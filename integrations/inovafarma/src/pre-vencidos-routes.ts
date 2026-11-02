import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { COLABORADORES_SQL, LOJAS_SQL } from "./colaboradores-routes.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { conferir } from "./pre-vencidos-conferencia.js";
import { PRE_VENCIDO_ACTIONS, PRE_VENCIDO_PLUGIN, PRE_VENCIDO_TARGET, type AtributosPreVencido } from "./pre-vencidos-audit.js";
import type { LancamentoPreVencido, PreVencidoStore } from "./pre-vencidos-store.js";
import type { AuditService } from "./vinculo-audit.js";
import { vinculoDesfeito, type VinculoStore } from "./vinculo-store.js";

/** Forma do serviço `periods` do Module `closing_period`; o Plugin não importa `@platform/server` (ADR 0002). */
export interface PeriodoResumo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
}
export interface PeriodsService {
  list(): Promise<PeriodoResumo[]>;
}

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

export interface PreVencidosRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  store: PreVencidoStore;
  vinculos: VinculoStore;
  periods: PeriodsService;
  audit: AuditService;
}

type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

const SEM_CONEXAO = "Conexão com ERP InovaFarma não configurada ou inativa.";
const ERP_INDISPONIVEL = "ERP InovaFarma indisponível. Tente novamente em instantes.";
const SEM_VINCULO = "Seu Usuário não está vinculado a um Colaborador. Peça o vínculo a quem administra os Colaboradores.";
const VERSAO_DESATUALIZADA = { error: "O lançamento foi alterado por outra pessoa. A lista foi recarregada.", code: "versao_desatualizada" };
const PERIODO_NAO_ENCONTRADO = "Período de Fechamento não encontrado.";
const PERIODO_FECHADO = "O Período de Fechamento está fechado: não é possível lançar, alterar nem excluir.";
export const MIN_BUSCA = 3;
const LIMITE_BUSCA = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Validade = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe a validade como mês e ano (AAAA-MM).");
const Quantidade = z.number().int().min(1).max(1_000_000);
const Novo = z.object({ periodoId: z.string().min(1), codigoLoja: z.number().int().min(1), produtoId: z.string().regex(UUID), quantidade: Quantidade, validade: Validade });
const Edicao = z.object({ quantidade: Quantidade, validade: Validade, version: z.number().int().min(1) });

// O código do produto no ERP é bloqueado para o usuário: a API só fala em `produtoId` (Produto.rowguid).
const PRODUTO_SQL = `
  SELECT p.CodigoProduto AS codigoProduto, CONVERT(varchar(36), p.rowguid) AS produtoId,
         LTRIM(RTRIM(p.NomeProduto)) AS nome, p.CodigoBarra AS codigoBarra
  FROM Produto p
  WHERE p.Eliminado = 0 AND CONVERT(varchar(36), p.rowguid) = @produtoId
`;

export const BUSCA_SQL = `
  SELECT TOP ${LIMITE_BUSCA} CONVERT(varchar(36), p.rowguid) AS produtoId, LTRIM(RTRIM(p.NomeProduto)) AS nome,
         CASE WHEN p.CodigoBarra = @busca OR EXISTS (SELECT 1 FROM Produto_CodigoBarra b WHERE b.CodigoProduto = p.CodigoProduto AND b.CodigoBarra = @busca)
              THEN @busca ELSE p.CodigoBarra END AS codigoBarra
  FROM Produto p
  WHERE p.Eliminado = 0
    AND (p.CodigoBarra = @busca
         OR EXISTS (SELECT 1 FROM Produto_CodigoBarra b WHERE b.CodigoProduto = p.CodigoProduto AND b.CodigoBarra = @busca)
         OR p.NomeProduto LIKE @buscaLike ESCAPE '\\')
  ORDER BY p.NomeProduto
`;

type LinhaProduto = { codigoProduto: number; produtoId: string; nome: string | null; codigoBarra: string | null };
export type LinhaBusca = { produtoId: string; nome: string | null; codigoBarra: string | null };
export type LinhaVenda = { codigoColaborador: number; produtoId: string; quantidade: number | null };

export const LOTE_PRODUTOS = 1000;

export const vendasSql = (produtos: number) => `
  SELECT vp.CodigoFuncionario AS codigoColaborador, CONVERT(varchar(36), p.rowguid) AS produtoId, CAST(SUM(vp.Quantidade) AS float) AS quantidade
  FROM Venda v
  JOIN Venda_Produto vp ON vp.CodigoVenda = v.CodigoVenda
  JOIN Produto p ON p.CodigoProduto = vp.CodigoProduto
  WHERE v.Eliminado = 0
    AND v.CodigoAbertura IS NOT NULL
    AND ISNULL(p.CodigoGrupoInventario, 0) <> 3
    AND v.DataVenda >= @dataInicio
    AND v.DataVenda <= @dataFim
    AND vp.CodigoProduto IN (${Array.from({ length: produtos }, (_, i) => `@p${i}`).join(", ")})
  GROUP BY vp.CodigoFuncionario, p.rowguid
`;

/** O que a API devolve: nunca o código do produto no ERP. */
const publico = ({ codigoProduto: _codigoProduto, ...resto }: LancamentoPreVencido) => resto;

export function registerPreVencidosRoutes({ routes, permissions, auth, erpClient, store, vinculos, periods, audit }: PreVencidosRoutesDeps): void {
  const lancar = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-lancamento:manage");
  const conferirPerm = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-conferencia:view");
  const pode = (c: AuthContext, ref: { key: string }) => permissions.has(c.get("user")?.permissions, ref.key);

  const vinculoDe = async (c: AuthContext) => {
    const sub = c.get("user")?.sub;
    const vinculo = sub ? ((await vinculos.list()).find((v) => v.usuarioId === sub && !vinculoDesfeito(v)) ?? null) : null;
    return vinculo?.usuarioId ? vinculo : null;
  };

  const lojasDoErp = async (client: ErpQuery | undefined) => {
    if (!client) return [];
    try {
      const rows = await client.query<{ codigoEmpresa: number; nome: string | null }>(LOJAS_SQL);
      return rows.map((r) => ({ codigo: Number(r.codigoEmpresa), nome: (r.nome || "").trim() }));
    } catch {
      return [];
    }
  };

  const registrar = (c: AuthContext, action: string, alvo: LancamentoPreVencido, periodo: PeriodoResumo | undefined, anterior: AtributosPreVencido["anterior"] = null) => {
    const user = c.get("user");
    const atributos: AtributosPreVencido = {
      periodo: periodo?.name ?? alvo.periodoId,
      codigoColaborador: alvo.codigoColaborador,
      nomeColaborador: alvo.nomeColaborador,
      nomeProduto: alvo.nomeProduto,
      codigoBarra: alvo.codigoBarra,
      codigoLoja: alvo.codigoLoja,
      quantidade: alvo.quantidade,
      validade: alvo.validade,
      anterior,
    };
    return audit.record({
      plugin: PRE_VENCIDO_PLUGIN,
      action,
      actor: { id: user?.sub ?? "", name: user?.fullname ?? "" },
      target: { type: PRE_VENCIDO_TARGET, id: alvo.id },
      attributes: atributos,
    });
  };

  const periodoAberto = async (periodoId: string) => (await periods.list()).find((p) => p.id === periodoId && p.status === "open");

  // O que a tela precisa para abrir: Closing Periods, Lojas e as abas que a Permission libera.
  routes.get("/pre-vencidos/contexto", auth, async (c: AuthContext) => {
    const podeLancar = pode(c, lancar);
    const podeConferir = pode(c, conferirPerm);
    if (!podeLancar && !podeConferir) return c.json({ error: lancar.deniedMessage }, 403);

    const todos = (await periods.list()).sort((a, b) => b.startDate.localeCompare(a.startDate));
    const client = erpClient();
    const vinculo = podeLancar ? await vinculoDe(c) : null;
    const lojasErp = podeLancar || podeConferir ? await lojasDoErp(client) : [];
    const nomeLoja = (codigo: number) => lojasErp.find((l) => l.codigo === codigo)?.nome ?? "";

    return c.json({
      podeLancar,
      podeConferir,
      vinculado: vinculo !== null,
      // Todos os períodos: o Colaborador consulta os fechados, mas só lança, edita e exclui nos abertos.
      periodos: todos,
      lojas: (vinculo?.lojas ?? []).map((codigo) => ({ codigo, nome: nomeLoja(codigo) })),
      ...(podeConferir ? { periodosConferencia: todos, lojasConferencia: lojasErp } : {}),
    });
  });

  routes.get("/pre-vencidos/produtos", auth, async (c: AuthContext) => {
    if (!pode(c, lancar)) return c.json({ error: lancar.deniedMessage }, 403);
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < MIN_BUSCA) return c.json([]);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const rows = await client.query<LinhaBusca>(BUSCA_SQL, { busca: q, buscaLike: `%${q.replace(/[\\%_[]/g, "\\$&")}%` });
      return c.json(rows.map((r) => ({ id: r.produtoId, nome: (r.nome || "").trim(), codigoBarra: r.codigoBarra })));
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });

  routes.get("/pre-vencidos/lancamentos", auth, async (c: AuthContext) => {
    if (!pode(c, lancar)) return c.json({ error: lancar.deniedMessage }, 403);
    const periodoId = c.req.query("periodoId");
    if (!periodoId) return c.json({ error: "Parâmetro 'periodoId' é obrigatório." }, 400);
    const vinculo = await vinculoDe(c);
    if (!vinculo) return c.json([]);
    return c.json((await store.listar({ periodoId, codigoColaborador: vinculo.codigoColaborador })).map(publico));
  });

  routes.post("/pre-vencidos/lancamentos", auth, async (c: AuthContext) => {
    if (!pode(c, lancar)) return c.json({ error: lancar.deniedMessage }, 403);
    const parsed = Novo.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { periodoId, codigoLoja, produtoId, quantidade, validade } = parsed.data;

    const vinculo = await vinculoDe(c);
    if (!vinculo) return c.json({ error: SEM_VINCULO }, 403);
    if (!vinculo.lojas.includes(codigoLoja)) return c.json({ error: "A Loja informada não está vinculada ao seu Colaborador." }, 403);

    const periodo = (await periods.list()).find((p) => p.id === periodoId);
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    if (periodo.status !== "open") return c.json({ error: PERIODO_FECHADO }, 409);

    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    let produto: LinhaProduto | undefined;
    let colaborador: { nome: string | null } | undefined;
    try {
      [produto] = await client.query<LinhaProduto>(PRODUTO_SQL, { produtoId });
      [colaborador] = await client.query<{ nome: string | null }>(`${COLABORADORES_SQL} AND f.CodigoFuncionario = @codigo`, { codigo: vinculo.codigoColaborador });
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
    if (!produto) return c.json({ error: "Produto não encontrado no ERP." }, 404);

    const criado = await store.criar({
      periodoId,
      codigoColaborador: vinculo.codigoColaborador,
      nomeColaborador: (colaborador?.nome ?? "").trim() || `Colaborador cód. ${vinculo.codigoColaborador}`,
      usuarioId: vinculo.usuarioId!,
      codigoLoja,
      produtoId: produto.produtoId,
      codigoProduto: Number(produto.codigoProduto),
      nomeProduto: (produto.nome || "").trim(),
      codigoBarra: produto.codigoBarra,
      quantidade,
      validade,
    });
    await registrar(c, PRE_VENCIDO_ACTIONS.criar, criado, periodo);
    return c.json(publico(criado), 201);
  });

  /** Lançamento do próprio Usuário em Closing Period aberto; senão devolve a resposta de recusa. */
  const doProprioEmPeriodoAberto = async (c: AuthContext) => {
    if (!pode(c, lancar)) return { recusa: c.json({ error: lancar.deniedMessage }, 403) } as const;
    const lancamento = await store.get(c.req.param("id") ?? "");
    if (!lancamento || lancamento.usuarioId !== c.get("user")?.sub) return { recusa: c.json({ error: "Lançamento não encontrado." }, 404) } as const;
    const periodo = await periodoAberto(lancamento.periodoId);
    if (!periodo) return { recusa: c.json({ error: PERIODO_FECHADO }, 409) } as const;
    return { lancamento, periodo } as const;
  };

  routes.put("/pre-vencidos/lancamentos/:id", auth, async (c: AuthContext) => {
    const alvo = await doProprioEmPeriodoAberto(c);
    if ("recusa" in alvo) return alvo.recusa;
    const parsed = Edicao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { version, ...valores } = parsed.data;
    const atualizado = await store.atualizar(alvo.lancamento.id, valores, version);
    if (!atualizado) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, PRE_VENCIDO_ACTIONS.editar, atualizado, alvo.periodo, { quantidade: alvo.lancamento.quantidade, validade: alvo.lancamento.validade });
    return c.json(publico(atualizado));
  });

  routes.delete("/pre-vencidos/lancamentos/:id", auth, async (c: AuthContext) => {
    const alvo = await doProprioEmPeriodoAberto(c);
    if ("recusa" in alvo) return alvo.recusa;
    const version = Number(c.req.query("version"));
    if (!Number.isInteger(version) || version < 1) return c.json({ error: "Parâmetro 'version' é obrigatório." }, 400);
    if (!(await store.excluir(alvo.lancamento.id, version))) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, PRE_VENCIDO_ACTIONS.excluir, alvo.lancamento, alvo.periodo);
    return c.json({ success: true });
  });

  routes.get("/pre-vencidos/conferencia", auth, async (c: AuthContext) => {
    if (!pode(c, conferirPerm)) return c.json({ error: conferirPerm.deniedMessage }, 403);
    const periodoId = c.req.query("periodoId");
    if (!periodoId) return c.json({ error: "Parâmetro 'periodoId' é obrigatório." }, 400);
    const periodo = (await periods.list()).find((p) => p.id === periodoId);
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    const loja = c.req.query("codigoLoja");
    if (loja !== undefined && loja !== "" && !Number.isInteger(Number(loja))) {
      return c.json({ error: "O filtro 'codigoLoja' deve ser um número inteiro." }, 400);
    }

    const lancamentos = await store.listar({ periodoId, codigoLoja: loja === undefined || loja === "" ? undefined : Number(loja) });
    if (lancamentos.length === 0) return c.json([]);

    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);

    // Vendas do Colaborador em todas as Lojas, com a mesma regra do Desempenho de Vendas.
    // Em lotes de produtos: o SQL Server aceita cerca de 2100 parâmetros por consulta.
    const codigos = [...new Set(lancamentos.map((l) => l.codigoProduto))];
    const vendas: LinhaVenda[] = [];
    try {
      for (let i = 0; i < codigos.length; i += LOTE_PRODUTOS) {
        const lote = codigos.slice(i, i + LOTE_PRODUTOS);
        const params: Record<string, unknown> = { dataInicio: `${periodo.startDate} 00:00:00`, dataFim: `${periodo.endDate} 23:59:59` };
        lote.forEach((codigo, n) => (params[`p${n}`] = codigo));
        vendas.push(...(await client.query<LinhaVenda>(vendasSql(lote.length), params)));
      }
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }

    return c.json(
      conferir(
        lancamentos,
        vendas.map((v) => ({ codigoColaborador: Number(v.codigoColaborador), produtoId: v.produtoId, quantidade: Number(v.quantidade) || 0 })),
      ),
    );
  });
}
