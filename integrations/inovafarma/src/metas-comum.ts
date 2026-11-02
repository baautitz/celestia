import type { Context } from "hono";
import { vinculoDesfeito, type VinculoColaborador, type VinculoStore } from "./vinculo-store.js";

/** O que as rotas das Metas compartilham: o Usuário autenticado, o autor no Audit Log, as recusas e o Vínculo. */

/** Usuário autenticado como as rotas das Metas o leem. */
export type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

/** Autor de uma entrada no Audit Log. */
export const ator = (c: AuthContext) => ({ id: c.get("user")?.sub ?? "", name: c.get("user")?.fullname ?? "" });

export const SEM_CONEXAO = "Conexão com ERP InovaFarma não configurada ou inativa.";
export const ERP_INDISPONIVEL = "ERP InovaFarma indisponível. Tente novamente em instantes.";
export const PERIODO_NAO_ENCONTRADO = "Período de Fechamento não encontrado.";
export const META_DESATUALIZADA = { error: "A Meta foi alterada por outra pessoa. A tela foi recarregada.", code: "versao_desatualizada" };

/** Vínculo em vigor do Usuário com um Colaborador; null sem Vínculo ou com ele desfeito. */
export const vinculoDoUsuario = async (vinculos: VinculoStore, usuarioId: string): Promise<VinculoColaborador | null> =>
  (await vinculos.list()).find((v) => v.usuarioId === usuarioId && !vinculoDesfeito(v)) ?? null;
