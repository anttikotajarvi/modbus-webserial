// test/exception.test.ts
import { it, expect } from 'vitest';
import { crc16 } from '../src/core/crc16';
import { ExceptionError } from '../src/core/errors';
import { FC_READ_HOLDING_REGISTERS } from '../src/core/types';
import { parseReadHolding } from '../src/core/frames';

it('throws ExceptionError with readable message', () => {
  // id = 1, fc = 0x83 (0x03 | 0x80), exception-code = 0x02
  const body  = Uint8Array.from([1, FC_READ_HOLDING_REGISTERS | 0x80, 0x02]);
  const crc   = crc16(body);
  const frame = Uint8Array.from([...body, crc & 0xff, crc >> 8]);

  expect(() => parseReadHolding(frame)).toThrowError(ExceptionError);

  try {
    parseReadHolding(frame);
  } catch (e) {
    const err = e as ExceptionError;
    expect(err.message).toBe('Illegal Data Address'); // 0x02
    expect(err.code).toBe(0x02);
  }
});