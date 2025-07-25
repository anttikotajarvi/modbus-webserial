export class CrcError extends Error {
  constructor() { super('CRC check failed'); }
}
export class TimeoutError extends Error {
  constructor() { super('Modbus response timed out'); }
}
export class ExceptionError extends Error {
  code: number;
  constructor(code: number) {
    super(`Modbus exception ${code.toString(16)}`);
    this.code = code;
  }
}
