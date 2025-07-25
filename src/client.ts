import { WebSerialTransport, WebSerialOptions } from './transport/webserial.js';
import {
  buildReadHolding, buildWriteSingle,
  parseReadHolding, parseWriteSingle
} from './core/frames.js';

import type { ReadRegisterResult, WriteRegisterResult } from './core/types.js';

export class ModbusRTU {
  private id = 1;
  private transport!: WebSerialTransport;

  /* ---------- static factory ---------- */
  static async openWebSerial(opts?: WebSerialOptions): Promise<ModbusRTU> {
    const cli = new ModbusRTU();
    cli.transport = await WebSerialTransport.open(opts);
    return cli;
  }

  /* ---------- housekeeping ---------- */
  async close() { await this.transport.close(); }
  isOpen()      { return !!this.transport; }

  /* ---------- config ---------- */
  setID(id: number)     { this.id = id; }
  getID()               { return this.id; }

  /* ---------- helpers (v0.1) ---------- */
  async readHoldingRegisters(addr: number, len: number): Promise<ReadRegisterResult> {
    const req = buildReadHolding(this.id, addr, len);
    const raw = await this.transport.transact(req);
    return { data: parseReadHolding(raw), raw };
  }

  async writeRegister(addr: number, value: number): Promise<WriteRegisterResult> {
    const req = buildWriteSingle(this.id, addr, value);
    const raw = await this.transport.transact(req);
    const { address, value: v } = parseWriteSingle(raw);
    return { address, value: v, raw };
  }
}
