import { FC_READ_HOLDING, FC_WRITE_SINGLE } from './types.js';
import { crc16 } from './crc16.js';
import { CrcError, ExceptionError } from './errors.js';

/* ---------- encode helpers ---------- */

export function buildReadHolding(id: number, addr: number, len: number): Uint8Array {
  const frame = new Uint8Array(8);
  frame[0] = id;
  frame[1] = FC_READ_HOLDING;
  frame[2] = addr >> 8;
  frame[3] = addr & 0xff;
  frame[4] = len  >> 8;
  frame[5] = len  & 0xff;
  const crc = crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;          // low byte first
  frame[7] = crc >> 8;
  return frame;
}

export function buildWriteSingle(id: number, addr: number, value: number): Uint8Array {
  const frame = new Uint8Array(8);
  frame[0] = id;
  frame[1] = FC_WRITE_SINGLE;
  frame[2] = addr  >> 8;
  frame[3] = addr  & 0xff;
  frame[4] = value >> 8;
  frame[5] = value & 0xff;
  const crc = crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;
  frame[7] = crc >> 8;
  return frame;
}

/* ---------- decode helpers ---------- */

export function parseReadHolding(resp: Uint8Array): number[] {
  basicChecks(resp, FC_READ_HOLDING);

  const byteCount = resp[2];
  const words: number[] = [];
  for (let i = 0; i < byteCount; i += 2) {
    words.push((resp[3 + i] << 8) | resp[4 + i]);
  }
  return words;
}

export function parseWriteSingle(resp: Uint8Array): { address: number; value: number } {
  basicChecks(resp, FC_WRITE_SINGLE);
  const addr  = (resp[2] << 8) | resp[3];
  const value = (resp[4] << 8) | resp[5];
  return { address: addr, value };
}

/* ---------- internal utility ---------- */

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
