import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { COTACAO_ACTIONS } from "./cotacao-audit.js";
import { gerarPlanilha, lerPlanilha, type PlanilhaLida } from "./cotacao-planilha.js";
import type { Cotacao, CotacaoStore } from "./cotacao-store.js";
import { ator, Codigo, CodigoEmTexto, erroDoErp, recusaDeValidacao, SEM_CONEXAO, Version, versaoDesatualizada, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { PEDIDO_TARGET, PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import type { Pedido } from "./pedidos.js";
import type { PedidoStore } from "./pedidos-store.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { parametrosBusca } from "./produtos-erp.js";
import type { AuditService } from "./vinculo-audit.js";

export interface CotacaoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  pedidos: PedidoStore;
  cotacoes: CotacaoStore;
  audit: AuditService;
}

const BASE = "/pedidos/pedidos/:id/cotacao";
const MAX_FORNECEDORES = 30;
const MAX_ARQUIVO = 5 * 1024 * 1024;
const NAO_ENCONTRADO = "Pedido não encontrado.";
const DESATUALIZADO = versaoDesatualizada("A cotação foi alterada por outra pessoa. A tela foi recarregada.");

const Inicio = z.object({
  fornecedores: z.array(Codigo).min(1, "Escolha ao menos um fornecedor.").max(MAX_FORNECEDORES, "Fornecedores demais na cotação."),
  version: Version,
}).refine((i) => new Set(i.fornecedores).size === i.fornecedores.length, { error: "Fornecedor repetido.", path: ["fornecedores"] });

/** A planilha viaja em base64: o cliente de API da plataforma só fala JSON. */
const Envio = z.object({ arquivo: z.string().min(1, "Envie a planilha preenchida.").max(MAX_ARQUIVO * 2), version: Version.optional() });

const FORNECEDORES_SQL = `
  SELECT f.CodigoFornecedor AS codigo, LTRIM(RTRIM(c.Nome)) AS nome
  FROM Fornecedor f
  JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
  WHERE f.Ativo = 1 AND c.Eliminado = 0 AND c.Nome LIKE @buscaLike ESCAPE '\\'
  ORDER BY c.Nome`;

/** Os nomes não filtram por situação: um fornecedor desativado depois continua legível na cotação. */
const nomesSql = (codigos: number) => `
  SELECT f.CodigoFornecedor AS codigo, LTRIM(RTRIM(c.Nome)) AS nome
  FROM Fornecedor f
  JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
  WHERE f.CodigoFornecedor IN (${Array.from({ length: codigos }, (_, i) => `@c${i}`).join(", ")})`;

const produtosSql = (n: number) => `
  SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, LTRIM(RTRIM(fa.NomeFabricante)) AS fabricante, CAST(p.Fracao AS varchar(20)) AS fracao
  FROM Produto p
  LEFT JOIN Produto_Fabricante fa ON fa.CodigoFabricante = p.CodigoFabricante
  WHERE CONVERT(varchar(36), p.rowguid) IN (${Array.from({ length: n }, (_, i) => `@p${i}`).join(", ")})`;

const fallback = (codigo: number) => `Fornecedor ${codigo}`;
const plano = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Cotação do Pedido: escolha dos fornecedores, planilha de preços por fornecedor e comparação. */
export function registerCotacaoRoutes({ routes, permissions, auth, erpClient, pedidos, cotacoes, audit }: CotacaoRoutesDeps): void {
  const gerir = INOVAFARMA_PERMISSIONS.ref("pedidos-pedidos:gerir");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, gerir.key);

  const registrar = (c: AuthContext, action: string, pedido: Pedido, attributes: Record<string, unknown>) =>
    audit.record({ plugin: PEDIDOS_PLUGIN, action, actor: ator(c), target: { type: PEDIDO_TARGET, id: pedido.id }, attributes });

  /** O nome vem sempre do ERP; sem resposta, "Fornecedor <código>". */
  const nomes = async (codigos: number[]): Promise<Map<number, string>> => {
    const mapa = new Map(codigos.map((c) => [c, fallback(c)] as const));
    const client = erpClient();
    if (!client || codigos.length === 0) return mapa;
    try {
      const params = Object.fromEntries(codigos.map((c, i) => [`c${i}`, c]));
      for (const r of await client.query<{ codigo: number; nome: string | null }>(nomesSql(codigos.length), params)) {
        const nome = plano(r.nome);
        if (nome) mapa.set(Number(r.codigo), nome);
      }
    } catch {
      // Sem o ERP o nome volta ao padrão.
    }
    return mapa;
  };

  const detalhe = async (pedido: Pedido) => {
    const lista = await cotacoes.listar(pedido.id);
    const nomeDe = await nomes(lista.map((c) => c.codigoFornecedor));
    return {
      pedido: { id: pedido.id, status: pedido.status, version: pedido.version },
      fornecedores: lista.map((c) => ({ codigo: c.codigoFornecedor, nome: nomeDe.get(c.codigoFornecedor) ?? fallback(c.codigoFornecedor), importado: c.precos !== null, importadoEm: c.importadoEm, version: c.version })),
      produtos: pedido.itens.map((i) => ({
        produtoId: i.produtoId,
        nome: i.nome,
        codigoBarra: i.codigoBarra,
        quantidade: totalDoItem(i),
        precos: Object.fromEntries(lista.filter((c) => c.precos).map((c) => [c.codigoFornecedor, c.precos?.[i.produtoId] ?? null])),
      })),
    };
  };

  /** Pedido da rota; a recusa quando falta a Permission ou o Pedido não existe. */
  const doPedido = async (c: AuthContext) => {
    if (!pode(c)) return { recusa: c.json({ error: gerir.deniedMessage }, 403) } as const;
    const pedido = await pedidos.pedido(c.req.param("id") ?? "");
    return pedido ? ({ pedido } as const) : ({ recusa: c.json({ error: NAO_ENCONTRADO }, 404) } as const);
  };

  routes.get("/pedidos/fornecedores", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const rows = await client.query<{ codigo: number; nome: string | null }>(FORNECEDORES_SQL, parametrosBusca((c.req.query("busca") ?? "").trim()));
      return c.json(rows.map((r) => ({ codigo: Number(r.codigo), nome: plano(r.nome) ?? fallback(Number(r.codigo)) })));
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.post(BASE, auth, async (c: AuthContext) => {
    const achado = await doPedido(c);
    if ("recusa" in achado) return achado.recusa;
    const lido = Inicio.safeParse(await c.req.json().catch(() => null));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const iniciado = await pedidos.iniciarCotacao(achado.pedido.id, lido.data.version);
    if (!iniciado) return c.json(versaoDesatualizada("O Pedido foi alterado por outra pessoa ou já não é um rascunho. A lista foi recarregada."), 409);
    await cotacoes.criar(iniciado.id, lido.data.fornecedores);
    await registrar(c, COTACAO_ACTIONS.iniciar, iniciado, { fornecedores: lido.data.fornecedores.length });
    return c.json(await detalhe(iniciado));
  });

  routes.get(BASE, auth, async (c: AuthContext) => {
    const achado = await doPedido(c);
    if ("recusa" in achado) return achado.recusa;
    return c.json(await detalhe(achado.pedido));
  });

  /** Pedido em cotação e o fornecedor participante da rota; senão a recusa. */
  const doFornecedor = async (c: AuthContext) => {
    const achado = await doPedido(c);
    if ("recusa" in achado) return { recusa: achado.recusa } as const;
    if (achado.pedido.status !== "aguardando_precos" && achado.pedido.status !== "cotado") return { recusa: c.json({ error: "O Pedido não está em cotação." }, 409) } as const;
    const codigo = CodigoEmTexto.safeParse(c.req.param("codigo"));
    const cotacao = codigo.success ? (await cotacoes.listar(achado.pedido.id)).find((x) => x.codigoFornecedor === codigo.data) : undefined;
    return cotacao ? ({ pedido: achado.pedido, cotacao } as const) : ({ recusa: c.json({ error: "Fornecedor não participa desta cotação." }, 404) } as const);
  };

  routes.get(`${BASE}/:codigo/planilha`, auth, async (c: AuthContext) => {
    const achado = await doFornecedor(c);
    if ("recusa" in achado) return achado.recusa;
    const { pedido, cotacao } = achado;
    const detalhes = await detalhesDosProdutos(erpClient(), pedido);
    const arquivo = await gerarPlanilha({
      pedidoId: pedido.id,
      codigoFornecedor: cotacao.codigoFornecedor,
      linhas: pedido.itens.map((i) => ({ produtoId: i.produtoId, codigoBarra: i.codigoBarra, nome: i.nome, fabricante: detalhes.get(i.produtoId)?.fabricante ?? null, fracao: detalhes.get(i.produtoId)?.fracao ?? null, quantidade: totalDoItem(i) })),
    });
    return c.json({ nome: `cotacao-${cotacao.codigoFornecedor}.xlsx`, conteudo: arquivo.toString("base64") });
  });

  /** O arquivo enviado (multipart) já lido e conferido contra o Pedido; senão a recusa. */
  const conferir = async (c: AuthContext, pedido: Pedido, cotacao: Cotacao) => {
    const lido = Envio.safeParse(await c.req.json().catch(() => null));
    if (!lido.success) return { recusa: recusaDeValidacao(c, lido.error) } as const;
    const corpo = lido.data;
    const arquivo = Buffer.from(corpo.arquivo, "base64");
    if (arquivo.length > MAX_ARQUIVO) return { recusa: c.json({ error: "A planilha passa de 5 MB." }, 400) } as const;
    const lida: PlanilhaLida = await lerPlanilha(arquivo, { pedidoId: pedido.id, codigoFornecedor: cotacao.codigoFornecedor });
    if (!lida.ok) return { recusa: c.json({ error: lida.erro }, 422) } as const;
    const produtosDoPedido = new Set(pedido.itens.map((i) => i.produtoId));
    const erros = lida.linhas.filter((l) => l.erro && produtosDoPedido.has(l.produtoId)).map((l) => ({ linha: l.linha, mensagem: l.erro ?? "" }));
    const semMatch = lida.linhas.filter((l) => !produtosDoPedido.has(l.produtoId)).map((l) => ({ linha: l.linha }));
    const validas = lida.linhas.filter((l) => produtosDoPedido.has(l.produtoId) && !l.erro);
    const ofertas = validas.filter((l) => l.preco !== null);
    return { corpo, previa: { validas: ofertas.length, semOferta: validas.length - ofertas.length, erros, semMatch }, validas } as const;
  };

  routes.post(`${BASE}/:codigo/previa`, auth, async (c: AuthContext) => {
    const achado = await doFornecedor(c);
    if ("recusa" in achado) return achado.recusa;
    const conferido = await conferir(c, achado.pedido, achado.cotacao);
    return "recusa" in conferido ? conferido.recusa : c.json(conferido.previa);
  });

  routes.post(`${BASE}/:codigo/importar`, auth, async (c: AuthContext) => {
    const achado = await doFornecedor(c);
    if ("recusa" in achado) return achado.recusa;
    const conferido = await conferir(c, achado.pedido, achado.cotacao);
    if ("recusa" in conferido) return conferido.recusa;
    const version = conferido.corpo.version;
    if (version === undefined) return c.json({ error: "Informe a versão da cotação." }, 400);
    if (conferido.previa.erros.length > 0) return c.json({ error: "A planilha tem linhas com erro. Corrija e envie de novo." }, 400);
    const precos: Record<string, number | null> = Object.fromEntries(achado.pedido.itens.map((i) => [i.produtoId, null]));
    for (const l of conferido.validas) precos[l.produtoId] = l.preco;
    const gravada = await cotacoes.gravarPrecos(achado.pedido.id, achado.cotacao.codigoFornecedor, precos, version);
    if (!gravada) return c.json(DESATUALIZADO, 409);
    const atual = (await pedidos.marcarCotado(achado.pedido.id)) ?? (await pedidos.pedido(achado.pedido.id)) ?? achado.pedido;
    await registrar(c, COTACAO_ACTIONS.importar, atual, { codigoFornecedor: gravada.codigoFornecedor, ofertas: conferido.previa.validas });
    return c.json(await detalhe(atual));
  });
}

/** Quantidade total do produto no Pedido, sem divisão por Loja. */
const totalDoItem = (item: Pedido["itens"][number]) => item.quantidades.reduce((soma, q) => soma + q.quantidade, 0);

/** Fabricante e fração vêm do ERP; sem resposta a planilha sai com essas colunas em branco. */
async function detalhesDosProdutos(client: ErpQuery | undefined, pedido: Pedido): Promise<Map<string, { fabricante: string | null; fracao: string | null }>> {
  const mapa = new Map<string, { fabricante: string | null; fracao: string | null }>();
  if (!client) return mapa;
  try {
    const params = Object.fromEntries(pedido.itens.map((i, n) => [`p${n}`, i.produtoId]));
    for (const r of await client.query<{ produtoId: string; fabricante: string | null; fracao: string | null }>(produtosSql(pedido.itens.length), params)) mapa.set(String(r.produtoId), { fabricante: plano(r.fabricante), fracao: plano(r.fracao) });
  } catch {
    // A planilha ainda serve ao fornecedor sem estas colunas.
  }
  return mapa;
}
