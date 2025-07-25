import { describe, it, expect } from 'vitest';
import { ModbusRTU } from '../src/client.js';
import { crc16 } from '../src/core/crc16.js';
import { FC_READ_HOLDING } from '../src/core/types.js';

// --- mock transport ---------------------------------------------------------
class MockTransport {
  calls: Uint8Array[] = [];

  async transact(frame: Uint8Array): Promise<Uint8Array> {
    this.calls.push(frame);

    const id = frame[0], fc = frame[1];
    if (fc === FC_READ_HOLDING) {
      // Respond with two registers: 0x1234 0x5678
      const respBody = Uint8Array.from([
        id, fc, 0x04, 0x12, 0x34, 0x56, 0x78
      ]);
      const crc = crc16(respBody);
      return Uint8Array.from([...respBody, crc & 0xFF, crc >> 8]);
    }
    throw new Error('unexpected fc');
  }

  async close() { /* no-op */ }
}

// Monkey-patch helper
function fakeClient(): ModbusRTU {
  const cli = Object.create(ModbusRTU.prototype) as ModbusRTU;
  (cli as any).transport = new MockTransport();
  return cli;
}
// ---------------------------------------------------------------------------

describe('ModbusRTU high-level helpers', () => {
  it('readHoldingRegisters returns parsed numbers', async () => {
    const cli = fakeClient();
    const res = await cli.readHoldingRegisters(0x0000, 2);
    expect(res.data).toEqual([0x1234, 0x5678]);
  });
});
