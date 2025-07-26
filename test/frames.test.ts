import { describe, it, expect } from 'vitest';
import { crc16 } from '../src/core/crc16.js';

import {
  buildReadHolding,
  buildWriteSingle,
  buildWriteMultiple,
  buildReadCoils,
  buildWriteSingleCoil,
  buildWriteMultipleCoils,
  buildReadInputRegisters,
  buildReadDiscreteInputs
} from '../src/core/frames.js';

import {
  FC_READ_HOLDING_REGISTERS,
  FC_WRITE_SINGLE_HOLDING_REGISTER,
  FC_WRITE_MULTIPLE_HOLDING_REGISTERS,
  FC_READ_COILS,
  FC_WRITE_SINGLE_COIL,
  FC_WRITE_MULTIPLE_COILS,
  FC_READ_INPUT_REGISTERS,
  FC_READ_DISCRETE_INPUTS
} from '../src/core/types.js';

/* helper: append CRC to an array of body bytes */
function withCRC(body: number[]): Uint8Array {
  const bytes = Uint8Array.from(body);
  const crc   = crc16(bytes);
  return Uint8Array.from([...bytes, crc & 0xff, crc >> 8]);
}

// ---------------------------------------------------------------------------
//  FRAME BUILDERS TESTS
//  - Testing builders against known good frames
// ---------------------------------------------------------------------------
describe('frame builders -> complete coverage', () => {

  // FC 03 read holding registers
  it('buildReadHolding() -> correct FC03 frame', () => {
    const frame = buildReadHolding(1, 0x0010, 3);           // slave 1, addr 0x10, len 3
    const expected = withCRC([1, FC_READ_HOLDING_REGISTERS, 0x00, 0x10, 0x00, 0x03]);
    expect(frame).toEqual(expected);
  });

  // FC 06 write single holding register
  it('buildWriteSingle() -> correct FC06 frame', () => {
    const frame = buildWriteSingle(1, 0x000A, 0x55AA);
    const expected = withCRC([1, FC_WRITE_SINGLE_HOLDING_REGISTER, 0x00, 0x0A, 0x55, 0xAA]);
    expect(frame).toEqual(expected);
  });

  // FC 16 write multiple holding registers
  it('buildWriteMultiple() -> correct FC16 frame (2 registers)', () => {
    const frame = buildWriteMultiple(1, 0x000A, [0x1234, 0x5678]);
    const expected = withCRC([
      1,
      FC_WRITE_MULTIPLE_HOLDING_REGISTERS,
      0x00, 0x0A,             // start addr
      0x00, 0x02,             // qty regs
      0x04,                   // byte count
      0x12, 0x34, 0x56, 0x78  // data
    ]);
    expect(frame).toEqual(expected);
  });

  // FC 01 read coils
  it('buildReadCoils() -> correct FC01 frame', () => {
    const frame = buildReadCoils(1, 0x0020, 8);   // read 8 coils @0x20
    const expected = withCRC([1, FC_READ_COILS, 0x00, 0x20, 0x00, 0x08]);
    expect(frame).toEqual(expected);
  });

  // FC 05 write single coil
  it('buildWriteSingleCoil() -> correct FC05 frame', () => {
    const frame = buildWriteSingleCoil(1, 0x0002, true);   // ON → 0xFF00
    const expected = withCRC([1, FC_WRITE_SINGLE_COIL, 0x00, 0x02, 0xFF, 0x00]);
    expect(frame).toEqual(expected);
  });

  // FC 0F write multiple coils
  it('buildWriteMultipleCoils() -> correct FC0F frame (3 coils)', () => {
    const frame = buildWriteMultipleCoils(1, 0x0010, [true, false, true]); // 3 coils
    const expected = withCRC([
      1, FC_WRITE_MULTIPLE_COILS,
      0x00, 0x10,     // start addr
      0x00, 0x03,     // quantity (3)
      0x01,           // byte count
      0b00000101      // bits LSB→MSB: 1,0,1
    ]);
    expect(frame).toEqual(expected);
  });

  // FC 04 read input registers
  it('buildReadInputRegisters() -> correct FC04 frame', () => {
    const frame = buildReadInputRegisters(1, 0x0010, 4);
    const expected = withCRC([1, FC_READ_INPUT_REGISTERS, 0x00, 0x10, 0x00, 0x04]);
    expect(frame).toEqual(expected);
  });

  // FC 02 read discrete inputs
  it('buildReadDiscreteInputs() -> correct FC02 frame', () => {
    const frame = buildReadDiscreteInputs(1, 0x0020, 8);
    const expected = withCRC([1, FC_READ_DISCRETE_INPUTS, 0x00, 0x20, 0x00, 0x08]);
    expect(frame).toEqual(expected);
  });
});
