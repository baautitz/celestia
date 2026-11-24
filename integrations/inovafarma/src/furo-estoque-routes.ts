import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import type { UsersService } from "./colaboradores-routes.js";
import { NomeDuplicadoError } from "./erros-de-store.js";
import { FURO_ESTOQUE_ACTIONS, FURO_ESTOQUE_PLUGIN, JUSTIFICATIVA_TARGET, MOTIVO_TARGET, type AtributosJustificativa } from "./furo-estoque-audit.js";
import type { FuroEstoqueStore, JustificativaAjuste, MotivoAjuste } from "./furo-estoque-store.js";
import { ator, CodigoEmTexto, ERP_INDISPONIVEL, PERIODO_NAO_ENCONTRADO, periodoAindaAberto, recusaDeValidacao, SEM_CONEXAO, Version, versaoDaQuery, versaoDesatualizada, vinculoDoUsuario, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { lojasDoErp } from "./pre-vencidos-comum.js";
import type { PeriodoResumo, PeriodsService } from "./pre-vencidos-routes.js";
import type { AuditService } from "./vinculo-audit.js";
import type { VinculoStore } from "./vinculo-store.js";

export interface FuroEstoqueRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  store: FuroEstoqueStore;
  vinculos: VinculoStore;
  users: UsersService;
  periods: PeriodsService;
  audit: AuditService;
}

const PERIODO_FECHADO = "O Período de Fechamento está fechado: não é possível justificar, alterar nem excluir.";
const AJUSTE_NAO_ENCONTRADO = "Ajuste de Estoque não encontrado neste Período de Fechamento.";
const NAO_ENCONTRADA = "Justificativa não encontrada.";
const LOJA_FORA = "O Ajuste de Estoque é de uma Loja que você não gerencia.";
const MOTIVO_INVALIDO = "Selecione um Motivo ativo.";
const JA_JUSTIFICADO = { error: "Este Ajuste de Estoque já foi justificado por outra pessoa. A lista foi recarregada.", code: "ja_justificado" };
const VERSAO_DESATUALIZADA = versaoDesatualizada("A Justificativa foi alterada por outra pessoa. A lista foi recarregada.");
const MOTIVO_DESATUALIZADO = versaoDesatualizada("O Motivo foi alterado por outra pessoa. A lista foi recarregada.");
const MOTIVO_DUPLICADO = "Já existe um Motivo com este nome.";

const Observacao = z
  .string()
  .trim()
  .max(500, "A observação deve ter no máximo 500 caracteres.")
  .nullish()
  .transform((v) => v || null);
const MotivoId = z.string().min(1, MOTIVO_INVALIDO);
const Nova = z.object({ periodoId: z.string().min(1), codigoMovimento: z.number().int().min(1), motivoId: MotivoId, observacao: Observacao });
const Edicao = z.object({ motivoId: MotivoId, observacao: Observacao, version: Version });
const NomeMotivo = z.string().trim().min(1, "Informe o nome do Motivo.").max(80, "O nome do Motivo deve ter no máximo 80 caracteres.");
const NovoMotivo = z.object({ nome: NomeMotivo });
const EdicaoMotivo = z.object({ nome: NomeMotivo, ativo: z.boolean(), version: Version });
const FiltroAjustes = z.object({ codigoLoja: CodigoEmTexto.optional() });

/** Grupo "AJUSTE DE ESTOQUE" em `Estoque_Movimentacao_Grupo`. */
const GRUPO_AJUSTE = 1;

/**
 * Itens dos Ajustes de Estoque. O sinal vem de `Operacao` no cabeçalho (`+` entrada, `-` saída);
 * a data, de `Lancamento`. O código do produto no ERP fica fora: a API só fala em `produtoId`.
 */
const ajustesSql = (filtro: string) => `
  SELECT m.CodigoMovimento AS codigoMovimento, m.CodigoEmpresa AS codigoLoja, l.DataLancamento AS data, m.Operacao AS operacao,
         CONVERT(varchar(36), p.rowguid) AS produtoId, p.CodigoProduto AS codigoProduto, LTRIM(RTRIM(p.NomeProduto)) AS nome, p.CodigoBarra AS codigoBarra,
         CAST(CASE m.Operacao WHEN '-' THEN -mp.Quantidade ELSE mp.Quantidade END AS float) AS quantidade,
         CAST(mp.PrecoCusto AS float) AS precoCusto,
         CAST(CASE m.Operacao WHEN '-' THEN -mp.TotalCusto ELSE mp.TotalCusto END AS float) AS totalCusto,
         LTRIM(RTRIM(cf.Nome)) AS colaborador, LTRIM(RTRIM(u.Nome)) AS usuario, m.Observacao AS observacao
  FROM Estoque_Movimentacao m
  JOIN Lancamento l ON l.CodigoLancamento = m.CodigoLancamento
  JOIN Estoque_Movimentacao_Produto mp ON mp.CodigoMovimento = m.CodigoMovimento
  JOIN Produto p ON p.CodigoProduto = mp.CodigoProduto
  LEFT JOIN Funcionario f ON f.CodigoFuncionario = m.CodigoFuncionario
  LEFT JOIN Cadastro cf ON cf.CodigoCadastro = f.CodigoCadastro
  LEFT JOIN Usuario u ON u.CodigoUsuario = l.CodigoUsuario
  WHERE m.CodigoGrupo = ${GRUPO_AJUSTE} AND m.Eliminado = 0
    AND l.DataLancamento >= @dataInicio AND l.DataLancamento <= @dataFim
    ${filtro}
  ORDER BY l.DataLancamento DESC, m.CodigoMovimento, p.NomeProduto
`;

interface LinhaAjuste {
  codigoMovimento: number;
  codigoLoja: number;
  data: Date | string;
  operacao: string;
  produtoId: string;
  codigoProduto: number | null;
  nome: string | null;
  codigoBarra: string | null;
  quantidade: number | null;
  precoCusto: number | null;
  totalCusto: number | null;
  colaborador: string | null;
  usuario: string | null;
  observacao: string | null;
}

export interface ItemAjuste {
  produtoId: string;
  codigoProduto: number | null;
  nome: string;
  codigoBarra: string | null;
  quantidade: number;
  precoCusto: number;
  totalCusto: number;
}

export interface AjusteEstoque {
  codigoMovimento: number;
  codigoLoja: number;
  /** Data e hora local do ERP, `AAAA-MM-DD HH:mm`. */
  data: string;
  operacao: "+" | "-";
  colaborador: string;
  usuario: string;
  observacaoErp: string;
  /** Quantidade e custo com sinal: negativos nas saídas. */
  quantidade: number;
  totalCusto: number;
  itens: ItemAjuste[];
}

/** O ERP grava hora local sem fuso; o driver a devolve como se fosse UTC. */
const dataLocal = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 16).replace("T", " ");

/** Agrupa os itens por Ajuste de Estoque, na ordem em que o ERP devolve. */
export function agruparAjustes(linhas: LinhaAjuste[]): AjusteEstoque[] {
  const ajustes = new Map<number, AjusteEstoque>();
  for (const r of linhas) {
    const codigo = Number(r.codigoMovimento);
    let ajuste = ajustes.get(codigo);
    if (!ajuste) {
      ajuste = {
        codigoMovimento: codigo,
        codigoLoja: Number(r.codigoLoja),
        data: dataLocal(r.data),
        operacao: r.operacao?.trim() === "-" ? "-" : "+",
        colaborador: r.colaborador ?? "",
        usuario: r.usuario ?? "",
        observacaoErp: (r.observacao ?? "").trim(),
        quantidade: 0,
        totalCusto: 0,
        itens: [],
      };
      ajustes.set(codigo, ajuste);
    }
    const item = { produtoId: r.produtoId, codigoProduto: r.codigoProduto == null ? null : Number(r.codigoProduto), nome: r.nome ?? "", codigoBarra: r.codigoBarra, quantidade: Number(r.quantidade) || 0, precoCusto: Number(r.precoCusto) || 0, totalCusto: Number(r.totalCusto) || 0 };
    ajuste.itens.push(item);
    ajuste.quantidade += item.quantidade;
    ajuste.totalCusto += item.totalCusto;
  }
  return [...ajustes.values()].map((a) => ({ ...a, totalCusto: Math.round(a.totalCusto * 100) / 100 }));
}

export function registerFuroEstoqueRoutes({ routes, permissions, auth, erpClient, store, vinculos, users, periods, audit }: FuroEstoqueRoutesDeps): void {
  const porLoja = INOVAFARMA_PERMISSIONS.ref("furo-estoque-loja:manage");
  const geral = INOVAFARMA_PERMISSIONS.ref("furo-estoque-geral:manage");
  const pode = (c: AuthContext, ref: { key: string }) => permissions.has(c.get("user")?.permissions, ref.key);
  const podeGerenciar = (c: AuthContext) => pode(c, geral) || pode(c, porLoja);

  /** Lojas que o Usuário gerencia: todas (undefined) com a Permission geral, senão as do seu Vínculo. */
  const lojasGerenciadas = async (c: AuthContext): Promise<number[] | undefined> => {
    if (pode(c, geral)) return undefined;
    const sub = c.get("user")?.sub;
    return (sub ? await vinculoDoUsuario(vinculos, sub) : null)?.lojas ?? [];
  };
  const gerencia = (lojas: number[] | undefined, codigoLoja: number) => lojas === undefined || lojas.includes(codigoLoja);

  /** Ajustes de Estoque do Closing Period nas Lojas pedidas; `filtro` extra é sempre SQL fixo com parâmetros. */
  const ajustesDoErp = async (periodo: PeriodoResumo, lojas: number[] | undefined, extra: { sql: string; params: Record<string, unknown> } = { sql: "", params: {} }) => {
    const client = erpClient();
    if (!client) return { erro: SEM_CONEXAO } as const;
    const params: Record<string, unknown> = { dataInicio: `${periodo.startDate} 00:00:00`, dataFim: `${periodo.endDate} 23:59:59`, ...extra.params };
    let filtro = extra.sql;
    if (lojas !== undefined) {
      filtro += ` AND m.CodigoEmpresa IN (${lojas.map((_, i) => `@loja${i}`).join(", ")})`;
      lojas.forEach((codigo, i) => {
        params[`loja${i}`] = codigo;
      });
    }
    try {
      return { ajustes: agruparAjustes(await client.query<LinhaAjuste>(ajustesSql(filtro), params)) } as const;
    } catch {
      return { erro: ERP_INDISPONIVEL } as const;
    }
  };

  const nomeMotivo = (motivos: MotivoAjuste[], id: string) => motivos.find((m) => m.id === id)?.nome ?? "";

  const registrar = (c: AuthContext, action: string, alvo: JustificativaAjuste, periodo: PeriodoResumo, motivos: MotivoAjuste[], anterior: AtributosJustificativa["anterior"] = null) => {
    const atributos: AtributosJustificativa = {
      periodo: periodo.name,
      codigoMovimento: alvo.codigoMovimento,
      codigoLoja: alvo.codigoLoja,
      motivo: nomeMotivo(motivos, alvo.motivoId),
      observacao: alvo.observacao,
      anterior,
    };
    return audit.record({
      plugin: FURO_ESTOQUE_PLUGIN,
      action,
      actor: ator(c),
      target: { type: JUSTIFICATIVA_TARGET, id: alvo.id },
      attributes: atributos,
    });
  };

  const registrarMotivo = (c: AuthContext, action: string, alvo: MotivoAjuste, anterior: MotivoAjuste | null = null) =>
    audit.record({
      plugin: FURO_ESTOQUE_PLUGIN,
      action,
      actor: ator(c),
      target: { type: MOTIVO_TARGET, id: alvo.id },
      attributes: { nome: alvo.nome, ativo: alvo.ativo, anterior: anterior && { nome: anterior.nome, ativo: anterior.ativo } },
    });

  const publicaJustificativa = ({ criadoPor: _criadoPor, ...resto }: JustificativaAjuste) => resto;

  routes.get("/furo-estoque/contexto", auth, async (c: AuthContext) => {
    if (!podeGerenciar(c)) return c.json({ error: porLoja.deniedMessage }, 403);
    const lojasErp = await lojasDoErp(erpClient());
    const lojas = await lojasGerenciadas(c);
    return c.json({
      todasAsLojas: lojas === undefined,
      podeGerenciarMotivos: pode(c, geral),
      periodos: (await periods.list()).sort((a, b) => b.startDate.localeCompare(a.startDate)),
      lojas: lojasErp,
      lojasGerenciadas: lojas === undefined ? lojasErp : lojas.map((codigo) => ({ codigo, nome: lojasErp.find((l) => l.codigo === codigo)?.nome ?? "" })),
      motivos: await store.listarMotivos(),
    });
  });

  routes.get("/furo-estoque/ajustes", auth, async (c: AuthContext) => {
    if (!podeGerenciar(c)) return c.json({ error: porLoja.deniedMessage }, 403);
    const periodo = (await periods.list()).find((p) => p.id === c.req.query("periodoId"));
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    const consulta = FiltroAjustes.safeParse({ codigoLoja: c.req.query("codigoLoja") || undefined });
    if (!consulta.success) return recusaDeValidacao(c, consulta.error);
    const { codigoLoja } = consulta.data;
    const lojas = await lojasGerenciadas(c);
    const filtro = codigoLoja === undefined ? lojas : gerencia(lojas, codigoLoja) ? [codigoLoja] : [];
    if (filtro?.length === 0) return c.json([]);

    const resultado = await ajustesDoErp(periodo, filtro);
    if ("erro" in resultado) return c.json({ error: resultado.erro }, 503);
    const [justificativas, motivos, usuarios] = await Promise.all([store.listarJustificativas(periodo.id), store.listarMotivos(), users.list()]);
    const porMovimento = new Map(justificativas.map((j) => [j.codigoMovimento, j]));
    const nomes = new Map(usuarios.map((u) => [u.id, u.fullname]));
    return c.json(
      resultado.ajustes.map((a) => {
        const j = porMovimento.get(a.codigoMovimento);
        return {
          ...a,
          justificativa: j
            ? { ...publicaJustificativa(j), motivo: nomeMotivo(motivos, j.motivoId), justificadoPor: nomes.get(j.criadoPor) ?? "" }
            : null,
        };
      }),
    );
  });

  routes.post("/furo-estoque/justificativas", auth, async (c: AuthContext) => {
    if (!podeGerenciar(c)) return c.json({ error: porLoja.deniedMessage }, 403);
    const parsed = Nova.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    const { periodoId, codigoMovimento, motivoId, observacao } = parsed.data;

    const periodo = (await periods.list()).find((p) => p.id === periodoId);
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    if (periodo.status !== "open") return c.json({ error: PERIODO_FECHADO }, 409);
    const motivos = await store.listarMotivos();
    if (!motivos.some((m) => m.id === motivoId && m.ativo)) return c.json({ error: MOTIVO_INVALIDO }, 400);

    const resultado = await ajustesDoErp(periodo, undefined, { sql: "AND m.CodigoMovimento = @codigoMovimento", params: { codigoMovimento } });
    if ("erro" in resultado) return c.json({ error: resultado.erro }, 503);
    const ajuste = resultado.ajustes[0];
    if (!ajuste) return c.json({ error: AJUSTE_NAO_ENCONTRADO }, 404);
    if (!gerencia(await lojasGerenciadas(c), ajuste.codigoLoja)) return c.json({ error: LOJA_FORA }, 403);
    // O Período pode ter fechado durante as conferências acima (inclusive a consulta ao ERP): confere de novo antes de gravar.
    if (!(await periodoAindaAberto(periods, periodoId))) return c.json({ error: PERIODO_FECHADO }, 409);

    const criada = await store.justificar({ periodoId, codigoMovimento, codigoLoja: ajuste.codigoLoja, motivoId, observacao, criadoPor: c.get("user")?.sub ?? "" });
    if (!criada) return c.json(JA_JUSTIFICADO, 409);
    await registrar(c, FURO_ESTOQUE_ACTIONS.justificar, criada, periodo, motivos);
    return c.json(publicaJustificativa(criada), 201);
  });

  /** Justificativa de uma Loja que o Usuário gerencia, em Closing Period aberto; senão devolve a resposta de recusa. */
  const gerenciavelEmPeriodoAberto = async (c: AuthContext) => {
    if (!podeGerenciar(c)) return { recusa: c.json({ error: porLoja.deniedMessage }, 403) } as const;
    const justificativa = await store.justificativa(c.req.param("id") ?? "");
    if (!justificativa || !gerencia(await lojasGerenciadas(c), justificativa.codigoLoja)) return { recusa: c.json({ error: NAO_ENCONTRADA }, 404) } as const;
    const periodo = (await periods.list()).find((p) => p.id === justificativa.periodoId);
    if (!periodo) return { recusa: c.json({ error: PERIODO_NAO_ENCONTRADO }, 404) } as const;
    if (periodo.status !== "open") return { recusa: c.json({ error: PERIODO_FECHADO }, 409) } as const;
    return { justificativa, periodo } as const;
  };

  routes.put("/furo-estoque/justificativas/:id", auth, async (c: AuthContext) => {
    const alvo = await gerenciavelEmPeriodoAberto(c);
    if ("recusa" in alvo) return alvo.recusa;
    const parsed = Edicao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    const { motivoId, observacao, version } = parsed.data;
    const motivos = await store.listarMotivos();
    // Um Motivo desativado pode continuar na Justificativa que já o usa, mas não ser escolhido de novo.
    if (!motivos.some((m) => m.id === motivoId && (m.ativo || m.id === alvo.justificativa.motivoId))) return c.json({ error: MOTIVO_INVALIDO }, 400);
    if (!(await periodoAindaAberto(periods, alvo.periodo.id))) return c.json({ error: PERIODO_FECHADO }, 409);
    const atualizada = await store.atualizarJustificativa(alvo.justificativa.id, { motivoId, observacao }, version);
    if (!atualizada) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, FURO_ESTOQUE_ACTIONS.editar, atualizada, alvo.periodo, motivos, {
      motivo: nomeMotivo(motivos, alvo.justificativa.motivoId),
      observacao: alvo.justificativa.observacao,
    });
    return c.json(publicaJustificativa(atualizada));
  });

  routes.delete("/furo-estoque/justificativas/:id", auth, async (c: AuthContext) => {
    const alvo = await gerenciavelEmPeriodoAberto(c);
    if ("recusa" in alvo) return alvo.recusa;
    const lida = versaoDaQuery(c);
    if ("recusa" in lida) return lida.recusa;
    if (!(await periodoAindaAberto(periods, alvo.periodo.id))) return c.json({ error: PERIODO_FECHADO }, 409);
    if (!(await store.excluirJustificativa(alvo.justificativa.id, lida.version))) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, FURO_ESTOQUE_ACTIONS.excluir, alvo.justificativa, alvo.periodo, await store.listarMotivos());
    return c.json({ success: true });
  });

  routes.post("/furo-estoque/motivos", auth, async (c: AuthContext) => {
    if (!pode(c, geral)) return c.json({ error: geral.deniedMessage }, 403);
    const parsed = NovoMotivo.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    let criado: MotivoAjuste;
    try {
      criado = await store.criarMotivo(parsed.data.nome);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: MOTIVO_DUPLICADO }, 409);
      throw err;
    }
    await registrarMotivo(c, FURO_ESTOQUE_ACTIONS.criarMotivo, criado);
    return c.json(criado, 201);
  });

  routes.put("/furo-estoque/motivos/:id", auth, async (c: AuthContext) => {
    if (!pode(c, geral)) return c.json({ error: geral.deniedMessage }, 403);
    const parsed = EdicaoMotivo.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    const id = c.req.param("id") ?? "";
    const anterior = (await store.listarMotivos()).find((m) => m.id === id);
    if (!anterior) return c.json({ error: "Motivo não encontrado." }, 404);
    const { nome, ativo, version } = parsed.data;
    let atualizado: MotivoAjuste | null;
    try {
      atualizado = await store.atualizarMotivo(id, { nome, ativo }, version);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: MOTIVO_DUPLICADO }, 409);
      throw err;
    }
    if (!atualizado) return c.json(MOTIVO_DESATUALIZADO, 409);
    await registrarMotivo(c, FURO_ESTOQUE_ACTIONS.editarMotivo, atualizado, anterior);
    return c.json(atualizado);
  });
}
