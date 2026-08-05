import { describe, it, expect } from "vitest";
import { resolveVariables } from "./variables";

describe("resolveVariables", () => {
  it("resolves contact tokens", () => {
    const text = resolveVariables("Olá {{nome}}, seu telefone é {{telefone}} e email {{email}}", {
      contact: { name: "João da Silva", phone: "+5511999999999", email: "joao@example.com" },
    });
    expect(text).toBe(
      "Olá João da Silva, seu telefone é +5511999999999 e email joao@example.com",
    );
  });

  it("resolves {{primeiro_nome}} to just the first name", () => {
    expect(resolveVariables("Oi {{primeiro_nome}}!", { contact: { name: "Maria Souza" } })).toBe(
      "Oi Maria!",
    );
  });

  it("resolves {{atendente}} and {{empresa}}", () => {
    const text = resolveVariables("Atendido por {{atendente}} da {{empresa}}", {
      assignedAgent: { full_name: "Ana Paula" },
      account: { name: "Funilly" },
    });
    expect(text).toBe("Atendido por Ana Paula da Funilly");
  });

  it("resolves {{data}} and {{hora}} from the given `now`", () => {
    const now = new Date(2026, 7, 4, 9, 5); // Aug 4, 2026, 09:05 (local)
    expect(resolveVariables("{{data}} às {{hora}}", { now })).toBe("04/08/2026 às 09:05");
  });

  it("resolves missing values to an empty string", () => {
    expect(resolveVariables("Olá {{nome}}!", {})).toBe("Olá !");
  });

  it("leaves unrecognized tokens untouched — Meta numeric placeholders", () => {
    expect(resolveVariables("Pedido {{1}} confirmado", {})).toBe("Pedido {{1}} confirmado");
  });

  it("leaves unrecognized tokens untouched — engines' own namespaced vocabulary", () => {
    const text = resolveVariables("{{contact.name}} disse {{message.text}} ({{vars.foo}})", {
      contact: { name: "Zé" },
    });
    expect(text).toBe("{{contact.name}} disse {{message.text}} ({{vars.foo}})");
  });

  it("returns empty/falsy text unchanged", () => {
    expect(resolveVariables("", { contact: { name: "Zé" } })).toBe("");
  });
});
