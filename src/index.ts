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

declare const __VERSION__: string
declare const __GIT_HASH__: string
declare const __BUILD_TIME__: string
export const BUILD_INFO = {
  version: __VERSION__,
  commit: __GIT_HASH__,
  buildTime: __BUILD_TIME__,
} as const