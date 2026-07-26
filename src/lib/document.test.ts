import { describe, expect, it } from "vitest";
import {
  detectDocumentType,
  formatDocument,
  isValidCNPJ,
  isValidCPF,
  onlyDigits,
  validateDocument,
} from "./document";

describe("onlyDigits", () => {
  it("strips non-digit characters", () => {
    expect(onlyDigits("123.456.789-09")).toBe("12345678909");
    expect(onlyDigits("12.345.678/0001-95")).toBe("12345678000195");
  });
});

describe("detectDocumentType", () => {
  it("detects cpf at 11 digits and cnpj at 14", () => {
    expect(detectDocumentType("12345678909")).toBe("cpf");
    expect(detectDocumentType("12345678000195")).toBe("cnpj");
  });

  it("returns null for any other length", () => {
    expect(detectDocumentType("123")).toBeNull();
    expect(detectDocumentType("")).toBeNull();
    expect(detectDocumentType("123456789012345")).toBeNull();
  });
});

describe("formatDocument", () => {
  it("applies the CPF mask progressively while typing", () => {
    expect(formatDocument("1")).toBe("1");
    expect(formatDocument("123")).toBe("123");
    expect(formatDocument("1234")).toBe("123.4");
    expect(formatDocument("123456")).toBe("123.456");
    expect(formatDocument("1234567")).toBe("123.456.7");
    expect(formatDocument("123456789")).toBe("123.456.789");
    expect(formatDocument("12345678909")).toBe("123.456.789-09");
  });

  it("switches to the CNPJ mask at the 12th digit", () => {
    expect(formatDocument("123456780001")).toBe("12.345.678/0001");
    expect(formatDocument("12345678000195")).toBe("12.345.678/0001-95");
  });

  it("drops digits beyond 14 instead of growing the mask further", () => {
    expect(formatDocument("123456789000195999")).toBe("12.345.678/9000-19");
  });

  it("ignores existing punctuation in the input (re-masks pasted values)", () => {
    expect(formatDocument("123.456.789-09")).toBe("123.456.789-09");
  });
});

describe("isValidCPF", () => {
  it("accepts known-valid CPFs, formatted or raw", () => {
    expect(isValidCPF("12345678909")).toBe(true);
    expect(isValidCPF("123.456.789-09")).toBe(true);
    expect(isValidCPF("98765432100")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidCPF("12345678900")).toBe(false);
  });

  it("rejects all-same-digit sequences even though some pass the checksum", () => {
    expect(isValidCPF("11111111111")).toBe(false);
    expect(isValidCPF("00000000000")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidCPF("123456789")).toBe(false);
    expect(isValidCPF("123456789091")).toBe(false);
  });
});

describe("isValidCNPJ", () => {
  it("accepts known-valid CNPJs, formatted or raw", () => {
    expect(isValidCNPJ("12345678000195")).toBe(true);
    expect(isValidCNPJ("12.345.678/0001-95")).toBe(true);
    expect(isValidCNPJ("11122233000183")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidCNPJ("12345678000100")).toBe(false);
  });

  it("rejects all-same-digit sequences", () => {
    expect(isValidCNPJ("11111111111111")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidCNPJ("1234567800019")).toBe(false);
  });
});

describe("validateDocument", () => {
  it("routes to the CPF algorithm at 11 digits", () => {
    expect(validateDocument("123.456.789-09")).toEqual({ valid: true, type: "cpf" });
  });

  it("routes to the CNPJ algorithm at 14 digits", () => {
    expect(validateDocument("12.345.678/0001-95")).toEqual({ valid: true, type: "cnpj" });
  });

  it("is invalid with a null type for any other length", () => {
    expect(validateDocument("123")).toEqual({ valid: false, type: null });
  });

  it("is invalid (but type still detected) for a bad checksum", () => {
    expect(validateDocument("12345678900")).toEqual({ valid: false, type: "cpf" });
  });
});
