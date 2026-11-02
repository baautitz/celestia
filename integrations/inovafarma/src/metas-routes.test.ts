import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerMetasRoutes } from "./metas-routes";
import { MemoryMetaStore, type Meta } from "./metas-store";
import { declareMetasAudit } from "./metas-audit";
import { MemoryTipoMetaStore } from "./tipos-meta-store";
import type { DadosTipoMeta } from "./tipos-meta";
import { MemoryVinculoStore } from "./vinculo-store";
import type { PeriodoResumo } from "./pre-vencidos-routes";
import type { AuditService } from "./vinculo-audit";

const MANAGE = "inovafarma:metas:manage";

const cmv: DadosTipoMeta = {
  nome: "CMV",
  indicador: "cmv",
  exibicao: "atingida",
  mostrarPremio: true,
  semAlvo: false,
  regra: { tipo: "faixas", faixas: [{ atingimento: 100, valorCentavos: 10000 }] },
  alvoPadrao: 30,
  ativo: true,
};
const ticket: DadosTipoMeta = { ...cmv, nome: "Ticket", indicador: "ticket-medio", alvoPadrao: null };
const lista: DadosTipoMeta = { ...cmv, nome: "Lista", indicador: "lista-produtos", exibicao: "contagem", alvoPadrao: null };

interface LinhaErp {
  codigoColaborador: number;
  nome: string;
  ativo: boolean;
  codigoEmpresa: number;
}

async function boot() {
  const app = new Hono();
  const periodos: PeriodoResumo[] = [
    { id: "maio", name: "Maio", startDate: "2027-05-01", endDate: "2027-05-31", status: "open" },
    { id: "abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" },
    { id: "marco", name: "Março", startDate: "2027-03-01", endDate: "2027-03-31", status: "closed" },
  ];
  const erp: LinhaErp[] = [
    { codigoColaborador: 1, nome: "ANA", ativo: true, codigoEmpresa: 10 },
    { codigoColaborador: 2, nome: "BIA", ativo: true, codigoEmpresa: 10 },
    { codigoColaborador: 3, nome: "CAIO", ativo: false, codigoEmpresa: 20 },
  ];
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(resumos.get(input.action)!(input.attributes as never)),
  };
  declareMetasAudit(audit);
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "gil" ? [MANAGE] : [] } as never);
    await next();
  };
  const tipos = new MemoryTipoMetaStore();
  const metas = new MemoryMetaStore();
  const vinculos = new MemoryVinculoStore();
  await vinculos.gravar({ codigoColaborador: 1, usuarioId: null, lojas: [10], atualizadoPor: "x" }, 0);
  registerMetasRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    erpClient: () => ({
      query: async <T,>(sql: string) => (sql.includes("Funcionario") ? erp : [{ codigoEmpresa: 10, nome: "Centro" }]) as T[],
    }),
    tipos,
    metas,
    vinculos,
    periods: { list: async () => periodos },
    audit,
  });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async <T,>(who: string, method: string, path: string, body?: unknown) => (await (await req(who, method, path, body)).json()) as T;
  return { req, json, tipos, metas, log, erp, periodos };
}

interface MetaVista extends Meta {
  pendentes: number;
  tipo: { nome: string };
}
interface Montagem {
  somenteLeitura: boolean;
  copiadoDe: string | null;
  colaboradores: { codigoColaborador: number; nome: string; lojas: number[] }[];
  metas: MetaVista[];
  tiposDisponiveis: { id: string; nome: string }[];
}

const alvos = (m: Meta) => m.participantes.map((p) => [p.nome, p.alvo]);

describe("Montar Metas", () => {
  it("adiciona uma Meta por Tipo ativo, com todos os Colaboradores ativos e o Alvo padrão", async () => {
    const { req, json, tipos, log } = await boot();
    const tipo = await tipos.criar(cmv);
    await tipos.criar({ ...ticket, ativo: false });
    const montagem = await json<Montagem>("gil", "GET", "/metas?periodoId=abril");
    expect(montagem.metas).toEqual([]);
    expect(montagem.tiposDisponiveis.map((t) => t.nome)).toEqual(["CMV"]);
    expect(montagem.colaboradores).toEqual([
      { codigoColaborador: 1, nome: "ANA", ativo: true, lojas: [10] },
      { codigoColaborador: 2, nome: "BIA", ativo: true, lojas: [] },
    ]);

    const res = await req("gil", "POST", "/metas", { periodoId: "abril", tipoId: tipo.id });
    expect(res.status).toBe(201);
    expect(alvos((await res.json()) as Meta)).toEqual([
      ["ANA", 30],
      ["BIA", 30],
    ]);
    expect((await req("gil", "POST", "/metas", { periodoId: "abril", tipoId: tipo.id })).status).toBe(409);
    expect(log).toEqual(['Adicionou a Meta "CMV" ao período "Abril" com 2 Participantes.']);
  });

  it("exige a Permission e só altera Metas de Período aberto", async () => {
    const { req, tipos } = await boot();
    const tipo = await tipos.criar(cmv);
    const negado = await req("ana", "GET", "/metas?periodoId=abril");
    expect(negado.status).toBe(403);
    expect(((await negado.json()) as { error: string }).error).toMatch(/Metas/);
    expect((await req("gil", "POST", "/metas", { periodoId: "marco", tipoId: tipo.id })).status).toBe(409);
  });

  it("desmarca e remarca Participantes, altera o Alvo e recusa versão desatualizada", async () => {
    const { req, json, tipos, log } = await boot();
    const tipo = await tipos.criar(cmv);
    const meta = await json<Meta>("gil", "POST", "/metas", { periodoId: "abril", tipoId: tipo.id });
    const fora = await json<Meta>("gil", "PUT", `/metas/${meta.id}/participantes/2`, { version: 1, participa: false });
    expect(alvos(fora)).toEqual([["ANA", 30]]);
    expect(fora.excluidos).toEqual([2]);
    expect((await req("gil", "PUT", `/metas/${meta.id}/participantes/1`, { version: 1, participa: true, alvo: 25 })).status).toBe(409);
    const alvo = await json<MetaVista>("gil", "PUT", `/metas/${meta.id}/participantes/1`, { version: 2, participa: true, alvo: null });
    expect(alvo.pendentes).toBe(1);
    const volta = await json<Meta>("gil", "PUT", `/metas/${meta.id}/participantes/2`, { version: 3, participa: true });
    expect(alvos(volta)).toEqual([
      ["ANA", null],
      ["BIA", 30],
    ]);
    expect(volta.excluidos).toEqual([]);
    expect(log.slice(1)).toEqual([
      'Desmarcou BIA da Meta "CMV" no período "Abril".',
      'Alterou o Alvo de ANA da Meta "CMV" no período "Abril" de 30% para pendente.',
      'Incluiu BIA como Participante da Meta "CMV" no período "Abril", com o Alvo 30%.',
    ]);
  });

  it("define o mesmo Alvo para os Participantes marcados", async () => {
    const { req, json, tipos, log } = await boot();
    const tipo = await tipos.criar(ticket);
    const meta = await json<MetaVista>("gil", "POST", "/metas", { periodoId: "abril", tipoId: tipo.id });
    expect(meta.pendentes).toBe(2);
    const res = await req("gil", "POST", `/metas/${meta.id}/definir-alvo`, { version: 1, codigos: [2], alvo: 5000 });
    expect(res.status).toBe(200);
    expect(alvos((await res.json()) as Meta)).toEqual([
      ["ANA", null],
      ["BIA", 5000],
    ]);
    expect((await req("gil", "POST", `/metas/${meta.id}/definir-alvo`, { version: 1, codigos: [1], alvo: 5000 })).status).toBe(409);
    expect(log.at(-1)).toBe('Definiu o Alvo R$ 50,00 da Meta "Ticket" no período "Abril" para 1 Participante: BIA.');
  });

  it("monta a Lista de Produtos com ajuste por Colaborador e mínimo de produtos", async () => {
    const { req, json, tipos, log } = await boot();
    const tipo = await tipos.criar(lista);
    const meta = await json<Meta>("gil", "POST", "/metas", { periodoId: "abril", tipoId: tipo.id });
    expect(meta.lista).toEqual({ produtos: [], minimo: null, ajustes: [] });
    const produtos = [
      { produtoId: "p1", nome: "DIPIRONA", quantidade: 10 },
      { produtoId: "p2", nome: "VITAMINA C", quantidade: 5 },
    ];
    const ajustes = [
      { codigoColaborador: 1, produtoId: "p1", quantidade: 4 },
      { codigoColaborador: 2, produtoId: "p1", quantidade: 10 },
    ];
    expect((await req("gil", "PUT", `/metas/${meta.id}/lista`, { version: 1, produtos, minimo: 3, ajustes })).status).toBe(400);
    const salva = await json<Meta>("gil", "PUT", `/metas/${meta.id}/lista`, { version: 1, produtos, minimo: 1, ajustes });
    expect(salva.lista).toEqual({ produtos, minimo: 1, ajustes: [ajustes[0]] });
    expect(log.at(-1)).toBe('Alterou a Lista de Produtos da Meta "Lista" no período "Abril": DIPIRONA (10), VITAMINA C (5); mínimo: 1; 1 ajuste por Colaborador.');
  });

  it("no primeiro acesso, copia as Metas do Período atualizado por último, com os Colaboradores de hoje", async () => {
    const { req, json, tipos, log, erp } = await boot();
    const tipo = await tipos.criar(cmv);
    const semPadrao = await tipos.criar(ticket);
    const inativo = await tipos.criar({ ...cmv, nome: "Antigo" });
    const meta = await json<Meta>("gil", "POST", "/metas", { periodoId: "marco", tipoId: tipo.id }).catch(() => null);
    expect(meta).toMatchObject({ error: expect.any(String) });
    // Abril é a origem: monta lá e desmarca BIA de CMV.
    const cmvAbril = await json<Meta>("gil", "POST", "/metas", { periodoId: "abril", tipoId: tipo.id });
    await json<Meta>("gil", "PUT", `/metas/${cmvAbril.id}/participantes/2`, { version: 1, participa: false });
    const ticketAbril = await json<Meta>("gil", "POST", "/metas", { periodoId: "abril", tipoId: semPadrao.id });
    await json<Meta>("gil", "POST", `/metas/${ticketAbril.id}/definir-alvo`, { version: 1, codigos: [1, 2], alvo: 4000 });
    await json<Meta>("gil", "POST", "/metas", { periodoId: "abril", tipoId: inativo.id });
    await tipos.atualizar(inativo.id, { ...cmv, nome: "Antigo", ativo: false }, 1);
    // ANA sai do ERP; DANI entra.
    erp[0]!.ativo = false;
    erp.push({ codigoColaborador: 4, nome: "DANI", ativo: true, codigoEmpresa: 10 });

    const maio = await json<Montagem>("gil", "GET", "/metas?periodoId=maio");
    expect(maio.copiadoDe).toBe("Abril");
    expect(maio.metas.map((m) => [m.tipo.nome, alvos(m), m.excluidos, m.pendentes])).toEqual([
      ["CMV", [["DANI", 30]], [2], 0],
      [
        "Ticket",
        [
          ["BIA", 4000],
          ["DANI", null],
        ],
        [],
        1,
      ],
    ]);
    expect(log.filter((l) => l.startsWith("Copiou"))).toEqual([
      'Copiou a Meta "CMV" do período "Abril" para "Maio" com 1 Participante; entraram DANI; saíram ANA.',
      'Copiou a Meta "Ticket" do período "Abril" para "Maio" com 2 Participantes; entraram DANI; saíram ANA; 1 pendente.',
    ]);
    // Segundo acesso não copia de novo.
    expect((await json<Montagem>("gil", "GET", "/metas?periodoId=maio")).copiadoDe).toBeNull();
    void req;
  });

  it("deixa o Período fechado só para leitura, sem cópia automática", async () => {
    const { req, json, tipos, metas } = await boot();
    const tipo = await tipos.criar(cmv);
    await json<Meta>("gil", "POST", "/metas", { periodoId: "abril", tipoId: tipo.id });
    const marco = await json<Montagem>("gil", "GET", "/metas?periodoId=marco");
    expect(marco).toMatchObject({ somenteLeitura: true, copiadoDe: null, metas: [] });
    const fechada = (await metas.criar({ periodoId: "marco", tipoId: tipo.id, participantes: [], excluidos: [], lista: null }))!;
    expect((await req("gil", "PUT", `/metas/${fechada.id}/participantes/1`, { version: 1, participa: true })).status).toBe(409);
    expect((await req("gil", "POST", `/metas/${fechada.id}/definir-alvo`, { version: 1, codigos: [1], alvo: 1 })).status).toBe(409);
  });

  it("informa as abas da página que a Permission libera", async () => {
    const { json, req } = await boot();
    expect(await json("gil", "GET", "/metas/contexto")).toMatchObject({
      abas: { tipos: false, montar: true, acompanhamento: false },
      periodos: [{ id: "maio" }, { id: "abril" }, { id: "marco" }],
      visualizacoes: [],
    });
    expect((await req("ana", "GET", "/metas/contexto")).status).toBe(403);
  });
});
