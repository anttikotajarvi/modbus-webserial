import { WebSerialTransport, WebSerialOptions } from './transport/webserial.js';
import {
  buildReadCoils,
  buildReadDiscreteInputs,
  buildReadHolding, buildReadInputRegisters, buildWriteMultiple, buildWriteMultipleCoils, buildWriteSingle,
  buildWriteSingleCoil,
  buildMaskWriteRegister,
  buildReadWriteMultiple,
  buildReadFileRecord,
  buildWriteFileRecord,
  buildReadFifoQueue,
  parseReadCoils,
  parseReadDiscreteInputs,
  parseReadHolding,
  parseReadInputRegisters,
  parseWriteSingle,
  parseMaskWriteRegister,
  parseReadWriteMultiple,
  parseReadFileRecord,
  parseReadFifoQueue,
  parseWriteSingleCoil
} from './core/frames.js';

import type { ReadCoilResult, ReadRegisterResult, WriteCoilResult, WriteMultipleResult, WriteRegisterResult, MaskWriteResult, WriteFileResult, ReadFifoResult } from './core/types.js';

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

  setTimeout(ms: number) { this.transport.setTimeout(ms); }
  getTimeout()          { return this.transport.getTimeout(); }
  getPort()             { return this.transport.getPort(); }

 
  /* =========================  READ  =============================== */

  /** FC 01 – coils */
  async readCoils(addr: number, qty: number): Promise<ReadCoilResult> {
    const raw = await this.transport.transact(buildReadCoils(this.id, addr, qty));
    return { data: parseReadCoils(raw), raw };
  }

  /** FC 02 – discrete inputs */
async readDiscreteInputs(addr: number, qty: number): Promise<ReadCoilResult> {
  const raw  = await this.transport.transact(
                 buildReadDiscreteInputs(this.id, addr, qty));
  const full = parseReadDiscreteInputs(raw);  // may be up to qty+7
  return { data: full.slice(0, qty), raw };   // trim padding here
}

  /** FC 03 – holding registers (already existed) */
  async readHoldingRegisters(addr: number, qty: number): Promise<ReadRegisterResult> {
    const raw = await this.transport.transact(buildReadHolding(this.id, addr, qty));
    return { data: parseReadHolding(raw), raw };
  }

  /** FC 04 – input registers */
  async readInputRegisters(addr: number, qty: number): Promise<ReadRegisterResult> {
    const raw = await this.transport.transact(buildReadInputRegisters(this.id, addr, qty));
    return { data: parseReadInputRegisters(raw), raw };
  }

  /* =========================  WRITE  ============================== */

  /** FC 05 – single coil */
  async writeCoil(addr: number, state: boolean): Promise<WriteCoilResult> {
    const raw = await this.transport.transact(buildWriteSingleCoil(this.id, addr, state));
    const { address, state: s } = parseWriteSingleCoil(raw);
    return { address, state: s, raw };
  }

  /** FC 0F – multiple coils */
  async writeCoils(addr: number, states: boolean[]): Promise<WriteMultipleResult> {
    const raw = await this.transport.transact(buildWriteMultipleCoils(this.id, addr, states));
    // echo frame contains start-addr & qty
    const length = states.length;
    return { address: addr, length, raw };
  }

  /** FC 06 – single holding register (already existed) */
  async writeRegister(addr: number, value: number): Promise<WriteRegisterResult> {
    const raw = await this.transport.transact(buildWriteSingle(this.id, addr, value));
    const { address, value: v } = parseWriteSingle(raw);
    return { address, value: v, raw };
  }

  /** FC 16 – multiple holding registers */
  async writeRegisters(addr: number, values: number[]): Promise<WriteMultipleResult> {
    const raw = await this.transport.transact(buildWriteMultiple(this.id, addr, values));
    const length = values.length;
    return { address: addr, length, raw };
  }
 /* ================== OPTIONAL DATA-ACCESS FUNCTIONS ================== */

  /** FC 22 – mask write register */
  async maskWriteRegister(addr: number, andMask: number, orMask: number): Promise<MaskWriteResult> {
    const raw = await this.transport.transact(buildMaskWriteRegister(this.id, addr, andMask, orMask));
    const { address, andMask: a, orMask: o } = parseMaskWriteRegister(raw);
    return { address, andMask: a, orMask: o, raw };
  }

  /** FC 23 – read/write multiple registers */
  async readWriteRegisters(readAddr: number, readQty: number, writeAddr: number, values: number[]): Promise<ReadRegisterResult> {
    const raw = await this.transport.transact(
      buildReadWriteMultiple(this.id, readAddr, readQty, writeAddr, values)
    );
    return { data: parseReadWriteMultiple(raw), raw };
  }

  /** FC 20 – read file record (single reference) */
  async readFileRecord(file: number, record: number, length: number): Promise<ReadRegisterResult> {
    const raw = await this.transport.transact(
      buildReadFileRecord(this.id, file, record, length)
    );
    return { data: parseReadFileRecord(raw), raw };
  }

  /** FC 21 – write file record (single reference) */
  async writeFileRecord(file: number, record: number, values: number[]): Promise<WriteFileResult> {
    const raw = await this.transport.transact(
      buildWriteFileRecord(this.id, file, record, values)
    );
    return { file, record, length: values.length, raw };
  }

  /** FC 24 – read FIFO queue */
  async readFifoQueue(addr: number): Promise<ReadFifoResult> {
    const raw = await this.transport.transact(
      buildReadFifoQueue(this.id, addr)
    );
    return { data: parseReadFifoQueue(raw), raw };
  }

}