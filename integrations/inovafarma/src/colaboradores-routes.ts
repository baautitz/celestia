import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { VINCULO_ACTION, VINCULO_TARGET, type AuditService } from "./vinculo-audit.js";
import { UsuarioJaVinculadoError, VersaoDesatualizadaError, type VinculoColaborador, type VinculoStore } from "./vinculo-store.js";

/** Forma do serviço `users` do Module `iam`; o Plugin não importa `@platform/server` (ADR 0002). */
export interface UsuarioResumo {
  id: string;
  fullname: string;
  username: string;
  status: string;
}
export interface UsersService {
  list(): Promise<UsuarioResumo[]>;
}

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

interface ColaboradorErp {
  codigoColaborador: number;
  nome: string;
  ativo: boolean;
}

export interface ColaboradoresRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  /** A conexão é resolvida a cada requisição: o ERP pode ser configurado com o servidor no ar. */
  erpClient: () => ErpQuery | undefined;
  store: VinculoStore;
  users: UsersService;
  audit: AuditService;
  plugin: string;
}

type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

const SEM_CONEXAO = "Conexão com ERP InovaFarma não configurada ou inativa.";
const ERP_INDISPONIVEL = "ERP InovaFarma indisponível. Tente novamente em instantes.";
const VERSAO_DESATUALIZADA = "O vínculo foi alterado por outra pessoa. A linha foi recarregada.";
const USUARIO_JA_VINCULADO = "Este Usuário já está vinculado a outro Colaborador.";

const MAX_INT = 2147483647;
const Codigo = z.coerce.number().int().min(1).max(MAX_INT);
const Gravacao = z.object({ usuarioId: z.string().min(1).nullable(), version: z.number().int().min(0) });

// Ativo vem só de Funcionario.Ativo: DataDesligamento está preenchida em poucos inativos.
const COLABORADORES_SQL = `
  SELECT f.CodigoFuncionario AS codigoColaborador, c.Nome AS nome, f.Ativo AS ativo
  FROM Funcionario f
  JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
  WHERE c.Eliminado = 0
`;

type LinhaErp = { codigoColaborador: number; nome: string | null; ativo: boolean | number | null };
const toColaborador = (r: LinhaErp): ColaboradorErp => ({
  codigoColaborador: Number(r.codigoColaborador),
  nome: (r.nome || "").trim(),
  ativo: Boolean(r.ativo),
});

/** Campos do vínculo em cada linha da tabela; `version` 0 = Pendente, sem vínculo gravado. */
function camposDoVinculo(vinculo: VinculoColaborador | null, usuarios: UsuarioResumo[]) {
  const usuarioId = vinculo?.usuarioId ?? null;
  return {
    confirmado: vinculo !== null,
    usuarioId,
    usuario: usuarios.find((u) => u.id === usuarioId) ?? null,
    version: vinculo?.version ?? 0,
  };
}

/** Rotas de Colaboradores: listagem com o vínculo de cada um e gravação do vínculo por linha. */
export function registerColaboradoresRoutes({ routes, permissions, auth, erpClient, store, users, audit, plugin }: ColaboradoresRoutesDeps): void {
  routes.get("/colaboradores", auth, async (c: AuthContext) => {
    const colaboradoresView = INOVAFARMA_PERMISSIONS.ref("colaboradores:view");
    if (!permissions.has(c.get("user")?.permissions, colaboradoresView.key)) {
      return c.json({ error: colaboradoresView.deniedMessage }, 403);
    }

    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);

    let colaboradores: ColaboradorErp[];
    try {
      colaboradores = (await client.query<LinhaErp>(`${COLABORADORES_SQL} ORDER BY c.Nome`)).map(toColaborador);
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }

    const [vinculos, usuarios] = await Promise.all([store.list(), users.list()]);
    const porCodigo = new Map(vinculos.map((v) => [v.codigoColaborador, v]));
    return c.json({
      colaboradores: colaboradores.map((col) => ({ ...col, ...camposDoVinculo(porCodigo.get(col.codigoColaborador) ?? null, usuarios) })),
      usuarios: usuarios
        .filter((u) => u.status === "active")
        .map(({ id, fullname, username }) => ({ id, fullname, username }))
        .sort((a, b) => a.fullname.localeCompare(b.fullname, "pt-BR")),
    });
  });

  routes.put("/colaboradores/:codigo/vinculo", auth, async (c: AuthContext) => {
    const update = INOVAFARMA_PERMISSIONS.ref("colaboradores:update");
    const user = c.get("user");
    if (!permissions.has(user?.permissions, update.key)) return c.json({ error: update.deniedMessage }, 403);

    const codigo = Codigo.safeParse(c.req.param("codigo"));
    const body = Gravacao.safeParse(await c.req.json().catch(() => null));
    if (!codigo.success || !body.success) return c.json({ error: "Dados do vínculo inválidos." }, 400);
    const codigoColaborador = codigo.data;
    const { usuarioId, version } = body.data;

    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    let colaborador: ColaboradorErp | undefined;
    try {
      const rows = await client.query<LinhaErp>(`${COLABORADORES_SQL} AND f.CodigoFuncionario = @codigo`, { codigo: codigoColaborador });
      colaborador = rows[0] && toColaborador(rows[0]);
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }

    const atual = await store.get(codigoColaborador);
    // Sem o Colaborador no ERP só se pode desfazer um vínculo já gravado, para liberar o Usuário.
    if (!colaborador && (!atual || usuarioId !== null)) return c.json({ error: "Colaborador não encontrado no ERP." }, 404);
    if ((atual?.version ?? 0) !== version) return c.json({ error: VERSAO_DESATUALIZADA }, 409);

    const usuarios = await users.list();
    const responder = (vinculo: VinculoColaborador | null) => c.json({ codigoColaborador, ...camposDoVinculo(vinculo, usuarios) });

    // Sem mudança não é alteração: nada a gravar nem a auditar.
    if ((atual?.usuarioId ?? null) === usuarioId) return responder(atual);

    const novo = usuarios.find((u) => u.id === usuarioId);
    if (usuarioId !== null && novo?.status !== "active") return c.json({ error: "Usuário não encontrado ou inativo." }, 400);

    let gravado: VinculoColaborador | null = null;
    try {
      if (usuarioId === null) await store.remover(codigoColaborador, version);
      else gravado = await store.gravar({ codigoColaborador, usuarioId, atualizadoPor: user?.sub ?? "" }, version);
    } catch (err: unknown) {
      if (err instanceof VersaoDesatualizadaError) return c.json({ error: VERSAO_DESATUALIZADA }, 409);
      if (err instanceof UsuarioJaVinculadoError) return c.json({ error: USUARIO_JA_VINCULADO }, 409);
      throw err;
    }

    const auditado = (id: string | null | undefined) => (id ? { id, fullname: usuarios.find((u) => u.id === id)?.fullname ?? null } : null);
    await audit.record({
      plugin,
      action: VINCULO_ACTION,
      actor: { id: user?.sub ?? "", name: user?.fullname ?? "" },
      target: { type: VINCULO_TARGET, id: String(codigoColaborador) },
      attributes: {
        codigoColaborador,
        nomeColaborador: colaborador?.nome ?? null,
        anterior: { usuario: auditado(atual?.usuarioId) },
        novo: { usuario: auditado(usuarioId) },
      },
    });
    return responder(gravado);
  });
}
