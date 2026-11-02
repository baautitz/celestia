import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerAcompanhamentoRoutes } from "./acompanhamento-routes";
import { MemoryApuracaoStore } from "./apuracao-store";
import { MemoryAvaliacaoStore } from "./avaliacoes-store";
import { MemoryMetaStore } from "./metas-store";
import { MemoryPreVencidoStore } from "./pre-vencidos-store";
import type { PeriodoResumo } from "./pre-vencidos-routes";
import { MemoryTipoMetaStore } from "./tipos-meta-store";
import type { DadosTipoMeta } from "./tipos-meta";
import { MemoryVinculoStore } from "./vinculo-store";

const GERAL = "inovafarma:metas-geral:view";
const LOJA = "inovafarma:metas-loja:view";

const cmv: DadosTipoMeta = {
  nome: "CMV",
  indicador: "cmv",
  exibicao: "atingida",
  mostrarPremio: true,
  semAlvo: false,
  regra: { tipo: "fixo", valorCentavos: 10000 },
  alvoPadrao: 30,
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
  const handlers = new Map<string, (p: object) => unknown>();
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    const permissions = { gil: [GERAL], lia: [LOJA] }[sub] ?? [];
    c.set("user" as never, { sub, fullname: sub, permissions } as never);
    await next();
  };
  const tipos = new MemoryTipoMetaStore();
  const metas = new MemoryMetaStore();
  const vinculos = new MemoryVinculoStore();
  const avaliacoesStore = new MemoryAvaliacaoStore();
  await vinculos.gravar({ codigoColaborador: 1, usuarioId: null, lojas: [10], atualizadoPor: "x" }, 0);
  await vinculos.gravar({ codigoColaborador: 9, usuarioId: "lia", lojas: [10], atualizadoPor: "x" }, 0);
  const participantes = [
    { codigoColaborador: 1, nome: "ANA", alvo: 30 },
    { codigoColaborador: 2, nome: "BIA", alvo: 30 },
  ];
  const tipoCmv = await tipos.criar(cmv);
  await metas.criar({ periodoId: "maio", tipoId: tipoCmv.id, participantes, excluidos: [], lista: null });
  registerAcompanhamentoRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    events: { after: (event, handler) => (handlers.set(event, handler as (p: object) => unknown), () => undefined) },
    erpClient: () => ({
      query: async <T,>(sql: string) =>
        (sql.includes("totalCmv") ? [...vendas].map(([codigoColaborador, v]) => ({ codigoColaborador, ...v })) : [{ codigoEmpresa: 10, nome: "Centro" }]) as T[],
    }),
    tipos,
    metas,
    vinculos,
    avaliacoes: avaliacoesStore,
    preVencidos: new MemoryPreVencidoStore(),
    apuracoes: new MemoryApuracaoStore(),
    periods: { list: async () => periodos },
  });
  const res = (who: string, query: string) => app.request(`/metas/acompanhamento?periodoId=maio${query}`, { headers: { "x-user": who } });
  const ver = async (who: string, query = "") => (await (await res(who, query)).json()) as Acompanhamento;
  const evento = async (event: string, status: PeriodoResumo["status"]) => {
    periodos[0] = { ...periodos[0]!, status };
    await handlers.get(event)?.({ periodId: "maio", name: "Maio", startDate: "2027-05-01", endDate: "2027-05-31" });
  };
  return { res, ver, vendas, evento, tipos, metas, avaliacoesStore, participantes };
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

  it("desconta as Avaliações do Período do valor inicial", async () => {
    const { ver, tipos, metas, avaliacoesStore, participantes } = await boot();
    const tipo = await tipos.criar(avaliacoes);
    await metas.criar({ periodoId: "maio", tipoId: tipo.id, participantes: participantes.map((p) => ({ ...p, alvo: 20000 })), excluidos: [], lista: null });
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
});
