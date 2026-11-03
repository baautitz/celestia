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
  lista: null,
  ativo: true,
};

const DIPIRONA = "8F14E45F-CEEA-467F-A8F4-5E1D2C3B4A01";

/**
 * ERP falso dos cadastros da Lista: devolve as linhas da tabela que o SQL consulta, aplicando só os filtros que o SQL
 * pede (eliminados, inativos, "REVISAR"), para que a rota prove que pede cada um.
 */
function erpFalso() {
  const tabelas = {
    Produto_Grupo: [
      { id: "44", nome: "VITAMINAS", ativo: true },
      { id: "14", nome: "POLIVITAMINICO", ativo: true },
      { id: "99", nome: "VITAMINAS ANTIGO", ativo: false },
    ],
    Produto_Sessao: [{ id: "261", nome: "GENERICOS" }],
    Produto_Fabricante: [
      { id: "414", nome: "EMS MARCAS", eliminado: false },
      { id: "7", nome: "REVISAR", eliminado: false },
      { id: "143", nome: "EMS ANTIGA", eliminado: true },
    ],
    Produto: [{ id: DIPIRONA, nome: "DIPIRONA 1G", detalhe: "789" }],
  };
  const erp = { fora: false, consultas: [] as string[] };
  const client = {
    query: async <T,>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> => {
      if (erp.fora) throw new Error("ERP fora do ar");
      erp.consultas.push(sql);
      if (sql.includes(" AS tipo")) {
        // Conferência: as entradas que existem em cada tabela.
        const pedidos = Object.entries(params).map(([k, v]) => [k.replace(/\d+$/, ""), String(v)] as const);
        const existe = (tipo: string, tabela: keyof typeof tabelas) => pedidos.filter(([t, id]) => t === tipo && tabelas[tabela].some((r) => r.id === id)).map(([, id]) => ({ tipo, id }));
        return [...existe("produto", "Produto"), ...existe("grupo", "Produto_Grupo"), ...existe("secao", "Produto_Sessao"), ...existe("laboratorio", "Produto_Fabricante")] as T[];
      }
      const termo = String(params.buscaLike ?? "").replace(/%/g, "").toUpperCase();
      const tabela = (["Produto_Grupo", "Produto_Sessao", "Produto_Fabricante"] as const).find((t) => sql.includes(t)) ?? "Produto";
      return (tabelas[tabela] as { id: string; nome: string; ativo?: boolean; eliminado?: boolean; detalhe?: string }[])
        .filter((r) => r.nome.includes(termo))
        .filter((r) => !sql.includes("Ativo = 1") || r.ativo)
        .filter((r) => !sql.includes("Eliminado = 0") || !r.eliminado)
        .filter((r) => !sql.includes("'REVISAR'") || r.nome !== "REVISAR")
        .map((r) => ({ id: r.id, nome: r.nome, detalhe: r.detalhe ?? null })) as T[];
    },
  };
  return { erp, client };
}

function boot() {
  const app = new Hono();
  const { erp, client } = erpFalso();
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
    erpClient: () => client,
    store: new MemoryTipoMetaStore(),
    metas,
    periods: { list: async () => periodos },
    audit,
  });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { req, metas, log, periodos, erp };
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
    const abril = (await metas.criar({ periodoId: "abril", tipoId: criado.id, participantes, excluidos: [] }))!;
    await metas.criar({ periodoId: "marco", tipoId: criado.id, participantes, excluidos: [] });

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

describe("Alvo padrão com o Período fechando ao mesmo tempo", () => {
  it("não grava nem registra se o Período fecha durante a aplicação", async () => {
    const { req, metas, log, periodos } = boot();
    const criado = (await (await req("gil", "POST", "/metas/tipos", cmv)).json()) as Tipo;
    const abril = await metas.criar({ periodoId: "abril", tipoId: criado.id, participantes: [{ codigoColaborador: 2, nome: "BIA", alvo: null }], excluidos: [] });
    if (!abril) throw new Error("Meta não criada");
    // Outro gestor fecha o Período enquanto a aplicação confere a Meta.
    const ler = metas.meta.bind(metas);
    metas.meta = async (id) => {
      periodos[0] = { ...periodos[0], status: "closed" } as PeriodoResumo;
      return ler(id);
    };
    const antes = log.length;
    const res = await req("gil", "POST", `/metas/tipos/${criado.id}/aplicar-alvo-padrao`, { aplicacoes: [{ metaId: abril.id, version: abril.version, codigos: [2] }] });
    expect(res.status).toBe(409);
    expect((await ler(abril.id))?.participantes[0]?.alvo).toBeNull();
    expect(log.length).toBe(antes);
  });
});

describe("Alvo em várias Metas de uma vez", () => {
  it("grava todas ou nenhuma: uma Meta alterada por outra pessoa não deixa as outras alteradas", async () => {
    const metas = new MemoryMetaStore();
    const participantes = [{ codigoColaborador: 1, nome: "ANA", alvo: null }];
    const abril = await metas.criar({ periodoId: "abril", tipoId: "t", participantes, excluidos: [] });
    const maio = await metas.criar({ periodoId: "maio", tipoId: "t", participantes, excluidos: [] });
    if (!abril || !maio) throw new Error("Metas não criadas");
    const aplicacoes = (versaoMaio: number) => [
      { id: abril.id, codigos: [1], expectedVersion: abril.version },
      { id: maio.id, codigos: [1], expectedVersion: versaoMaio },
    ];
    const alvos = async () => (await metas.listar(["abril", "maio"])).map((m) => m.participantes[0]?.alvo);
    expect(await metas.definirAlvos(aplicacoes(maio.version + 1), 30)).toBeNull();
    expect(await alvos()).toEqual([null, null]);
    expect((await metas.definirAlvos(aplicacoes(maio.version), 30))?.length).toBe(2);
    expect(await alvos()).toEqual([30, 30]);
  });
});

describe("Tipo de Meta de Lista de Produtos", () => {
  const lista = {
    ...cmv,
    nome: "Mix Vitaminas",
    indicador: "lista-produtos",
    alvoPadrao: 50,
    lista: {
      unidade: "unidades",
      entradas: [
        { tipo: "laboratorio", id: "414", nome: "EMS MARCAS" },
        { tipo: "produto", id: DIPIRONA, nome: "DIPIRONA 1G" },
        { tipo: "grupo", id: "44", nome: "VITAMINAS" },
      ],
    },
  };

  it("cadastra a Lista mista com a unidade e o Alvo padrão, e registra a Lista no Audit Log", async () => {
    const { req, log } = boot();
    const res = await req("gil", "POST", "/metas/tipos", lista);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ lista: lista.lista, alvoPadrao: 50, premio: "Lista de Produtos a partir de 50 paga R$ 100,00" });
    expect(log).toEqual([
      'Cadastrou o Tipo de Meta "Mix Vitaminas" (Lista de Produtos): Lista de Produtos a partir de 50 paga R$ 100,00; Lista de Produtos em unidades: Produto DIPIRONA 1G, Grupo VITAMINAS, Laboratório EMS MARCAS.',
    ]);
  });

  it("recusa a Lista vazia, a Lista em outro Indicador e a Exibição Contagem", async () => {
    const { req } = boot();
    const erro = async (corpo: unknown) => {
      const res = await req("gil", "POST", "/metas/tipos", corpo);
      return [res.status, ((await res.json()) as { error: string }).error];
    };
    expect(await erro({ ...lista, lista: { unidade: "unidades", entradas: [] } })).toEqual([400, "Adicione pelo menos uma entrada à Lista."]);
    expect(await erro({ ...lista, lista: null })).toEqual([400, "Adicione pelo menos uma entrada à Lista."]);
    expect(await erro({ ...cmv, lista: lista.lista })).toEqual([400, "Só o Indicador Lista de Produtos tem Lista."]);
    expect((await erro({ ...lista, exibicao: "contagem" }))[0]).toBe(400);
  });

  it("em R$, aceita Sem Alvo pagando o Percentual sobre a própria Lista; em unidades, não", async () => {
    const { req, log } = boot();
    const comissao = {
      ...lista,
      nome: "Comissão Vitaminas",
      semAlvo: true,
      exibicao: "progresso",
      alvoPadrao: null,
      regra: { tipo: "percentual", percentual: 2, indicadorBase: "lista-produtos", soSeAtingir: false },
    };
    expect((await req("gil", "POST", "/metas/tipos", comissao)).status).toBe(400);
    const res = await req("gil", "POST", "/metas/tipos", { ...comissao, lista: { ...lista.lista, unidade: "reais" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ premio: "Paga 2% do valor vendido da Lista de Produtos" });
    expect(log.at(-1)).toMatch(/Lista de Produtos em R\$: /);
  });

  it("busca só no tipo escolhido, sem o Fabricante REVISAR nem cadastros eliminados ou inativos", async () => {
    const { req } = boot();
    const busca = async (tipo: string, q: string) => (await (await req("gil", "GET", `/metas/lista/busca?tipo=${tipo}&q=${q}`)).json()) as { tipo: string; id: string; nome: string }[];
    expect((await busca("laboratorio", "EM")).map((r) => r.nome)).toEqual(["EMS MARCAS"]);
    expect((await busca("laboratorio", "REVISAR")).map((r) => r.nome)).toEqual([]);
    expect((await busca("grupo", "VITAMIN")).map((r) => [r.tipo, r.id, r.nome])).toEqual([
      ["grupo", "44", "VITAMINAS"],
      ["grupo", "14", "POLIVITAMINICO"],
    ]);
    expect((await busca("secao", "GEN")).map((r) => r.nome)).toEqual(["GENERICOS"]);
    expect((await busca("produto", "DIP")).map((r) => [r.tipo, r.id])).toEqual([["produto", DIPIRONA]]);
    expect((await req("gil", "GET", "/metas/lista/busca?tipo=marca&q=EMS")).status).toBe(400);
    expect((await req("ana", "GET", "/metas/lista/busca?tipo=grupo&q=VIT")).status).toBe(403);
  });

  it("confere quais entradas não existem mais no ERP", async () => {
    const { req, erp } = boot();
    const entradas = [
      { tipo: "grupo", id: "44" },
      { tipo: "laboratorio", id: "999" },
    ];
    const res = await req("gil", "POST", "/metas/lista/conferir", { entradas });
    expect(await res.json()).toEqual({ ausentes: [{ tipo: "laboratorio", id: "999" }] });
    erp.fora = true;
    expect((await req("gil", "POST", "/metas/lista/conferir", { entradas })).status).toBe(503);
  });
});
