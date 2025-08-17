# modbus-webserial

Tiny zero-dependency library for communicating with a Modbus-RTU serial device from the browser via WebSerial.

![npm](https://img.shields.io/npm/v/modbus-webserial)
![size](https://img.shields.io/bundlephobia/minzip/modbus-webserial)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![CI](https://img.shields.io/github/actions/workflow/status/anttikotajarvi/modbus-webserial/ci.yaml?branch=main)
[![License](https://img.shields.io/npm/l/modbus-webserial)](./LICENSE)
![types](https://img.shields.io/npm/types/modbus-webserial)
![esm](https://img.shields.io/badge/esm-%F0%9F%9A%80-green)

## Install

```bash
npm install modbus-webserial
```

## Usage
**Connect  → read/write in browser**
```javascript
import { ModbusRTU } from 'modbus-webserial';

// Prompt the WebSerial dialog and open port
const client = await ModbusRTU.openWebSerial({ baudRate: 9600 });
client.setID(1);

// Read holding registers 0x00 and 0x01
const { data } = await client.readHoldingRegisters(0, 2);
console.log('HR0=', data[0], 'HR1=', data[1]);

// Write values to holding registers 0x00 and 0x01
await client.writeRegisters(0, [0x0A, 0x0B]);
```
**Can also be used *without* WebSerial for building modbus frames in any environment**
```javascript
import {
  buildReadHoldingRegisters,
  buildWriteRegisters
} from 'modbus-webserial';

// Build a “Read Holding Registers” frame (ID=1, addr=0, qty=2)
const rawRead = buildReadHoldingRegisters(1, 0x00, 2);
console.log(rawRead);
// → Uint8Array [0x01, 0x03, 0x00, 0x00, 0x00, 0x02, CRC_LO, CRC_HI]

// Build a “Write Multiple Registers” frame (ID=1, addr=0, values=[10,11])
const rawWrite = buildWriteRegisters(1, 0x00, [0x0A, 0x0B]);
console.log(rawWrite);
// → Uint8Array [0x01, 0x10, 0x00, 0x00, 0x00, 0x02, 0x04, 0x00,0x0A, 0x00,0x0B, CRC_LO, CRC_HI]
```
> [!TIP]
> Check `src/index.ts` (or `dist/index.js`) for all exports 
## Supported Functions

### Modbus Data Functions

The following Modbus-RTU function calls are implemented:

| Function                          | Description                              |
| --------------------------------- | ---------------------------------------- |
| `readCoils(addr, qty)`            | FC 01 – Read coil status                 |
| `readDiscreteInputs(addr, qty)`   | FC 02 – Read discrete input status       |
| `readHoldingRegisters(addr, qty)` | FC 03 – Read holding registers           |
| `readInputRegisters(addr, qty)`   | FC 04 – Read input registers             |
| `writeCoil(addr, state)`          | FC 05 – Write single coil                |
| `writeRegister(addr, value)`      | FC 06 – Write single holding register    |
| `writeCoils(addr, states)`        | FC 15 – Write multiple coils             |
| `writeRegisters(addr, values)`    | FC 16 – Write multiple holding registers |
| `readFileRecord(file, rec, len)`  | FC 20 – Read file record (single ref)    |
| `writeFileRecord(file, rec, vals)`| FC 21 – Write file record (single ref)   |
| `maskWriteRegister(addr, and, or)`| FC 22 – Mask write register              |
| `readWriteRegisters(rAddr, rQty, wAddr, vals)` | FC 23 – Read/write multiple regs |
| `readFifoQueue(addr)`             | FC 24 – Read FIFO queue                  |
> [!CAUTION]
> Not all slave libraries support file records, FIFO queues, mask writes or read-write calls
### Auxiliary Client Methods

Utility and configuration methods exposed on `ModbusRTU`:

| Method                   | Purpose                             |
| ------------------------ | ----------------------------------- |
| `openWebSerial(options)` | Open a serial port via WebSerial    |
| `close()`                | Close the current serial connection |
| `setID(id)`              | Set the Modbus slave ID             |
| `getID()`                | Get the current slave ID            |
| `setTimeout(ms)`         | Set transaction timeout (ms)        |
| `getTimeout()`           | Get current timeout (ms)            |
| `getPort()`              | Get 'SerialPort' instance*          |
*Note: The returned `SerialPort` instance from `getPort` can be used to access properties such as `usbVendorId` and `usbProductId` for retrieving information about the connected USB device.*

## Examples

The following demos are fully self‑contained HTML files, served via GitHub Pages:

* [Basic Read/Write Demo](https://anttikotajarvi.github.io/modbus-webserial/examples/basic-demo/)
  Simple page to connect, read two registers, and write two registers.
* [64‑Register Smoke Test](https://anttikotajarvi.github.io/modbus-webserial/examples/smoke-test/)
  Automated loop testing read/write of 64 registers, coils, and discrete inputs with live counters and error logging.

## Current state
* **v0.10**: Full modbus data-access coverage
* **v0.9**: Full passing tests, smoke test passed, complete README, build scripts in place
* **Beta**: Full Modbus RTU function‑code coverage
* **Alpha**: Basic structure and layout

## Roadmap

* **v1.0.0**: Finalize API, apply bug fixes, refine docs, production-ready release

---

© 2025 Antti Kotajärvi
