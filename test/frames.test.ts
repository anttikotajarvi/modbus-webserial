// test/frames.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildReadHolding, parseReadHolding,
  buildWriteSingle, parseWriteSingle
} from '../src/core/frames.js';
import { crc16 } from '../src/core/crc16.js';   // ← regular import here

describe('frame encoders & decoders', () => {
  it('round-trips read-holding (FC3)', () => {
    const req = buildReadHolding(1, 0x0123, 4);
    expect(req.length).toBe(8);

    // Fake slave response: 01 03 04 00 11 00 22 <crc>
    const respBody = Uint8Array.from([0x01, 0x03, 0x04, 0x00, 0x11, 0x00, 0x22]);
    const crc = crc16(respBody);                                // ← no await
    const resp = Uint8Array.from([...respBody, crc & 0xff, crc >> 8]);

    const words = parseReadHolding(resp);
    expect(words).toEqual([0x0011, 0x0022]);
  });

  it('round-trips write-single (FC6)', () => {
    const req = buildWriteSingle(1, 0x000A, 0x55AA);
    expect(req.length).toBe(8);

    const echo = parseWriteSingle(req);
    expect(echo).toEqual({ address: 0x000A, value: 0x55AA });
  });
});
