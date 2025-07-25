import { TimeoutError } from '../core/errors.js';

export interface WebSerialOptions {
  baudRate?: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  requestFilters?: SerialPortFilter[];
  timeout?: number;          // ms
}

export class WebSerialTransport {
  private port!: SerialPort;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;
  private timeout = 500;

  static async open(opts: WebSerialOptions = {}): Promise<WebSerialTransport> {
    const t = new WebSerialTransport();
    await t.init(opts);
    return t;
  }

  private async init(opts: WebSerialOptions) {
    this.timeout = opts.timeout ?? 500;
    this.port = await navigator.serial.requestPort({ filters: opts.requestFilters ?? [] });
    await this.port.open({
      baudRate: opts.baudRate ?? 9600,
      dataBits: opts.dataBits ?? 8,
      stopBits: opts.stopBits ?? 1,
      parity:   opts.parity   ?? 'none'
    });
    this.reader = this.port.readable!.getReader();
    this.writer = this.port.writable!.getWriter();
  }

  async transact(frame: Uint8Array): Promise<Uint8Array> {
    await this.writer.write(frame);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TimeoutError()), this.timeout)
    );
    const { value } = await Promise.race([this.reader.read(), timeout]);
    if (!value) throw new TimeoutError();
    return value;
  }

  async close() {
    await this.reader?.cancel();
    await this.writer?.close();
    await this.port?.close();
  }
}
