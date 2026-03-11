// test/proveRequestResponseMismatch.test.ts
import { describe, it, expect } from "vitest";
import {
  FC_READ_HOLDING_REGISTERS,
  FC_WRITE_SINGLE_HOLDING_REGISTER,
  FC_WRITE_MULTIPLE_HOLDING_REGISTERS,
  FC_READ_COILS,
  FC_WRITE_SINGLE_COIL,
  FC_WRITE_MULTIPLE_COILS,
  FC_READ_INPUT_REGISTERS,
  FC_READ_DISCRETE_INPUTS,
  FC_READ_FILE_RECORD,
  FC_WRITE_FILE_RECORD,
  FC_MASK_WRITE_REGISTER,
  FC_READ_WRITE_MULTIPLE_REGISTERS,
  FC_READ_FIFO_QUEUE,
} from "../src/core/types"
import { proveRequestResponseMismatch } from "../src/transport/webserial";

function u8(...xs: number[]) {
  return Uint8Array.from(xs);
}

describe("proveRequestResponseMismatch", () => {
  describe("base disqualifiers", () => {
    it("proves mismatch when slave address differs", () => {
      const req = u8(1, FC_READ_HOLDING_REGISTERS, 0x00, 0x10, 0x00, 0x02, 0, 0);
      const res = u8(2, FC_READ_HOLDING_REGISTERS, 0x04, 0xaa, 0xbb, 0xcc, 0xdd, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });

    it("proves mismatch when FC differs", () => {
      const req = u8(1, FC_READ_HOLDING_REGISTERS, 0x00, 0x10, 0x00, 0x02, 0, 0);
      const res = u8(1, FC_READ_INPUT_REGISTERS, 0x04, 0xaa, 0xbb, 0xcc, 0xdd, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });

    it("does not disprove a same-base exception frame with valid exception length", () => {
      const req = u8(1, FC_READ_HOLDING_REGISTERS, 0x00, 0x10, 0x00, 0x02, 0, 0);
      const res = u8(1, FC_READ_HOLDING_REGISTERS | 0x80, 0x02, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for malformed exception frame length", () => {
      const req = u8(1, FC_READ_HOLDING_REGISTERS, 0x00, 0x10, 0x00, 0x02, 0, 0);
      const res = u8(1, FC_READ_HOLDING_REGISTERS | 0x80, 0x02, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("0x01 / 0x02 reads", () => {
    it("does not disprove READ_COILS when byte count matches requested quantity", () => {
      const req = u8(1, FC_READ_COILS, 0x00, 0x13, 0x00, 0x0a, 0, 0); // 10 bits => 2 bytes
      const res = u8(1, FC_READ_COILS, 0x02, 0xcd, 0x01, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for READ_DISCRETE_INPUTS when byte count is wrong", () => {
      const req = u8(1, FC_READ_DISCRETE_INPUTS, 0x00, 0x13, 0x00, 0x09, 0, 0); // 9 bits => 2 bytes
      const res = u8(1, FC_READ_DISCRETE_INPUTS, 0x01, 0xcd, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("0x03 / 0x04 reads", () => {
    it("does not disprove READ_HOLDING_REGISTERS when byte count matches quantity", () => {
      const req = u8(1, FC_READ_HOLDING_REGISTERS, 0x00, 0x10, 0x00, 0x02, 0, 0);
      const res = u8(1, FC_READ_HOLDING_REGISTERS, 0x04, 0x11, 0x22, 0x33, 0x44, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for READ_INPUT_REGISTERS when total frame length disagrees with byte count", () => {
      const req = u8(1, FC_READ_INPUT_REGISTERS, 0x00, 0x10, 0x00, 0x02, 0, 0);
      const res = u8(1, FC_READ_INPUT_REGISTERS, 0x04, 0x11, 0x22, 0x33, 0x44, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("0x05 / 0x06 single writes", () => {
    it("does not disprove WRITE_SINGLE_COIL when echoed body matches", () => {
      const req = u8(1, FC_WRITE_SINGLE_COIL, 0x00, 0x13, 0xff, 0x00, 0, 0);
      const res = u8(1, FC_WRITE_SINGLE_COIL, 0x00, 0x13, 0xff, 0x00, 0x12, 0x34);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for WRITE_SINGLE_HOLDING_REGISTER when echoed value differs", () => {
      const req = u8(1, FC_WRITE_SINGLE_HOLDING_REGISTER, 0x00, 0x01, 0xbe, 0xef, 0, 0);
      const res = u8(1, FC_WRITE_SINGLE_HOLDING_REGISTER, 0x00, 0x01, 0xbe, 0xee, 0x12, 0x34);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("0x0f / 0x10 multiple writes", () => {
    it("does not disprove WRITE_MULTIPLE_COILS when start address and quantity echo back", () => {
      const req = u8(
        1, FC_WRITE_MULTIPLE_COILS,
        0x00, 0x13,
        0x00, 0x0a,
        0x02,
        0xcd, 0x01,
        0, 0,
      );
      const res = u8(1, FC_WRITE_MULTIPLE_COILS, 0x00, 0x13, 0x00, 0x0a, 0x12, 0x34);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for WRITE_MULTIPLE_HOLDING_REGISTERS when echoed quantity differs", () => {
      const req = u8(
        1, FC_WRITE_MULTIPLE_HOLDING_REGISTERS,
        0x00, 0x64,
        0x00, 0x02,
        0x04,
        0x12, 0x34, 0x56, 0x78,
        0, 0,
      );
      const res = u8(1, FC_WRITE_MULTIPLE_HOLDING_REGISTERS, 0x00, 0x64, 0x00, 0x03, 0x12, 0x34);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("0x16 mask write register", () => {
    it("does not disprove MASK_WRITE_REGISTER when echoed body matches", () => {
      const req = u8(1, FC_MASK_WRITE_REGISTER, 0x00, 0x01, 0xf2, 0x25, 0x00, 0x0a);
      const res = u8(1, FC_MASK_WRITE_REGISTER, 0x00, 0x01, 0xf2, 0x25, 0x12, 0x34);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for MASK_WRITE_REGISTER when AND mask differs", () => {
      const req = u8(1, FC_MASK_WRITE_REGISTER, 0x00, 0x01, 0xf2, 0x25, 0x00, 0x0a);
      const res = u8(1, FC_MASK_WRITE_REGISTER, 0x00, 0x01, 0xf2, 0x26, 0x12, 0x34);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("0x17 read/write multiple registers", () => {
    it("does not disprove READ_WRITE_MULTIPLE_REGISTERS when read byte count matches", () => {
      const req = u8(
        1, FC_READ_WRITE_MULTIPLE_REGISTERS,
        0x00, 0x10, // read start
        0x00, 0x02, // read qty => 4 bytes in response
        0x00, 0x20, // write start
        0x00, 0x02, // write qty
        0x04,       // write byte count
        0x12, 0x34, 0x56, 0x78,
        0, 0,
      );
      const res = u8(1, FC_READ_WRITE_MULTIPLE_REGISTERS, 0x04, 0xaa, 0xbb, 0xcc, 0xdd, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for READ_WRITE_MULTIPLE_REGISTERS when byte count is wrong", () => {
      const req = u8(
        1, FC_READ_WRITE_MULTIPLE_REGISTERS,
        0x00, 0x10,
        0x00, 0x02,
        0x00, 0x20,
        0x00, 0x02,
        0x04,
        0x12, 0x34, 0x56, 0x78,
        0, 0,
      );
      const res = u8(1, FC_READ_WRITE_MULTIPLE_REGISTERS, 0x02, 0xaa, 0xbb, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("0x18 read FIFO queue", () => {
    it("does not disprove READ_FIFO_QUEUE when declared byte count matches frame length", () => {
      // byteCount=6 => fifoCount(2) + data(4)
      const req = u8(1, FC_READ_FIFO_QUEUE, 0x00, 0x10, 0, 0);
      const res = u8(1, FC_READ_FIFO_QUEUE, 0x00, 0x06, 0x00, 0x02, 0x12, 0x34, 0x56, 0x78, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for READ_FIFO_QUEUE when byte count disagrees with actual frame length", () => {
      const req = u8(1, FC_READ_FIFO_QUEUE, 0x00, 0x10, 0, 0);
      const res = u8(1, FC_READ_FIFO_QUEUE, 0x00, 0x06, 0x00, 0x02, 0x12, 0x34, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("0x14 / 0x15 file record", () => {
    it("does not disprove READ_FILE_RECORD when declared byte count matches frame length", () => {
    const req = u8(
        1, FC_READ_FILE_RECORD,
        0x07,
        0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02,
        0, 0,
    );

    const res = u8(
        1, FC_READ_FILE_RECORD,
        0x06,             // byte count
        0x05,             // subresponse length
        0x06,             // reference type
        0x12, 0x34, 0x56, 0x78,
        0, 0,
    );

    expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });

    it("proves mismatch for WRITE_FILE_RECORD when declared byte count disagrees with frame length", () => {
      const req = u8(
        1, FC_WRITE_FILE_RECORD,
        0x09,
        0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0xab, 0xcd,
        0, 0,
      );
      const res = u8(
        1, FC_WRITE_FILE_RECORD,
        0x09,
        0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0, 0,
      );

      expect(proveRequestResponseMismatch(req, res)).toBe(true);
    });
  });

  describe("important semantic boundary", () => {
    it("does not disprove a stale-but-plausible same-slave same-FC same-length read response", () => {
      const req = u8(1, FC_READ_HOLDING_REGISTERS, 0x01, 0xf4, 0x00, 0x02, 0, 0);
      const res = u8(1, FC_READ_HOLDING_REGISTERS, 0x04, 0xde, 0xad, 0xbe, 0xef, 0, 0);

      expect(proveRequestResponseMismatch(req, res)).toBe(false);
    });
  });
});