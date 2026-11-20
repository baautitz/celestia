import type { Context } from "hono";
import { z } from "zod";
import type { PeriodsService } from "./pre-vencidos-routes.js";
import { vinculoDesfeito, type VinculoColaborador, type VinculoStore } from "./vinculo-store.js";

/** O que as rotas do Plugin compartilham: o Usuário autenticado, o autor no Audit Log, o ERP, as recusas e o Vínculo. */

/** Cliente do ERP InovaFarma como as rotas o usam. */
export interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

/** Usuário autenticado como as rotas do Plugin o leem. */
export type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

/** Autor de uma entrada no Audit Log. */
export const ator = (c: AuthContext) => ({ id: c.get("user")?.sub ?? "", name: c.get("user")?.fullname ?? "" });

export const SEM_CONEXAO = "Conexão com ERP InovaFarma não configurada ou inativa.";
export const ERP_INDISPONIVEL = "ERP InovaFarma indisponível. Tente novamente em instantes.";
/** Mensagem do 503 de uma falha do ERP: sem conexão, ou indisponível. */
export const erroDoErp = (err: unknown) => ({ error: err instanceof Error && err.message === SEM_CONEXAO ? SEM_CONEXAO : ERP_INDISPONIVEL });
export const PERIODO_NAO_ENCONTRADO = "Período de Fechamento não encontrado.";

/** Corpo do conflito de `version` (HTTP 409): a tela decide pelo `code` e recarrega. */
export const versaoDesatualizada = (error: string) => ({ error, code: "versao_desatualizada" });
export const META_DESATUALIZADA = versaoDesatualizada("A Meta foi alterada por outra pessoa. A tela foi recarregada.");

/**
 * Recusa de validação no contrato da plataforma (`ValidationErrorBody` de `@platform/shared`, o mesmo do `zValidator`
 * do servidor): o Plugin não importa `@platform/server` nem `@platform/shared` (ADR 0002), então o corpo é montado
 * aqui. `{ error: string }` fica para as recusas de regra de negócio.
 */
export const recusaDeValidacao = (c: Context, erro: z.ZodError) =>
  c.json({ error: { issues: erro.issues.map(({ path, message }) => ({ path: path.map((p) => (typeof p === "symbol" ? String(p) : p)), message })) } }, 400);

const MAX_INT = 2147483647;
/** Inteiro positivo em texto (parâmetro de rota ou de query): nada de `""`, `1.5`, `1e2` nem `NaN`. */
const inteiroEmTexto = (mensagem: string) =>
  z
    .string(mensagem)
    .regex(/^\d+$/, mensagem)
    .transform(Number)
    .pipe(z.number().int().min(1, mensagem).max(MAX_INT, mensagem));

/** Código (de Colaborador ou de Loja) recebido como parâmetro de rota ou de query. */
export const CodigoEmTexto = inteiroEmTexto("Informe um código inteiro maior que zero.");
/** Código (de Colaborador ou de Loja) recebido no corpo JSON. */
export const Codigo = z.number().int().min(1).max(MAX_INT);
/** `version` no corpo JSON. */
export const Version = z.number().int().min(1);
/** Dia `AAAA-MM-DD` de calendário (rejeita `2026-02-31`). */
export const DiaDoCalendario = (mensagem: string) => z.iso.date(mensagem);

const VersionDaQuery = z.object({ version: inteiroEmTexto("Parâmetro 'version' é obrigatório.") });

/** `version` da query de um DELETE; senão a recusa de validação. */
export function versaoDaQuery(c: Context) {
  const parsed = VersionDaQuery.safeParse({ version: c.req.query("version") });
  return parsed.success ? ({ version: parsed.data.version } as const) : ({ recusa: recusaDeValidacao(c, parsed.error) } as const);
}

/** Vínculo em vigor do Usuário com um Colaborador; null sem Vínculo ou com ele desfeito. */
export const vinculoDoUsuario = async (vinculos: VinculoStore, usuarioId: string): Promise<VinculoColaborador | null> => {
  const vinculo = await vinculos.porUsuario(usuarioId);
  return vinculo && !vinculoDesfeito(vinculo) ? vinculo : null;
};

/**
 * O Período fechar entre a conferência de uma rota e a gravação (a Apuração e as Baixas congelam no fechamento): confere
 * de novo logo antes de gravar. O status é do Module `closing_period`, fora dos stores do Plugin, então não entra na
 * condição da gravação.
 */
export const periodoAindaAberto = async (periods: PeriodsService, periodoId: string): Promise<boolean> =>
  (await periods.list()).find((p) => p.id === periodoId)?.status === "open";
