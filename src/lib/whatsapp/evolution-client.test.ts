import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEvolutionInstance,
  deleteEvolutionInstance,
  generateEvolutionInstanceName,
  getEvolutionConnectionState,
  getEvolutionQrCode,
  sendEvolutionText,
  setEvolutionWebhook,
} from "./evolution-client";

const BASE_URL = "https://evo.funilly.tech";
const API_KEY = "test-evolution-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("evolution-client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = BASE_URL;
    process.env.EVOLUTION_API_KEY = API_KEY;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
  });

  it("generateEvolutionInstanceName embeds the account id and a timestamp", () => {
    const name = generateEvolutionInstanceName("acc-1");
    expect(name).toMatch(/^funilly_acc-1_\d+$/);
  });

  it("createEvolutionInstance POSTs the right endpoint, headers, and body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await createEvolutionInstance("funilly_acc-1_123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/instance/create`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: API_KEY, "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      instanceName: "funilly_acc-1_123",
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    });
  });

  it("getEvolutionQrCode reads base64 from the top level or nested under qrcode", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ base64: "data:image/png;base64,AAA" }));
    await expect(getEvolutionQrCode("inst-1")).resolves.toEqual({
      base64: "data:image/png;base64,AAA",
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ qrcode: { base64: "data:image/png;base64,BBB" } }));
    await expect(getEvolutionQrCode("inst-1")).resolves.toEqual({
      base64: "data:image/png;base64,BBB",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/instance/connect/inst-1`);
  });

  it("getEvolutionConnectionState normalizes to open/connecting/close", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ instance: { state: "open" } }));
    await expect(getEvolutionConnectionState("inst-1")).resolves.toBe("open");

    fetchMock.mockResolvedValueOnce(jsonResponse({ state: "connecting" }));
    await expect(getEvolutionConnectionState("inst-1")).resolves.toBe("connecting");

    fetchMock.mockResolvedValueOnce(jsonResponse({ state: "something-unexpected" }));
    await expect(getEvolutionConnectionState("inst-1")).resolves.toBe("close");
  });

  it("setEvolutionWebhook posts the url and the three handled events", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await setEvolutionWebhook("inst-1", "https://www.funilly.tech/api/whatsapp/evolution-webhook?secret=abc");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/webhook/set/inst-1`);
    const body = JSON.parse(init.body);
    expect(body.url).toBe("https://www.funilly.tech/api/whatsapp/evolution-webhook?secret=abc");
    expect(body.events).toEqual(["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"]);
  });

  it("sendEvolutionText posts number and text to sendText/{instance} and returns the message id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ key: { id: "abc" } }));
    await expect(sendEvolutionText("inst-1", "5511999999999", "Olá!")).resolves.toEqual({
      messageId: "abc",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/message/sendText/inst-1`);
    expect(JSON.parse(init.body)).toEqual({ number: "5511999999999", text: "Olá!" });
  });

  it("sendEvolutionText falls back to a generated id when the response omits key.id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const result = await sendEvolutionText("inst-1", "5511999999999", "Olá!");
    expect(result.messageId).toMatch(/^evo_\d+$/);
  });

  it("deleteEvolutionInstance issues a DELETE", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await deleteEvolutionInstance("inst-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/instance/delete/inst-1`);
    expect(init.method).toBe("DELETE");
  });

  it("throws a descriptive error on a non-OK response", async () => {
    // `Response.json()` consumes the body stream, so each call needs its
    // own fresh Response instance — a single shared mockResolvedValue
    // would throw "body already used" on the second assertion below.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ message: "Instance already exists" }, 409)));
    await expect(createEvolutionInstance("dup")).rejects.toThrow(/409/);
    await expect(createEvolutionInstance("dup")).rejects.toThrow(/Instance already exists/);
  });

  it("throws when EVOLUTION_API_URL is missing", async () => {
    delete process.env.EVOLUTION_API_URL;
    await expect(createEvolutionInstance("x")).rejects.toThrow(/EVOLUTION_API_URL/);
  });

  it("throws when EVOLUTION_API_KEY is missing", async () => {
    delete process.env.EVOLUTION_API_KEY;
    await expect(createEvolutionInstance("x")).rejects.toThrow(/EVOLUTION_API_KEY/);
  });
});
