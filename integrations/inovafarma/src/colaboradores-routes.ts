import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { VINCULO_ACTION, VINCULO_TARGET, type AuditService } from "./vinculo-audit.js";
import { sugerirUsuarios } from "./sugestao-usuario.js";
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
  codigoEmpresa: number;
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
const Gravacao = z.object({ usuarioId: z.string().min(1).nullable(), lojas: z.array(Codigo), version: z.number().int().min(0) });

// Ativo vem só de Funcionario.Ativo: DataDesligamento está preenchida em poucos inativos.
const COLABORADORES_SQL = `
  SELECT f.CodigoFuncionario AS codigoColaborador, c.Nome AS nome, f.Ativo AS ativo, c.CodigoEmpresa AS codigoEmpresa
  FROM Funcionario f
  JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
  WHERE c.Eliminado = 0
`;

/** Mesma origem da rota /lojas; aqui a falha não é engolida, vira 503. */
export const LOJAS_SQL = `
  SELECT CodigoEmpresa AS codigoEmpresa, NomeFilial AS nome
  FROM Config
  WHERE NomeFilial IS NOT NULL AND LTRIM(RTRIM(NomeFilial)) <> ''
  ORDER BY CodigoEmpresa
`;

interface LojaOpcao {
  codigo: number;
  nome: string;
}
type LinhaLoja = { codigoEmpresa: number; nome: string | null };
const toLoja = (r: LinhaLoja): LojaOpcao => ({ codigo: Number(r.codigoEmpresa), nome: (r.nome || "").trim() });

type LinhaErp = { codigoColaborador: number; nome: string | null; ativo: boolean | number | null; codigoEmpresa: number | null };
const toColaborador = (r: LinhaErp): ColaboradorErp => ({
  codigoColaborador: Number(r.codigoColaborador),
  nome: (r.nome || "").trim(),
  ativo: Boolean(r.ativo),
  codigoEmpresa: Number(r.codigoEmpresa),
});

/** Campos do vínculo em cada linha da tabela; `version` 0 = Pendente, sem vínculo gravado. */
function camposDoVinculo(vinculo: VinculoColaborador | null, usuarios: UsuarioResumo[]) {
  const usuarioId = vinculo?.usuarioId ?? null;
  return {
    confirmado: vinculo !== null,
    usuarioId,
    usuario: usuarios.find((u) => u.id === usuarioId) ?? null,
    lojas: vinculo?.lojas ?? [],
    version: vinculo?.version ?? 0,
    // Só a listagem calcula sugestões; ao desfazer um vínculo a linha fica vazia até recarregar.
    sugestao: null as { usuarioId: string | null; lojas: number[] } | null,
  };
}

type TipoAviso = "usuario_desativado" | "inativo_no_erp" | "loja_nao_encontrada" | "colaborador_nao_encontrado";
interface Aviso {
  tipo: TipoAviso;
  mensagem: string;
}

/** O que mudou fora da tela desde a gravação do vínculo; o vínculo é mantido e a pessoa decide o que fazer. */
function avisosDoVinculo(vinculo: VinculoColaborador | null, colaborador: ColaboradorErp | undefined, usuarios: UsuarioResumo[], lojas: LojaOpcao[]): Aviso[] {
  if (!vinculo) return [];
  const avisos: Aviso[] = [];
  if (!colaborador) avisos.push({ tipo: "colaborador_nao_encontrado", mensagem: "Não encontrado no ERP" });
  else if (!colaborador.ativo) avisos.push({ tipo: "inativo_no_erp", mensagem: "Inativo no ERP" });
  const usuario = usuarios.find((u) => u.id === vinculo.usuarioId);
  if (usuario && usuario.status !== "active") avisos.push({ tipo: "usuario_desativado", mensagem: "Usuário desativado" });
  for (const codigo of vinculo.lojas) {
    if (!lojas.some((l) => l.codigo === codigo)) avisos.push({ tipo: "loja_nao_encontrada", mensagem: `Loja não encontrada (cód. ${codigo})` });
  }
  return avisos;
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
    let lojas: LojaOpcao[];
    try {
      const [linhas, linhasLojas] = await Promise.all([client.query<LinhaErp>(`${COLABORADORES_SQL} ORDER BY c.Nome`), client.query<LinhaLoja>(LOJAS_SQL)]);
      colaboradores = linhas.map(toColaborador);
      lojas = linhasLojas.map(toLoja);
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }

    const [vinculos, usuarios] = await Promise.all([store.list(), users.list()]);
    const porCodigo = new Map(vinculos.map((v) => [v.codigoColaborador, v]));
    const noErp = new Set(colaboradores.map((col) => col.codigoColaborador));
    const vinculados = new Set(vinculos.map((v) => v.usuarioId));
    const pendentes = colaboradores.filter((col) => !porCodigo.has(col.codigoColaborador));
    const usuarioSugerido = sugerirUsuarios(pendentes, usuarios.filter((u) => u.status === "active" && !vinculados.has(u.id)));
    const linhasDoErp = colaboradores.map((col) => {
      const { codigoEmpresa, ...dados } = col;
      const vinculo = porCodigo.get(col.codigoColaborador) ?? null;
      const sugestao = vinculo
        ? null
        : { usuarioId: usuarioSugerido.get(col.codigoColaborador) ?? null, lojas: lojas.some((l) => l.codigo === codigoEmpresa) ? [codigoEmpresa] : [] };
      return { ...dados, ...camposDoVinculo(vinculo, usuarios), sugestao, avisos: avisosDoVinculo(vinculo, col, usuarios, lojas) };
    });
    // O ERP não informa mais o nome de quem sumiu, e o vínculo não o guarda.
    const sumidos = vinculos
      .filter((v) => !noErp.has(v.codigoColaborador))
      .map((v) => ({
        codigoColaborador: v.codigoColaborador,
        nome: `Colaborador ${v.codigoColaborador}`,
        ativo: false,
        ...camposDoVinculo(v, usuarios),
        avisos: avisosDoVinculo(v, undefined, usuarios, lojas),
      }));
    // Ordem fixada no servidor: a linha não salta na tela ao ser confirmada.
    const todas = [...linhasDoErp, ...sumidos].sort((a, b) => Number(a.confirmado) - Number(b.confirmado));
    return c.json({
      colaboradores: todas,
      usuarios: usuarios
        .filter((u) => u.status === "active")
        .map(({ id, fullname, username }) => ({ id, fullname, username }))
        .sort((a, b) => a.fullname.localeCompare(b.fullname, "pt-BR")),
      lojas,
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
    const lojas = [...new Set(body.data.lojas)].sort((a, b) => a - b);
    const vazio = usuarioId === null && lojas.length === 0;

    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    let colaborador: ColaboradorErp | undefined;
    let lojasErp: LojaOpcao[];
    try {
      const [rows, linhasLojas] = await Promise.all([
        client.query<LinhaErp>(`${COLABORADORES_SQL} AND f.CodigoFuncionario = @codigo`, { codigo: codigoColaborador }),
        client.query<LinhaLoja>(LOJAS_SQL),
      ]);
      colaborador = rows[0] && toColaborador(rows[0]);
      lojasErp = linhasLojas.map(toLoja);
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }

    const atual = await store.get(codigoColaborador);
    // Sem o Colaborador no ERP só se pode desfazer um vínculo já gravado, para liberar o Usuário.
    if (!colaborador && (!atual || !vazio)) return c.json({ error: "Colaborador não encontrado no ERP." }, 404);
    if ((atual?.version ?? 0) !== version) return c.json({ error: VERSAO_DESATUALIZADA }, 409);

    const usuarios = await users.list();
    const responder = (vinculo: VinculoColaborador | null) => c.json({ codigoColaborador, ...camposDoVinculo(vinculo, usuarios), avisos: avisosDoVinculo(vinculo, colaborador, usuarios, lojasErp) });

    // Sem mudança não é alteração: nada a gravar nem a auditar.
    const lojasAnteriores = atual?.lojas ?? [];
    if ((atual?.usuarioId ?? null) === usuarioId && lojas.join() === lojasAnteriores.join()) return responder(atual);

    // Um Usuário já gravado pode ter sido desativado e continua aceito; só um novo precisa estar ativo.
    const novo = usuarios.find((u) => u.id === usuarioId);
    if (usuarioId !== null && usuarioId !== atual?.usuarioId && novo?.status !== "active") return c.json({ error: "Usuário não encontrado ou inativo." }, 400);

    // Uma Loja já gravada pode ter saído do ERP e continua aceita; só uma nova precisa existir lá.
    const lojaValida = (codigo: number) => lojasAnteriores.includes(codigo) || lojasErp.some((l) => l.codigo === codigo);
    if (!lojas.every(lojaValida)) return c.json({ error: "Loja não encontrada no ERP." }, 400);

    let gravado: VinculoColaborador | null = null;
    try {
      if (vazio) await store.remover(codigoColaborador, version);
      else gravado = await store.gravar({ codigoColaborador, usuarioId, lojas, atualizadoPor: user?.sub ?? "" }, version);
    } catch (err: unknown) {
      if (err instanceof VersaoDesatualizadaError) return c.json({ error: VERSAO_DESATUALIZADA }, 409);
      if (err instanceof UsuarioJaVinculadoError) return c.json({ error: USUARIO_JA_VINCULADO }, 409);
      throw err;
    }

    const auditado = (id: string | null | undefined) => (id ? { id, fullname: usuarios.find((u) => u.id === id)?.fullname ?? null } : null);
    const lojasAuditadas = (codigos: number[]) => codigos.map((codigo) => ({ codigo, nome: lojasErp.find((l) => l.codigo === codigo)?.nome ?? null }));
    await audit.record({
      plugin,
      action: VINCULO_ACTION,
      actor: { id: user?.sub ?? "", name: user?.fullname ?? "" },
      target: { type: VINCULO_TARGET, id: String(codigoColaborador) },
      attributes: {
        codigoColaborador,
        nomeColaborador: colaborador?.nome ?? null,
        anterior: { usuario: auditado(atual?.usuarioId), lojas: lojasAuditadas(lojasAnteriores) },
        novo: { usuario: auditado(usuarioId), lojas: lojasAuditadas(lojas) },
      },
    });
    return responder(gravado);
  });
}
