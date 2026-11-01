import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { AVALIACAO_ACTIONS, AVALIACAO_PLUGIN, AVALIACAO_TARGET, type AtributosAvaliacao } from "./avaliacoes-audit.js";
import type { Avaliacao, AvaliacaoStore } from "./avaliacoes-store.js";
import { COLABORADORES_SQL, LOJAS_SQL, type UsersService } from "./colaboradores-routes.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { PeriodoResumo, PeriodsService } from "./pre-vencidos-routes.js";
import type { AuditService } from "./vinculo-audit.js";
import { vinculoDesfeito, type VinculoStore } from "./vinculo-store.js";

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

export interface AvaliacoesRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  store: AvaliacaoStore;
  vinculos: VinculoStore;
  users: UsersService;
  periods: PeriodsService;
  audit: AuditService;
}

interface LinhaColaborador {
  codigoColaborador: number;
  nome: string | null;
  ativo: boolean | number;
  codigoEmpresa: number;
}

/** Colaborador que pode receber Avaliação, com as Lojas que contam para quem gerencia. */
interface Elegivel {
  codigoColaborador: number;
  nome: string;
  lojas: number[];
}

type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

const ERP_INDISPONIVEL = "ERP InovaFarma indisponível. Tente novamente em instantes.";
const VERSAO_DESATUALIZADA = { error: "A Avaliação foi alterada por outra pessoa. A lista foi recarregada.", code: "versao_desatualizada" };
const PERIODO_NAO_ENCONTRADO = "Período de Fechamento não encontrado.";
const PERIODO_FECHADO = "O Período de Fechamento está fechado: não é possível lançar, alterar nem excluir.";
const NAO_ENCONTRADA = "Avaliação não encontrada.";
const LOJA_FORA = "A Loja informada não está entre as Lojas que você gerencia.";

const Descricao = z.string().trim().min(1, "Informe a descrição.").max(500, "A descrição deve ter no máximo 500 caracteres.");
const Valor = z.number({ invalid_type_error: "Informe o valor descontado." }).min(0, "O valor descontado não pode ser negativo.").max(1_000_000, "Valor descontado muito alto.");
const Nova = z.object({ periodoId: z.string().min(1), codigoColaborador: z.number().int().min(1), codigoLoja: z.number().int().min(1), descricao: Descricao, valor: Valor });
const Edicao = z.object({ descricao: Descricao, valor: Valor, version: z.number().int().min(1) });

const centavos = (valor: number) => Math.round(valor * 100);

/** O que a API devolve: valor em reais e sem o id de quem lançou. */
const publico = ({ valorCentavos, criadoPor: _criadoPor, ...resto }: Avaliacao) => ({ ...resto, valor: valorCentavos / 100 });

export function registerAvaliacoesRoutes({ routes, permissions, auth, erpClient, store, vinculos, users, periods, audit }: AvaliacoesRoutesDeps): void {
  const individual = INOVAFARMA_PERMISSIONS.ref("avaliacoes-individual:view");
  const porLoja = INOVAFARMA_PERMISSIONS.ref("avaliacoes-loja:manage");
  const geral = INOVAFARMA_PERMISSIONS.ref("avaliacoes-geral:manage");
  const pode = (c: AuthContext, ref: { key: string }) => permissions.has(c.get("user")?.permissions, ref.key);
  const podeGerenciar = (c: AuthContext) => pode(c, geral) || pode(c, porLoja);

  const vinculoDe = async (c: AuthContext) => {
    const sub = c.get("user")?.sub;
    return sub ? ((await vinculos.list()).find((v) => v.usuarioId === sub && !vinculoDesfeito(v)) ?? null) : null;
  };

  /** Lojas que o Usuário gerencia: todas (undefined) com a Permission geral, senão as do seu Vínculo. */
  const lojasGerenciadas = async (c: AuthContext): Promise<number[] | undefined> => (pode(c, geral) ? undefined : ((await vinculoDe(c))?.lojas ?? []));
  const gerencia = (lojas: number[] | undefined, codigoLoja: number) => lojas === undefined || lojas.includes(codigoLoja);

  const lojasDoErp = async () => {
    const client = erpClient();
    if (!client) return [];
    try {
      const rows = await client.query<{ codigoEmpresa: number; nome: string | null }>(LOJAS_SQL);
      return rows.map((r) => ({ codigo: Number(r.codigoEmpresa), nome: (r.nome || "").trim() }));
    } catch {
      return [];
    }
  };

  /**
   * Colaboradores que o Usuário pode avaliar, menos ele mesmo: os de uma Loja que ele gerencia.
   * A Loja vem do Vínculo salvo; sem Vínculo (ou sem Loja nele), da Loja do Colaborador ativo no ERP.
   * `null` quando o ERP não responde.
   */
  const elegiveis = async (c: AuthContext, lojas: number[] | undefined): Promise<Elegivel[] | null> => {
    let erp: LinhaColaborador[] = [];
    const client = erpClient();
    if (client) {
      try {
        erp = await client.query<LinhaColaborador>(COLABORADORES_SQL);
      } catch {
        return null;
      }
    }
    const salvos = new Map((await vinculos.list()).filter((v) => v.lojas.length > 0).map((v) => [v.codigoColaborador, v]));
    const doErp = erp.map((r) => {
      const codigoColaborador = Number(r.codigoColaborador);
      const nome = (r.nome || "").trim();
      const salvo = salvos.get(codigoColaborador);
      return { codigoColaborador, nome, lojas: salvo ? salvo.lojas : r.ativo ? [Number(r.codigoEmpresa)] : [] };
    });
    const noErp = new Set(doErp.map((e) => e.codigoColaborador));
    const sumidos = [...salvos.values()].filter((v) => !noErp.has(v.codigoColaborador)).map((v) => ({ codigoColaborador: v.codigoColaborador, nome: "", lojas: v.lojas }));
    const proprio = (await vinculoDe(c))?.codigoColaborador;
    return [...doErp, ...sumidos].filter((e) => e.codigoColaborador !== proprio && e.lojas.some((l) => gerencia(lojas, l)));
  };

  const registrar = (c: AuthContext, action: string, alvo: Avaliacao, periodo: PeriodoResumo | undefined, anterior: AtributosAvaliacao["anterior"] = null) => {
    const user = c.get("user");
    const atributos: AtributosAvaliacao = {
      periodo: periodo?.name ?? alvo.periodoId,
      codigoColaborador: alvo.codigoColaborador,
      nomeColaborador: alvo.nomeColaborador,
      codigoLoja: alvo.codigoLoja,
      descricao: alvo.descricao,
      valorCentavos: alvo.valorCentavos,
      anterior,
    };
    return audit.record({
      plugin: AVALIACAO_PLUGIN,
      action,
      actor: { id: user?.sub ?? "", name: user?.fullname ?? "" },
      target: { type: AVALIACAO_TARGET, id: alvo.id },
      attributes: atributos,
    });
  };

  const periodosOrdenados = async () => (await periods.list()).sort((a, b) => b.startDate.localeCompare(a.startDate));

  // O que a tela precisa para abrir: Closing Periods, Lojas e as abas que a Permission libera.
  routes.get("/avaliacoes/contexto", auth, async (c: AuthContext) => {
    const podeVer = pode(c, individual);
    const gerenciar = podeGerenciar(c);
    if (!podeVer && !gerenciar) return c.json({ error: individual.deniedMessage }, 403);
    const vinculo = await vinculoDe(c);
    const lojasErp = await lojasDoErp();
    const lojas = gerenciar ? await lojasGerenciadas(c) : [];
    return c.json({
      podeVer,
      podeGerenciar: gerenciar,
      todasAsLojas: pode(c, geral),
      vinculado: vinculo?.usuarioId != null,
      periodos: await periodosOrdenados(),
      // Nomes de todas as Lojas, para exibir; `lojasGerenciadas` são as do filtro e do formulário.
      lojas: lojasErp,
      lojasGerenciadas: lojas === undefined ? lojasErp : lojas.map((codigo) => ({ codigo, nome: lojasErp.find((l) => l.codigo === codigo)?.nome ?? "" })),
    });
  });

  routes.get("/avaliacoes/minhas", auth, async (c: AuthContext) => {
    if (!pode(c, individual)) return c.json({ error: individual.deniedMessage }, 403);
    const periodoId = c.req.query("periodoId");
    if (!periodoId) return c.json({ error: "Parâmetro 'periodoId' é obrigatório." }, 400);
    const vinculo = await vinculoDe(c);
    if (!vinculo?.usuarioId) return c.json([]);
    return c.json((await store.listar({ periodoId, codigoColaborador: vinculo.codigoColaborador })).map(publico));
  });

  routes.get("/avaliacoes/colaboradores", auth, async (c: AuthContext) => {
    if (!podeGerenciar(c)) return c.json({ error: porLoja.deniedMessage }, 403);
    const lojas = await lojasGerenciadas(c);
    const lista = await elegiveis(c, lojas);
    if (lista === null) return c.json({ error: ERP_INDISPONIVEL }, 503);
    const [usuarios, todos] = await Promise.all([users.list(), vinculos.list()]);
    const vinculoPorCodigo = new Map(todos.map((v) => [v.codigoColaborador, v]));
    return c.json(
      lista
        .map((v) => ({
          codigoColaborador: v.codigoColaborador,
          nome: v.nome || `Colaborador cód. ${v.codigoColaborador}`,
          usuario: usuarios.find((u) => u.id === vinculoPorCodigo.get(v.codigoColaborador)?.usuarioId)?.username ?? null,
          lojas: v.lojas.filter((l) => gerencia(lojas, l)),
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    );
  });

  routes.get("/avaliacoes", auth, async (c: AuthContext) => {
    if (!podeGerenciar(c)) return c.json({ error: porLoja.deniedMessage }, 403);
    const periodoId = c.req.query("periodoId");
    if (!periodoId) return c.json({ error: "Parâmetro 'periodoId' é obrigatório." }, 400);
    const loja = c.req.query("codigoLoja");
    if (loja !== undefined && loja !== "" && !Number.isInteger(Number(loja))) return c.json({ error: "O filtro 'codigoLoja' deve ser um número inteiro." }, 400);
    const lojas = await lojasGerenciadas(c);
    const filtro = loja === undefined || loja === "" ? lojas : gerencia(lojas, Number(loja)) ? [Number(loja)] : [];
    // Quem lançou só aparece para quem gerencia; o Colaborador avaliado não vê.
    const usuarios = await users.list();
    return c.json(
      (await store.listar({ periodoId, lojas: filtro })).map((a) => ({ ...publico(a), lancadoPor: usuarios.find((u) => u.id === a.criadoPor)?.fullname ?? "" })),
    );
  });

  routes.post("/avaliacoes", auth, async (c: AuthContext) => {
    if (!podeGerenciar(c)) return c.json({ error: porLoja.deniedMessage }, 403);
    const parsed = Nova.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { periodoId, codigoColaborador, codigoLoja, descricao, valor } = parsed.data;

    const lojas = await lojasGerenciadas(c);
    if (!gerencia(lojas, codigoLoja)) return c.json({ error: LOJA_FORA }, 403);
    if ((await vinculoDe(c))?.codigoColaborador === codigoColaborador) return c.json({ error: "Você não pode lançar uma Avaliação para si mesmo." }, 403);
    const lista = await elegiveis(c, lojas);
    if (lista === null) return c.json({ error: ERP_INDISPONIVEL }, 503);
    const colaborador = lista.find((v) => v.codigoColaborador === codigoColaborador);
    if (!colaborador?.lojas.includes(codigoLoja)) return c.json({ error: "O Colaborador não é da Loja informada." }, 403);

    const periodo = (await periods.list()).find((p) => p.id === periodoId);
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    if (periodo.status !== "open") return c.json({ error: PERIODO_FECHADO }, 409);

    const criada = await store.criar({
      periodoId,
      codigoColaborador,
      nomeColaborador: colaborador.nome || `Colaborador cód. ${codigoColaborador}`,
      codigoLoja,
      descricao,
      valorCentavos: centavos(valor),
      criadoPor: c.get("user")?.sub ?? "",
    });
    await registrar(c, AVALIACAO_ACTIONS.criar, criada, periodo);
    return c.json(publico(criada), 201);
  });

  /** Avaliação de uma Loja que o Usuário gerencia, em Closing Period aberto; senão devolve a resposta de recusa. */
  const gerenciavelEmPeriodoAberto = async (c: AuthContext) => {
    if (!podeGerenciar(c)) return { recusa: c.json({ error: porLoja.deniedMessage }, 403) } as const;
    const avaliacao = await store.get(c.req.param("id") ?? "");
    if (!avaliacao || !gerencia(await lojasGerenciadas(c), avaliacao.codigoLoja)) return { recusa: c.json({ error: NAO_ENCONTRADA }, 404) } as const;
    const periodo = (await periods.list()).find((p) => p.id === avaliacao.periodoId && p.status === "open");
    if (!periodo) return { recusa: c.json({ error: PERIODO_FECHADO }, 409) } as const;
    return { avaliacao, periodo } as const;
  };

  routes.put("/avaliacoes/:id", auth, async (c: AuthContext) => {
    const alvo = await gerenciavelEmPeriodoAberto(c);
    if ("recusa" in alvo) return alvo.recusa;
    const parsed = Edicao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { version, descricao, valor } = parsed.data;
    const atualizada = await store.atualizar(alvo.avaliacao.id, { descricao, valorCentavos: centavos(valor) }, version);
    if (!atualizada) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, AVALIACAO_ACTIONS.editar, atualizada, alvo.periodo, { descricao: alvo.avaliacao.descricao, valorCentavos: alvo.avaliacao.valorCentavos });
    return c.json(publico(atualizada));
  });

  routes.delete("/avaliacoes/:id", auth, async (c: AuthContext) => {
    const alvo = await gerenciavelEmPeriodoAberto(c);
    if ("recusa" in alvo) return alvo.recusa;
    const version = Number(c.req.query("version"));
    if (!Number.isInteger(version) || version < 1) return c.json({ error: "Parâmetro 'version' é obrigatório." }, 400);
    if (!(await store.excluir(alvo.avaliacao.id, version))) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, AVALIACAO_ACTIONS.excluir, alvo.avaliacao, alvo.periodo);
    return c.json({ success: true });
  });
}
