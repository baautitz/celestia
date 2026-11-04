import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerAcompanhamentoRoutes } from "./acompanhamento-routes";
import { MemoryApuracaoStore } from "./apuracao-store";
import { MemoryAvaliacaoStore } from "./avaliacoes-store";
import { MemoryMetaStore } from "./metas-store";
import { MemoryEstoquePreVencidoStore } from "./estoque-pre-vencidos-store";
import { MemoryBaixasCongeladasStore } from "./baixas-congeladas-store";
import { MemoryCorrecaoBaixaStore } from "./correcoes-baixa-store";
import type { PeriodoResumo } from "./pre-vencidos-routes";
import { MemoryTipoMetaStore } from "./tipos-meta-store";
import type { DadosTipoMeta } from "./tipos-meta";
import { MemoryVinculoStore } from "./vinculo-store";

const GERAL = "inovafarma:metas-geral:view";
const LOJA = "inovafarma:metas-loja:view";
const MINHAS = "inovafarma:metas-individual:view";
const MONTAR = "inovafarma:metas:manage";

const cmv: DadosTipoMeta = {
  nome: "CMV",
  indicador: "cmv",
  exibicao: "atingida",
  mostrarPremio: true,
  semAlvo: false,
  regra: { tipo: "fixo", valorCentavos: 10000 },
  alvoPadrao: 30,
  lista: null,
  ativo: true,
};
const avaliacoes: DadosTipoMeta = { ...cmv, nome: "Avaliações", indicador: "avaliacoes", regra: { tipo: "saldo" }, alvoPadrao: 20000 };

interface Linha {
  tipo: { nome: string };
  codigoColaborador: number;
  nome: string;
  atingimento: number | null;
  premioCentavos: number;
  resultado: string;
}
interface Acompanhamento {
  congelada: boolean;
  linhas: Linha[];
  totais: { codigoColaborador: number; nome: string; premioCentavos: number }[];
}

async function boot() {
  const app = new Hono();
  const periodos: PeriodoResumo[] = [{ id: "maio", name: "Maio", startDate: "2027-05-01", endDate: "2027-05-31", status: "open" }];
  // CMV de cada Colaborador no ERP: custo sobre líquido.
  const vendas = new Map([
    [1, { totalLiquido: 1000, totalCmv: 250, quantidadeVendas: 10 }],
    [2, { totalLiquido: 1000, totalCmv: 400, quantidadeVendas: 10 }],
  ]);
  // Unidades vendidas de cada produto da Lista, por Colaborador.
  const produtos: { codigoColaborador: number; produtoId: string; quantidade: number }[] = [];
  // Total vendido da Lista de Produtos por Colaborador (unidades e valor líquido em R$), e os parâmetros de cada consulta.
  const listaVendas: { codigoColaborador: number; quantidade: number; valor: number }[] = [];
  const consultasLista: Record<string, unknown>[] = [];
  // Linhas de venda de cada Loja no ERP, para as Baixas de Pré-vencido.
  const vendasDaLoja: { codigoLoja: number; vendaId: number; data: string; cancelada: boolean; codigoColaborador: number; nomeColaborador: string; produtoId: string; quantidade: number }[] = [];
  const estoque = new MemoryEstoquePreVencidoStore();
  const correcoes = new MemoryCorrecaoBaixaStore();
  const handlers = new Map<string, (p: object) => unknown>();
  const antes = new Map<string, (ctx: { payload: object; cancel(reason: string): void }) => unknown>();
  const registros: { action: string; actor: { id: string; name: string }; attributes: unknown }[] = [];
  const erp = { falha: false, inativos: new Set<number>() };
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    const permissions = { gil: [GERAL], lia: [LOJA], ana: [MINHAS], zoe: [MINHAS], mon: [MONTAR] }[sub] ?? [];
    c.set("user" as never, { sub, fullname: sub, permissions } as never);
    await next();
  };
  const tipos = new MemoryTipoMetaStore();
  const metas = new MemoryMetaStore();
  const vinculos = new MemoryVinculoStore();
  const avaliacoesStore = new MemoryAvaliacaoStore();
  await vinculos.gravar({ codigoColaborador: 1, usuarioId: "ana", lojas: [10], atualizadoPor: "x" }, 0);
  await vinculos.gravar({ codigoColaborador: 9, usuarioId: "lia", lojas: [10], atualizadoPor: "x" }, 0);
  const participantes = [
    { codigoColaborador: 1, nome: "ANA", alvo: 30 },
    { codigoColaborador: 2, nome: "BIA", alvo: 30 },
  ];
  const tipoCmv = await tipos.criar(cmv);
  await metas.criar({ periodoId: "maio", tipoId: tipoCmv.id, participantes, excluidos: [] });
  registerAcompanhamentoRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    events: {
      after: (event, handler) => (handlers.set(event, handler as (p: object) => unknown), () => undefined),
      before: (event, handler) => (antes.set(event, handler as never), () => undefined),
    },
    audit: { declareAction: () => undefined, record: async (r) => registros.push(r) },
    users: { list: async () => [{ id: "gil", fullname: "Gil Gestor", username: "gil", status: "active" }] },
    erpClient: () => ({
      query: async <T,>(sql: string, params: Record<string, unknown> = {}) => {
        if (erp.falha) throw new Error("ERP fora do ar");
        // Colaboradores do ERP: ativos, menos os que o teste desligou.
        if (sql.includes("f.Ativo")) return [1, 2, 9].map((codigoColaborador) => ({ codigoColaborador, nome: `Colaborador ${codigoColaborador}`, ativo: !erp.inativos.has(codigoColaborador), codigoEmpresa: 10 })) as T[];
        if (sql.includes("@codigoLoja")) return vendasDaLoja.filter((v) => v.codigoLoja === params.codigoLoja && v.data >= String(params.dataInicio)) as T[];
        if (!sql.includes("totalCmv") && sql.includes(" AS valor")) {
          consultasLista.push(params);
          return listaVendas as T[];
        }
        return (sql.includes("totalCmv")
          ? [...vendas].map(([codigoColaborador, v]) => ({ codigoColaborador, ...v }))
          : sql.includes("produtoId")
            ? produtos
            : [{ codigoEmpresa: 10, nome: "Centro" }]) as T[];
      },
    }),
    tipos,
    metas,
    vinculos,
    avaliacoes: avaliacoesStore,
    estoque,
    congeladas: new MemoryBaixasCongeladasStore(),
    correcoes,
    apuracoes: new MemoryApuracaoStore(),
    periods: { list: async () => periodos },
  });
  const res = (who: string, query: string) => app.request(`/metas/acompanhamento?periodoId=maio${query}`, { headers: { "x-user": who } });
  const ver = async (who: string, query = "") => (await (await res(who, query)).json()) as Acompanhamento;
  /** Como o EventBus: `before` pode recusar; senão a transição acontece e roda o `after`. Devolve o motivo da recusa. */
  const evento = async (event: string, status: PeriodoResumo["status"]) => {
    const payload = { actorId: "gil", periodId: "maio", name: "Maio", startDate: "2027-05-01", endDate: "2027-05-31" };
    let motivo: string | undefined;
    await antes.get(event)?.({ payload, cancel: (r) => (motivo ??= r) });
    if (motivo) return motivo;
    periodos[0] = { ...periodos[0], status };
    await handlers.get(event)?.(payload);
    return undefined;
  };
  /** Fecha o Período sem passar pelo Plugin: como um fechamento anterior à Apuração gravada. */
  const fecharSemPlugin = () => (periodos[0] = { ...periodos[0], status: "closed" });
  const minhas = (who: string, periodoId = "maio") => app.request(`/metas/minhas?periodoId=${periodoId}`, { headers: { "x-user": who } });
  return { periodos, app, res, ver, vendas, produtos, vendasDaLoja, estoque, correcoes, listaVendas, consultasLista, minhas, evento, fecharSemPlugin, erp, registros, tipos, metas, avaliacoesStore, participantes };
}

describe("Acompanhamento das Metas", () => {
  it("apura cada Participante ao vivo, com o resultado em palavras e o total de Prêmios", async () => {
    const { ver } = await boot();
    const { linhas, totais, congelada } = await ver("gil");
    expect(congelada).toBe(false);
    expect(linhas.map((l) => [l.nome, l.resultado, l.premioCentavos])).toEqual([
      ["ANA", "CMV 25% · Meta: até 30% · ✓ 5 p.p. abaixo", 10000],
      ["BIA", "CMV 40% · Meta: até 30% · ✗ 10 p.p. acima", 0],
    ]);
    expect(totais).toEqual([
      { codigoColaborador: 1, nome: "ANA", premioCentavos: 10000 },
      { codigoColaborador: 2, nome: "BIA", premioCentavos: 0 },
    ]);
  });

  it("tira da Apuração quem ficou inativo no ERP", async () => {
    const { ver, erp } = await boot();
    erp.inativos.add(2);
    const { linhas, totais } = await ver("gil");
    expect(linhas.map((l) => l.nome)).toEqual(["ANA"]);
    expect(totais.map((t) => t.codigoColaborador)).toEqual([1]);
  });

  it("não paga o CMV a quem não vendeu no Período, sem linha no ERP ou com líquido zero", async () => {
    const { ver, vendas } = await boot();
    vendas.delete(1);
    vendas.set(2, { totalLiquido: 0, totalCmv: 0, quantidadeVendas: 0 });
    expect((await ver("gil")).linhas.map((l) => [l.nome, l.atingimento, l.premioCentavos])).toEqual([
      ["ANA", 0, 0],
      ["BIA", 0, 0],
    ]);
  });

  it("desconta as Avaliações do Período do valor inicial", async () => {
    const { ver, tipos, metas, avaliacoesStore, participantes } = await boot();
    const tipo = await tipos.criar(avaliacoes);
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: participantes.map((p) => ({ ...p, alvo: 20000 })), excluidos: [] });
    await avaliacoesStore.criar({ periodoId: "maio", codigoColaborador: 2, nomeColaborador: "BIA", codigoLoja: 20, descricao: "Atraso", valorCentavos: 5000, criadoPor: "x" });
    const { linhas } = await ver("gil");
    expect(linhas.filter((l) => l.tipo.nome === "Avaliações").map((l) => [l.nome, l.premioCentavos])).toEqual([
      ["ANA", 20000],
      ["BIA", 15000],
    ]);
  });

  it("filtra pelas Lojas confirmadas no Vínculo: na Visualização Loja, só as do Usuário", async () => {
    const { ver, res } = await boot();
    expect((await ver("gil", "&codigoEmpresa=10")).linhas.map((l) => l.nome)).toEqual(["ANA"]);
    expect((await ver("lia", "&visualizacao=loja")).linhas.map((l) => l.nome)).toEqual(["ANA"]);
    expect((await res("lia", "&visualizacao=loja&codigoEmpresa=20")).status).toBe(403);
    expect((await res("lia", "&visualizacao=geral")).status).toBe(403);
    expect((await res("zé", "")).status).toBe(403);
  });

  it("congela a Apuração no fechamento e volta a apurar ao vivo ao reabrir", async () => {
    const { ver, vendas, evento } = await boot();
    await evento("closing_period.close", "closed");
    vendas.set(1, { totalLiquido: 1000, totalCmv: 500, quantidadeVendas: 10 });
    const fechada = await ver("gil");
    expect(fechada.congelada).toBe(true);
    expect(fechada.linhas[0]!.premioCentavos).toBe(10000);

    await evento("closing_period.reopen", "open");
    const reaberta = await ver("gil");
    expect(reaberta.congelada).toBe(false);
    expect(reaberta.linhas[0]!.premioCentavos).toBe(0);
  });

  it("recusa o fechamento com o ERP indisponível, sem gravar Apuração", async () => {
    const { evento, erp, registros } = await boot();
    erp.falha = true;
    expect(await evento("closing_period.close", "closed")).toBe(
      "Não foi possível apurar as Metas do Período no ERP InovaFarma: o Período não pode ser fechado agora. Tente novamente em instantes.",
    );
    expect(registros).toEqual([]);
  });

  it("registra no Audit Log a Apuração gravada no fechamento e a descartada na reabertura", async () => {
    const { evento, registros } = await boot();
    await evento("closing_period.close", "closed");
    await evento("closing_period.reopen", "open");
    expect(registros.map((r) => [r.action, r.actor, r.attributes])).toEqual([
      ["apuracao_metas_freeze", { id: "gil", name: "Gil Gestor" }, { periodo: "Maio", origem: "fechamento", metas: 1, participantes: 2, premioCentavos: 10000 }],
      ["apuracao_metas_discard", { id: "gil", name: "Gil Gestor" }, { periodo: "Maio" }],
    ]);
  });

  it("grava e registra na primeira consulta a Apuração de um Período fechado sem ela", async () => {
    const { ver, fecharSemPlugin, registros } = await boot();
    fecharSemPlugin();
    expect((await ver("gil")).congelada).toBe(true);
    await ver("gil");
    expect(registros.map((r) => [r.action, r.attributes])).toEqual([
      ["apuracao_metas_freeze", { periodo: "Maio", origem: "consulta", metas: 1, participantes: 2, premioCentavos: 10000 }],
    ]);
  });
});

describe("Período anterior", () => {
  it("traz o Alvo e o Realizado do Período imediatamente anterior pela data, na mesma Meta", async () => {
    const { periodos, app, metas, tipos, minhas } = await boot();
    periodos.push({ id: "abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" });
    periodos.push({ id: "junho", name: "Junho", startDate: "2027-06-01", endDate: "2027-06-30", status: "open" });
    const [tipo] = await tipos.listar();
    await metas.criar({ periodoId: "junho", tipoId: tipo!.id, participantes: [{ codigoColaborador: 1, nome: "ANA", alvo: 28 }], excluidos: [] });
    const r = await app.request("/metas/anterior?periodoId=junho", { headers: { "x-user": "mon" } });
    expect(r.status).toBe(200);
    const anterior = (await r.json()) as { periodo: { name: string }; metas: { tipoId: string; participantes: { codigoColaborador: number; alvo: number; realizado: number }[] }[] };
    expect(anterior.periodo.name).toBe("Maio");
    expect(anterior.metas[0]!.tipoId).toBe(tipo!.id);
    expect(anterior.metas[0]!.participantes.map((p) => [p.codigoColaborador, p.alvo, p.realizado])).toEqual([
      [1, 30, 25],
      [2, 30, 40],
    ]);
    expect((await app.request("/metas/anterior?periodoId=junho", { headers: { "x-user": "gil" } })).status).toBe(403);
    // O Acompanhamento traz o Período anterior em cada linha.
    const acompanhamento = (await (await app.request("/metas/acompanhamento?periodoId=junho", { headers: { "x-user": "gil" } })).json()) as { linhas: { anterior?: { alvo: number; realizado: number } }[] };
    expect(acompanhamento.linhas[0]!.anterior).toMatchObject({ alvo: 30, realizado: 25 });
    // Minhas Metas também traz a mesma Meta no Período anterior, cortada pela Exibição.
    const minha = (await (await minhas("ana", "junho")).json()) as { periodoAnterior: { name: string }; metas: { anterior?: unknown }[] };
    expect(minha.periodoAnterior.name).toBe("Maio");
    expect(minha.metas[0]!.anterior).toBeDefined();
  });
});

describe("Acompanhamento da Lista de Produtos", () => {
  const DIPIRONA = "8F14E45F-CEEA-467F-A8F4-5E1D2C3B4A01";
  const entradas = [
    { tipo: "laboratorio" as const, id: "414", nome: "EMS" },
    { tipo: "produto" as const, id: DIPIRONA, nome: "Dipirona 1g" },
    { tipo: "grupo" as const, id: "44", nome: "Vitaminas" },
  ];
  const lista: DadosTipoMeta = { ...cmv, nome: "Mix", indicador: "lista-produtos", alvoPadrao: 10, lista: { unidade: "unidades", entradas } };

  it("em unidades, o Realizado é o vendido da Lista, com % Atingido e Prêmio como num Indicador comum", async () => {
    const { ver, tipos, metas, listaVendas, consultasLista } = await boot();
    const tipo = await tipos.criar(lista);
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: [{ codigoColaborador: 1, nome: "ANA", alvo: 10 }, { codigoColaborador: 2, nome: "BIA", alvo: 10 }], excluidos: [] });
    listaVendas.push({ codigoColaborador: 1, quantidade: 12, valor: 300 }, { codigoColaborador: 2, quantidade: 4, valor: 100 });
    const linhas = (await ver("gil")).linhas.filter((l) => l.tipo.nome === "Mix");
    expect(linhas.map((l) => [l.nome, l.atingimento, l.premioCentavos, l.resultado])).toEqual([
      ["ANA", 120, 10000, "Lista de Produtos 12 de 10 un. · ✓ 2 acima"],
      ["BIA", 40, 0, "Lista de Produtos 4 de 10 un. · faltam 6"],
    ]);
    // Uma consulta por Tipo de Meta, com todas as entradas da Lista.
    expect(consultasLista).toHaveLength(1);
    expect(consultasLista[0]).toMatchObject({ produto0: DIPIRONA, grupo0: 44, laboratorio0: 414 });
  });

  it("em R$, soma o valor vendido; Sem Alvo, paga o Percentual sobre a própria Lista", async () => {
    const { ver, tipos, metas, listaVendas } = await boot();
    const tipo = await tipos.criar({
      ...lista,
      nome: "Comissão Mix",
      semAlvo: true,
      exibicao: "progresso",
      alvoPadrao: null,
      lista: { unidade: "reais", entradas },
      regra: { tipo: "percentual", percentual: 2, indicadorBase: "lista-produtos", soSeAtingir: false },
    });
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: [{ codigoColaborador: 1, nome: "ANA", alvo: null }], excluidos: [] });
    listaVendas.push({ codigoColaborador: 1, quantidade: 12, valor: 1500.5 });
    const [linha] = (await ver("gil")).linhas.filter((l) => l.tipo.nome === "Comissão Mix");
    expect([linha!.atingimento, linha!.premioCentavos, linha!.resultado]).toEqual([null, 3001, "Lista de Produtos R$ 1.500,50"]);
  });

  it("em R$ com Alvo, o % Atingido é sobre o valor vendido", async () => {
    const { ver, tipos, metas, listaVendas } = await boot();
    const tipo = await tipos.criar({ ...lista, nome: "Mix R$", alvoPadrao: 100000, lista: { unidade: "reais", entradas } });
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: [{ codigoColaborador: 1, nome: "ANA", alvo: 100000 }], excluidos: [] });
    listaVendas.push({ codigoColaborador: 1, quantidade: 3, valor: 1500 });
    const [linha] = (await ver("gil")).linhas.filter((l) => l.tipo.nome === "Mix R$");
    expect([linha!.atingimento, linha!.premioCentavos]).toEqual([150, 10000]);
  });

  it("em Minhas Metas, mostra o Progresso e as entradas da Lista por tipo e depois por nome", async () => {
    const { minhas, tipos, metas, listaVendas } = await boot();
    const tipo = await tipos.criar({ ...lista, exibicao: "progresso" });
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: [{ codigoColaborador: 1, nome: "ANA", alvo: 10 }], excluidos: [] });
    listaVendas.push({ codigoColaborador: 1, quantidade: 7, valor: 70 });
    const metasAna = ((await (await minhas("ana")).json()) as { metas: Record<string, unknown>[] }).metas;
    expect(metasAna.find((m) => m.nome === "Mix")).toEqual({
      metaId: expect.any(String),
      nome: "Mix",
      indicador: "lista-produtos",
      exibicao: "progresso",
      atingida: false,
      realizado: "7",
      alvo: "10",
      falta: "3",
      lista: ["Produto Dipirona 1g", "Grupo Vitaminas", "Laboratório EMS"],
      premioCentavos: 0,
    });
  });
});

describe("Acompanhamento de Pré-vencidos vendidos", () => {
  const preVencidos: DadosTipoMeta = { ...cmv, nome: "Pré-vencidos", indicador: "pre-vencidos", exibicao: "progresso", alvoPadrao: 5 };
  const item = (codigoLoja: number, quantidade: number) => ({
    codigoLoja,
    produtoId: "p1",
    codigoProduto: 1,
    nomeProduto: "Dipirona 1g",
    codigoBarra: "789",
    validade: "2027-06",
    quantidade,
    incluidoEm: "2027-04-01T12:00:00.000Z",
  });
  const venda = (codigoLoja: number, vendaId: number, data: string, codigoColaborador: number, quantidade: number, cancelada = false) => ({
    codigoLoja,
    vendaId,
    data,
    cancelada,
    codigoColaborador,
    nomeColaborador: codigoColaborador === 1 ? "ANA" : "BIA",
    produtoId: "p1",
    quantidade,
  });

  async function comPreVencidos() {
    const ctx = await boot();
    const tipo = await ctx.tipos.criar(preVencidos);
    await ctx.metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: ctx.participantes.map((p) => ({ ...p, alvo: 5 })), excluidos: [] });
    await ctx.estoque.criar(item(10, 10));
    await ctx.estoque.criar(item(20, 4));
    ctx.vendasDaLoja.push(
      // Em abril, antes do Período: gasta o Item, mas não conta no Período.
      venda(10, 100, "2027-04-20 10:00:00", 1, 1),
      venda(10, 101, "2027-05-03 10:00:00", 1, 2),
      // Cancelada no ERP: não baixa.
      venda(10, 102, "2027-05-04 10:00:00", 1, 3, true),
      // Em outra Loja: soma no mesmo Colaborador; só há 4 no Estoque dela.
      venda(20, 200, "2027-05-05 10:00:00", 1, 6),
    );
    return ctx;
  }

  it("o Realizado é a soma das Baixas do Participante no Período, em todas as Lojas", async () => {
    const { ver } = await comPreVencidos();
    const linhas = (await ver("gil")).linhas.filter((l) => l.tipo.nome === "Pré-vencidos");
    expect(linhas.map((l) => [l.nome, l.atingimento, l.premioCentavos, l.resultado])).toEqual([
      ["ANA", 120, 10000, "Pré-vencidos vendidos 6 de 5 un. · ✓ 1 acima"],
      ["BIA", 0, 0, "Pré-vencidos vendidos 0 de 5 un. · faltam 5"],
    ]);
  });

  it("em Minhas Metas, o Colaborador vê o Realizado e as suas Baixas do Período por venda", async () => {
    const { minhas } = await comPreVencidos();
    const corpo = (await (await minhas("ana")).json()) as { metas: Record<string, unknown>[]; baixas: unknown[] };
    expect(corpo.metas.find((m) => m.nome === "Pré-vencidos")).toMatchObject({ realizado: "6", alvo: "5" });
    expect(corpo.baixas).toEqual([
      { vendaId: 101, data: "2027-05-03 10:00:00", produtoId: "p1", nomeProduto: "Dipirona 1g", codigoBarra: "789", quantidadeVendida: 2, quantidade: 2 },
      { vendaId: 200, data: "2027-05-05 10:00:00", produtoId: "p1", nomeProduto: "Dipirona 1g", codigoBarra: "789", quantidadeVendida: 6, quantidade: 4 },
    ]);
  });

  it("em Minhas Metas, o Colaborador vê a Correção de Baixa e o motivo, e o Realizado já a reflete", async () => {
    const { minhas, correcoes } = await comPreVencidos();
    await correcoes.criar({ periodoId: "maio", codigoLoja: 10, vendaId: 101, produtoId: "p1", quantidade: 1, motivo: "Uma unidade era da prateleira comum", autorId: "gil", autorNome: "Gil" });
    const corpo = (await (await minhas("ana")).json()) as { metas: Record<string, unknown>[]; baixas: Record<string, unknown>[] };
    expect(corpo.metas.find((m) => m.nome === "Pré-vencidos")).toMatchObject({ realizado: "5" });
    expect(corpo.baixas[0]).toMatchObject({ vendaId: 101, quantidadeVendida: 2, quantidade: 1, correcao: { quantidade: 1, motivo: "Uma unidade era da prateleira comum" } });
  });

  it("sem Meta de Pré-vencidos, Minhas Metas não traz Baixas", async () => {
    const { minhas } = await boot();
    expect(((await (await minhas("ana")).json()) as { baixas: unknown[] }).baixas).toEqual([]);
  });
});

describe("Minhas Metas", () => {
  const minhasDe = async (res: Response) => ((await res.json()) as { metas: Record<string, unknown>[] }).metas;

  it("na Exibição Atingida / Não atingida, mostra só a situação e o Prêmio só se atingida", async () => {
    const { minhas, vendas } = await boot();
    expect(await minhasDe(await minhas("ana"))).toEqual([{ metaId: expect.any(String), nome: "CMV", indicador: "cmv", exibicao: "atingida", atingida: true, premioCentavos: 10000 }]);
    vendas.set(1, { totalLiquido: 1000, totalCmv: 500, quantidadeVendas: 10 });
    expect(await minhasDe(await minhas("ana"))).toEqual([{ metaId: expect.any(String), nome: "CMV", indicador: "cmv", exibicao: "atingida", atingida: false }]);
  });

  it("no Progresso, mostra Realizado, Alvo e quanto falta, sem o Prêmio que o Tipo esconde", async () => {
    const { minhas, tipos, metas } = await boot();
    const tipo = await tipos.criar({ ...cmv, nome: "Ticket", indicador: "ticket-medio", exibicao: "progresso", mostrarPremio: false, alvoPadrao: 12000 });
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: [{ codigoColaborador: 1, nome: "ANA", alvo: 12000 }], excluidos: [] });
    const ticket = (await minhasDe(await minhas("ana"))).find((m) => m.nome === "Ticket");
    expect(ticket).toEqual({ metaId: expect.any(String), nome: "Ticket", indicador: "ticket-medio", exibicao: "progresso", atingida: false, realizado: "R$ 100,00", alvo: "R$ 120,00", falta: "R$ 20,00" });
  });

  it("mostra o Saldo da Meta de Avaliações como Prêmio quando o Tipo permite", async () => {
    const { minhas, tipos, metas, avaliacoesStore } = await boot();
    const tipo = await tipos.criar({ ...avaliacoes, exibicao: "progresso" });
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: [{ codigoColaborador: 1, nome: "ANA", alvo: 20000 }], excluidos: [] });
    await avaliacoesStore.criar({ periodoId: "maio", codigoColaborador: 1, nomeColaborador: "ANA", codigoLoja: 10, descricao: "Atraso", valorCentavos: 5000, criadoPor: "x" });
    const saldo = (await minhasDe(await minhas("ana"))).find((m) => m.nome === "Avaliações");
    expect(saldo).toEqual({ metaId: expect.any(String), nome: "Avaliações", indicador: "avaliacoes", exibicao: "progresso", atingida: true, realizado: "R$ 150,00", alvo: "R$ 200,00", premioCentavos: 15000 });
  });

  it("esconde o Saldo da Meta de Avaliações quando o Tipo não mostra o Prêmio", async () => {
    const { minhas, tipos, metas } = await boot();
    const tipo = await tipos.criar({ ...avaliacoes, exibicao: "progresso", mostrarPremio: false });
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: [{ codigoColaborador: 1, nome: "ANA", alvo: 20000 }], excluidos: [] });
    const saldo = (await minhasDe(await minhas("ana"))).find((m) => m.nome === "Avaliações");
    expect(saldo).toEqual({ metaId: expect.any(String), nome: "Avaliações", indicador: "avaliacoes", exibicao: "progresso", atingida: true });
  });

  it("só libera ao Usuário com a Permission e um Colaborador vinculado, e só as Metas de que ele é Participante", async () => {
    const { minhas } = await boot();
    expect((await minhas("gil")).status).toBe(403);
    expect((await minhas("zoe")).status).toBe(403);
    expect((await minhas("ana", "junho")).status).toBe(404);
    expect((await minhasDe(await minhas("ana"))).map((m) => m.nome)).toEqual(["CMV"]);
  });
});
