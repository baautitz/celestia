import type { ModuleContext } from "@platform/core/module";
import { horaDoErp } from "./baixas-da-loja.js";
import { vinculoDoUsuario, type AuthContext, type ErpQuery } from "./metas-comum.js";
import type { PeriodsService } from "./pre-vencidos-routes.js";
import type { VinculoStore } from "./vinculo-store.js";
import { VISUALIZACAO_PERMISSION_BAIXAS, visualizacoesDoUsuario, type Visualizacao, type VisualizacoesDoUsuario } from "./visualizacoes.js";

/** O que as rotas do Estoque e das Baixas de Pré-vencido compartilham: as Lojas do Vínculo e a inclusão retroativa. */

export const SEM_VINCULO = "Seu Usuário não está vinculado a um Colaborador. Peça o vínculo a quem administra os Colaboradores.";
export const LOJA_FORA_DO_VINCULO = "A Loja informada não está vinculada ao seu Colaborador.";

/** Lojas do Vínculo (não desfeito) do Usuário; null sem Vínculo. */
export async function lojasDoVinculo(vinculos: VinculoStore, usuarioId: string | undefined): Promise<number[] | null> {
  if (!usuarioId) return null;
  return (await vinculoDoUsuario(vinculos, usuarioId))?.lojas ?? null;
}

/**
 * Recusa de quem não tem a Permission, não tem Vínculo ou não tem a Loja no Vínculo: devolve a resposta 403, ou null
 * quando pode.
 */
export const recusaDeLoja =
  (permissions: ModuleContext["permissions"], vinculos: VinculoStore, ref: { key: string; deniedMessage?: string }) =>
  async (c: AuthContext, codigoLoja: number) => {
    if (!permissions.has(c.get("user")?.permissions, ref.key)) return c.json({ error: ref.deniedMessage }, 403);
    const lojas = await lojasDoVinculo(vinculos, c.get("user")?.sub);
    if (!lojas) return c.json({ error: SEM_VINCULO }, 403);
    if (!lojas.includes(codigoLoja)) return c.json({ error: LOJA_FORA_DO_VINCULO }, 403);
    return null;
  };

/** Visualizações do Usuário: a Permission de cada uma (`permissoes`) e, para Loja e Individual, o Vínculo em vigor. */
export async function visualizacoesDoContexto(
  c: AuthContext,
  permissions: ModuleContext["permissions"],
  vinculos: VinculoStore,
  permissoes: Readonly<Record<Visualizacao, string>>,
): Promise<VisualizacoesDoUsuario> {
  const usuarioId = c.get("user")?.sub;
  const vinculo = usuarioId ? await vinculoDoUsuario(vinculos, usuarioId) : null;
  return visualizacoesDoUsuario(c.get("user")?.permissions, vinculo, (p, k) => permissions.has(p, k), permissoes);
}

/** Visualizações das Baixas que o Usuário tem, com as regras do Desempenho de Vendas. */
export const visualizacoesDasBaixas = (c: AuthContext, permissions: ModuleContext["permissions"], vinculos: VinculoStore) =>
  visualizacoesDoContexto(c, permissions, vinculos, VISUALIZACAO_PERMISSION_BAIXAS);

/** Lojas do ERP: o `Config` de cada filial com nome. */
export const LOJAS_SQL = `
  SELECT CodigoEmpresa AS codigoEmpresa, NomeFilial AS nome
  FROM Config
  WHERE NomeFilial IS NOT NULL AND LTRIM(RTRIM(NomeFilial)) <> ''
  ORDER BY CodigoEmpresa
`;

export interface LojaOpcao {
  codigo: number;
  nome: string;
}
export type LinhaLoja = { codigoEmpresa: number; nome: string | null };
export const paraLoja = (r: LinhaLoja): LojaOpcao => ({ codigo: Number(r.codigoEmpresa), nome: (r.nome || "").trim() });

/** Lojas do ERP com o nome; vazio sem conexão ou com o ERP indisponível. */
export async function lojasDoErp(client: ErpQuery | undefined): Promise<LojaOpcao[]> {
  if (!client) return [];
  try {
    return (await client.query<LinhaLoja>(LOJAS_SQL)).map(paraLoja);
  } catch {
    return [];
  }
}

/** Até onde a data de abrangência de um Item pode ir, em dias `AAAA-MM-DD` na hora do ERP. */
export interface InclusaoRetroativa {
  /** Início do Closing Period aberto (o mais antigo, se houver vários), mesmo que ele já tenha terminado. */
  inicio: string;
  /** Hoje: a inclusão nunca vai para o futuro. */
  hoje: string;
}

/** Limites da inclusão retroativa; null sem Closing Period aberto já iniciado. */
export async function inclusaoRetroativa(periods: PeriodsService): Promise<InclusaoRetroativa | null> {
  const hoje = horaDoErp(new Date().toISOString()).slice(0, 10);
  const inicio = (await periods.list())
    .filter((p) => p.status === "open" && p.startDate <= hoje)
    .map((p) => p.startDate)
    .sort()[0];
  return inicio ? { inicio, hoje } : null;
}
