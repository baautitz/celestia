import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { colaboradorDasMinhasMetas, visualizacoesDasMetas } from "./acompanhamento-routes.js";
import { LOJAS_SQL } from "./colaboradores-routes.js";
import { formatarValor, indicadorPorId } from "./indicadores.js";
import { METAS_ACTIONS } from "./metas-audit.js";
import { ator, ERP_INDISPONIVEL, META_DESATUALIZADA, PERIODO_NAO_ENCONTRADO, SEM_CONEXAO, type AuthContext } from "./metas-comum.js";
import type { DadosMeta, Meta, MetaStore } from "./metas-store.js";
import { alvoInicial, novaMeta, pendentes, usaAlvo, type ColaboradorAtivo } from "./montar-metas.js";
import { metasDoPeriodo, metasVisiveis } from "./metas-do-periodo.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { BUSCA_SQL, MIN_BUSCA, type LinhaBusca, type PeriodsService } from "./pre-vencidos-routes.js";
import { descreverPremio, type TipoMeta } from "./tipos-meta.js";
import type { ErpQueryClient } from "./server.js";
import type { TipoMetaStore } from "./tipos-meta-store.js";
import type { AuditService } from "./vinculo-audit.js";
import { vinculoDesfeito, type VinculoStore } from "./vinculo-store.js";

export interface MetasRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  erpClient: () => ErpQueryClient | undefined;
  tipos: TipoMetaStore;
  metas: MetaStore;
  vinculos: VinculoStore;
  periods: PeriodsService;
  audit: AuditService;
}

const PERIODO_FECHADO = "O Período de Fechamento está fechado: as Metas ficam só para leitura.";
const SEM_METAS = "Acesso negado: o usuário não possui nenhuma permissão das Metas (Tipos de Meta, Montar Metas, Acompanhamento ou Minhas Metas).";
const META_NAO_ENCONTRADA = "Meta não encontrada.";
const TIPO_NAO_ENCONTRADO = "Tipo de Meta não encontrado ou inativo.";
const META_REPETIDA = "O Período já tem uma Meta deste Tipo de Meta.";
const NAO_PARTICIPANTE = "O Colaborador não é Participante da Meta.";
const NAO_ATIVO = "O Colaborador não está ativo no ERP.";
const SEM_ALVO = "Esta Meta não tem Alvo por Participante.";
const SO_LISTA = "Só a Meta de Lista de Produtos tem produtos.";

const Version = z.number().int().min(1);
const Alvo = z.number({ invalid_type_error: "Informe o Alvo." }).positive("O Alvo deve ser maior que zero.").max(1e12);
const Nova = z.object({ periodoId: z.string().min(1), tipoId: z.string().min(1) });
const Participacao = z.object({ version: Version, participa: z.boolean(), alvo: Alvo.nullable().optional() });
const Definicao = z.object({ version: Version, codigos: z.array(z.number().int()).min(1, "Escolha ao menos um Participante."), alvo: Alvo });
const Quantidade = z.number().int().min(1, "A quantidade deve ser maior que zero.").max(1_000_000);
const Lista = z.object({
  version: Version,
  produtos: z.array(z.object({ produtoId: z.string().min(1), nome: z.string().trim().min(1), quantidade: Quantidade })).max(500),
  minimo: z.number().int().min(1, "O mínimo de produtos deve ser maior que zero.").nullable(),
  ajustes: z.array(z.object({ codigoColaborador: z.number().int(), produtoId: z.string().min(1), quantidade: Quantidade })).max(10_000),
});

const rotuloAlvo = (tipo: TipoMeta) => (tipo.indicador === "avaliacoes" ? "o valor inicial" : "o Alvo");

export function registerMetasRoutes({ routes, permissions, auth, erpClient, tipos, metas, vinculos, periods, audit }: MetasRoutesDeps): void {
  const manage = INOVAFARMA_PERMISSIONS.ref("metas:manage");
  const tiposManage = INOVAFARMA_PERMISSIONS.ref("tipos-meta:manage");
  const pode = (c: AuthContext, ref: { key: string } = manage) => permissions.has(c.get("user")?.permissions, ref.key);
  const montagem = metasDoPeriodo({ erpClient, tipos, metas, audit });
  const { ativosDoErp } = montagem;
  const registrar = (c: AuthContext, action: string, meta: Meta, attributes: Record<string, unknown>) => montagem.registrar(ator(c), action, meta, attributes);

  const periodosOrdenados = async () => (await periods.list()).sort((a, b) => b.startDate.localeCompare(a.startDate));

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

  /** Lojas confirmadas no Vínculo de cada Colaborador; sem Loja confirmada, ele só aparece em "Todas as Lojas". */
  const lojasConfirmadas = async () => new Map((await vinculos.list()).filter((v) => !vinculoDesfeito(v)).map((v) => [v.codigoColaborador, v.lojas]));

  const comTipo = (meta: Meta, tipo: TipoMeta) => ({ ...meta, tipo: { ...tipo, premio: descreverPremio(tipo) }, pendentes: pendentes(meta, tipo).length });

  // O que a página Metas precisa para abrir: as abas que a Permission libera e os Períodos.
  routes.get("/metas/contexto", auth, async (c: AuthContext) => {
    const acompanhamento = await visualizacoesDasMetas(c.get("user"), permissions.has, vinculos);
    const abas = {
      tipos: pode(c, tiposManage),
      montar: pode(c),
      acompanhamento: acompanhamento.geral || acompanhamento.lojas !== null,
      minhas: (await colaboradorDasMinhasMetas(c.get("user"), permissions.has, vinculos)) !== null,
    };
    if (!abas.tipos && !abas.montar && !abas.acompanhamento && !abas.minhas) return c.json({ error: SEM_METAS }, 403);
    const lojas = abas.montar || abas.acompanhamento ? await lojasDoErp() : [];
    // Visualizações do Acompanhamento: Geral filtra todas as Lojas; Loja, só as do Vínculo do Usuário.
    const visualizacoes = [
      ...(acompanhamento.geral ? [{ id: "geral" as const, lojas }] : []),
      ...(acompanhamento.lojas ? [{ id: "loja" as const, lojas: acompanhamento.lojas.map((codigo) => lojas.find((l) => l.codigo === codigo) ?? { codigo, nome: "" }) }] : []),
    ];
    return c.json({ abas, periodos: abas.montar || abas.acompanhamento || abas.minhas ? await periodosOrdenados() : [], lojas: abas.montar ? lojas : [], visualizacoes });
  });

  routes.get("/metas/produtos", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < MIN_BUSCA) return c.json([]);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const rows = await client.query<LinhaBusca>(BUSCA_SQL, { busca: q, buscaLike: `%${q.replace(/[\\%_[]/g, "\\$&")}%` });
      return c.json(rows.map((r) => ({ produtoId: r.produtoId, nome: (r.nome || "").trim(), codigoBarra: r.codigoBarra })));
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });

  // Montar Metas de um Período; no primeiro acesso a um Período aberto sem Metas, faz a cópia automática.
  routes.get("/metas", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const todos = await periods.list();
    const periodo = todos.find((p) => p.id === c.req.query("periodoId"));
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    const preparo = await montagem.preparar(ator(c), periodo, todos);
    if (!preparo) return c.json({ error: ERP_INDISPONIVEL }, 503);
    const { ativos, copiadoDe } = preparo;

    const doPeriodo = metasVisiveis(await metas.listar([periodo.id]), await tipos.listar(), periodo);
    const lojas = await lojasConfirmadas();
    // Os Participantes que saíram do ERP depois de entrar na Meta continuam na lista.
    const pessoas = new Map<number, ColaboradorAtivo & { ativo: boolean }>(ativos.map((a) => [a.codigoColaborador, { ...a, ativo: true }]));
    for (const { meta: m } of doPeriodo) for (const p of m.participantes) if (!pessoas.has(p.codigoColaborador)) pessoas.set(p.codigoColaborador, { codigoColaborador: p.codigoColaborador, nome: p.nome, ativo: false });

    return c.json({
      periodo,
      somenteLeitura: periodo.status !== "open",
      copiadoDe,
      colaboradores: [...pessoas.values()].sort((a, b) => a.nome.localeCompare(b.nome)).map((p) => ({ ...p, lojas: lojas.get(p.codigoColaborador) ?? [] })),
      metas: doPeriodo.map(({ meta, tipo }) => comTipo(meta, tipo)).sort((a, b) => a.tipo.nome.localeCompare(b.tipo.nome)),
    });
  });

  routes.post("/metas", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const parsed = Nova.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const periodo = (await periods.list()).find((p) => p.id === parsed.data.periodoId);
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    if (periodo.status !== "open") return c.json({ error: PERIODO_FECHADO }, 409);
    const tipo = await tipos.tipo(parsed.data.tipoId);
    if (!tipo?.ativo) return c.json({ error: TIPO_NAO_ENCONTRADO }, 404);
    const ativos = await ativosDoErp();
    if (!ativos) return c.json({ error: ERP_INDISPONIVEL }, 503);
    const criada = await metas.criar(novaMeta(periodo.id, tipo, ativos));
    if (!criada) return c.json({ error: META_REPETIDA }, 409);
    await registrar(c, METAS_ACTIONS.criar, criada, { tipo: tipo.nome, periodo: periodo.name, participantes: criada.participantes.length });
    return c.json(comTipo(criada, tipo), 201);
  });

  /** Meta de Período aberto, com o Tipo; senão devolve a resposta de recusa. */
  const alteravel = async (c: AuthContext) => {
    if (!pode(c)) return { recusa: c.json({ error: manage.deniedMessage }, 403) } as const;
    const meta = await metas.meta(c.req.param("id") ?? "");
    const tipo = meta && (await tipos.tipo(meta.tipoId));
    if (!meta || !tipo) return { recusa: c.json({ error: META_NAO_ENCONTRADA }, 404) } as const;
    const periodo = (await periods.list()).find((p) => p.id === meta.periodoId);
    if (periodo?.status !== "open") return { recusa: c.json({ error: PERIODO_FECHADO }, 409) } as const;
    return { meta, tipo, periodo } as const;
  };

  /**
   * O Período pode fechar entre `alteravel` e a gravação (a Apuração congela no fechamento): confere de novo logo antes
   * de gravar. O status é do Module `closing_period`, fora do store das Metas, então não entra na condição da gravação.
   */
  const aindaAberto = async (meta: Meta) => (await periods.list()).find((p) => p.id === meta.periodoId)?.status === "open";

  const gravar = async (meta: Meta, dados: Partial<DadosMeta>, version: number) =>
    metas.atualizar(meta.id, { participantes: meta.participantes, excluidos: meta.excluidos, lista: meta.lista, ...dados }, version);

  // Marca ou desmarca um Colaborador como Participante, ou altera o Alvo dele.
  routes.put("/metas/:id/participantes/:codigo", auth, async (c: AuthContext) => {
    const alteracao = await alteravel(c);
    if ("recusa" in alteracao) return alteracao.recusa;
    const { meta, tipo, periodo } = alteracao;
    const parsed = Participacao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { version, participa } = parsed.data;
    if (parsed.data.alvo != null && !usaAlvo(tipo)) return c.json({ error: SEM_ALVO }, 400);
    if (meta.version !== version) return c.json(META_DESATUALIZADA, 409);
    const codigo = Number(c.req.param("codigo"));
    const atual = meta.participantes.find((p) => p.codigoColaborador === codigo);
    const indicador = indicadorPorId(tipo.indicador);
    const texto = (n: number | null) => (n === null ? "pendente" : formatarValor(indicador, n));
    const base = { tipo: tipo.nome, periodo: periodo.name, rotulo: rotuloAlvo(tipo) };

    let dados: Partial<DadosMeta>;
    let atributos: Record<string, unknown>;
    if (!participa) {
      if (!atual) return c.json({ error: NAO_PARTICIPANTE }, 400);
      dados = {
        participantes: meta.participantes.filter((p) => p !== atual),
        excluidos: [...meta.excluidos.filter((e) => e !== codigo), codigo],
        lista: meta.lista && { ...meta.lista, ajustes: meta.lista.ajustes.filter((a) => a.codigoColaborador !== codigo) },
      };
      atributos = { ...base, colaborador: atual.nome, mudanca: "excluido", alvo: texto(atual.alvo), anterior: null };
    } else if (atual) {
      const novo = parsed.data.alvo ?? null;
      dados = { participantes: meta.participantes.map((p) => (p === atual ? { ...p, alvo: novo } : p)) };
      atributos = { ...base, colaborador: atual.nome, mudanca: "alvo", alvo: texto(novo), anterior: atual.alvo === null ? null : texto(atual.alvo) };
    } else {
      const colaborador = (await ativosDoErp())?.find((a) => a.codigoColaborador === codigo);
      if (!colaborador) return c.json({ error: NAO_ATIVO }, 400);
      const novo = parsed.data.alvo === undefined ? alvoInicial(tipo) : parsed.data.alvo;
      dados = { participantes: [...meta.participantes, { ...colaborador, alvo: novo }], excluidos: meta.excluidos.filter((e) => e !== codigo) };
      atributos = { ...base, colaborador: colaborador.nome, mudanca: "incluido", alvo: texto(novo), anterior: null };
    }
    if (!(await aindaAberto(meta))) return c.json({ error: PERIODO_FECHADO }, 409);
    const atualizada = await gravar(meta, dados, version);
    if (!atualizada) return c.json(META_DESATUALIZADA, 409);
    await registrar(c, METAS_ACTIONS.participante, atualizada, atributos);
    return c.json(comTipo(atualizada, tipo));
  });

  // Definir Alvo (ou valor inicial, na Meta de Avaliações) em massa, para os Participantes marcados.
  routes.post("/metas/:id/definir-alvo", auth, async (c: AuthContext) => {
    const alteracao = await alteravel(c);
    if ("recusa" in alteracao) return alteracao.recusa;
    const { meta, tipo, periodo } = alteracao;
    if (!usaAlvo(tipo)) return c.json({ error: SEM_ALVO }, 400);
    const parsed = Definicao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { version, codigos } = parsed.data;
    const marcados = meta.participantes.filter((p) => codigos.includes(p.codigoColaborador));
    if (marcados.length !== new Set(codigos).size) return c.json({ error: NAO_PARTICIPANTE }, 400);
    if (!(await aindaAberto(meta))) return c.json({ error: PERIODO_FECHADO }, 409);
    const atualizada = await metas.definirAlvo(meta.id, codigos, parsed.data.alvo, version);
    if (!atualizada) return c.json(META_DESATUALIZADA, 409);
    await registrar(c, METAS_ACTIONS.definirAlvo, atualizada, {
      tipo: tipo.nome,
      periodo: periodo.name,
      rotulo: rotuloAlvo(tipo),
      alvo: formatarValor(indicadorPorId(tipo.indicador), parsed.data.alvo),
      participantes: marcados.map((p) => p.nome),
    });
    return c.json(comTipo(atualizada, tipo));
  });

  // Lista de Produtos: a quantidade de cada produto, os ajustes por Colaborador e o mínimo de produtos batidos.
  routes.put("/metas/:id/lista", auth, async (c: AuthContext) => {
    const alteracao = await alteravel(c);
    if ("recusa" in alteracao) return alteracao.recusa;
    const { meta, tipo, periodo } = alteracao;
    if (tipo.indicador !== "lista-produtos") return c.json({ error: SO_LISTA }, 400);
    const parsed = Lista.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { version, produtos, minimo, ajustes } = parsed.data;
    const ids = new Set(produtos.map((p) => p.produtoId));
    if (ids.size !== produtos.length) return c.json({ error: "Um produto aparece duas vezes na Lista de Produtos." }, 400);
    if (minimo !== null && minimo > produtos.length) return c.json({ error: "O mínimo de produtos não pode passar do número de produtos da Lista." }, 400);
    const participantes = new Set(meta.participantes.map((p) => p.codigoColaborador));
    if (!ajustes.every((a) => ids.has(a.produtoId) && participantes.has(a.codigoColaborador))) return c.json({ error: "Um ajuste é de um produto ou Colaborador fora da Meta." }, 400);
    // O ajuste igual à quantidade do produto não é ajuste.
    const lista = { produtos, minimo, ajustes: ajustes.filter((a) => produtos.find((p) => p.produtoId === a.produtoId)?.quantidade !== a.quantidade) };
    if (!(await aindaAberto(meta))) return c.json({ error: PERIODO_FECHADO }, 409);
    const atualizada = await gravar(meta, { lista }, version);
    if (!atualizada) return c.json(META_DESATUALIZADA, 409);
    await registrar(c, METAS_ACTIONS.lista, atualizada, {
      tipo: tipo.nome,
      periodo: periodo.name,
      produtos: produtos.map((p) => `${p.nome} (${p.quantidade})`),
      minimo: minimo === null ? "todos" : String(minimo),
      ajustes: lista.ajustes.length,
    });
    return c.json(comTipo(atualizada, tipo));
  });
}
