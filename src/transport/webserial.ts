import { TimeoutError, CrcError } from '../core/errors.js';
import { crc16 }            from '../core/crc16.js';

// ----------------------------------------------------------------
//  User-visible options
// ----------------------------------------------------------------
export interface WebSerialOptions {
  baudRate?: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?:   'none' | 'even' | 'odd';
  requestFilters?: SerialPortFilter[];
  timeout?: number;                 // ms
}

// ----------------------------------------------------------------
// WebSerialTransport
// ----------------------------------------------------------------
export class WebSerialTransport {
  private port!:   SerialPort;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;

  private timeout = 500;
  private rxBuf   = new Uint8Array(0);        // rolling buffer across calls

  // timeout gelpers
  setTimeout(ms: number) { this.timeout = ms; }
  getTimeout()          { return this.timeout; }

  // ----------------------------------------------------------------
  // Factory
  // ----------------------------------------------------------------
  static async open(opts: WebSerialOptions = {}): Promise<WebSerialTransport> {
    const t = new WebSerialTransport();
    await t.init(opts);
    return t;
  }

  private async init(opts: WebSerialOptions) {
    this.timeout = opts.timeout ?? 500;
    this.port = await navigator.serial.requestPort({ filters: opts.requestFilters ?? [] });
    await this.port.open({
      baudRate: opts.baudRate ?? 9600,
      dataBits: opts.dataBits ?? 8,
      stopBits: opts.stopBits ?? 1,
      parity:   opts.parity   ?? 'none'
    });
    this.reader = this.port.readable!.getReader();
    this.writer = this.port.writable!.getWriter();
  }

  // ----------------------------------------------------------------
  //  transact(): Send `req` and await a response whose function-code matches the request
  // ---------------------------------------------------------------- */
  async transact(req: Uint8Array): Promise<Uint8Array> {
    await this.writer.write(req);

    const expectedFC = req[1] & 0x7f;           // strip exception bit, if any
    const deadline   = Date.now() + this.timeout;

    while (true) {
      /* ---------- read / accumulate until we hold ≥ 3 bytes ---------- */
      while (this.rxBuf.length < 3) {
        if (Date.now() > deadline) throw new TimeoutError();
        const { value } = await this.reader.read();
        if (!value) throw new TimeoutError();
        this.rxBuf = concat(this.rxBuf, value);
      }

      /* ---------- can we determine the full length yet? -------------- */
      const need = this.frameLengthIfComplete(this.rxBuf);
      if (need === 0) {
        /* incomplete → read more or timeout */
        if (Date.now() > deadline) throw new TimeoutError();
        const { value } = await this.reader.read();
        if (!value) throw new TimeoutError();
        this.rxBuf = concat(this.rxBuf, value);
        continue;
      }

      /* ---------- slice the candidate frame -------------------------- */
      const frame = this.rxBuf.slice(0, need);
      this.rxBuf  = this.rxBuf.slice(need);     // keep leftovers

      /* ---------- CRC check ------------------------------------------ */
      const crc = crc16(frame.subarray(0, frame.length - 2));
      const crcOk = ((crc & 0xff) === frame[frame.length - 2] &&
                    (crc >> 8)   === frame[frame.length - 1]);
      if (!crcOk) {
        // bad frame: discard first byte and resync
        this.rxBuf = this.rxBuf.slice(1);
        throw new CrcError();
      }

      /* ---------- match function-code ---------------------------------- */
      const fc = frame[1] & 0x7f;               // clear exception bit
      if (fc === expectedFC) {
        return frame;                           // belongs to this request
      } else {
        // frame is for an earlier/later request; ignore **this** one.
        // `this.rxBuf` already contains any bytes that followed it (echo06 in tests),
        // so the loop will attempt to parse those next.
        continue;
      }
    }
  }

  // ----------------------------------------------------------------
  //  Determine expected length; return 0 if we still need more bytes
  // ----------------------------------------------------------------
  private frameLengthIfComplete(buf: Uint8Array): number {
    if (buf.length < 3) return 0;                 // need id + fc + 1
    const fc = buf[1];

    // Exception                               // id fc|0x80 exc CRC₂
    if (fc & 0x80) return buf.length >= 5 ? 5 : 0;

    // Variable-length replies (byte-count in byte 2)
    if (fc === 0x01 || fc === 0x02 || fc === 0x03 || fc === 0x04) {
      const need = 3 + buf[2] + 2;
      return buf.length >= need ? need : 0;
    }

    // Echo frames with fixed 8-byte length
    if (fc === 0x05 || fc === 0x06 || fc === 0x0F || fc === 0x10)
      return buf.length >= 8 ? 8 : 0;

    // Unsupported FC – fall back to fixed-echo length
    return buf.length >= 8 ? 8 : 0;
  }

  // -- close port --
  async close() {
    await this.reader?.cancel();
    await this.writer?.close();
    await this.port?.close();
  }
}

// ----------------------------------------------------------------
//  Tiny helper to concatenate Uint8Arrays
// ----------------------------------------------------------------
function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
