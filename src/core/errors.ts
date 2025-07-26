/**
 * Modbus exception-code lookup  
 * Modbus Application Protocol V1.1b3 
 * §7 MOODBUS Exception Responses 
 */
const EXCEPTION_MESSAGES: Record<number, string> = {
  0x01: 'Illegal Function',
  0x02: 'Illegal Data Address',
  0x03: 'Illegal Data Value',
  0x04: 'Slave Device Failure',
  0x05: 'Acknowledge',
  0x06: 'Slaver Device Busy',
  0x08: 'Memory Parity Error',
  0x0A: 'Gateway Path Unavailable',
  0x0B: 'Gateway Target Device Failed to Respond'
};

export class CrcError extends Error {
  constructor() { super('CRC check failed'); }
}

export class TimeoutError extends Error {
  constructor() { super('Modbus response timed out'); }
}

export class ExceptionError extends Error {
  code: number;
  constructor(code: number) {
    super(EXCEPTION_MESSAGES[code] ?? `Modbus exception 0x${code.toString(16)}`);
    this.code = code;
  }
}
