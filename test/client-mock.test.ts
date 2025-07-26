import { describe, it, expect } from 'vitest';
import { ModbusRTU } from '../src/client.js';
import {
  FC_READ_COILS,
  FC_WRITE_SINGLE_COIL,
  FC_WRITE_MULTIPLE_COILS,
  FC_READ_DISCRETE_INPUTS,
  FC_READ_INPUT_REGISTERS,
  FC_READ_HOLDING_REGISTERS,
  FC_WRITE_SINGLE_HOLDING_REGISTER,
  FC_WRITE_MULTIPLE_HOLDING_REGISTERS
} from '../src/core/types.js';
import { crc16 } from '../src/core/crc16.js';

// -----------------------------------------------------------
//  Mock transport for testing high-level helpers
//  - This mock simulates a Modbus RTU server and allows us to
//    test the client methods without needing a real device.
// -----------------------------------------------------------
class MockTransport {
  public coils: boolean[]    = Array(64).fill(false);
  public discrete: boolean[] = Array(64).fill(true);
  public hregs: number[]     = Array.from({ length: 64 }, (_, i) => i);
  public iregs: number[]     = Array.from({ length: 64 }, () => 0xAAAA);

  /* ------- timeout support for set/getTimeout tests ------- */
  private _timeout = 500;
  setTimeout(ms: number) { this._timeout = ms; }
  getTimeout()  { return this._timeout; }

  calls: Uint8Array[] = [];
  async transact(frame: Uint8Array): Promise<Uint8Array> {
    this.calls.push(frame);

    const id   = frame[0];
    const fc   = frame[1];
    const addr = (frame[2] << 8) | frame[3];

    const ok = (body: number[]) => {
      const bytes = Uint8Array.from(body);
      const crc = crc16(bytes);
      return Uint8Array.from([...bytes, crc & 0xff, crc >> 8]);
    };

    const bitPack = (bits: boolean[]) => {
      const out: number[] = [];
      for (let i = 0; i < bits.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8 && i + j < bits.length; j++) {
          if (bits[i + j]) b |= 1 << j;
        }
        out.push(b);
      }
      return out;
    };

    switch (fc) {
      /* ------- coils & discrete bits ------------------------------ */
      case FC_READ_COILS: {
        const qty = (frame[4] << 8) | frame[5];
        const slice = this.coils.slice(addr, addr + qty);
        return ok([id, fc, bitPack(slice).length, ...bitPack(slice)]);
      }
      case FC_READ_DISCRETE_INPUTS: {
        const qty = (frame[4] << 8) | frame[5];
        const slice = this.discrete.slice(addr, addr + qty);
        return ok([id, fc, bitPack(slice).length, ...bitPack(slice)]);
      }
      case FC_WRITE_SINGLE_COIL: {
        const val = (frame[4] << 8) | frame[5];       // 0xFF00 or 0x0000
        this.coils[addr] = val === 0xff00;
        return ok(Array.from(frame.slice(0, 6)));     // echo
      }
      case FC_WRITE_MULTIPLE_COILS: {
        const qty = (frame[4] << 8) | frame[5];
        for (let i = 0; i < qty; i++) {
          const byte = frame[7 + (i >> 3)];
          this.coils[addr + i] = !!((byte >> (i & 7)) & 1);
        }
        return ok([id, fc, frame[2], frame[3], frame[4], frame[5]]);
      }

      /* ------- registers ----------------------------------------- */
      case FC_READ_HOLDING_REGISTERS: {
        const qty = (frame[4] << 8) | frame[5];
        const words = this.hregs.slice(addr, addr + qty);
        const bytes: number[] = [];
        words.forEach(w => bytes.push(w >> 8, w & 0xff));
        return ok([id, fc, bytes.length, ...bytes]);
      }
      case FC_READ_INPUT_REGISTERS: {
        const qty = (frame[4] << 8) | frame[5];
        const words = this.iregs.slice(addr, addr + qty);
        const bytes: number[] = [];
        words.forEach(w => bytes.push(w >> 8, w & 0xff));
        return ok([id, fc, bytes.length, ...bytes]);
      }
      case FC_WRITE_SINGLE_HOLDING_REGISTER: {
        const val = (frame[4] << 8) | frame[5];
        this.hregs[addr] = val;
        return ok(Array.from(frame.slice(0, 6)));
      }
      case FC_WRITE_MULTIPLE_HOLDING_REGISTERS: {
        const qty = (frame[4] << 8) | frame[5];
        for (let i = 0; i < qty; i++) {
          const hi = frame[7 + i * 2];
          const lo = frame[7 + i * 2 + 1];
          this.hregs[addr + i] = (hi << 8) | lo;
        }
        return ok([id, fc, frame[2], frame[3], frame[4], frame[5]]);
      }

      default:
        throw new Error('Mock: unhandled FC 0x' + fc.toString(16));
    }
  }

  async close() {}
}

/* helper returns BOTH objects so tests can mutate mock directly */
function makeClient() {
  const mock = new MockTransport();
  const cli  = Object.create(ModbusRTU.prototype) as ModbusRTU;
  (cli as any).transport = mock;          // bypass private for tests only
  return { cli, mock };
}

/* ------------------------------------------------------------------ *
   TESTS
 * ------------------------------------------------------------------ */
describe('ModbusRTU high-level helpers (mock transport)', () => {

  /* --- Client factory --------------------------------------------- */
  it('setID / getID reflect the current slave address', () => {
    const { cli } = makeClient();

    cli.setID(17);          // 0x11
    expect(cli.getID()).toBe(17);

    cli.setID(247);         // max legal unit-id
    expect(cli.getID()).toBe(247);
  });

  it('setTimeout propagates to transport', () => {
    const { cli, mock } = makeClient();
    cli.setTimeout(2000);
    expect(cli.getTimeout()).toBe(2000);
    expect(mock.getTimeout()).toBe(2000);
  });

  /* --- Holding registers ------------------------------------------- */
  it('reads holding registers', async () => {
    const { cli, mock } = makeClient();
    mock.hregs[0] = 0x1234;
    mock.hregs[1] = 0x5678;
    const res = await cli.readHoldingRegisters(0, 2);
    expect(res.data).toEqual([0x1234, 0x5678]);
  });

  it('writes single holding register', async () => {
    const { cli, mock } = makeClient();
    await cli.writeRegister(5, 0xBEEF);
    expect(mock.hregs[5]).toBe(0xBEEF);
  });

  it('writes multiple holding registers', async () => {
    const { cli, mock } = makeClient();
    await cli.writeRegisters(0x10, [0xAAAA, 0xBBBB]);
    expect(mock.hregs[0x10]).toBe(0xAAAA);
    expect(mock.hregs[0x11]).toBe(0xBBBB);
  });

  /* --- Coils -------------------------------------------------------- */
  it('reads coils', async () => {
    const { cli, mock } = makeClient();
    mock.coils[0] = true;
    mock.coils[3] = true;
    const res = await cli.readCoils(0, 8);
    expect(res.data.slice(0, 8)).toEqual([true, false, false, true, false, false, false, false]);
  });

  it('writes single coil', async () => {
    const { cli, mock } = makeClient();
    await cli.writeCoil(2, true);
    expect(mock.coils[2]).toBe(true);
  });

  it('writes multiple coils', async () => {
    const { cli, mock } = makeClient();
    await cli.writeCoils(0x10, [true, false, true]);
    expect(mock.coils.slice(0x10, 0x13)).toEqual([true, false, true]);
  });

  /* --- Input registers --------------------------------------------- */
  it('reads input registers', async () => {
    const { cli, mock } = makeClient();
    mock.iregs[0x10] = 0x0BAD;
    const res = await cli.readInputRegisters(0x10, 1);
    expect(res.data).toEqual([0x0BAD]);
  });

  /* --- Discrete inputs --------------------------------------------- */
  it('reads discrete inputs', async () => {
    const { cli, mock } = makeClient();
    mock.discrete[5] = false;
    const res = await cli.readDiscreteInputs(0, 8);
    expect(res.data.slice(0, 8)).toEqual([true, true, true, true, true, false, true, true]);
  });
});
