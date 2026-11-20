import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { CATEGORIAS, desempenhoSql, porCategoria, type CategoriaColuna, type CategoriaTotais } from "./desempenho-vendas.js";
import { CodigoEmTexto, DiaDoCalendario, ERP_INDISPONIVEL, recusaDeValidacao, SEM_CONEXAO, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { lojasDoErp, visualizacoesDoContexto } from "./pre-vencidos-comum.js";
import type { VinculoStore } from "./vinculo-store.js";
import { VISUALIZACAO_PERMISSION, visualizacaoPedida, type Visualizacao } from "./visualizacoes.js";

export interface DesempenhoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  vinculos: VinculoStore;
}

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

type ColaboradorRow = Record<`qtd${CategoriaColuna}` | `valor${CategoriaColuna}`, number | null> & {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidadeVendas: number;
  totalBruto: number;
  totalDesconto: number;
  totalLiquido: number;
  totalCmv: number;
  vendasComCadastro: number;
};

const categoriasDe = (r: ColaboradorRow): CategoriaTotais =>
  porCategoria((k) => {
    const { coluna } = CATEGORIAS[k];
    return { quantidade: Number(r[`qtd${coluna}`]) || 0, valor: Number(r[`valor${coluna}`]) || 0 };
  });

/** Desempenho de Vendas por Colaborador: as Visualizações do Usuário e o relatório de cada uma. */
export function registerDesempenhoRoutes({ routes, permissions, auth, erpClient, vinculos }: DesempenhoRoutesDeps): void {
  const visualizacoesDe = (c: AuthContext) => visualizacoesDoContexto(c, permissions, vinculos, VISUALIZACAO_PERMISSION);

  // A tela decide o que mostrar por aqui: Visualizações disponíveis e as Lojas que cada uma permite filtrar.
  routes.get("/relatorios/vendas-colaborador/visualizacoes", auth, async (c: AuthContext) => {
    const { disponiveis, lojas } = await visualizacoesDe(c);
    const lojasErp = disponiveis.some((v) => v !== "individual") ? (await lojasDoErp(erpClient())).map(({ codigo, nome }) => ({ codigoEmpresa: codigo, nome })) : [];
    const lojasDe = (v: Visualizacao) =>
      v === "geral" ? lojasErp : v === "loja" ? lojas.map((codigoEmpresa) => lojasErp.find((l) => l.codigoEmpresa === codigoEmpresa) ?? { codigoEmpresa, nome: "" }) : [];
    return c.json({ visualizacoes: disponiveis.map((id) => ({ id, lojas: lojasDe(id) })) });
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

    const { sql, sqlTotalVendas } = desempenhoSql(filtroEmpresa);

    try {
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
      const categoriasPorLinha = rows.map(categoriasDe);
      const categoriasGeral = porCategoria((k) => ({
        quantidade: categoriasPorLinha.reduce((acc, cat) => acc + cat[k].quantidade, 0),
        valor: categoriasPorLinha.reduce((acc, cat) => acc + cat[k].valor, 0),
      }));

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
          categorias: categoriasGeral,
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
            categorias: categoriasPorLinha[i],
          };
        }),
      });
    } catch {
      // A mensagem do driver (SQL, host) não sai do servidor: a tela mostra só a indisponibilidade.
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });
}
