import { describe, expect, it } from "vitest"
import { matchesExactKeyword, matchesReactivationKeyword, normalizeOptOutText } from "./opt-out"

describe("normalizeOptOutText", () => {
  it("lowercases and strips accents", () => {
    expect(normalizeOptOutText("CANCELAR")).toBe("cancelar")
    expect(normalizeOptOutText("Não")).toBe("nao")
  })

  it("trims whitespace and punctuation only at the ends", () => {
    expect(normalizeOptOutText("  Sair!  ")).toBe("sair")
    expect(normalizeOptOutText("¿Parar?")).toBe("parar")
    expect(normalizeOptOutText("...stop...")).toBe("stop")
  })

  it("leaves internal punctuation/spacing untouched", () => {
    expect(normalizeOptOutText("consigo sair do banco?")).toBe("consigo sair do banco")
  })
})

describe("matchesExactKeyword", () => {
  const keywords = ["sair", "parar", "stop", "cancelar"]

  it("matches the whole message case/accent-insensitively", () => {
    expect(matchesExactKeyword("sair", keywords)).toBe(true)
    expect(matchesExactKeyword("SAIR", keywords)).toBe(true)
    expect(matchesExactKeyword("  Sair!  ", keywords)).toBe(true)
    expect(matchesExactKeyword("Cancelar.", keywords)).toBe(true)
  })

  it("does NOT match a message that merely contains the keyword", () => {
    expect(matchesExactKeyword("consigo sair do banco?", keywords)).toBe(false)
    expect(matchesExactKeyword("quero parar de pagar essa conta", keywords)).toBe(false)
    expect(matchesExactKeyword("não quero mais, CANCELAR!!!", keywords)).toBe(false)
  })

  it("does not match an unrelated word or empty message", () => {
    expect(matchesExactKeyword("pare", keywords)).toBe(false)
    expect(matchesExactKeyword("", keywords)).toBe(false)
    expect(matchesExactKeyword("   ", keywords)).toBe(false)
  })

  it("respects the account's configured keyword list, not a hardcoded one", () => {
    expect(matchesExactKeyword("remover", ["remover"])).toBe(true)
    expect(matchesExactKeyword("sair", ["remover"])).toBe(false)
  })
})

describe("matchesReactivationKeyword", () => {
  it("matches VOLTAR with the same whole-message rule", () => {
    expect(matchesReactivationKeyword("voltar")).toBe(true)
    expect(matchesReactivationKeyword("VOLTAR!")).toBe(true)
    expect(matchesReactivationKeyword("  Voltar  ")).toBe(true)
  })

  it("does not match a message that merely mentions voltar", () => {
    expect(matchesReactivationKeyword("quero voltar a receber")).toBe(false)
  })
})
