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
import { CrcError, ResyncError, TimeoutError } from "../src/core/errors";

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
};

type ReadStep =
  | { type: "chunk"; value: Uint8Array } // read() resolved immediately
  | { type: "pending" } // read() does not resolve until manually resolved with __resolveNextRead()
  | { type: "end" }; // read() resolves like stream closed

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function fakeTransport(
  steps: Array<Uint8Array | ReadStep>,
  opts: FakeTransportOpts = {},
) {
  const t = Object.create(WebSerialTransport.prototype) as any;

  t.timeout = opts.timeout ?? 50;
  t.rxBuf = new Uint8Array(0);

  if (opts.strictCrc !== undefined) t.strictCrc = opts.strictCrc;
  if (opts.maxResyncDrops !== undefined) t.maxResyncDrops = opts.maxResyncDrops;

  t.writer = { write: async () => {} };

  const normalized: ReadStep[] = steps.map((s) =>
    s instanceof Uint8Array ? { type: "chunk", value: s } : s,
  );

  const pendingReads: Array<
    ReturnType<typeof deferred<{ value?: Uint8Array; done?: boolean }>>
  > = [];

  const it = normalized[Symbol.iterator]();

  t.__resolveNextRead = (value?: Uint8Array) => {
    const d = pendingReads.shift();
    if (!d) throw new Error("No pending read");
    d.resolve(
      value ? { value, done: false } : { value: undefined, done: true },
    );
  };

  t.__pendingReads = pendingReads;

  function makeReader() {
    return {
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
    };
  }

  t.port = {
    readable: {
      getReader: () => makeReader(),
    },
  };
  t.reader = t.port.readable.getReader();

  return t as WebSerialTransport & {
    __resolveNextRead: (value?: Uint8Array) => void;
    __pendingReads: Array<
      ReturnType<typeof deferred<{ value?: Uint8Array; done?: boolean }>>
    >;
  };
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

  it("throws TimeoutError when nothing arrives", async () => {
    const tr = fakeTransport([]); // reader returns undefined
    await expect(tr.transact(new Uint8Array([0]))).rejects.toBeInstanceOf(
      TimeoutError,
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
  it("throws TimeoutError when stream ends mid-frame", async () => {
    const ok = buildResponse([1, 0x03, 0x02, 0x12, 0x34]);
    const partial = ok.slice(0, 4); // missing bytes
    const tr = fakeTransport([partial]); // then reader returns undefined forever
    const req = Uint8Array.from([1, 0x03]);

    await expect(tr.transact(req)).rejects.toBeInstanceOf(TimeoutError);
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

  /* Timeout fixes patch-0.10.4 */
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

    await Promise.resolve(); // let first read start
    tr.__resolveNextRead(ok.slice(0, 3));
    await Promise.resolve(); // let it loop to second read

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
    await Promise.resolve();
    tr.__resolveNextRead(good);

    await expect(p2).resolves.toEqual(good);

    vi.useRealTimers();
  });

  it.skip("does not let a late reply from a timed-out transaction satisfy the next one", async () => {
    // Requires explicit post-timeout stale-frame draining/resync policy.
    // Current transport matches only by function code, so a late old reply
    // can be accepted by the next transact() call.
  });
});
