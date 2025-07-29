
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
  buildReadDiscreteInputs,
  buildMaskWriteRegister,
  buildReadWriteMultiple,
  buildReadFileRecord,
  buildWriteFileRecord,
  buildReadFifoQueue
} from '../src/core/frames.js';

import {
  parseReadHolding,
  parseWriteSingle,
  parseReadCoils,
  parseReadDiscreteInputs,
  parseReadInputRegisters,
  parseWriteSingleCoil,
  parseMaskWriteRegister,
  parseReadWriteMultiple,
  parseReadFileRecord,
  parseReadFifoQueue
} from '../src/core/frames.js';

import {
  FC_READ_HOLDING_REGISTERS,
  FC_WRITE_SINGLE_HOLDING_REGISTER,
  FC_WRITE_MULTIPLE_HOLDING_REGISTERS,
  FC_READ_COILS,
  FC_WRITE_SINGLE_COIL,
  FC_WRITE_MULTIPLE_COILS,
  FC_READ_INPUT_REGISTERS,
  FC_READ_DISCRETE_INPUTS,
  FC_MASK_WRITE_REGISTER,
  FC_READ_WRITE_MULTIPLE_REGISTERS,
  FC_READ_FILE_RECORD,
  FC_WRITE_FILE_RECORD,
  FC_READ_FIFO_QUEUE
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

  // FC 22 mask write register
  it('buildMaskWriteRegister() -> correct FC22 frame', () => {
    const frame = buildMaskWriteRegister(1, 0x0050, 0x0F0F, 0xF0F0);
    const expected = withCRC([
      1, FC_MASK_WRITE_REGISTER,
      0x00, 0x50,
      0x0F, 0x0F,
      0xF0, 0xF0
    ]);
    expect(frame).toEqual(expected);
  });

  // FC 23 read/write multiple registers
  it('buildReadWriteMultiple() -> correct FC23 frame', () => {
    const frame = buildReadWriteMultiple(1, 0x0000, 2, 0x0010, [0xAAAA, 0x5555]);
    const expected = withCRC([
      1, FC_READ_WRITE_MULTIPLE_REGISTERS,
      0x00, 0x00, // read addr
      0x00, 0x02, // read qty
      0x00, 0x10, // write addr
      0x00, 0x02, // write qty
      0x04,       // byte count
      0xAA, 0xAA, 0x55, 0x55
    ]);
    expect(frame).toEqual(expected);
  });

  // FC 20 read file record
  it('buildReadFileRecord() -> correct FC20 frame', () => {
    const frame = buildReadFileRecord(1, 1, 3, 2);
    const expected = withCRC([
      1, FC_READ_FILE_RECORD,
      0x07, 0x06,
      0x00, 0x01,
      0x00, 0x03,
      0x00, 0x02
    ]);
    expect(frame).toEqual(expected);
  });

  // FC 21 write file record
  it('buildWriteFileRecord() -> correct FC15 frame', () => {
    const frame = buildWriteFileRecord(1, 2, 0, [0x1111, 0x2222]);
    const expected = withCRC([
      1, FC_WRITE_FILE_RECORD,
      0x0B, 0x06,
      0x00, 0x02,
      0x00, 0x00,
      0x00, 0x02,
      0x11, 0x11, 0x22, 0x22
    ]);
    expect(frame).toEqual(expected);
  });

  // FC 24 read FIFO queue
  it('buildReadFifoQueue() -> correct FC18 frame', () => {
    const frame = buildReadFifoQueue(1, 0x1234);
    const expected = withCRC([1, FC_READ_FIFO_QUEUE, 0x12, 0x34]);
    expect(frame).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
//  FRAME PARSERS TESTS
// ---------------------------------------------------------------------------
describe('frame parsers -> complete coverage', () => {
  it('parseReadHolding() decodes register words', () => {
    const frame = withCRC([1, FC_READ_HOLDING_REGISTERS, 0x04, 0x12, 0x34, 0x56, 0x78]);
    expect(parseReadHolding(frame)).toEqual([0x1234, 0x5678]);
  });

  it('parseWriteSingle() decodes address and value', () => {
    const frame = withCRC([1, FC_WRITE_SINGLE_HOLDING_REGISTER, 0x00, 0x05, 0xAB, 0xCD]);
    expect(parseWriteSingle(frame)).toEqual({ address: 0x0005, value: 0xABCD });
  });

  it('parseReadCoils() decodes packed bits', () => {
    const frame = withCRC([1, FC_READ_COILS, 0x01, 0b00000101]);
    expect(parseReadCoils(frame).slice(0, 3)).toEqual([true, false, true]);
  });

  it('parseReadDiscreteInputs() decodes bits', () => {
    const frame = withCRC([1, FC_READ_DISCRETE_INPUTS, 0x01, 0b00001010]);
    expect(parseReadDiscreteInputs(frame).slice(0, 4)).toEqual([false, true, false, true]);
  });

  it('parseReadInputRegisters() decodes words', () => {
    const frame = withCRC([1, FC_READ_INPUT_REGISTERS, 0x04, 0xAA, 0x55, 0x12, 0x34]);
    expect(parseReadInputRegisters(frame)).toEqual([0xAA55, 0x1234]);
  });

  it('parseWriteSingleCoil() echoes address/state', () => {
    const frame = withCRC([1, FC_WRITE_SINGLE_COIL, 0x00, 0x02, 0xFF, 0x00]);
    expect(parseWriteSingleCoil(frame)).toEqual({ address: 0x0002, state: true });
  });

  it('parseMaskWriteRegister() echoes masks', () => {
    const frame = withCRC([1, FC_MASK_WRITE_REGISTER, 0x00, 0x10, 0x0F, 0x0F, 0xF0, 0xF0]);
    expect(parseMaskWriteRegister(frame)).toEqual({ address: 0x0010, andMask: 0x0F0F, orMask: 0xF0F0 });
  });

  it('parseReadWriteMultiple() decodes register data', () => {
    const frame = withCRC([1, FC_READ_WRITE_MULTIPLE_REGISTERS, 0x04, 0xAA, 0xAA, 0x55, 0x55]);
    expect(parseReadWriteMultiple(frame)).toEqual([0xAAAA, 0x5555]);
  });

  it('parseReadFileRecord() decodes file data', () => {
    const frame = withCRC([1, FC_READ_FILE_RECORD, 0x07, 0x05, 0x06, 0x12, 0x34, 0x56, 0x78]);
    expect(parseReadFileRecord(frame)).toEqual([0x1234, 0x5678]);
  });

  it('parseReadFifoQueue() decodes FIFO words', () => {
    const frame = withCRC([1, FC_READ_FIFO_QUEUE, 0x00, 0x06, 0x00, 0x03, 0x11, 0x11, 0x22, 0x22, 0x33, 0x33]);
    expect(parseReadFifoQueue(frame)).toEqual([0x1111, 0x2222, 0x3333]);
  });
});

