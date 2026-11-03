import { calcularBaixas, type ResultadoBaixas, type VendaParaBaixa } from "./baixas-pre-vencidos.js";
import type { ItemPreVencido } from "./estoque-pre-vencidos-store.js";

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

/** Fuso das datas do ERP: `Venda.DataVenda` é a hora local da Loja, sem fuso. */
export const FUSO_ERP = "America/Sao_Paulo";

/** Um instante (ISO) na hora do ERP, `AAAA-MM-DD HH:MM:SS`, comparável como texto com `Venda.DataVenda`. */
export function horaDoErp(iso: string): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_ERP, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}`;
}

/** Linha de venda do ERP com o nome de quem vendeu, para a aba Baixas. */
export interface VendaDaLoja extends VendaParaBaixa {
  nomeColaborador: string;
}

type LinhaVendaErp = { vendaId: number; data: string; cancelada: boolean | number; codigoColaborador: number; nomeColaborador: string | null; produtoId: string; quantidade: number | null };

export const LOTE_PRODUTOS = 1000;

/**
 * Vendas de uma Loja (`Venda.CodigoEmpresa`, a mesma coluna da Visualização Loja do Desempenho de Vendas) a partir de
 * `@dataInicio`, por venda e produto, com as regras de venda válida do Desempenho de Vendas (com abertura de caixa, fora
 * do grupo de inventário 3). As eliminadas vêm marcadas como canceladas: o motor não as baixa.
 * Uma linha por venda e produto: se mais de um Colaborador vendeu o mesmo produto na mesma venda, o crédito é do de maior código.
 */
export const vendasDaLojaSql = (produtos: number) => `
  SELECT v.CodigoVenda AS vendaId, CONVERT(varchar(19), v.DataVenda, 120) AS data, CAST(v.Eliminado AS bit) AS cancelada,
         MAX(vp.CodigoFuncionario) AS codigoColaborador, MAX(LTRIM(RTRIM(c.Nome))) AS nomeColaborador,
         CONVERT(varchar(36), p.rowguid) AS produtoId, CAST(SUM(vp.Quantidade) AS float) AS quantidade
  FROM Venda v
  JOIN Venda_Produto vp ON vp.CodigoVenda = v.CodigoVenda
  JOIN Produto p ON p.CodigoProduto = vp.CodigoProduto
  LEFT JOIN Funcionario f ON f.CodigoFuncionario = vp.CodigoFuncionario
  LEFT JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
  WHERE v.CodigoEmpresa = @codigoLoja
    AND v.CodigoAbertura IS NOT NULL
    AND ISNULL(p.CodigoGrupoInventario, 0) <> 3
    AND v.DataVenda >= @dataInicio
    AND vp.CodigoProduto IN (${Array.from({ length: produtos }, (_, i) => `@p${i}`).join(", ")})
  GROUP BY v.CodigoVenda, v.DataVenda, v.Eliminado, p.rowguid
`;

/**
 * Baixas e Restante do Estoque de uma Loja: busca no ERP as vendas da Loja desde a inclusão mais antiga, só dos
 * produtos dos Itens, e roda o motor. Lança se o ERP falhar.
 */
export async function baixasDaLoja(client: ErpQuery, codigoLoja: number, itens: readonly ItemPreVencido[]): Promise<ResultadoBaixas<VendaDaLoja>> {
  const paraMotor = itens.map((i) => ({ id: i.id, produtoId: i.produtoId, validade: i.validade, quantidade: i.quantidade, incluidoEm: horaDoErp(i.incluidoEm) }));
  if (paraMotor.length === 0) return calcularBaixas({ itens: [], vendas: [] });

  const dataInicio = paraMotor.map((i) => i.incluidoEm).sort()[0]!;
  // Em lotes de produtos: o SQL Server aceita cerca de 2100 parâmetros por consulta.
  const codigos = [...new Set(itens.map((i) => i.codigoProduto))];
  const vendas: VendaDaLoja[] = [];
  for (let i = 0; i < codigos.length; i += LOTE_PRODUTOS) {
    const lote = codigos.slice(i, i + LOTE_PRODUTOS);
    const params: Record<string, unknown> = { codigoLoja, dataInicio };
    lote.forEach((codigo, n) => (params[`p${n}`] = codigo));
    const linhas = await client.query<LinhaVendaErp>(vendasDaLojaSql(lote.length), params);
    vendas.push(
      ...linhas.map((l) => ({
        vendaId: Number(l.vendaId),
        data: String(l.data),
        cancelada: l.cancelada === true || Number(l.cancelada) === 1,
        codigoColaborador: Number(l.codigoColaborador),
        nomeColaborador: (l.nomeColaborador ?? "").trim() || `Colaborador cód. ${l.codigoColaborador}`,
        produtoId: l.produtoId,
        quantidade: Number(l.quantidade) || 0,
      })),
    );
  }
  return calcularBaixas({ itens: paraMotor, vendas });
}
