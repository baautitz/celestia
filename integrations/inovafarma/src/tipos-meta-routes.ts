import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { formatarValor } from "./indicadores.js";
import { BUSCA_LISTA_SQL, conferirSql, type ResultadoBusca } from "./lista-produtos.js";
import { NomeDuplicadoError } from "./erros-de-store.js";
import { ator, ERP_INDISPONIVEL, META_DESATUALIZADA, recusaDeValidacao, SEM_CONEXAO, Version, versaoDesatualizada, type AuthContext, type ErpQuery } from "./metas-comum.js";
import type { MetaStore } from "./metas-store.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { PeriodsService } from "./pre-vencidos-routes.js";
import { parametrosBusca } from "./produtos-erp.js";
import { DadosTipoMeta, EXIBICAO_LABEL, EntradaLista, idValido, indicadorDoTipo, MIN_BUSCA_LISTA, TIPOS_ENTRADA, descreverEntrada, descreverPremio, ordenarEntradas, problemaDoTipo, type TipoMeta } from "./tipos-meta.js";
import { META_TARGET, TIPO_META_TARGET, TIPOS_META_ACTIONS, TIPOS_META_PLUGIN, type ValoresTipo } from "./tipos-meta-audit.js";
import type { TipoMetaStore } from "./tipos-meta-store.js";
import type { AuditService } from "./vinculo-audit.js";

export interface TiposMetaRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  store: TipoMetaStore;
  metas: MetaStore;
  periods: PeriodsService;
  audit: AuditService;
}

const NAO_ENCONTRADO = "Tipo de Meta não encontrado.";
const NOME_DUPLICADO = "Já existe um Tipo de Meta com este nome.";
const INDICADOR_FIXO = "O Indicador de um Tipo de Meta não muda depois de cadastrado: cadastre outro Tipo de Meta.";
const SEM_ALVO_PADRAO = "O Tipo de Meta não tem Alvo padrão para aplicar.";
const META_NAO_ENCONTRADA = "Meta não encontrada para este Tipo de Meta.";
const PERIODO_FECHADO = "O Período de Fechamento da Meta está fechado: a Meta não pode ser alterada.";
const PARTICIPANTE_FORA = "Um dos Colaboradores escolhidos não é Participante da Meta.";
const UNIDADE_FIXA = "A Lista deste Tipo de Meta já mede os Alvos das Metas cadastradas: a unidade não muda. Cadastre outro Tipo de Meta.";
const VERSAO_DESATUALIZADA = versaoDesatualizada("O Tipo de Meta foi alterado por outra pessoa. A lista foi recarregada.");

const Edicao = DadosTipoMeta.extend({ version: Version });
const Aplicacao = z.object({
  aplicacoes: z
    .array(z.object({ metaId: z.string().min(1), version: Version, codigos: z.array(z.number().int()).min(1, "Escolha ao menos um Participante.") }))
    .min(1, "Escolha ao menos um Período."),
});

const ID_INVALIDO = "Uma entrada da Lista tem um identificador inválido.";
const Conferencia = z.object({ entradas: z.array(EntradaLista.pick({ tipo: true, id: true }).refine(idValido, ID_INVALIDO)).max(500) });
const TipoBusca = z.enum(TIPOS_ENTRADA, { error: "Tipo de entrada da Lista inválido." });

const comPremio = (t: TipoMeta, temMetas = false) => ({ ...t, premio: descreverPremio(t), temMetas });

const valores = (t: TipoMeta): ValoresTipo => {
  const indicador = indicadorDoTipo(t);
  return {
    nome: t.nome,
    indicador: indicador.nome,
    exibicao: EXIBICAO_LABEL[t.exibicao],
    mostrarPremio: t.mostrarPremio,
    premio: descreverPremio(t),
    alvoPadrao: t.alvoPadrao === null ? null : formatarValor(indicador, t.alvoPadrao),
    lista: t.lista ? `em ${t.lista.unidade === "reais" ? "R$" : "unidades"}: ${ordenarEntradas(t.lista.entradas).map(descreverEntrada).join(", ")}` : null,
    ativo: t.ativo,
  };
};

export function registerTiposMetaRoutes({ routes, permissions, auth, erpClient, store, metas, periods, audit }: TiposMetaRoutesDeps): void {
  const manage = INOVAFARMA_PERMISSIONS.ref("tipos-meta:manage");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, manage.key);
  // A busca e a conferência das entradas também servem às colunas do Desempenho de Vendas e ao Filtro de produtos de Pedidos.
  const colunas = INOVAFARMA_PERMISSIONS.ref("colunas-desempenho:manage");
  // E ao "Filtro de produtos" do Lançamento de Pedidos, que quem só lança também precisa buscar.
  const lancamento = INOVAFARMA_PERMISSIONS.ref("pedidos-lancamento:ver");
  const podeBuscar = (c: AuthContext) => [colunas, lancamento].some((p) => permissions.has(c.get("user")?.permissions, p.key)) || pode(c);

  const registrar = (c: AuthContext, action: string, tipo: TipoMeta, anterior: TipoMeta | null = null) =>
    audit.record({
      plugin: TIPOS_META_PLUGIN,
      action,
      actor: ator(c),
      target: { type: TIPO_META_TARGET, id: tipo.id },
      attributes: { ...valores(tipo), anterior: anterior && valores(anterior) },
    });

  /** Lê e valida o corpo; devolve os dados ou a resposta de recusa. */
  const ler = async <S extends typeof DadosTipoMeta | typeof Edicao>(c: AuthContext, schema: S) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return { recusa: recusaDeValidacao(c, parsed.error) } as const;
    const problema = problemaDoTipo(parsed.data);
    if (problema) return { recusa: c.json({ error: problema }, 400) } as const;
    return { dados: parsed.data as z.infer<S> } as const;
  };

  /** Ids dos Tipos de Meta que já têm Meta em algum Período, aberto ou fechado. */
  const tiposComMetas = async () => new Set((await metas.listar((await periods.list()).map((p) => p.id))).map((m) => m.tipoId));

  routes.get("/metas/tipos", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const comMetas = await tiposComMetas();
    return c.json((await store.listar()).map((t) => comPremio(t, comMetas.has(t.id))));
  });

  routes.post("/metas/tipos", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const lido = await ler(c, DadosTipoMeta);
    if ("recusa" in lido) return lido.recusa;
    let criado: TipoMeta;
    try {
      criado = await store.criar(lido.dados);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
      throw err;
    }
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
    // Os Alvos gravados nas Metas estão na unidade da Lista: em outra unidade, seriam lidos errado.
    if (anterior.lista && dados.lista && anterior.lista.unidade !== dados.lista.unidade && (await tiposComMetas()).has(anterior.id))
      return c.json({ error: UNIDADE_FIXA }, 400);
    let atualizado: TipoMeta | null;
    try {
      atualizado = await store.atualizar(anterior.id, dados, version);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
      throw err;
    }
    if (!atualizado) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, TIPOS_META_ACTIONS.editar, atualizado, anterior);
    return c.json(comPremio(atualizado, (await tiposComMetas()).has(atualizado.id)));
  });

  // Busca de entradas da Lista de Produtos no ERP, só no tipo escolhido.
  routes.get("/tipos-meta/lista/busca", auth, async (c: AuthContext) => {
    if (!podeBuscar(c)) return c.json({ error: manage.deniedMessage }, 403);
    const parsedTipo = TipoBusca.safeParse(c.req.query("tipo"));
    if (!parsedTipo.success) return recusaDeValidacao(c, parsedTipo.error);
    const tipo = parsedTipo.data;
    const q = (c.req.query("q") ?? "").trim().slice(0, 100);
    if (q.length < MIN_BUSCA_LISTA[tipo]) return c.json([]);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const rows = await client.query<ResultadoBusca>(BUSCA_LISTA_SQL[tipo], parametrosBusca(q));
      return c.json(rows.map((r) => ({ tipo, id: String(r.id), nome: (r.nome || "").trim(), detalhe: r.detalhe ?? null })));
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });

  // Quais entradas da Lista ainda existem no ERP: as outras aparecem com o aviso "não encontrado no ERP".
  routes.post("/tipos-meta/lista/conferir", auth, async (c: AuthContext) => {
    if (!podeBuscar(c)) return c.json({ error: manage.deniedMessage }, 403);
    const parsed = Conferencia.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    const consulta = conferirSql(parsed.data.entradas);
    if (!consulta) return c.json({ ausentes: [] });
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const existem = new Set((await client.query<{ tipo: string; id: string | number }>(consulta.sql, consulta.params)).map((r) => `${r.tipo}:${String(r.id).toUpperCase()}`));
      return c.json({ ausentes: parsed.data.entradas.filter((e) => !existem.has(`${e.tipo}:${e.id.toUpperCase()}`)) });
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
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
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);

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

    const alvoTexto = formatarValor(indicadorDoTipo(tipo), tipo.alvoPadrao);
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
