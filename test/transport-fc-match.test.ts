/**
 * FC-matching test
 * ----------------
 * `WebSerialTransport.transact()` must return ONLY the response frame
 * whose function-code (FC) matches the request it just sent.  
 *
 * To prove that, we:
 *   • Craft two valid frames:  ─ f1  = stray  FC 03   (Read Holding)
 *                              ─ f2  = correct FC 06  (Write-single echo)
 *   • Deliver them *concatenated* in one USB chunk so the stray
 *     frame arrives first.
 *   • Send a stub request whose FC = 0x06.
 *
 * The transport should:
 *   1) Parse f1, see FC ≠ expected, discard it.
 *   2) Parse f2 next, see FC matches, and return it.
 *
 * If the matcher is missing or wrong, `transact()` will either
 *   – time-out waiting for a “matching” frame, or
 *   – return the wrong FC and the helper’s parser will throw
 *     “Unexpected function code”.
 *
 * The test passes when the received frame equals the FC 06 echo.
 */
import { it, expect } from 'vitest';
import { WebSerialTransport } from '../src/transport/webserial';
import { crc16 } from '../src/core/crc16';

// helpers
function build(buf: number[]): Uint8Array {
  const crc = crc16(Uint8Array.from(buf));
  return Uint8Array.from([...buf, crc & 0xff, crc >> 8]);
}

function fakeTransport(chunks: Uint8Array[]): WebSerialTransport {
  const t = Object.create(WebSerialTransport.prototype) as any;
  t.timeout = 50;
  t.rxBuf   = new Uint8Array(0);
  t.writer  = { write: async () => {} };

  // iterator that yields our prepared byte-chunks
  const it = chunks[Symbol.iterator]();
  t.reader = {
    read: async () => {
      const { value, done } = it.next();
      return done ? { value: undefined } : { value };
    }
  };
  return t as WebSerialTransport;
}

// ------------------------------------------------------------------
//  The test: two frames arrive together. transact() must skip the
//  wrong-FC frame and return the one matching the request.
// ------------------------------------------------------------------
it('transact returns frame that matches request FC', async () => {
  const reqWriteReg = Uint8Array.from([1, 0x06, 0, 1, 0xBE, 0xEF]); // FC 06
  const echo06 = build([1, 0x06, 0x00, 0x01, 0xBE, 0xEF]);          // correct echo
  const read03 = build([1, 0x03, 0x02, 0x12, 0x34]);                // stray FC 03

  // put stray FC-03 first to simulate overlap
  const tr = fakeTransport([Uint8Array.from([...read03, ...echo06])]);

  const res = await tr.transact(reqWriteReg);
  expect(res).toEqual(echo06);                 // got the matching FC 06 frame
});
