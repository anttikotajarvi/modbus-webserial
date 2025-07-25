/** Standard Modbus CRC-16 (poly 0xA001, little-endian) */
export function crc16(buf: Uint8Array): number {
  let crc = 0xffff;
  for (let b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc >> 1) ^ ((crc & 1) ? 0xA001 : 0);
    }
  }
  return crc;
}
