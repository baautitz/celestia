import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import type { ColunaDesempenho, MedidaColuna } from "./colunas-desempenho.js";
import type { ColunaDesempenhoStore } from "./colunas-desempenho-store.js";
import { semearColunas } from "./colunas-desempenho-seed.js";
import { desempenhoSql } from "./desempenho-vendas.js";
import { CodigoEmTexto, DiaDoCalendario, ERP_INDISPONIVEL, recusaDeValidacao, SEM_CONEXAO, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { lojasDoErp, visualizacoesDoContexto } from "./pre-vencidos-comum.js";
import type { PeriodsService } from "./pre-vencidos-routes.js";
import type { VinculoStore } from "./vinculo-store.js";
import { VISUALIZACAO_PERMISSION, visualizacaoPedida, type Visualizacao } from "./visualizacoes.js";

export interface DesempenhoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  vinculos: VinculoStore;
  periods: PeriodsService;
  colunas: ColunaDesempenhoStore;
}

const COLUNAS_MANAGE = INOVAFARMA_PERMISSIONS.ref("colunas-desempenho:manage").key;

const DATAS_OBRIGATORIAS = "Parâmetros 'dataInicio' e 'dataFim' são obrigatórios no formato YYYY-MM-DD.";
/** Só compara as datas depois de validá-las: comparar texto com `2026-13-99` seria ruído. */
const Consulta = z
  .object({
    dataInicio: DiaDoCalendario(DATAS_OBRIGATORIAS),
    dataFim: DiaDoCalendario(DATAS_OBRIGATORIAS),
    codigoEmpresa: CodigoEmTexto.optional(),
  })
  .pipe(
    z
      .object({ dataInicio: z.string(), dataFim: z.string(), codigoEmpresa: z.number().optional() })
      .refine(({ dataInicio, dataFim }) => dataInicio <= dataFim, { error: "A data final não pode ser anterior à data inicial.", path: ["dataFim"] }),
  );

type ColaboradorRow = {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidadeVendas: number;
  totalBruto: number;
  totalDesconto: number;
  totalLiquido: number;
  totalCmv: number;
  vendasComCadastro: number;
} & Partial<Record<`colQtd${number}` | `colValor${number}` | `colCmv${number}` | `colVendas${number}`, number | null>>;

/** Totais de uma coluna personalizada: unidades, valor líquido (R$), CMV (R$) e vendas distintas com item dela. */
type TotalColuna = { id: string; nome: string; mostra: MedidaColuna[]; quantidade: number; valor: number; cmv: number; vendas: number };

const colunasDe = (r: ColaboradorRow, colunas: readonly ColunaDesempenho[]): TotalColuna[] =>
  colunas.map((c, i) => ({
    id: c.id,
    nome: c.nome,
    mostra: c.medidas,
    quantidade: Number(r[`colQtd${i}`]) || 0,
    valor: Number(r[`colValor${i}`]) || 0,
    cmv: Number(r[`colCmv${i}`]) || 0,
    vendas: Number(r[`colVendas${i}`]) || 0,
  }));

/** As medidas de uma coluna derivadas dos totais: CMV %, Ticket Médio (valor por venda) e participação no Total Líquido. */
const medidas = (t: TotalColuna, totalLiquido: number, comTicket: boolean) => ({
  id: t.id,
  nome: t.nome,
  mostra: t.mostra,
  quantidade: t.quantidade,
  valor: t.valor,
  cmv: t.cmv,
  cmvPercent: t.valor > 0 ? (t.cmv / t.valor) * 100 : 0,
  // Uma venda com itens de vários Colaboradores conta em cada um: o ticket só vale por Colaborador.
  ticketMedio: comTicket && t.vendas > 0 ? t.valor / t.vendas : 0,
  participacaoPercent: totalLiquido > 0 ? (t.valor / totalLiquido) * 100 : 0,
});

/** Desempenho de Vendas por Colaborador: as Visualizações do Usuário e o relatório de cada uma. */
export function registerDesempenhoRoutes({ routes, permissions, auth, erpClient, vinculos, periods, colunas }: DesempenhoRoutesDeps): void {
  const visualizacoesDe = (c: AuthContext) => visualizacoesDoContexto(c, permissions, vinculos, VISUALIZACAO_PERMISSION);

  // A tela decide o que mostrar por aqui: os Períodos, as Visualizações disponíveis e as Lojas que cada uma permite filtrar.
  routes.get("/relatorios/vendas-colaborador/visualizacoes", auth, async (c: AuthContext) => {
    const { disponiveis, lojas } = await visualizacoesDe(c);
    const lojasErp = disponiveis.some((v) => v !== "individual") ? (await lojasDoErp(erpClient())).map(({ codigo, nome }) => ({ codigoEmpresa: codigo, nome })) : [];
    const lojasDe = (v: Visualizacao) =>
      v === "geral" ? lojasErp : v === "loja" ? lojas.map((codigoEmpresa) => lojasErp.find((l) => l.codigoEmpresa === codigoEmpresa) ?? { codigoEmpresa, nome: "" }) : [];
    return c.json({
      podeGerenciarColunas: permissions.has(c.get("user")?.permissions, COLUNAS_MANAGE),
      periodos: (await periods.list()).sort((a, b) => b.startDate.localeCompare(a.startDate)),
      visualizacoes: disponiveis.map((id) => ({ id, lojas: lojasDe(id) })),
    });
  });

  routes.get("/relatorios/vendas-colaborador", auth, async (c: AuthContext) => {
    const { disponiveis, lojas: lojasVinculo, codigoColaborador } = await visualizacoesDe(c);
    const pedida = visualizacaoPedida(c, disponiveis, VISUALIZACAO_PERMISSION);
    if ("recusa" in pedida) return pedida.recusa;
    const { visualizacao } = pedida;

    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);

    const consulta = Consulta.safeParse({ dataInicio: c.req.query("dataInicio"), dataFim: c.req.query("dataFim"), codigoEmpresa: c.req.query("codigoEmpresa") || undefined });
    if (!consulta.success) return recusaDeValidacao(c, consulta.error);
    const { dataInicio, dataFim, codigoEmpresa: lojaPedida } = consulta.data;

    const params: Record<string, unknown> = {
      dataInicio: `${dataInicio} 00:00:00`,
      dataFim: `${dataFim} 23:59:59`,
    };

    // Loja: toda venda feita nas Lojas do vínculo, de qualquer vendedor. Individual: toda venda do
    // Colaborador, em qualquer Loja: quem vendeu fora das suas Lojas continua no próprio Individual.
    let filtroEmpresa = "";
    if (visualizacao === "loja") {
      if (lojaPedida !== undefined && !lojasVinculo.includes(lojaPedida)) {
        return c.json({ error: "A Loja informada não está vinculada ao seu Colaborador." }, 403);
      }
      const permitidas = lojaPedida === undefined ? lojasVinculo : [lojaPedida];
      filtroEmpresa = `AND v.CodigoEmpresa IN (${permitidas.map((_, i) => `@loja${i}`).join(", ")})`;
      permitidas.forEach((codigo, i) => {
        params[`loja${i}`] = codigo;
      });
    } else if (lojaPedida !== undefined) {
      filtroEmpresa = "AND v.CodigoEmpresa = @codigoEmpresa";
      params.codigoEmpresa = lojaPedida;
    }
    if (visualizacao === "individual") {
      filtroEmpresa += " AND vp.CodigoFuncionario = @codigoColaborador";
      params.codigoColaborador = codigoColaborador;
    }

    try {
      await semearColunas(colunas, client);
      const personalizadas = await colunas.listar();
      const { sql, sqlTotalVendas, params: paramsColunas } = desempenhoSql(filtroEmpresa, personalizadas);
      Object.assign(params, paramsColunas);

      const [rows, [totalVendasRow]] = await Promise.all([
        client.query<ColaboradorRow>(sql, params),
        client.query<{ totalVendasGeral: number; totalVendasComCadastro: number }>(sqlTotalVendas, params),
      ]);

      const totalVendasGeral = Number(totalVendasRow?.totalVendasGeral) || 0;
      const totalVendasComCadastro = Number(totalVendasRow?.totalVendasComCadastro) || 0;
      const totalLiquidoGeral = rows.reduce((acc, r) => acc + (Number(r.totalLiquido) || 0), 0);
      const totalBrutoGeral = rows.reduce((acc, r) => acc + (Number(r.totalBruto) || 0), 0);
      const totalDescontoGeral = rows.reduce((acc, r) => acc + (Number(r.totalDesconto) || 0), 0);
      const totalCmvGeral = rows.reduce((acc, r) => acc + (Number(r.totalCmv) || 0), 0);
      const colunasPorLinha = rows.map((r) => colunasDe(r, personalizadas));
      const soma = (i: number, campo: "quantidade" | "valor" | "cmv" | "vendas") => colunasPorLinha.reduce((acc, linha) => acc + (linha[i]?.[campo] ?? 0), 0);
      const colunasGeral = personalizadas.map((c, i) =>
        medidas({ id: c.id, nome: c.nome, mostra: c.medidas, quantidade: soma(i, "quantidade"), valor: soma(i, "valor"), cmv: soma(i, "cmv"), vendas: soma(i, "vendas") }, totalLiquidoGeral, false),
      );

      return c.json({
        resumo: {
          totalVendasGeral,
          totalLiquidoGeral,
          totalBrutoGeral,
          totalDescontoGeral,
          totalCmvGeral,
          descontoPercentGeral: totalBrutoGeral > 0 ? (totalDescontoGeral / totalBrutoGeral) * 100 : 0,
          cmvPercentGeral: totalLiquidoGeral > 0 ? (totalCmvGeral / totalLiquidoGeral) * 100 : 0,
          cadastroPercentGeral: totalVendasGeral > 0 ? (totalVendasComCadastro / totalVendasGeral) * 100 : 0,
          totalColaboradores: rows.length,
          colunas: colunasGeral,
        },
        colaboradores: rows.map((r, i) => {
          const liq = Number(r.totalLiquido) || 0;
          const qtd = Number(r.quantidadeVendas) || 0;
          const cmv = Number(r.totalCmv) || 0;
          const bruto = Number(r.totalBruto) || 0;
          const desconto = Number(r.totalDesconto) || 0;
          return {
            codigoColaborador: Number(r.codigoColaborador),
            nomeColaborador: (r.nomeColaborador || "").trim(),
            quantidadeVendas: qtd,
            totalBruto: bruto,
            totalDesconto: desconto,
            descontoPercent: bruto > 0 ? (desconto / bruto) * 100 : 0,
            totalLiquido: liq,
            totalCmv: cmv,
            cmvPercent: liq > 0 ? (cmv / liq) * 100 : 0,
            ticketMedio: qtd > 0 ? liq / qtd : 0,
            participacaoPercent: totalLiquidoGeral > 0 ? (liq / totalLiquidoGeral) * 100 : 0,
            cadastroPercent: qtd > 0 ? ((Number(r.vendasComCadastro) || 0) / qtd) * 100 : 0,
            colunas: (colunasPorLinha[i] ?? []).map((t) => medidas(t, totalLiquidoGeral, true)),
          };
        }),
      });
    } catch {
      // A mensagem do driver (SQL, host) não sai do servidor: a tela mostra só a indisponibilidade.
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });
}
