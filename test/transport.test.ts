/**
 * WebSerialTransport “byte-stream” tests
 * --------------------------------------
 * These unit-tests operate directly on the transport’s receive logic,
 * bypassing the higher-level Modbus client.  We emulate the browser’s
 * `ReadableStream` by feeding predefined byte-chunks into a fake reader
 * so we can verify that the state-machine in `transact()`:
 *
 *   1.   Correctly re-assembles a frame that arrives split across
 *        multiple USB packets.
 *   2.   Returns the first frame when two valid replies arrive
 *        back-to-back in the same packet (and leaves the second for
 *        the next call).
 *   3.   Drops a frame with a bad CRC, resynchronises, and successfully
 *        parses the next good frame.
 *   4.   Throws TimeoutError when no data arrives within the deadline.
 *
 * NOTE: Since `transact()` now matches responses by function-code, each
 * test builds a *stub* request (`req`) whose FC matches the frame(s)
 * we expect the transport to return.  Only the first two bytes of `req`
 * (`id`, `fc`) are inspected by the transport — the remainder is ignored.
 */
import { describe, it, expect, vi } from "vitest";
import { WebSerialTransport } from "../src/transport/webserial";
import { crc16 } from "../src/core/crc16";
import {
  CrcError,
  ResyncError,
  StreamClosedError,
  TimeoutError,
} from "../src/core/errors";

function buildResponse(frameBody: number[]): Uint8Array {
  const crc = crc16(Uint8Array.from(frameBody));
  return Uint8Array.from([...frameBody, crc & 0xff, crc >> 8]);
}
// ----------------------------------------------------------------
//  helper: build a mock WebSerialTransport whose reader yields `chunks`
// ------------------------------------------------------------------ */
type FakeTransportOpts = {
  timeout?: number;
  strictCrc?: boolean;
  maxResyncDrops?: number;
  postTimeoutWaitPeriod?: number;
  interRequestDelay?: number;
};

type ReadStep =
  | Uint8Array
  | { type: "chunk"; value: Uint8Array }
  | { type: "pending" }
  | { type: "end" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function fakeTransport(steps: ReadStep[], opts: FakeTransportOpts = {}) {
  const t = Object.create(WebSerialTransport.prototype) as any;

  // ---- important: initialize fields that class initializers would set ----
  t.postTimeoutWaitPeriod = opts.postTimeoutWaitPeriod ?? 0;
  t.dirtyUntil = 0;
  t.inFlight = false;
  t.interRequestDelay = opts.interRequestDelay ?? 0;

  // existing fields you already set
  t.timeout = opts.timeout ?? 50;
  t.rxBuf = new Uint8Array(0);
  if (opts.strictCrc !== undefined) t.strictCrc = opts.strictCrc;
  if (opts.maxResyncDrops !== undefined) t.maxResyncDrops = opts.maxResyncDrops;

  t.writer = { write: async () => {} };

  const normalized = steps.map((s) =>
    s instanceof Uint8Array ? { type: "chunk", value: s } : s,
  );

  const it = normalized[Symbol.iterator]();
  const pendingReads: Array<
    ReturnType<typeof deferred<{ value?: Uint8Array; done?: boolean }>>
  > = [];

  const makeReader = () => ({
    read: () => {
      const { value, done } = it.next();

      if (done || value.type === "end") {
        return Promise.resolve({ value: undefined, done: true });
      }

      if (value.type === "chunk") {
        return Promise.resolve({ value: value.value, done: false });
      }

      const d = deferred<{ value?: Uint8Array; done?: boolean }>();
      pendingReads.push(d);
      return d.promise;
    },
    cancel: async () => {
      const d = pendingReads.shift();
      d?.resolve({ value: undefined, done: true });
    },
    releaseLock: () => {},
  });

  t.port = {
    readable: {
      getReader: () => makeReader(),
    },
  };

  t.reader = t.port.readable.getReader();

  t.__pendingReads = pendingReads;
  t.__resolveNextRead = (value?: Uint8Array) => {
    const d = pendingReads.shift();
    if (!d) throw new Error("No pending read");
    d.resolve(
      value ? { value, done: false } : { value: undefined, done: true },
    );
  };

  return t as WebSerialTransport & {
    __pendingReads: typeof pendingReads;
    __resolveNextRead: (value?: Uint8Array) => void;
  };
}

async function waitForPendingRead(tr: { __pendingReads: unknown[] }) {
  for (let i = 0; i < 1000; i++) {
    if (tr.__pendingReads.length > 0) return;

    await Promise.resolve();

    // If fake timers are enabled, this helps.
    // If not, Vitest throws "Timers are not mocked" — ignore that.
    try {
      await vi.advanceTimersByTimeAsync(0);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!msg.includes("Timers are not mocked")) throw e;
    }
  }
  throw new Error("waitForPendingRead: timed out waiting for pending read");
}

describe("WebSerialTransport frame assembly", () => {
  it("assembles split frame (two chunks)", async () => {
    const okFrame = buildResponse([1, 0x03, 0x02, 0x12, 0x34]); // id=1, fc=3, byteCnt=2
    const chunks = [okFrame.slice(0, 3), okFrame.slice(3)]; // split position

    const tr = fakeTransport(chunks);
    const req = Uint8Array.from([1, 0x03]); // any FC-03 request stub
    const res = await tr.transact(req);
    expect(res).toEqual(okFrame);
  });

  it("returns first of two back-to-back frames", async () => {
    const f1 = buildResponse([1, 0x06, 0x00, 0x01, 0xbe, 0xef]); // FC 06 echo
    const f2 = buildResponse([1, 0x06, 0x00, 0x02, 0x12, 0x34]);
    const tr = fakeTransport([Uint8Array.from([...f1, ...f2])]);
    const req = Uint8Array.from([1, 0x06]); // FC-06 stub
    const r1 = await tr.transact(req);
    const r2 = await tr.transact(req);
    expect(r1).toEqual(f1);
    expect(r2).toEqual(f2);
  });

  it("throws StreamClosedError when nothing arrives", async () => {
    const tr = fakeTransport([]); // reader returns undefined
    await expect(tr.transact(new Uint8Array([0]))).rejects.toBeInstanceOf(
      StreamClosedError,
    );
  });

  it("ignores frame with wrong function code", async () => {
    const wrong = buildResponse([1, 0x06, 0x00, 0x01, 0xbe, 0xef]); // FC 06
    const right = buildResponse([1, 0x03, 0x02, 0xaa, 0x55]); // FC 03
    const tr = fakeTransport([Uint8Array.from([...wrong, ...right])]);
    const req = Uint8Array.from([1, 0x03]);

    await expect(tr.transact(req)).resolves.toEqual(right);
  });

  it("strict: throws CrcError on bad frame", async () => {
    const bad = Uint8Array.from([1, 0x03, 0x02, 0x12, 0x34, 0x00, 0x00]);
    const good = buildResponse([1, 0x03, 0x02, 0xaa, 0x55]);
    const tr = fakeTransport([bad, good], { strictCrc: true });
    const req = Uint8Array.from([1, 0x03]);

    await expect(tr.transact(req)).rejects.toBeInstanceOf(CrcError);
    await expect(tr.transact(req)).resolves.toEqual(good);
  });

  it("resync: ignores bad frame and returns good frame", async () => {
    const bad = Uint8Array.from([1, 0x03, 0x02, 0x12, 0x34, 0x00, 0x00]);
    const good = buildResponse([1, 0x03, 0x02, 0xaa, 0x55]);
    const tr = fakeTransport([bad, good], {
      strictCrc: false,
      maxResyncDrops: 32,
    });
    const req = Uint8Array.from([1, 0x03]);

    const ok = await tr.transact(req);
    expect(ok).toEqual(good);
  });

  it("parses exception frame (fc|0x80) with fixed 5-byte length", async () => {
    // id=1, fc=0x83 (03|0x80), exc=0x02, crc computed by buildResponse
    const exc = buildResponse([1, 0x83, 0x02]);
    const tr = fakeTransport([exc]);
    const req = Uint8Array.from([1, 0x03]); // expectedFC=0x03, but response fc&0x7f=0x03

    await expect(tr.transact(req)).resolves.toEqual(exc);
  });

  it("resync: throws ResyncError when maxResyncDrops exceeded", async () => {
    const bad = Uint8Array.from([1, 0x03, 0x02, 0x12, 0x34, 0x00, 0x00]);

    // feed enough bad chunks that drops will exceed limit
    const tr = fakeTransport(
      Array.from({ length: 50 }, () => bad),
      {
        strictCrc: false,
        maxResyncDrops: 4,
        timeout: 2000, // ensure we fail by drops, not timeout
      },
    );

    const req = Uint8Array.from([1, 0x03]);
    await expect(tr.transact(req)).rejects.toBeInstanceOf(ResyncError);
  });
  it("assembles variable-length frame with larger byteCount", async () => {
    const ok = buildResponse([
      1, 0x03, 0x06, 0xde, 0xad, 0xbe, 0xef, 0x12, 0x34,
    ]); // byteCnt=6
    const tr = fakeTransport([ok.slice(0, 4), ok.slice(4)]); // split mid-payload
    const req = Uint8Array.from([1, 0x03]);

    await expect(tr.transact(req)).resolves.toEqual(ok);
  });
  it("throws StreamClosedError when stream ends mid-frame", async () => {
    const ok = buildResponse([1, 0x03, 0x02, 0x12, 0x34]);
    const partial = ok.slice(0, 4); // missing bytes
    const tr = fakeTransport([partial]); // then reader returns undefined forever
    const req = Uint8Array.from([1, 0x03]);

    await expect(tr.transact(req)).rejects.toBeInstanceOf(StreamClosedError);
  });

  it("resync: handles bad+good in same chunk", async () => {
    const bad = Uint8Array.from([1, 0x03, 0x02, 0x12, 0x34, 0x00, 0x00]);
    const good = buildResponse([1, 0x03, 0x02, 0xaa, 0x55]);

    const tr = fakeTransport([Uint8Array.from([...bad, ...good])], {
      strictCrc: false,
      maxResyncDrops: 64,
    });

    const req = Uint8Array.from([1, 0x03]);
    await expect(tr.transact(req)).resolves.toEqual(good);
  });

  it("resync: handles good+bad+good in same chunk", async () => {
    const bad = Uint8Array.from([1, 0x03, 0x02, 0x12, 0x34, 0x00, 0x00]);
    const good = buildResponse([1, 0x03, 0x02, 0xaa, 0x55]);

    const tr = fakeTransport([Uint8Array.from([...good, ...bad, ...good])], {
      strictCrc: false,
      maxResyncDrops: 64,
    });

    const req = Uint8Array.from([1, 0x03]);
    await expect(tr.transact(req)).resolves.toEqual(good);
  });

  /* Timeout/concurrency fixes patch-0.10.4 */
  it("times out even when reader.read() stays pending", async () => {
    vi.useFakeTimers();

    const tr = fakeTransport([{ type: "pending" }], { timeout: 100 });
    const req = Uint8Array.from([1, 0x03]);

    const p = expect(tr.transact(req)).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(101);
    await p;

    vi.useRealTimers();
  });

  it("times out while waiting for the second chunk of a partial frame", async () => {
    vi.useFakeTimers();

    const tr = fakeTransport([{ type: "pending" }, { type: "pending" }], {
      timeout: 100,
    });
    const req = Uint8Array.from([1, 0x03]);
    const ok = buildResponse([1, 0x03, 0x02, 0x12, 0x34]);

    const p = expect(tr.transact(req)).rejects.toBeInstanceOf(TimeoutError);

    await waitForPendingRead(tr);
    tr.__resolveNextRead(ok.slice(0, 3));

    await waitForPendingRead(tr);
    await vi.advanceTimersByTimeAsync(101);
    await p;

    vi.useRealTimers();
  });

  it("does not lose the next reply after a timed-out read", async () => {
    vi.useFakeTimers();

    const tr = fakeTransport([{ type: "pending" }, { type: "pending" }], {
      timeout: 100,
    });
    const req = Uint8Array.from([1, 0x03]);
    const good = buildResponse([1, 0x03, 0x02, 0xaa, 0x55]);

    const p1 = expect(tr.transact(req)).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(101);
    await p1;

    const p2 = tr.transact(req);
    await waitForPendingRead(tr);
    tr.__resolveNextRead(good);

    await expect(p2).resolves.toEqual(good);

    vi.useRealTimers();
  });

  it("rejects concurrent transact() calls", async () => {
    const tr = fakeTransport([{ type: "pending" }], { timeout: 100 });
    const req = Uint8Array.from([1, 0x03]);

    const p1 = tr.transact(req);
    await waitForPendingRead(tr);

    await expect(tr.transact(req)).rejects.toThrow(/Concurrent transact\(\)/i);

    // Cleanup: end the pending read so p1 settles (avoid hanging test)
    tr.__resolveNextRead(undefined);

    await expect(p1).rejects.toBeInstanceOf(StreamClosedError);
  });

  it("post-timeout quarantine discards stale response bytes", async () => {
    vi.useFakeTimers();

    const req = Uint8Array.from([1, 0x06]); // any FC is fine
    const stale = buildResponse([1, 0x06, 0x00, 0x10, 0x12, 0x34]); // echo-ish 8 bytes with CRC from helper
    const good = buildResponse([1, 0x06, 0x00, 0x20, 0xab, 0xcd]);

    // steps:
    // 1) first transact: pending read => timeout
    // 2) second transact: during waitOutDirtyPeriod, transport reads and discards 'stale' chunk
    // 3) still in wait period: pending read so timer can elapse (no more data)
    // 4) after quarantine ends and request is written, next read returns 'good'
    const tr = fakeTransport(
      [
        { type: "pending" }, // first transact read
        { type: "chunk", value: stale }, // quarantine drain read #1
        { type: "pending" }, // quarantine drain read #2 (lets time pass)
        { type: "chunk", value: good }, // actual response for second transact
      ],
      { timeout: 50, postTimeoutWaitPeriod: 200 },
    );

    // First transact times out
    const p1 = expect(tr.transact(req)).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(51);
    await p1;

    // Start second transact immediately; it should quarantine-wait and discard stale
    const p2 = tr.transact(req);

    // Let it reach the first quarantine read (stale chunk is immediate so one tick is enough)
    await Promise.resolve();

    // Now it should be sitting on the pending drain read; advance time to finish quarantine
    await vi.advanceTimersByTimeAsync(201);

    await expect(p2).resolves.toEqual(good);

    vi.useRealTimers();
  });

  it("with postTimeoutWaitPeriod=0, a late same-FC frame can satisfy the next call (documented behavior)", async () => {
    vi.useFakeTimers();

    const tr = fakeTransport([{ type: "pending" }, { type: "pending" }], {
      timeout: 100,
    });
    (tr as any).postTimeoutWaitPeriod = 0;

    const req = Uint8Array.from([1, 0x03]);
    const stale = buildResponse([1, 0x03, 0x02, 0x11, 0x22]);

    const p1 = expect(tr.transact(req)).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(101);
    await p1;

    const p2 = tr.transact(req);
    await waitForPendingRead(tr);
    tr.__resolveNextRead(stale);

    await expect(p2).resolves.toEqual(stale);

    vi.useRealTimers();
  });

  it("interRequestDelay: does not delay the first request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const req = Uint8Array.from([1, 0x03]);
    const r1 = buildResponse([1, 0x03, 0x02, 0x12, 0x34]);

    const tr = fakeTransport([r1], { interRequestDelay: 200, timeout: 1000 });
    const write = vi.fn(async () => {});
    (tr as any).writer.write = write;

    const p = tr.transact(req);
    // Let async code run a tick.
    await Promise.resolve();

    // Even with interRequestDelay, the *first* call should write immediately.
    expect(write).toHaveBeenCalledTimes(1);
    await expect(p).resolves.toEqual(r1);

    vi.useRealTimers();
  });

  it("interRequestDelay: delays the next request write until the delay has elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const req = Uint8Array.from([1, 0x03]);
    const r1 = buildResponse([1, 0x03, 0x02, 0xaa, 0x55]);
    const r2 = buildResponse([1, 0x03, 0x02, 0xde, 0xad]);

    const tr = fakeTransport([r1, r2], { interRequestDelay: 200, timeout: 1000 });
    const write = vi.fn(async () => {});
    (tr as any).writer.write = write;

    // First request completes.
    await expect(tr.transact(req)).resolves.toEqual(r1);
    expect(write).toHaveBeenCalledTimes(1);

    // Second request: should not write immediately.
    const p2 = tr.transact(req);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(199);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(2);

    await expect(p2).resolves.toEqual(r2);

    vi.useRealTimers();
  });
  });
