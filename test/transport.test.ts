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
import { describe, it, expect } from 'vitest';
import { WebSerialTransport } from '../src/transport/webserial';
import { crc16 } from '../src/core/crc16';
import { CrcError, TimeoutError } from '../src/core/errors';
import {
  buildReadHolding,
  buildWriteSingle
} from '../src/core/frames';

function buildResponse(frameBody: number[]): Uint8Array {
  const crc = crc16(Uint8Array.from(frameBody));
  return Uint8Array.from([...frameBody, crc & 0xff, crc >> 8]);
}
// ----------------------------------------------------------------
//  helper: build a mock WebSerialTransport whose reader yields `chunks`
// ------------------------------------------------------------------ */
function fakeTransport(chunks: Uint8Array[]): WebSerialTransport {
  // 1. create a plain object that inherits all real methods
  const t = Object.create(WebSerialTransport.prototype) as any;

  // 2. initialise the private fields we need
  t.timeout = 50;                 // ms
  t.rxBuf   = new Uint8Array(0);

  // stub writer
  t.writer  = { write: async () => {} };

  // stub reader that streams the predefined chunks
  const it = chunks[Symbol.iterator]();
  t.reader  = {
    read: async () => {
      const { value, done } = it.next();
      return done ? { value: undefined } : { value };
    }
  };

  return t as WebSerialTransport;
}

describe('WebSerialTransport frame assembly', () => {
  it('assembles split frame (two chunks)', async () => {
    const okFrame = buildResponse([1, 0x03, 0x02, 0x12, 0x34]); // id=1, fc=3, byteCnt=2
    const chunks  = [okFrame.slice(0, 3), okFrame.slice(3)];     // split position

    const tr  = fakeTransport(chunks);
    const req = Uint8Array.from([1, 0x03]);       // any FC-03 request stub
    const res = await tr.transact(req);
    expect(res).toEqual(okFrame);
  });

  it('returns first of two back-to-back frames', async () => {
    const f1 = buildResponse([1, 0x06, 0x00, 0x01, 0xBE, 0xEF]); // FC 06 echo
    const f2 = buildResponse([1, 0x06, 0x00, 0x02, 0x12, 0x34]);
    const tr = fakeTransport([Uint8Array.from([...f1, ...f2])]);
    const req = Uint8Array.from([1, 0x06]);       // FC-06 stub
    const r1  = await tr.transact(req);
    const r2  = await tr.transact(req);
    expect(r1).toEqual(f1);
    expect(r2).toEqual(f2);
  });

  it('throws CrcError on bad frame then resynchronises', async () => {
    const bad  = Uint8Array.from([1, 0x03, 0x02, 0x12, 0x34, 0x00, 0x00]); // wrong CRC
    const good = buildResponse([1, 0x03, 0x02, 0xAA, 0x55]);
    const tr  = fakeTransport([bad, good]);
    const req = Uint8Array.from([1, 0x03]);       // FC-03 stub
    await expect(tr.transact(req)).rejects.toBeInstanceOf(CrcError);
    const ok = await tr.transact(req);
    expect(ok).toEqual(good);
  });

  it('throws TimeoutError when nothing arrives', async () => {
    const tr = fakeTransport([]);              // reader returns undefined
    await expect(tr.transact(new Uint8Array([0])))
      .rejects.toBeInstanceOf(TimeoutError);
  });
});
