import type { MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { horaDoErp } from "./baixas-da-loja.js";
import { ator, ERP_INDISPONIVEL, erroDoErp, recusaDeValidacao, SEM_CONEXAO, Version, versaoDaQuery, versaoDesatualizada, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import { lojasDoUsuario } from "./pedidos-escopo-lojas.js";
import { FALTEIRO_ACTIONS, FALTEIRO_TARGET } from "./pedidos-falteiro-audit.js";
import { FaltaDuplicadaError, type FalteiroStore } from "./pedidos-falteiro-store.js";
import { DadosFalteiro, EdicaoFalteiro, type Falta } from "./pedidos-falteiro.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { lojasDoErp, type LojaOpcao } from "./pre-vencidos-comum.js";
import { buscaProdutosSql, MIN_BUSCA_PRODUTO, parametrosBusca } from "./produtos-erp.js";
import type { AuditService } from "./vinculo-audit.js";
import type { VinculoStore } from "./vinculo-store.js";

export interface PedidosFalteiroRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  falteiro: FalteiroStore;
  vinculos: Pick<VinculoStore, "porUsuario">;
  audit: AuditService;
}

export interface FaltaComErp extends Falta {
  nomeProduto: string;
  codigoBarra: string | null;
  /** Estoque atual na Loja da falta, ou total na rede quando `codigoLoja === null`. */
  estoque: number;
  /** Estoques por Loja quando `codigoLoja === null` (ou da Loja). */
  estoquesPorLoja: { codigoLoja: number; estoque: number }[];
  /** Houve entrada de NF (`Compra`) após `criadoEm` na Loja da falta (ou em qualquer Loja quando `codigoLoja === null`). */
  entradaAposCriacao: boolean;
  /** Sugestão visual para remoção manual: `estoque > 0 && entradaAposCriacao`. */
  sugerirRemocao: boolean;
}

const BASE = "/pedidos/falteiro";
const NAO_ENCONTRADA = "Registro de falta não encontrado.";
const FALTA_DUPLICADA = "Este produto já está registrado no Falteiro para esta Loja.";
const FORA_DO_ESCOPO = "Acesso negado: você só pode registrar, editar ou remover faltas das Lojas vinculadas ao seu Colaborador.";
const DESATUALIZADO = versaoDesatualizada("O registro do Falteiro foi alterado por outra pessoa. A lista foi recarregada.");

const EdicaoComVersion = EdicaoFalteiro.extend({ version: Version });

const nomesSql = (n: number) => {
  const ids = Array.from({ length: n }, (_, i) => `@p${i}`).join(", ");
  return `
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, LTRIM(RTRIM(p.NomeProduto)) AS nome, p.CodigoBarra AS codigoBarra
    FROM Produto p
    WHERE CONVERT(varchar(36), p.rowguid) IN (${ids})
  `;
};

const estoquesSql = (n: number) => {
  const ids = Array.from({ length: n }, (_, i) => `@p${i}`).join(", ");
  return `
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, pe.CodigoEmpresa AS codigoLoja, CAST(pe.Estoque AS float) AS estoque
    FROM Produto_Estoque pe
    JOIN Produto p ON p.CodigoProduto = pe.CodigoProduto
    WHERE CONVERT(varchar(36), p.rowguid) IN (${ids})
  `;
};

const entradasSql = (n: number) => {
  const ids = Array.from({ length: n }, (_, i) => `@p${i}`).join(", ");
  return `
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, c.CodigoEmpresa AS codigoLoja, MAX(CONVERT(varchar(19), c.DataNota, 120)) AS ultimaEntrada
    FROM Compra c
    JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
    JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
    WHERE c.Eliminado = 0 AND c.DataNota >= @desde AND CONVERT(varchar(36), p.rowguid) IN (${ids})
    GROUP BY CONVERT(varchar(36), p.rowguid), c.CodigoEmpresa
  `;
};

async function nomeDoProduto(client: ErpQuery | undefined, produtoId: string): Promise<string> {
  try {
    const [r] =
      (await client?.query<{ nome: string | null }>(
        "SELECT LTRIM(RTRIM(p.NomeProduto)) AS nome FROM Produto p WHERE CONVERT(varchar(36), p.rowguid) = @produtoId",
        { produtoId },
      )) ?? [];
    return r?.nome?.trim() || produtoId;
  } catch {
    return produtoId;
  }
}

async function enriquecerComErp(client: ErpQuery | undefined, faltas: Falta[]): Promise<FaltaComErp[]> {
  if (faltas.length === 0) return [];
  if (!client) {
    return faltas.map((f) => ({
      ...f,
      nomeProduto: f.produtoId,
      codigoBarra: null,
      estoque: 0,
      estoquesPorLoja: [],
      entradaAposCriacao: false,
      sugerirRemocao: false,
    }));
  }
  const ids = [...new Set(faltas.map((f) => f.produtoId))];
  const paramsIds = Object.fromEntries(ids.map((id, i) => [`p${i}`, id]));
  const maisAntiga = faltas.map((f) => horaDoErp(f.criadoEm)).sort()[0] ?? "1970-01-01 00:00:00";
  const desde = `${maisAntiga.slice(0, 10)} 00:00:00`;

  const [produtos, estoques, entradas] = await Promise.all([
    client.query<{ produtoId: string; nome: string | null; codigoBarra: string | null }>(nomesSql(ids.length), paramsIds),
    client.query<{ produtoId: string; codigoLoja: number; estoque: number | null }>(estoquesSql(ids.length), paramsIds),
    client.query<{ produtoId: string; codigoLoja: number; ultimaEntrada: string | null }>(entradasSql(ids.length), { ...paramsIds, desde }),
  ]);

  const infoPorProduto = new Map(produtos.map((p) => [String(p.produtoId), { nome: (p.nome ?? "").trim() || String(p.produtoId), codigoBarra: p.codigoBarra }]));
  const estoquesPorProduto = new Map<string, { codigoLoja: number; estoque: number }[]>();
  for (const e of estoques) {
    const pid = String(e.produtoId);
    const lista = estoquesPorProduto.get(pid) ?? [];
    lista.push({ codigoLoja: Number(e.codigoLoja), estoque: Number(e.estoque) || 0 });
    estoquesPorProduto.set(pid, lista);
  }
  const entradasPorProduto = new Map<string, { codigoLoja: number; ultimaEntrada: string }[]>();
  for (const e of entradas) {
    if (!e.ultimaEntrada) continue;
    const pid = String(e.produtoId);
    const lista = entradasPorProduto.get(pid) ?? [];
    lista.push({ codigoLoja: Number(e.codigoLoja), ultimaEntrada: String(e.ultimaEntrada) });
    entradasPorProduto.set(pid, lista);
  }

  return faltas.map((f) => {
    const info = infoPorProduto.get(f.produtoId);
    const todosEstoques = estoquesPorProduto.get(f.produtoId) ?? [];
    const estoquesRelevantes = f.codigoLoja === null ? todosEstoques : todosEstoques.filter((e) => e.codigoLoja === f.codigoLoja);
    const estoque = estoquesRelevantes.reduce((s, e) => s + e.estoque, 0);

    const criadoNoErp = horaDoErp(f.criadoEm);
    const todasEntradas = entradasPorProduto.get(f.produtoId) ?? [];
    const entradasRelevantes = f.codigoLoja === null ? todasEntradas : todasEntradas.filter((e) => e.codigoLoja === f.codigoLoja);
    const entradaAposCriacao = entradasRelevantes.some((e) => e.ultimaEntrada > criadoNoErp);
    const sugerirRemocao = estoque > 0 && entradaAposCriacao;

    return {
      ...f,
      nomeProduto: info?.nome ?? f.produtoId,
      codigoBarra: info?.codigoBarra ?? null,
      estoque,
      estoquesPorLoja: estoquesRelevantes,
      entradaAposCriacao,
      sugerirRemocao,
    };
  });
}

export function registerPedidosFalteiroRoutes({ routes, permissions, auth, erpClient, falteiro, vinculos, audit }: PedidosFalteiroRoutesDeps): void {
  const gerir = INOVAFARMA_PERMISSIONS.ref("pedidos-falteiro:gerir");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, gerir.key);

  const podeAtuarNaLoja = (permitidas: number[] | null, codigoLoja: number | null): boolean => {
    if (permitidas === null) return true;
    return codigoLoja !== null && permitidas.includes(codigoLoja);
  };

  const registrarAudit = async (c: AuthContext, action: string, falta: Falta, lojas: LojaOpcao[]) => {
    const client = erpClient();
    const produto = await nomeDoProduto(client, falta.produtoId);
    const nomeLoja = falta.codigoLoja === null ? null : (lojas.find((l) => l.codigo === falta.codigoLoja)?.nome ?? null);
    await audit.record({
      plugin: PEDIDOS_PLUGIN,
      action,
      actor: ator(c),
      target: { type: FALTEIRO_TARGET, id: falta.id },
      attributes: {
        produto,
        codigoLoja: falta.codigoLoja,
        nomeLoja,
        quantidade: falta.quantidade,
        observacao: falta.observacao,
      },
    });
  };

  routes.get(BASE, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const client = erpClient();
    try {
      const [permitidas, lojas, lista] = await Promise.all([
        lojasDoUsuario({ permissions, vinculos }, c),
        lojasDoErp(client),
        falteiro.listar(),
      ]);
      const itens = await enriquecerComErp(client, lista);
      return c.json({
        todasAsLojas: permitidas === null,
        lojas,
        lojasPermitidas: permitidas,
        itens,
      });
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.get(`${BASE}/produtos`, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < MIN_BUSCA_PRODUTO) return c.json([]);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const rows = await client.query<{ produtoId: string; nome: string | null; codigoBarra: string | null }>(
        buscaProdutosSql({ somenteAtivos: false }),
        parametrosBusca(q),
      );
      return c.json(rows.map((r) => ({ id: r.produtoId, nome: (r.nome || "").trim(), codigoBarra: r.codigoBarra })));
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });

  routes.post(BASE, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const lido = DadosFalteiro.safeParse(await c.req.json().catch(() => null));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const permitidas = await lojasDoUsuario({ permissions, vinculos }, c);
    if (!podeAtuarNaLoja(permitidas, lido.data.codigoLoja)) {
      return c.json({ error: FORA_DO_ESCOPO }, 403);
    }
    const autor = ator(c);
    try {
      const criada = await falteiro.criar(lido.data, { id: autor.id, nome: autor.name });
      const lojas = await lojasDoErp(erpClient());
      await registrarAudit(c, FALTEIRO_ACTIONS.criar, criada, lojas);
      return c.json(criada, 201);
    } catch (err: unknown) {
      if (err instanceof FaltaDuplicadaError) return c.json({ error: FALTA_DUPLICADA }, 409);
      throw err;
    }
  });

  routes.put(`${BASE}/:id`, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const id = c.req.param("id") ?? "";
    const atual = await falteiro.get(id);
    if (!atual) return c.json({ error: NAO_ENCONTRADA }, 404);
    const lido = EdicaoComVersion.safeParse(await c.req.json().catch(() => null));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const permitidas = await lojasDoUsuario({ permissions, vinculos }, c);
    if (!podeAtuarNaLoja(permitidas, atual.codigoLoja) || !podeAtuarNaLoja(permitidas, lido.data.codigoLoja)) {
      return c.json({ error: FORA_DO_ESCOPO }, 403);
    }
    const { version, ...dados } = lido.data;
    try {
      const editada = await falteiro.atualizar(id, dados, version);
      if (!editada) return c.json(DESATUALIZADO, 409);
      const lojas = await lojasDoErp(erpClient());
      await registrarAudit(c, FALTEIRO_ACTIONS.editar, editada, lojas);
      return c.json(editada);
    } catch (err: unknown) {
      if (err instanceof FaltaDuplicadaError) return c.json({ error: FALTA_DUPLICADA }, 409);
      throw err;
    }
  });

  routes.delete(`${BASE}/:id`, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const versao = versaoDaQuery(c);
    if ("recusa" in versao) return versao.recusa;
    const id = c.req.param("id") ?? "";
    const atual = await falteiro.get(id);
    if (!atual) return c.json({ error: NAO_ENCONTRADA }, 404);
    const permitidas = await lojasDoUsuario({ permissions, vinculos }, c);
    if (!podeAtuarNaLoja(permitidas, atual.codigoLoja)) {
      return c.json({ error: FORA_DO_ESCOPO }, 403);
    }
    if (!(await falteiro.remover(id, versao.version))) return c.json(DESATUALIZADO, 409);
    const lojas = await lojasDoErp(erpClient());
    await registrarAudit(c, FALTEIRO_ACTIONS.remover, atual, lojas);
    return c.body(null, 204);
  });
}
