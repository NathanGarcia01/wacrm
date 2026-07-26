// ============================================================
// CPF/CNPJ — shared by the signup form (client-side, instant feedback)
// and the validate-document API route (server-side, authoritative).
// Pure functions only, no DOM/Node APIs, so this is safe to import
// from both.
// ============================================================

export type DocumentType = "cpf" | "cnpj";

/** Strips everything but digits — the only shape these functions
 *  operate on internally; masking is purely a display concern. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** 11 digits → cpf, 14 → cnpj, anything else → null (still being typed
 *  or already too long). Used both to pick which mask to render and
 *  which checksum algorithm to run. */
export function detectDocumentType(digits: string): DocumentType | null {
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
}

/**
 * Progressive mask applied while typing — formats as many digits as
 * are available rather than waiting for the full length, so the
 * field looks right mid-entry. Assumes CPF up to 11 digits; digit 12+
 * switches to the CNPJ pattern. Extra digits beyond 14 are dropped.
 */
export function formatDocument(rawValue: string): string {
  const digits = onlyDigits(rawValue).slice(0, 14);

  if (digits.length <= 11) {
    // CPF: 000.000.000-00
    let out = digits.slice(0, 3);
    if (digits.length > 3) out += "." + digits.slice(3, 6);
    if (digits.length > 6) out += "." + digits.slice(6, 9);
    if (digits.length > 9) out += "-" + digits.slice(9, 11);
    return out;
  }

  // CNPJ: 00.000.000/0000-00
  let out = digits.slice(0, 2);
  out += "." + digits.slice(2, 5);
  out += "." + digits.slice(5, 8);
  out += "/" + digits.slice(8, 12);
  if (digits.length > 12) out += "-" + digits.slice(12, 14);
  return out;
}

/** True if every digit is the same (000.000.000-00-style sequences) —
 *  passes the mod-11 checksum below by coincidence for some values,
 *  so both validators reject these explicitly, same as every real
 *  CPF/CNPJ validator. */
function isAllSameDigit(digits: string): boolean {
  return digits.split("").every((d) => d === digits[0]);
}

/** Standard mod-11 check-digit algorithm shared by CPF and CNPJ, just
 *  with different weight tables — computes one check digit from a
 *  digit string and its weights (same length). */
function modulo11CheckDigit(digits: string, weights: number[]): number {
  const sum = digits
    .split("")
    .reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCPF(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || isAllSameDigit(digits)) return false;

  const check1 = modulo11CheckDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (check1 !== Number(digits[9])) return false;

  const check2 = modulo11CheckDigit(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return check2 === Number(digits[10]);
}

export function isValidCNPJ(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || isAllSameDigit(digits)) return false;

  const check1 = modulo11CheckDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (check1 !== Number(digits[12])) return false;

  const check2 = modulo11CheckDigit(
    digits.slice(0, 13),
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return check2 === Number(digits[13]);
}

/** Runs the right algorithm for whatever length was given. Returns
 *  the detected type alongside validity so callers don't have to
 *  re-derive it — `type` is null when the length doesn't match either
 *  document (always invalid in that case). */
export function validateDocument(value: string): { valid: boolean; type: DocumentType | null } {
  const digits = onlyDigits(value);
  const type = detectDocumentType(digits);
  if (!type) return { valid: false, type: null };
  const valid = type === "cpf" ? isValidCPF(digits) : isValidCNPJ(digits);
  return { valid, type };
}
