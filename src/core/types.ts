/** Function-code constants we handle in v0.1 */
export const FC_READ_HOLDING  = 0x03;
export const FC_WRITE_SINGLE  = 0x06;

/** Result payloads returned by high-level helpers */
export interface ReadRegisterResult {
  data: number[];          // 16-bit words
  raw: Uint8Array;         // full response frame
}
export interface WriteRegisterResult {
  address: number;
  value:   number;
  raw:     Uint8Array;
}
