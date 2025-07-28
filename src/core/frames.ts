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
    FC_READ_FIFO_QUEUE,
} from './types';
import { crc16 } from './crc16.js';
import { CrcError, ExceptionError } from './errors.js';

// ---------------------------------------------------------------------------
// FRAME BUILDERS
// - Specification: Modbus Application Protocol V1.1b3
//   https://www.modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf
// ---------------------------------------------------------------------------
/**
 * FC_READ_HOLDING_REGISTERS  (0x03)
 * Modbus Application Protocol V1.1b3 §6.3
 */
export function buildReadHolding(id: number, addr: number, len: number): Uint8Array {
  const frame = new Uint8Array(8);
  frame[0] = id;
  frame[1] = FC_READ_HOLDING_REGISTERS;
  frame[2] = addr >> 8;
  frame[3] = addr & 0xff;
  frame[4] = len  >> 8;
  frame[5] = len  & 0xff;
  const crc = crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;          // low byte first
  frame[7] = crc >> 8;
  return frame;
}
/**
 * FC_WRITE_SINGLE_HOLDING_REGISTER  (0x06)
 * Modbus Application Protocol V1.1b3 §6.6
 */
export function buildWriteSingle(id: number, addr: number, value: number): Uint8Array {
  const frame = new Uint8Array(8);
  frame[0] = id;                                // slave id
  frame[1] = FC_WRITE_SINGLE_HOLDING_REGISTER;  // function code
  frame[2] = addr  >> 8;                        // address hi
  frame[3] = addr  & 0xff;                      // address lo
  frame[4] = value >> 8;                        // value hi
  frame[5] = value & 0xff;                      // value lo
  const crc = crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;                        // CRC low byte first
  frame[7] = crc >> 8;                          // CRC high byte
  return frame;
}
/**
 * FC_WRITE_MULTIPLE_HOLDING_REGISTERS  (0x10)
 * Modbus Application Protocol V1.1b3 §6.12
 */
export function buildWriteMultiple(id: number, addr: number, values: number[]): Uint8Array {
  const qty = values.length;
  // Spec allows 1 … 123 registers in a single request (byte-count ≤ 246)
  if (qty < 1 || qty > 123) throw new Error('Invalid number of registers');

  const byteCount = qty * 2;
  const frame     = new Uint8Array(7 + byteCount + 2); // +2 for CRC

  frame[0] = id;                                    // slave id
  frame[1] = FC_WRITE_MULTIPLE_HOLDING_REGISTERS;   // function code
  frame[2] = addr >> 8;                             // address hi
  frame[3] = addr & 0xff;                           // address lo
  frame[4] = qty  >> 8;                             // quantity hi
  frame[5] = qty  & 0xff;                           // quantity lo
  frame[6] = byteCount;

  for (let i = 0; i < qty; i++) {
    const val = values[i] & 0xffff;
    frame[7 + i * 2]     = val >> 8;    // high byte
    frame[7 + i * 2 + 1] = val & 0xff;  // low  byte
  }

  const crc = crc16(frame.subarray(0, frame.length - 2));
  frame[frame.length - 2] = crc & 0xff;             // CRC low  byte
  frame[frame.length - 1] = crc >> 8;               // CRC high byte

  return frame;
}

/**
 * FC_READ_COILS  (0x01)
 * Modbus Application Protocol V1.1b3 §6.1
 */
export function buildReadCoils(id: number, addr: number, qty: number): Uint8Array {
  // Spec allows 1 … 2000 coils in a single request (byte-count ≤ 250)
  if (qty < 1 || qty > 2000) throw new Error('Invalid coil quantity');

  const frame = new Uint8Array(8);          // 6-byte body + 2-byte CRC
  frame[0] = id;                            // slave id   
  frame[1] = FC_READ_COILS;                 // 0x01
  frame[2] = addr >> 8;                     // start-address Hi
  frame[3] = addr & 0xff;                   // start-address Lo
  frame[4] = qty  >> 8;                     // quantity Hi
  frame[5] = qty  & 0xff;                   // quantity Lo

  const crc = crc16(frame.subarray(0, 6));  // calculate over first 6 bytes
  frame[6] = crc & 0xff;                    // CRC Lo
  frame[7] = crc >> 8;                      // CRC Hi

  return frame;
}
/**
 * FC_WRITE_SINGLE_COIL  (0x05)
 * Modbus Application Protocol V1.1b3 §6.5
 */
export function buildWriteSingleCoil(id: number, addr: number, value: boolean): Uint8Array {

  const frame = new Uint8Array(8);
  frame[0] = id;                          // slave id
  frame[1] = FC_WRITE_SINGLE_COIL;        // 0x05 function code
  frame[2] = addr >> 8;                   // address hi
  frame[3] = addr & 0xff;                 // address lo

  // Spec: ON = 0xFF00, OFF = 0x0000
  frame[4] = value ? 0xff : 0x00;         // value hi
  frame[5] = 0x00;                        // value lo

  const crc = crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;                  // CRC low byte first
  frame[7] = crc >> 8;                    // CRC high byte

  return frame;
}

/**
 * FC_WRITE_MULTIPLE_COILS  (0x0F)
 * Modbus Application Protocol V1.1b3 §6.11
 */
export function buildWriteMultipleCoils(id: number, addr: number, values: boolean[]): Uint8Array {
  const qty = values.length;
  // Spec allows 1 … 1968 coils in a single request (byte-count ≤ 1968)
  if (qty < 1 || qty > 1968) throw new Error('Invalid coil quantity');

  const byteCount = Math.ceil(qty / 8);
  const frame = new Uint8Array(7 + byteCount + 2);   // header + data + CRC

  frame[0] = id;
  frame[1] = FC_WRITE_MULTIPLE_COILS;                // 0x0F
  frame[2] = addr >> 8;                              // start-addr hi
  frame[3] = addr & 0xff;                            // start-addr lo
  frame[4] = qty  >> 8;                              // qty hi
  frame[5] = qty  & 0xff;                            // qty lo
  frame[6] = byteCount;                              // byte count

  /* ---- pack coil bits LSB-first ---- */
  for (let i = 0; i < qty; i++) {
    if (values[i]) {
      const byteIndex = i >> 3;                      // i / 8
      const bitIndex  = i & 7;                       // i % 8
      frame[7 + byteIndex] |= 1 << bitIndex;
    }
  }

  /* ---- CRC16 little-endian ---- */
  const crc = crc16(frame.subarray(0, frame.length - 2));
  frame[frame.length - 2] = crc & 0xff;              // CRC lo
  frame[frame.length - 1] = crc >> 8;                // CRC hi

  return frame;
}


/** 
 * FC_READ_INPUT_REGISTERS  (0x04)
 * Modbus Application Protocol V1.1b3 §6.4
 */
export function buildReadInputRegisters(id: number, addr: number, qty: number): Uint8Array {
  // Spec allows 1 … 125 registers in a single request (byte-count ≤ 250)
  if (qty < 1 || qty > 125) throw new Error('Invalid register quantity');

  const frame = new Uint8Array(8);          // 6-byte body + 2 CRC
  frame[0] = id;
  frame[1] = FC_READ_INPUT_REGISTERS;       // 0x04
  frame[2] = addr >> 8;                     // start-addr Hi
  frame[3] = addr & 0xff;                   // start-addr Lo
  frame[4] = qty  >> 8;                     // quantity Hi
  frame[5] = qty  & 0xff;                   // quantity Lo

  const crc = crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;                    // CRC Lo
  frame[7] = crc >> 8;                      // CRC Hi

  return frame;
}
/** 
 * FC_READ_DISCRETE_INPUTS  (0x02)
 * Modbus Application Protocol V1.1b3 §6.2
 */
export function buildReadDiscreteInputs(id: number, addr: number, qty: number): Uint8Array {
  // Spec allows 1 … 2000 discrete inputs in a single request (byte-count ≤ 250)
  if (qty < 1 || qty > 2000) throw new Error('Invalid discrete-input quantity');

  const frame = new Uint8Array(8);          // 6-byte body + 2-byte CRC
  frame[0] = id;
  frame[1] = FC_READ_DISCRETE_INPUTS;       // 0x02
  frame[2] = addr >> 8;                     // start-addr Hi
  frame[3] = addr & 0xff;                   // start-addr Lo
  frame[4] = qty  >> 8;                     // quantity  Hi
  frame[5] = qty  & 0xff;                   // quantity  Lo

  const crc = crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;                    // CRC Lo
  frame[7] = crc >> 8;                      // CRC Hi

  return frame;
}
/**
 * FC_MASK_WRITE_REGISTER (0x16)
 * Modbus Application Protocol V1.1b3 §6.16
 */
export function buildMaskWriteRegister(id: number, addr: number, andMask: number, orMask: number): Uint8Array {
  const frame = new Uint8Array(10);
  frame[0] = id;
  frame[1] = FC_MASK_WRITE_REGISTER;
  frame[2] = addr >> 8;
  frame[3] = addr & 0xff;
  frame[4] = andMask >> 8;
  frame[5] = andMask & 0xff;
  frame[6] = orMask >> 8;
  frame[7] = orMask & 0xff;
  const crc = crc16(frame.subarray(0, 8));
  frame[8] = crc & 0xff;
  frame[9] = crc >> 8;
  return frame;
}

/**
 * FC_READ_WRITE_MULTIPLE_REGISTERS (0x17)
 * Modbus Application Protocol V1.1b3 §6.17
 */
export function buildReadWriteMultiple(id: number, readAddr: number, readQty: number,
                                       writeAddr: number, values: number[]): Uint8Array {
  const writeQty = values.length;
  if (readQty < 1 || readQty > 125) throw new Error('Invalid read quantity');
  if (writeQty < 1 || writeQty > 121) throw new Error('Invalid write quantity');

  const byteCount = writeQty * 2;
  const frame = new Uint8Array(11 + byteCount + 2);

  frame[0] = id;
  frame[1] = FC_READ_WRITE_MULTIPLE_REGISTERS;
  frame[2] = readAddr >> 8;
  frame[3] = readAddr & 0xff;
  frame[4] = readQty >> 8;
  frame[5] = readQty & 0xff;
  frame[6] = writeAddr >> 8;
  frame[7] = writeAddr & 0xff;
  frame[8] = writeQty >> 8;
  frame[9] = writeQty & 0xff;
  frame[10] = byteCount;
  for (let i = 0; i < writeQty; i++) {
    const v = values[i] & 0xffff;
    frame[11 + i * 2] = v >> 8;
    frame[12 + i * 2] = v & 0xff;
  }
  const crc = crc16(frame.subarray(0, frame.length - 2));
  frame[frame.length - 2] = crc & 0xff;
  frame[frame.length - 1] = crc >> 8;
  return frame;
}

/**
 * FC_READ_FILE_RECORD (0x14)
 * Single sub-request only (ref type 0x06)
 * Modbus Application Protocol V1.1b3 §6.14
 */
export function buildReadFileRecord(id: number, file: number, record: number, length: number): Uint8Array {
  if (length < 1 || length > 120) throw new Error('Invalid record length');
  const frame = new Uint8Array(12);
  frame[0] = id;
  frame[1] = FC_READ_FILE_RECORD;
  frame[2] = 0x07;                // byte count
  frame[3] = 0x06;                // reference type
  frame[4] = file >> 8;
  frame[5] = file & 0xff;
  frame[6] = record >> 8;
  frame[7] = record & 0xff;
  frame[8] = length >> 8;
  frame[9] = length & 0xff;
  const crc = crc16(frame.subarray(0, 10));
  frame[10] = crc & 0xff;
  frame[11] = crc >> 8;
  return frame;
}

/**
 * FC_WRITE_FILE_RECORD (0x15)
 * Single sub-request only (ref type 0x06)
 * Modbus Application Protocol V1.1b3 §6.15
 */
export function buildWriteFileRecord(id: number, file: number, record: number, values: number[]): Uint8Array {
  const len = values.length;
  if (len < 1 || len > 120) throw new Error('Invalid record length');
  const byteCount = 7 + len * 2;
  const frame = new Uint8Array(3 + byteCount + 2);
  frame[0] = id;
  frame[1] = FC_WRITE_FILE_RECORD;
  frame[2] = byteCount;
  frame[3] = 0x06;
  frame[4] = file >> 8;
  frame[5] = file & 0xff;
  frame[6] = record >> 8;
  frame[7] = record & 0xff;
  frame[8] = len >> 8;
  frame[9] = len & 0xff;
  for (let i = 0; i < len; i++) {
    const v = values[i] & 0xffff;
    frame[10 + i * 2] = v >> 8;
    frame[11 + i * 2] = v & 0xff;
  }
  const crc = crc16(frame.subarray(0, frame.length - 2));
  frame[frame.length - 2] = crc & 0xff;
  frame[frame.length - 1] = crc >> 8;
  return frame;
}

/** 
 * FC_READ_FIFO_QUEUE (0x18) 
 * Modbus Application Protocol V1.1b3 §6.18
 */
export function buildReadFifoQueue(id: number, addr: number): Uint8Array {
  const frame = new Uint8Array(6);
  frame[0] = id;
  frame[1] = FC_READ_FIFO_QUEUE;
  frame[2] = addr >> 8;
  frame[3] = addr & 0xff;
  const crc = crc16(frame.subarray(0, 4));
  frame[4] = crc & 0xff;
  frame[5] = crc >> 8;
  return frame;
}

// ---------------------------------------------------------------------------
//  FRAME PARSERS
// ---------------------------------------------------------------------------
/** FC 03 – Read Holding Registers: returns array of words */
export function parseReadHolding(resp: Uint8Array): number[] {
  basicChecks(resp, FC_READ_HOLDING_REGISTERS);

  const byteCount = resp[2];
  const words: number[] = [];
  for (let i = 0; i < byteCount; i += 2) {
    words.push((resp[3 + i] << 8) | resp[4 + i]);
  }
  return words;
}

/** FC 06 – Write Single Holding Register: echo frame -> { address, value } */
export function parseWriteSingle(resp: Uint8Array): { address: number; value: number } {
  basicChecks(resp, FC_WRITE_SINGLE_HOLDING_REGISTER);
  const addr  = (resp[2] << 8) | resp[3];
  const value = (resp[4] << 8) | resp[5];
  return { address: addr, value };
}

/** FC 01 – Read Coils: returns boolean array (LSB first) */
export const parseReadCoils = _parseBits(FC_READ_COILS);

/** FC 02 – Read Discrete Inputs: identical unpacking logic */
export const parseReadDiscreteInputs = _parseBits(FC_READ_DISCRETE_INPUTS);

/** FC 04 – Read Input Registers: same structure as holding regs */
export function parseReadInputRegisters(resp: Uint8Array): number[] {
  basicChecks(resp, FC_READ_INPUT_REGISTERS);
  const byteCount = resp[2];
  const words: number[] = [];
  for (let i = 0; i < byteCount; i += 2) {
    const hi = resp[3 + i], lo = resp[4 + i];
    words.push((hi << 8) | lo);
  }
  return words;
}

/** FC 05 – Write Single Coil: echo frame → { address, state } */
export function parseWriteSingleCoil(resp: Uint8Array): { address: number; state: boolean } {
  basicChecks(resp, FC_WRITE_SINGLE_COIL);
  const addr = (resp[2] << 8) | resp[3];
  const val  = (resp[4] << 8) | resp[5];     // 0xFF00 or 0x0000
  return { address: addr, state: val === 0xff00 };
}

/** FC 16 – Mask Write Register: echo → { address, andMask, orMask } */
export function parseMaskWriteRegister(resp: Uint8Array): { address: number; andMask: number; orMask: number } {
  basicChecks(resp, FC_MASK_WRITE_REGISTER);
  const addr    = (resp[2] << 8) | resp[3];
  const andMask = (resp[4] << 8) | resp[5];
  const orMask  = (resp[6] << 8) | resp[7];
  return { address: addr, andMask, orMask };
}

/** FC 23 – Read/Write Multiple Registers: returns array of words */
export function parseReadWriteMultiple(resp: Uint8Array): number[] {
  basicChecks(resp, FC_READ_WRITE_MULTIPLE_REGISTERS);
  const byteCount = resp[2];
  const words: number[] = [];
  for (let i = 0; i < byteCount; i += 2) {
    words.push((resp[3 + i] << 8) | resp[4 + i]);
  }
  return words;
}

/** FC 20 – Read File Record (single sub-response) */
export function parseReadFileRecord(resp: Uint8Array): number[] {
  basicChecks(resp, FC_READ_FILE_RECORD);
  const dataLen = resp[3] - 1;           // bytes of data (excludes ref-type)
  const words: number[] = [];
  for (let i = 0; i < dataLen; i += 2) {
    words.push((resp[5 + i] << 8) | resp[6 + i]);
  }
  return words;
}

/** FC 24 – Read FIFO Queue */
export function parseReadFifoQueue(resp: Uint8Array): number[] {
  basicChecks(resp, FC_READ_FIFO_QUEUE);
  const count = (resp[4] << 8) | resp[5];
  const words: number[] = [];
  for (let i = 0; i < count; i++) {
    const hi = resp[6 + i * 2];
    const lo = resp[7 + i * 2];
    words.push((hi << 8) | lo);
  }
  return words;
}

/* FC 0F & FC 10 replies are already handled inline in client methods
   (they only echo start-addr + qty) so no dedicated parser needed. */

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------
// Underscore needs to precede the curried parameter or eslint freaks out
function _parseBits(expectedFC: number): (_frame: Uint8Array) => boolean[] {
  return (_frame: Uint8Array) => {
    basicChecks(_frame, expectedFC);

    const byteCount = _frame[2];
    const bits: boolean[] = [];

    for (let i = 0; i < byteCount; i++) {
      const byte = _frame[3 + i];
      for (let j = 0; j < 8; j++) bits.push(Boolean(byte & (1 << j)));
    }
    return bits;
  };
}

function basicChecks(frame: Uint8Array, expectedFC: number) {
  // CRC
  const crcExpected = crc16(frame.subarray(0, frame.length - 2));
  const crcGot = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
  if (crcExpected !== crcGot) throw new CrcError();

  const fc = frame[1] & 0x7f;
  const isException = (frame[1] & 0x80) !== 0;

  if (isException) throw new ExceptionError(frame[2]);
  if (fc !== expectedFC) throw new Error('Unexpected function code');
}

