import { TimeoutError, CrcError, ResyncError, StreamClosedError } from "../core/errors.js";
import { crc16 } from "../core/crc16.js";
import {
  FC_MASK_WRITE_REGISTER,
  FC_READ_COILS,
  FC_READ_DISCRETE_INPUTS,
  FC_READ_FIFO_QUEUE,
  FC_READ_FILE_RECORD,
  FC_READ_HOLDING_REGISTERS,
  FC_READ_INPUT_REGISTERS,
  FC_READ_WRITE_MULTIPLE_REGISTERS,
  FC_WRITE_FILE_RECORD,
  FC_WRITE_MULTIPLE_COILS,
  FC_WRITE_MULTIPLE_HOLDING_REGISTERS,
  FC_WRITE_SINGLE_COIL,
  FC_WRITE_SINGLE_HOLDING_REGISTER,
} from "../core/types.js";

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
  postTimeoutWaitPeriod?: number; // ms
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

  private postTimeoutWaitPeriod = 0;
  private dirtyUntil = 0;
  private inFlight = false;

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

    // Timeout settings
    this.postTimeoutWaitPeriod = opts.postTimeoutWaitPeriod ?? 0;

    // Prefer 'performance.now()' over 'Date.now()'
    // For some reason just defining a singleton for now
    //  caused tests to break
    if (typeof performance !== "undefined") {
      this.now = () => performance.now();
    }
  }

  // ----------------------------------------------------------------
  //  transact(): Send `req` and await a response whose function-code matches the request
  // ---------------------------------------------------------------- */
  async transact(req: Uint8Array): Promise<Uint8Array> {
    if (this.inFlight) {
      throw new Error("Concurrent transact() calls are not supported");
    }

    this.inFlight = true;
    try {
      await this.waitOutDirtyPeriod();
      await this.writer.write(req);

      const STRICT_CRC = this.strictCrc;
      const MAX_RESYNC_DROPS = this.maxResyncDrops; // interpreted as max discarded bytes

      const deadline = this.now() + this.timeout;

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
              // If no mismatch -> return the frame
              if (!proveRequestResponseMismatch(req, frame!)) return frame!;

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
            const now = this.now();
            const remaining = deadline - now;
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
    } finally {
      this.inFlight = false;
    }
  }
  private static readonly TIMEOUT = Symbol("timeout");
  private async readOnce(
    maxMs: number,
  ): Promise<
    | { kind: "chunk"; value: Uint8Array }
    | { kind: "timeout" }
    | { kind: "closed" }
  > {
    if (maxMs <= 0) return { kind: "timeout" } as const;

    const ms = Math.max(1, maxMs);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race<
        ReadableStreamReadResult<Uint8Array> | typeof WebSerialTransport.TIMEOUT
      >([
        this.reader.read(),
        new Promise<typeof WebSerialTransport.TIMEOUT>((resolve) => {
          timer = setTimeout(() => resolve(WebSerialTransport.TIMEOUT), ms);
        }),
      ]);

      if (result === WebSerialTransport.TIMEOUT) return { kind: "timeout" } as const;
      if (result.done || !result.value) return { kind: "closed" } as const;
      return { kind: "chunk", value: result.value } as const;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async waitOutDirtyPeriod() {
    for (;;) {
      const now = this.now();
      if (now >= this.dirtyUntil) return;

      const remaining = this.dirtyUntil - now;
      const r = await this.readOnce(remaining);

      if (r.kind !== "chunk") break; // timeout or closed
      // discard and continue draining
    }

    this.rxBuf = new Uint8Array(0);
  }

  private async readWithTimeout(ms: number): Promise<Uint8Array> {
    const r = await this.readOnce(ms);

    if (r.kind === "chunk") return r.value;

    if (r.kind === "timeout") {
      await this.resetReaderAfterTimeout();
      this.rxBuf = new Uint8Array(0);
      this.dirtyUntil = this.now() + this.postTimeoutWaitPeriod;
      throw new TimeoutError();
    }

    if (r.kind === "closed") {
      throw new StreamClosedError();
    }

    throw new Error("invalid read result");
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

  private now(): number {
    return Date.now();
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
    if (
      fc === 0x05 || // write single coil
      fc === 0x06 || // write single register
      fc === 0x0f || // write multiple coils
      fc === 0x10 || // write multiple registers
      fc === 0x16 // mask write register
    )
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

/**
 * We cannot prove that a response matches a request,
 * but we can prove a mismatch by:
 *  - Device address
 *  - Function code
 *  - Length
 */
export function proveRequestResponseMismatch(
  req: Uint8Array,
  res: Uint8Array,
): boolean {
  if (req.length < 2 || res.length < 2) return false;

  const reqAddr = req[0];
  const reqFc = req[1] & 0x7f;

  const resAddr = res[0];
  const resFc = res[1];
  const resBaseFc = resFc & 0x7f;

  // Different slave/device address => definite mismatch
  if (resAddr !== reqAddr) return true;

  // Different function family => definite mismatch
  if (resBaseFc !== reqFc) return true;

  // Exception response: addr, fc|0x80, excCode, crcLo, crcHi
  // Same addr + same base FC + correct exception length is NOT a proven mismatch.
  if (resFc & 0x80) {
    return res.length !== 5;
  }

  switch (reqFc) {
    case FC_READ_COILS:
    case FC_READ_DISCRETE_INPUTS: {
      if (req.length < 6 || res.length < 3) return false;

      const quantity = u16be(req, 4);
      const expectedByteCount = Math.ceil(quantity / 8);

      if (res[2] !== expectedByteCount) return true;
      if (res.length !== 3 + expectedByteCount + 2) return true;

      return false;
    }

    case FC_READ_HOLDING_REGISTERS:
    case FC_READ_INPUT_REGISTERS: {
      if (req.length < 6 || res.length < 3) return false;

      const quantity = u16be(req, 4);
      const expectedByteCount = quantity * 2;

      if (res[2] !== expectedByteCount) return true;
      if (res.length !== 3 + expectedByteCount + 2) return true;

      return false;
    }

    case FC_WRITE_SINGLE_COIL:
    case FC_WRITE_SINGLE_HOLDING_REGISTER:
    case FC_MASK_WRITE_REGISTER: {
      // Response echoes request body (excluding CRC bytes)
      if (req.length < 8 || res.length < 8) return false;
      if (res.length !== req.length) return true;

      if (!bytesEqual(req, 2, res, 2, req.length - 4)) return true;

      return false;
    }

    case FC_WRITE_MULTIPLE_COILS:
    case FC_WRITE_MULTIPLE_HOLDING_REGISTERS: {
      // Fixed 8-byte response: addr fc startHi startLo qtyHi qtyLo crcLo crcHi
      if (req.length < 6 || res.length < 8) return false;
      if (res.length !== 8) return true;

      // start address + quantity echoed back
      if (!bytesEqual(req, 2, res, 2, 4)) return true;

      return false;
    }

    case FC_READ_WRITE_MULTIPLE_REGISTERS: {
      if (req.length < 10 || res.length < 3) return false;

      const readQuantity = u16be(req, 4);
      const expectedByteCount = readQuantity * 2;

      if (res[2] !== expectedByteCount) return true;
      if (res.length !== 3 + expectedByteCount + 2) return true;

      return false;
    }

    case FC_READ_FIFO_QUEUE: {
      // No useful request-side proof here beyond addr/fc.
      if (res.length < 6) return true;

      const byteCount = u16be(res, 2);

      if (byteCount < 2) return true;
      if (res.length !== 4 + byteCount + 2) return true;

      const fifoDataBytes = byteCount - 2;
      if (fifoDataBytes % 2 !== 0) return true;

      return false;
    }

    case FC_READ_FILE_RECORD:
    case FC_WRITE_FILE_RECORD: {
      if (res.length < 5) return true;

      const byteCount = res[2];
      if (res.length !== 3 + byteCount + 2) return true;

      return false;
    }

    default:
      // Unknown FC-specific semantics: not disproven
      return false;
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

function u16be(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1];
}

function bytesEqual(
  a: Uint8Array,
  aStart: number,
  b: Uint8Array,
  bStart: number,
  len: number,
): boolean {
  for (let i = 0; i < len; i++) {
    if (a[aStart + i] !== b[bStart + i]) return false;
  }
  return true;
}
