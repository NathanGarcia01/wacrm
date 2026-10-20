import { describe, expect, it } from "vitest";
import {
  extractNameParts,
  resolveVariables,
  resolveSingleVariable,
  findUnfilledVariableKeys,
} from "./broadcast-variables";

describe("extractNameParts", () => {
  it("capitalizes first/last/full name regardless of input casing", () => {
    expect(extractNameParts("JOÃO SILVA")).toEqual({
      firstName: "João",
      lastName: "Silva",
      fullName: "João Silva",
    });
    expect(extractNameParts("maria")).toEqual({
      firstName: "Maria",
      lastName: "Maria",
      fullName: "Maria",
    });
  });

  it("collapses repeated whitespace and trims", () => {
    expect(extractNameParts("  ana   paula souza  ")).toEqual({
      firstName: "Ana",
      lastName: "Souza",
      fullName: "Ana Paula Souza",
    });
  });

  it("returns empty strings for null/undefined/blank input without throwing", () => {
    expect(extractNameParts(null)).toEqual({ firstName: "", lastName: "", fullName: "" });
    expect(extractNameParts(undefined)).toEqual({ firstName: "", lastName: "", fullName: "" });
    expect(extractNameParts("   ")).toEqual({ firstName: "", lastName: "", fullName: "" });
  });
});

describe("resolveVariables field mapping", () => {
  const contact = { name: "JOÃO SILVA", phone: "+551199999999", email: "j@x.com", company: "Acme" };

  it("resolves first_name/last_name/name with proper capitalization", () => {
    const result = resolveVariables(
      { "1": { type: "field", value: "first_name" }, "2": { type: "field", value: "last_name" }, "3": { type: "field", value: "name" } },
      contact,
    );
    expect(result).toEqual(["João", "Silva", "João Silva"]);
  });

  it("passes phone/email/company through unchanged", () => {
    const result = resolveVariables(
      { "1": { type: "field", value: "phone" }, "2": { type: "field", value: "email" }, "3": { type: "field", value: "company" } },
      contact,
    );
    expect(result).toEqual(["+551199999999", "j@x.com", "Acme"]);
  });
});

describe("default values (migration 114)", () => {
  const contactNoName = { name: null, phone: "+551199999999", email: null, company: null };

  it("falls back to default when the resolved field is blank", () => {
    const result = resolveVariables(
      { "1": { type: "field", value: "name", default: "cliente" } },
      contactNoName,
    );
    expect(result).toEqual(["cliente"]);
  });

  it("does not apply the default when the resolved value is non-blank", () => {
    const result = resolveVariables(
      { "1": { type: "field", value: "name", default: "cliente" } },
      { name: "Maria", phone: null, email: null, company: null },
    );
    expect(result).toEqual(["Maria"]);
  });

  it("resolves to an empty string when blank and no default is set", () => {
    const result = resolveVariables({ "1": { type: "field", value: "name" } }, contactNoName);
    expect(result).toEqual([""]);
  });

  it("resolveSingleVariable mirrors the same default behavior", () => {
    expect(
      resolveSingleVariable({ type: "field", value: "name", default: "cliente" }, contactNoName),
    ).toBe("cliente");
  });
});

describe("findUnfilledVariableKeys", () => {
  const contactNoName = { name: null, phone: "+551199999999", email: null, company: null };

  it("flags a body key with no default as unfilled", () => {
    const unfilled = findUnfilledVariableKeys(
      { body: { "1": { type: "field", value: "name" } } },
      contactNoName,
    );
    expect(unfilled).toEqual(["1"]);
  });

  it("does not flag a body key that has a default", () => {
    const unfilled = findUnfilledVariableKeys(
      { body: { "1": { type: "field", value: "name", default: "cliente" } } },
      contactNoName,
    );
    expect(unfilled).toEqual([]);
  });

  it("flags an unfilled header and button alongside body keys", () => {
    const unfilled = findUnfilledVariableKeys(
      {
        body: { "1": { type: "field", value: "name" } },
        header: { type: "field", value: "company" },
        buttons: { "0": { type: "field", value: "email" } },
      },
      contactNoName,
    );
    expect(unfilled).toEqual(["1", "header", "button:0"]);
  });

  it("returns an empty list when everything resolves or has a default", () => {
    const unfilled = findUnfilledVariableKeys(
      {
        body: { "1": { type: "static", value: "Oi" } },
        header: { type: "field", value: "company", default: "nossa loja" },
      },
      contactNoName,
    );
    expect(unfilled).toEqual([]);
  });
});
