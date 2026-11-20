import { describe, expect, it } from "vitest";
import { parseApiError } from "./api";

describe("parseApiError", () => {
  it("junta os issues de uma recusa de validação em vez de [object Object]", async () => {
    const res = new Response(JSON.stringify({ error: { issues: [{ path: ["a", 0], message: "inválido" }] } }), { status: 400 });
    const err = await parseApiError(res);
    expect(err.message).toBe("a.0: inválido");
    expect(err.status).toBe(400);
  });

  it("usa a mensagem textual e o código", async () => {
    const err = await parseApiError(new Response(JSON.stringify({ error: "Conflito", code: "x" }), { status: 409 }));
    expect(err).toMatchObject({ message: "Conflito", status: 409, code: "x" });
  });

  it("mantém o status quando o corpo não é JSON", async () => {
    const err = await parseApiError(new Response("<html>", { status: 502, statusText: "Bad Gateway" }));
    expect(err).toMatchObject({ message: "Bad Gateway", status: 502 });
  });
});
