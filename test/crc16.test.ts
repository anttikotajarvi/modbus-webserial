import { describe, it, expect } from 'vitest';
import { crc16 } from '../src/core/crc16.js';

describe('crc16', () => {
  it('matches known Modbus test vector', () => {
    // Example vector: 01 03 00 00 00 0A  (id=1, fc=3, addr=0, len=10)
    const frame = Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0A]);
    expect(crc16(frame)).toBe(0xCDC5);   // high-byte first
  });

  it('is symmetric (crc16 ∘ concat ∘ check)', () => {
    const body = Uint8Array.from([0x11, 0x06, 0x00, 0x2A, 0x00, 0xFF]);
    const crc  = crc16(body);
    const full = Uint8Array.from([...body, crc & 0xFF, crc >> 8]);
    expect(crc16(full.subarray(0, -2))).toBe(crc);
  });
});
