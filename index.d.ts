/* index.d.ts — browser only */

export interface WebSerialOptions {
  baudRate?: number;             // default 9600
  dataBits?: 7 | 8;              // default 8
  stopBits?: 1 | 2;              // default 1
  parity?: 'none' | 'even' | 'odd'; // default 'none'
  requestFilters?: SerialPortFilter[]; // optional Web Serial filters
  timeout?: number;              // ms; default 500
}

export interface ReadRegisterResult {
  data: number[];                // each 0-0xFFFF
  raw: Uint8Array;               // full response frame
}

export interface WriteRegisterResult {
  address: number;
  value: number;
  raw: Uint8Array;
}

export class ModbusRTU {
  /* open the browser’s port picker and return a ready client */
  static openWebSerial(opts?: WebSerialOptions): Promise<ModbusRTU>;

  /* housekeeping */
  close(): Promise<void>;
  isOpen(): boolean;

  /* config */
  setID(id: number): void;
  getID(): number;
  setTimeout(ms: number): void;
  getTimeout(): number;

  /* core function codes v0.1 */
  readHoldingRegisters(addr: number, length: number): Promise<ReadRegisterResult>;
  writeRegister(addr: number, value: number): Promise<WriteRegisterResult>;
}

/* low-level helpers (tree-shakable) */
export function buildReadHolding(id: number, addr: number, len: number): Uint8Array;
export function parseReadHolding(frame: Uint8Array): number[];
export function buildWriteSingle(id: number, addr: number, val: number): Uint8Array;
export function crc16(data: Uint8Array): number;

export class CrcError extends Error {}
export class TimeoutError extends Error {}
export class ExceptionError extends Error { code: number; }
