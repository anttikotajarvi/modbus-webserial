/** Function-code constants we handle in v0.1 */
export const FC_READ_HOLDING_REGISTERS              = 0x03;
export const FC_WRITE_SINGLE_HOLDING_REGISTER       = 0x06;
export const FC_WRITE_MULTIPLE_HOLDING_REGISTERS    = 0x10;

export const FC_READ_COILS           = 0x01;
export const FC_WRITE_SINGLE_COIL    = 0x05;
export const FC_WRITE_MULTIPLE_COILS = 0x0F;

export const FC_READ_INPUT_REGISTERS    = 0x04;
export const FC_READ_DISCRETE_INPUTS    = 0x02;

// TODO: Consider other rest of the "data access" function codes
// e.g. 21-24

/** Result payloads returned by high-level helpers */
export interface ReadCoilResult {
  /** packed bits as booleans (C0 … Cn-1) */
  data: boolean[];
  /** raw response frame (incl. CRC) */
  raw: Uint8Array;
}

export interface ReadRegisterResult {
  /** 16-bit register words */
  data: number[];
  raw: Uint8Array;
}

export interface WriteCoilResult {
  address: number;
  state: boolean;
  raw: Uint8Array;
}

export interface WriteRegisterResult {
  address: number;
  value: number;
  raw: Uint8Array;
}

export interface WriteMultipleResult {
  address: number;
  length: number;
  raw: Uint8Array;
}