import { describe, expect, it } from "vitest";
import { extractNameParts, resolveVariables } from "./broadcast-variables";

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
