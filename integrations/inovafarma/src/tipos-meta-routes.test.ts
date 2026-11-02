import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerTiposMetaRoutes } from "./tipos-meta-routes";
import { MemoryTipoMetaStore } from "./tipos-meta-store";
import { MemoryMetaStore } from "./metas-store";
import { declareTiposMetaAudit } from "./tipos-meta-audit";
import type { PeriodoResumo } from "./pre-vencidos-routes";
import type { AuditService } from "./vinculo-audit";

const MANAGE = "inovafarma:tipos-meta:manage";

const cmv = {
  nome: "CMV",
  indicador: "cmv",
  exibicao: "atingida",
  mostrarPremio: true,
  semAlvo: false,
  regra: { tipo: "faixas", faixas: [{ atingimento: 100, valorCentavos: 10000 }] },
  alvoPadrao: 30,
  ativo: true,
};

function boot() {
  const app = new Hono();
  const periodos: PeriodoResumo[] = [
    { id: "abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" },
    { id: "marco", name: "Março", startDate: "2027-03-01", endDate: "2027-03-31", status: "closed" },
  ];
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(resumos.get(input.action)!(input.attributes as never)),
  };
  declareTiposMetaAudit(audit);
  // O Usuário vem do cabeçalho: "gil" gerencia os Tipos de Meta, "ana" não.
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "gil" ? [MANAGE] : [] } as never);
    await next();
  };
  const metas = new MemoryMetaStore();
  registerTiposMetaRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    store: new MemoryTipoMetaStore(),
    metas,
    periods: { list: async () => periodos },
    audit,
  });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { req, metas, log };
}

type Tipo = typeof cmv & { id: string; version: number; premio: string };

describe("Tipos de Meta", () => {
  it("cadastra, lista com a prévia do Prêmio e registra no Audit Log", async () => {
    const { req, log } = boot();
    const res = await req("gil", "POST", "/metas/tipos", cmv);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ nome: "CMV", version: 1, premio: "CMV % até 30% paga R$ 100,00" });
    const lista = (await (await req("gil", "GET", "/metas/tipos")).json()) as Tipo[];
    expect(lista.map((t) => t.nome)).toEqual(["CMV"]);
    expect(log).toEqual(['Cadastrou o Tipo de Meta "CMV" (CMV %): CMV % até 30% paga R$ 100,00.']);
  });

  it("exige a Permission e recusa regra sem sentido e nome repetido", async () => {
    const { req } = boot();
    const negado = await req("ana", "GET", "/metas/tipos");
    expect(negado.status).toBe(403);
    expect(((await negado.json()) as { error: string }).error).toMatch(/Tipos de Meta/);
    expect((await req("gil", "POST", "/metas/tipos", { ...cmv, regra: { tipo: "proporcional", valorCentavos: 100, gatilho: null, teto: null } })).status).toBe(400);
    expect((await req("gil", "POST", "/metas/tipos", cmv)).status).toBe(201);
    expect((await req("gil", "POST", "/metas/tipos", { ...cmv, nome: "cmv" })).status).toBe(409);
  });

  it("altera e desativa com controle de versão, sem trocar o Indicador", async () => {
    const { req, log } = boot();
    const criado = (await (await req("gil", "POST", "/metas/tipos", cmv)).json()) as Tipo;
    const res = await req("gil", "PUT", `/metas/tipos/${criado.id}`, { ...cmv, ativo: false, version: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ativo: false, version: 2 });
    expect((await req("gil", "PUT", `/metas/tipos/${criado.id}`, { ...cmv, version: 1 })).status).toBe(409);
    expect((await req("gil", "PUT", `/metas/tipos/${criado.id}`, { ...cmv, indicador: "ticket-medio", version: 2 })).status).toBe(400);
    expect(log[1]).toBe('Alterou o Tipo de Meta "CMV" (CMV %): desativou.');
  });

  it("aplica o Alvo padrão aos Participantes escolhidos das Metas dos Períodos abertos", async () => {
    const { req, metas, log } = boot();
    const criado = (await (await req("gil", "POST", "/metas/tipos", cmv)).json()) as Tipo;
    const participantes = [
      { codigoColaborador: 1, nome: "ANA", alvo: 28 },
      { codigoColaborador: 2, nome: "BIA", alvo: null },
    ];
    const abril = (await metas.criar({ periodoId: "abril", tipoId: criado.id, participantes }))!;
    await metas.criar({ periodoId: "marco", tipoId: criado.id, participantes });

    const aplicacao = (await (await req("gil", "GET", `/metas/tipos/${criado.id}/aplicacao`)).json()) as { periodos: { id: string; metaId: string; participantes: unknown[] }[] };
    expect(aplicacao.periodos.map((p) => [p.id, p.metaId, p.participantes.length])).toEqual([["abril", abril.id, 2]]);

    const aplicar = (metaId: string, version: number) => req("gil", "POST", `/metas/tipos/${criado.id}/aplicar-alvo-padrao`, { aplicacoes: [{ metaId, version, codigos: [2] }] });
    expect((await aplicar(abril.id, abril.version)).status).toBe(200);
    const [atualizada] = await metas.listar(["abril"]);
    expect(atualizada!.participantes.map((p) => p.alvo)).toEqual([28, 30]);
    expect((await aplicar(abril.id, abril.version)).status).toBe(409);
    const marco = (await metas.listar(["marco"]))[0]!;
    expect((await aplicar(marco.id, marco.version)).status).toBe(409);
    expect(log.at(-1)).toBe('Aplicou o Alvo padrão 30% do Tipo de Meta "CMV" a 1 Participante no período "Abril": BIA.');
  });
});
