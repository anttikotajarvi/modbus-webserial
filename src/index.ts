export * from './client.js';
export * from './core/frames.js';   // optional: expose low-level helpers
export * from './core/crc16.js';
export * from './core/errors.js';
export type {
  ReadRegisterResult,
  WriteRegisterResult,
  MaskWriteResult,
  WriteFileResult,
  ReadFifoResult
} from './core/types.js';
export type { WebSerialOptions } from './transport/webserial.js';
