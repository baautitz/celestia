import { describe, expect, it } from "vitest";
import { atorDoEvento, pendentesDoFechamento, periodoDoPayload } from "./pendentes-do-fechamento";

describe("pendentesDoFechamento", () => {
  it("devolve uma vez o que o before guardou e esquece", () => {
    const pendentes = pendentesDoFechamento<string>();
    pendentes.guardar("p1", "calculado");
    expect(pendentes.retirar("p1")).toBe("calculado");
    expect(pendentes.retirar("p1")).toBeUndefined();
  });

  it("o próximo fechamento do mesmo Período substitui a entrada que um fechamento recusado deixou", () => {
    const pendentes = pendentesDoFechamento<string>();
    pendentes.guardar("p1", "velho");
    pendentes.guardar("p1", "novo");
    expect(pendentes.retirar("p1")).toBe("novo");
  });

  it("é limitado: passando de 100 Períodos, descarta o mais antigo", () => {
    const pendentes = pendentesDoFechamento<number>();
    for (let i = 0; i < 101; i++) pendentes.guardar(`p${i}`, i);
    expect(pendentes.retirar("p0")).toBeUndefined();
    expect(pendentes.retirar("p1")).toBe(1);
    expect(pendentes.retirar("p100")).toBe(100);
  });
});

describe("payload do evento de fechamento", () => {
  it("lê o Período e o autor, e nomeia o autor pelo Usuário", async () => {
    const payload = { periodId: "abril", actorId: "gil" };
    expect(periodoDoPayload(payload)).toBe("abril");
    expect(periodoDoPayload({})).toBe("");
    const users = { list: async () => [{ id: "gil", fullname: "Gil Gestor", username: "gil", status: "active" }] };
    expect(await atorDoEvento(users, payload)).toEqual({ id: "gil", name: "Gil Gestor" });
    expect(await atorDoEvento(users, { actorId: "sumiu" })).toEqual({ id: "sumiu", name: "" });
  });
});
