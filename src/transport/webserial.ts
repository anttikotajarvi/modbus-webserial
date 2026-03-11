import { TimeoutError, CrcError, ResyncError } from "../core/errors.js";
import { crc16 } from "../core/crc16.js";

// ----------------------------------------------------------------
//  User-visible options
// ----------------------------------------------------------------
export interface WebSerialOptions {
  baudRate?: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  requestFilters?: SerialPortFilter[];
  port?: SerialPort;
  timeout?: number; // ms,
  crcPolicy?: CrcPolicy;
}

/* CRC policy for resyncing versus throwing on bad frames */
type CrcPolicy =
  | {
      mode: "strict";
    }
  | {
      mode: "resync";
      maxResyncDrops?: number;
    };
const DEFAULT_CRC_POLICY: CrcPolicy = { mode: "strict" };
const DEFAULT_MAX_RESYNC_DROPS = 32;

// ----------------------------------------------------------------
// WebSerialTransport
// ----------------------------------------------------------------
export class WebSerialTransport {
  private port!: SerialPort;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;

  private timeout = 500;
  private rxBuf = new Uint8Array(0); // rolling buffer across calls

  private strictCrc = true;
  private maxResyncDrops = DEFAULT_MAX_RESYNC_DROPS;

  // timeout gelpers
  setTimeout(ms: number) {
    this.timeout = ms;
  }
  getTimeout() {
    return this.timeout;
  }
  getPort() {
    return this.port;
  }

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
    this.port =
      opts.port ??
      (await navigator.serial.requestPort({
        filters: opts.requestFilters ?? [],
      }));
    await this.port.open({
      baudRate: opts.baudRate ?? 9600,
      dataBits: opts.dataBits ?? 8,
      stopBits: opts.stopBits ?? 1,
      parity: opts.parity ?? "none",
    });
    this.reader = this.port.readable!.getReader();
    this.writer = this.port.writable!.getWriter();

    // CRC policy defaults
    const policy = opts.crcPolicy ?? DEFAULT_CRC_POLICY;

    if (policy.mode === "strict") {
      this.strictCrc = true;
      this.maxResyncDrops = 0; // irrelevant in strict mode
    } else {
      this.strictCrc = false;
      this.maxResyncDrops = policy.maxResyncDrops ?? DEFAULT_MAX_RESYNC_DROPS;
    }
  }

  // ----------------------------------------------------------------
  //  transact(): Send `req` and await a response whose function-code matches the request
  // ---------------------------------------------------------------- */
  async transact(req: Uint8Array): Promise<Uint8Array> {
    await this.writer.write(req);

    const STRICT_CRC = this.strictCrc;
    const MAX_RESYNC_DROPS = this.maxResyncDrops; // interpreted as max discarded bytes

    const expectedFC = req[1] & 0x7f;
    const deadline = Date.now() + this.timeout;

    enum State {
      TRY_EXTRACT,
      HAVE_FRAME,
      BAD_CRC,
      NEED_READ,
    }
    let state: State = State.TRY_EXTRACT;

    let frame: Uint8Array | null = null;
    let discardedBytes = 0;

    while (true) {
      switch (state as State) {
        case State.TRY_EXTRACT: {
          frame = this.extractFrame();
          if (!frame) {
            state = State.NEED_READ;
            break; // I/O next
          }

          state = State.HAVE_FRAME;
          // [[fallthrough]] - frame ready, process immediately
        }

        case State.HAVE_FRAME: {
          if (this.crcOk(frame!)) {
            const fc = frame![1] & 0x7f;
            if (fc === expectedFC) return frame!;

            frame = null;
            state = State.TRY_EXTRACT;
            continue;
          }

          state = State.BAD_CRC;
          // [[fallthrough]]
        }
        case State.BAD_CRC: {
          if (STRICT_CRC) throw new CrcError();

          // Discarded a whole candidate frame (already popped from rxBuf).
          discardedBytes += frame ? frame.length : 0;
          frame = null;

          if (discardedBytes >= MAX_RESYNC_DROPS) {
            throw new ResyncError(discardedBytes, MAX_RESYNC_DROPS);
          }

          // IMPORTANT: do NOT drop 1 byte from rxBuf here.
          // rxBuf may already begin with the next valid frame (bad+good in same chunk).
          // Just continue parsing what remains.
          if (this.rxBuf.length > 0) {
            state = State.TRY_EXTRACT;
            continue;
          }

          state = State.NEED_READ;
          // [[fallthrough]]
        }

        case State.NEED_READ: {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new TimeoutError();

          const value = await this.readWithTimeout(remaining);

          this.rxBuf = concat(this.rxBuf, value);
          state = State.TRY_EXTRACT;
          continue;
        }

        default:
          throw new Error("invalid state");
      }
    }
  }

  private async resetReaderAfterTimeout() {
    try {
      await this.reader.cancel();
    } catch {
      // [[swallow]]
    }

    try {
      this.reader.releaseLock();
    } catch {
      // [[swallow]]
    }

    this.reader = this.port.readable!.getReader();
  }

  private async readWithTimeout(ms: number): Promise<Uint8Array> {
    const TIMEOUT = Symbol("timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race<
        ReadableStreamReadResult<Uint8Array> | typeof TIMEOUT
      >([
        this.reader.read(),
        new Promise<typeof TIMEOUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMEOUT), ms);
        }),
      ]);

      if (result === TIMEOUT) {
        await this.resetReaderAfterTimeout();
        throw new TimeoutError();
      }

      if (result.done || !result.value) {
        throw new TimeoutError();
      }

      return result.value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private extractFrame(): Uint8Array | null {
    if (this.rxBuf.length < 3) return null;

    const need = this.frameLengthIfComplete(this.rxBuf);
    if (need === 0) return null;

    const frame = this.rxBuf.slice(0, need);
    this.rxBuf = this.rxBuf.slice(need);
    return frame;
  }

  private crcOk(frame: Uint8Array): boolean {
    const crc = crc16(frame.subarray(0, frame.length - 2));
    const crcOk =
      (crc & 0xff) === frame[frame.length - 2] &&
      crc >> 8 === frame[frame.length - 1];
    return crcOk;
  }

  // ----------------------------------------------------------------
  //  Determine expected length; return 0 if we still need more bytes
  // ----------------------------------------------------------------
  private frameLengthIfComplete(buf: Uint8Array): number {
    if (buf.length < 3) return 0; // need id + fc + 1

    const id = buf[0];
    const fc = buf[1];

    // Optional but helpful sanity: Modbus RTU response slave ids are 1..247.
    // (id=0 is broadcast and should not respond)
    if (id === 0 || id > 247) return 0;

    // Exception: id, fc|0x80, exc, crcLo, crcHi
    if (fc & 0x80) return buf.length >= 5 ? 5 : 0;

    // Variable-length replies (byte-count in byte 2)
    if (fc === 0x01 || fc === 0x02 || fc === 0x03 || fc === 0x04) {
      const byteCount = buf[2];

      // Sanity bound: prevents misalignment from forcing a huge "need"
      // 3(header) + byteCount + 2(CRC) must fit within RTU ADU limits.
      if (byteCount > 252) {
        // Heuristic fallback: allow CRC-based resync by treating as fixed 8-byte candidate
        return buf.length >= 8 ? 8 : 0;
      }

      const need = 3 + byteCount + 2;
      return buf.length >= need ? need : 0;
    }

    // Echo frames with fixed 8-byte length
    if (fc === 0x05 || fc === 0x06 || fc === 0x0f || fc === 0x10)
      return buf.length >= 8 ? 8 : 0;

    // Unsupported FC – heuristic: fixed 8-byte candidate to enable CRC-based resync
    return buf.length >= 8 ? 8 : 0;
  }

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
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
