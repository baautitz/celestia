import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { formatarValor, indicadorPorId } from "./indicadores.js";
import type { MetaStore } from "./metas-store.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { PeriodsService } from "./pre-vencidos-routes.js";
import { DadosTipoMeta, EXIBICAO_LABEL, descreverPremio, problemaDoTipo, type TipoMeta } from "./tipos-meta.js";
import { META_TARGET, TIPO_META_TARGET, TIPOS_META_ACTIONS, TIPOS_META_PLUGIN, type ValoresTipo } from "./tipos-meta-audit.js";
import type { TipoMetaStore } from "./tipos-meta-store.js";
import type { AuditService } from "./vinculo-audit.js";

export interface TiposMetaRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  store: TipoMetaStore;
  metas: MetaStore;
  periods: PeriodsService;
  audit: AuditService;
}

type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

const NAO_ENCONTRADO = "Tipo de Meta não encontrado.";
const NOME_DUPLICADO = "Já existe um Tipo de Meta com este nome.";
const INDICADOR_FIXO = "O Indicador de um Tipo de Meta não muda depois de cadastrado: cadastre outro Tipo de Meta.";
const SEM_ALVO_PADRAO = "O Tipo de Meta não tem Alvo padrão para aplicar.";
const META_NAO_ENCONTRADA = "Meta não encontrada para este Tipo de Meta.";
const PERIODO_FECHADO = "O Período de Fechamento da Meta está fechado: a Meta não pode ser alterada.";
const PARTICIPANTE_FORA = "Um dos Colaboradores escolhidos não é Participante da Meta.";
const VERSAO_DESATUALIZADA = { error: "O Tipo de Meta foi alterado por outra pessoa. A lista foi recarregada.", code: "versao_desatualizada" };
const META_DESATUALIZADA = { error: "A Meta foi alterada por outra pessoa. A janela foi recarregada.", code: "versao_desatualizada" };

const Edicao = DadosTipoMeta.extend({ version: z.number().int().min(1) });
const Aplicacao = z.object({
  aplicacoes: z
    .array(z.object({ metaId: z.string().min(1), version: z.number().int().min(1), codigos: z.array(z.number().int()).min(1, "Escolha ao menos um Participante.") }))
    .min(1, "Escolha ao menos um Período."),
});

const comPremio = (t: TipoMeta) => ({ ...t, premio: descreverPremio(t) });

const valores = (t: TipoMeta): ValoresTipo => {
  const indicador = indicadorPorId(t.indicador);
  return {
    nome: t.nome,
    indicador: indicador.nome,
    exibicao: EXIBICAO_LABEL[t.exibicao],
    mostrarPremio: t.mostrarPremio,
    premio: descreverPremio(t),
    alvoPadrao: t.alvoPadrao === null ? null : formatarValor(indicador, t.alvoPadrao),
    ativo: t.ativo,
  };
};

export function registerTiposMetaRoutes({ routes, permissions, auth, store, metas, periods, audit }: TiposMetaRoutesDeps): void {
  const manage = INOVAFARMA_PERMISSIONS.ref("tipos-meta:manage");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, manage.key);
  const ator = (c: AuthContext) => ({ id: c.get("user")?.sub ?? "", name: c.get("user")?.fullname ?? "" });

  const registrar = (c: AuthContext, action: string, tipo: TipoMeta, anterior: TipoMeta | null = null) =>
    audit.record({
      plugin: TIPOS_META_PLUGIN,
      action,
      actor: ator(c),
      target: { type: TIPO_META_TARGET, id: tipo.id },
      attributes: { ...valores(tipo), anterior: anterior && valores(anterior) },
    });

  const duplicado = async (nome: string, id?: string) =>
    (await store.listar()).some((t) => t.id !== id && t.nome.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"));

  /** Lê e valida o corpo; devolve os dados ou a resposta de recusa. */
  const ler = async <S extends typeof DadosTipoMeta | typeof Edicao>(c: AuthContext, schema: S) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return { recusa: c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400) } as const;
    const problema = problemaDoTipo(parsed.data);
    if (problema) return { recusa: c.json({ error: problema }, 400) } as const;
    return { dados: parsed.data as z.infer<S> } as const;
  };

  routes.get("/metas/tipos", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    return c.json((await store.listar()).map(comPremio));
  });

  routes.post("/metas/tipos", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const lido = await ler(c, DadosTipoMeta);
    if ("recusa" in lido) return lido.recusa;
    if (await duplicado(lido.dados.nome)) return c.json({ error: NOME_DUPLICADO }, 409);
    const criado = await store.criar(lido.dados);
    await registrar(c, TIPOS_META_ACTIONS.criar, criado);
    return c.json(comPremio(criado), 201);
  });

  routes.put("/metas/tipos/:id", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const anterior = await store.tipo(c.req.param("id") ?? "");
    if (!anterior) return c.json({ error: NAO_ENCONTRADO }, 404);
    const lido = await ler(c, Edicao);
    if ("recusa" in lido) return lido.recusa;
    const { version, ...dados } = lido.dados;
    if (dados.indicador !== anterior.indicador) return c.json({ error: INDICADOR_FIXO }, 400);
    if (await duplicado(dados.nome, anterior.id)) return c.json({ error: NOME_DUPLICADO }, 409);
    const atualizado = await store.atualizar(anterior.id, dados, version);
    if (!atualizado) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, TIPOS_META_ACTIONS.editar, atualizado, anterior);
    return c.json(comPremio(atualizado));
  });

  const periodosAbertos = async () => (await periods.list()).filter((p) => p.status === "open").sort((a, b) => b.startDate.localeCompare(a.startDate));

  // Janela "Alterar o Alvo padrão": as Metas deste Tipo nos Períodos abertos, com os Participantes e o Alvo de cada um.
  routes.get("/metas/tipos/:id/aplicacao", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const tipo = await store.tipo(c.req.param("id") ?? "");
    if (!tipo) return c.json({ error: NAO_ENCONTRADO }, 404);
    const abertos = await periodosAbertos();
    const doTipo = (await metas.listar(abertos.map((p) => p.id))).filter((m) => m.tipoId === tipo.id);
    return c.json({
      periodos: abertos.flatMap((p) => {
        const meta = doTipo.find((m) => m.periodoId === p.id);
        return meta ? [{ ...p, metaId: meta.id, version: meta.version, participantes: meta.participantes }] : [];
      }),
    });
  });

  routes.post("/metas/tipos/:id/aplicar-alvo-padrao", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const tipo = await store.tipo(c.req.param("id") ?? "");
    if (!tipo) return c.json({ error: NAO_ENCONTRADO }, 404);
    if (tipo.alvoPadrao === null) return c.json({ error: SEM_ALVO_PADRAO }, 400);
    const parsed = Aplicacao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);

    // Confere tudo antes de gravar, para não aplicar em parte por um erro previsível.
    const abertos = await periodosAbertos();
    const alvos = [];
    for (const a of parsed.data.aplicacoes) {
      const meta = await metas.meta(a.metaId);
      if (!meta || meta.tipoId !== tipo.id) return c.json({ error: META_NAO_ENCONTRADA }, 404);
      const periodo = abertos.find((p) => p.id === meta.periodoId);
      if (!periodo) return c.json({ error: PERIODO_FECHADO }, 409);
      if (meta.version !== a.version) return c.json(META_DESATUALIZADA, 409);
      if (!a.codigos.every((codigo) => meta.participantes.some((p) => p.codigoColaborador === codigo))) return c.json({ error: PARTICIPANTE_FORA }, 400);
      alvos.push({ ...a, meta, periodo });
    }

    // O Período pode ter fechado durante a conferência: confere de novo logo antes de gravar.
    const abertosAgora = new Set((await periodosAbertos()).map((p) => p.id));
    if (!alvos.every(({ periodo }) => abertosAgora.has(periodo.id))) return c.json({ error: PERIODO_FECHADO }, 409);
    const atualizadas = await metas.definirAlvos(
      alvos.map(({ meta, codigos, version }) => ({ id: meta.id, codigos, expectedVersion: version })),
      tipo.alvoPadrao,
    );
    if (!atualizadas) return c.json(META_DESATUALIZADA, 409);

    const alvoTexto = formatarValor(indicadorPorId(tipo.indicador), tipo.alvoPadrao);
    for (const { meta, periodo, codigos } of alvos) {
      await audit.record({
        plugin: TIPOS_META_PLUGIN,
        action: TIPOS_META_ACTIONS.aplicarAlvoPadrao,
        actor: ator(c),
        target: { type: META_TARGET, id: meta.id },
        attributes: { tipo: tipo.nome, periodo: periodo.name, alvo: alvoTexto, participantes: meta.participantes.filter((p) => codigos.includes(p.codigoColaborador)).map((p) => p.nome) },
      });
    }
    return c.json({ metas: atualizadas });
  });
}
