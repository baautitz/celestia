import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { COTACAO_ACTIONS } from "./cotacao-audit.js";
import { nomeDoArquivo } from "./nome-arquivo.js";
import { linhasPorLoja } from "./pedido-pdf.js";
import { lojasDoErp } from "./pre-vencidos-comum.js";
import { gerarPlanilha, identificarPlanilha, lerPlanilha, type PlanilhaLida } from "./cotacao-planilha.js";
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

export const FORNECEDORES_SQL = `
  SELECT f.CodigoFornecedor AS codigo, LTRIM(RTRIM(c.Nome)) AS nome
  FROM Fornecedor f
  JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
  WHERE f.Ativo = 1 AND c.Eliminado = 0 AND c.Nome LIKE @buscaLike ESCAPE '\\'
  ORDER BY c.Nome`;

/** Os nomes não filtram por situação: um fornecedor desativado depois continua legível na cotação. */
export const nomesSql = (codigos: number) => `
  SELECT f.CodigoFornecedor AS codigo, LTRIM(RTRIM(c.Nome)) AS nome
  FROM Fornecedor f
  JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
  WHERE f.CodigoFornecedor IN (${Array.from({ length: codigos }, (_, i) => `@c${i}`).join(", ")})`;

const produtosSql = (n: number) => `
  SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, p.CodigoProduto AS codigoProduto, LTRIM(RTRIM(fa.NomeFabricante)) AS fabricante  FROM Produto p
  LEFT JOIN Produto_Fabricante fa ON fa.CodigoFabricante = p.CodigoFabricante
  WHERE CONVERT(varchar(36), p.rowguid) IN (${Array.from({ length: n }, (_, i) => `@p${i}`).join(", ")})`;

/** A última compra (entrada de NF) de cada produto de cada fornecedor: preço unitário e dia. */
const ultimasComprasSql = (n: number, fornecedores: number[]) => `
  SELECT produtoId, codigoFornecedor, preco, dia
  FROM (
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, f.CodigoFornecedor AS codigoFornecedor, CAST(cp.Preco AS float) AS preco, CONVERT(varchar(10), c.DataNota, 23) AS dia,
      ROW_NUMBER() OVER (PARTITION BY p.rowguid, f.CodigoFornecedor ORDER BY c.DataNota DESC, c.CodigoCompra DESC) AS n
    FROM Compra c
    JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
    JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
    JOIN Fornecedor f ON f.CodigoCadastro = c.CodigoCadastro
    WHERE c.Eliminado = 0 AND f.CodigoFornecedor IN (${fornecedores.map((c) => Math.trunc(c)).join(", ")}) AND CONVERT(varchar(36), p.rowguid) IN (${Array.from({ length: n }, (_, i) => `@p${i}`).join(", ")})
  ) x
  WHERE x.n = 1`;

const fallback = (codigo: number) => `Fornecedor ${codigo}`;
const plano = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Cotação do Pedido: escolha dos fornecedores, planilha de preços por fornecedor e comparação. */
export function registerCotacaoRoutes({ routes, permissions, auth, erpClient, pedidos, cotacoes, audit }: CotacaoRoutesDeps): void {
  const gerir = INOVAFARMA_PERMISSIONS.ref("pedidos-pedidos:gerir");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, gerir.key);

  const confirmar = INOVAFARMA_PERMISSIONS.ref("pedidos-pedidos:confirmar");
  const podeConfirmar = (c: AuthContext) => permissions.has(c.get("user")?.permissions, confirmar.key);

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

  const detalhe = async (pedido: Pedido, podeConfirmar: boolean) => {
    // Pedido editado depois de cotado: as distribuidoras novas das linhas entram na cotação.
    const naLinhas = [...new Set(pedido.itens.flatMap((i) => i.quantidades.flatMap((q) => q.codigosFornecedor ?? [])))];
    const lista = pedido.status === "aguardando_precos" || pedido.status === "cotado" ? await cotacoes.acrescentar(pedido.id, naLinhas) : await cotacoes.listar(pedido.id);
    const nomeDe = await nomes(lista.map((c) => c.codigoFornecedor));
    const anteriores = await ultimasCompras(erpClient(), pedido, lista.map((c) => c.codigoFornecedor));
    const detalhes = await detalhesDosProdutos(erpClient(), pedido);
    return {
      pedido: { id: pedido.id, status: pedido.status, version: pedido.version, escolhas: pedido.escolhas },
      podeConfirmar,
      fornecedores: lista.map((c) => ({ codigo: c.codigoFornecedor, nome: nomeDe.get(c.codigoFornecedor) ?? fallback(c.codigoFornecedor), importado: c.precos !== null, importadoEm: c.importadoEm, version: c.version })),
      produtos: pedido.itens.map((i) => ({
        produtoId: i.produtoId,
        codigoProduto: detalhes.get(i.produtoId)?.codigoProduto ?? null,
        nome: i.nome,
        codigoBarra: i.codigoBarra,
        quantidade: totalDoItem(i),
        // O que o Pedido pede a cada fornecedor e o que ele confirmou na planilha (null = não mexeu na quantidade).
        pedidas: Object.fromEntries(lista.map((c) => [c.codigoFornecedor, itensDoFornecedor(pedido, c.codigoFornecedor).find((x) => x.item.produtoId === i.produtoId)?.quantidade ?? 0])),
        ofertadas: Object.fromEntries(lista.map((c) => [c.codigoFornecedor, c.quantidades?.[i.produtoId] ?? null])),
        ultimas: Object.fromEntries(lista.map((c) => [c.codigoFornecedor, anteriores.get(`${i.produtoId}|${c.codigoFornecedor}`) ?? null])),
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
    return c.json(await detalhe(iniciado, podeConfirmar(c)));
  });

  routes.get(BASE, auth, async (c: AuthContext) => {
    const achado = await doPedido(c);
    if ("recusa" in achado) return achado.recusa;
    return c.json(await detalhe(achado.pedido, podeConfirmar(c)));
  });

  /** De quem é a planilha enviada: o código do fornecedor vem dentro do arquivo, e o cliente segue pelas rotas do fornecedor. */
  routes.post(`${BASE}/identificar`, auth, async (c: AuthContext) => {
    const achado = await doPedido(c);
    if ("recusa" in achado) return achado.recusa;
    const lido = Envio.safeParse(await c.req.json().catch(() => null));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const arquivo = Buffer.from(lido.data.arquivo, "base64");
    if (arquivo.length > MAX_ARQUIVO) return c.json({ error: "A planilha passa de 5 MB." }, 400);
    const identificada = await identificarPlanilha(arquivo, achado.pedido.id);
    if (!identificada.ok) return c.json({ error: identificada.erro }, 422);
    if (!(await cotacoes.listar(achado.pedido.id)).some((x) => x.codigoFornecedor === identificada.codigoFornecedor)) return c.json({ error: "Esta planilha é de um fornecedor que não participa desta cotação." }, 404);
    return c.json({ codigoFornecedor: identificada.codigoFornecedor });
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
    const anteriores = await ultimasCompras(erpClient(), pedido, [cotacao.codigoFornecedor]);
    const nomeFornecedor = (await nomes([cotacao.codigoFornecedor])).get(cotacao.codigoFornecedor) ?? fallback(cotacao.codigoFornecedor);
    // `?modo=loja`: abas extras com a quantidade de cada Loja; a primeira aba (a que se importa) não muda.
    const porLoja = c.req.query("modo") === "loja";
    const nomesLojas = porLoja ? new Map((await lojasDoErp(erpClient())).map((l) => [l.codigo, l.nome])) : new Map<number, string>();
    const lojasDaPlanilha = porLoja ? lojasDaDistribuidora(pedido, cotacao.codigoFornecedor, (codigo) => nomesLojas.get(codigo) ?? `Loja ${codigo}`) : undefined;
    const arquivo = await gerarPlanilha({
      porLoja: lojasDaPlanilha,
      fornecedor: nomeFornecedor,
      pedidoEm: pedido.criadoEm.slice(0, 10),
      pedidoId: pedido.id,
      codigoFornecedor: cotacao.codigoFornecedor,
      linhas: itensDoFornecedor(pedido, cotacao.codigoFornecedor).map(({ item: i, quantidade }) => ({ produtoId: i.produtoId, codigoBarra: i.codigoBarra, nome: i.nome, fabricante: detalhes.get(i.produtoId)?.fabricante ?? null, quantidade, precoAnterior: anteriores.get(`${i.produtoId}|${cotacao.codigoFornecedor}`)?.preco ?? null, dataAnterior: anteriores.get(`${i.produtoId}|${cotacao.codigoFornecedor}`)?.dia ?? null })),
    });
        return c.json({ nome: `${nomeDoArquivo(`Cotação ${nomeFornecedor} ${pedido.criadoEm.slice(0, 10)}${porLoja ? " por Loja" : ""}`)}.xlsx`, conteudo: arquivo.toString("base64") });
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
    // Quantidade diferente da pedida a este fornecedor: aceita, mas fica registrada e aparece na comparação.
    const pedidas = new Map(itensDoFornecedor(pedido, cotacao.codigoFornecedor).map((x) => [x.item.produtoId, x.quantidade]));
    const diferentes = validas.filter((l) => l.quantidade !== null && l.quantidade !== (pedidas.get(l.produtoId) ?? 0));
    return { corpo, previa: { validas: ofertas.length, semOferta: validas.length - ofertas.length, quantidadesDiferentes: diferentes.length, erros, semMatch }, validas } as const;
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
    const quantidades: Record<string, number> = {};
    for (const l of conferido.validas) if (l.quantidade !== null) quantidades[l.produtoId] = l.quantidade;
    const gravada = await cotacoes.gravarPrecos(achado.pedido.id, achado.cotacao.codigoFornecedor, precos, quantidades, version);
    if (!gravada) return c.json(DESATUALIZADO, 409);
    const atual = (await pedidos.marcarCotado(achado.pedido.id)) ?? (await pedidos.pedido(achado.pedido.id)) ?? achado.pedido;
    await registrar(c, COTACAO_ACTIONS.importar, atual, { codigoFornecedor: gravada.codigoFornecedor, ofertas: conferido.previa.validas });
    return c.json(await detalhe(atual, podeConfirmar(c)));
  });
}

/** As Lojas que o Pedido pede a esta distribuidora e, de cada uma, os produtos e quantidades (abas extras da planilha). */
function lojasDaDistribuidora(pedido: Pedido, codigoFornecedor: number, nomeLoja: (codigo: number) => string) {
  const porLoja = new Map<number, { codigoBarra: string | null; nome: string; quantidade: number }[]>();
  for (const l of linhasPorLoja(pedido, codigoFornecedor)) porLoja.set(l.codigoLoja, [...(porLoja.get(l.codigoLoja) ?? []), { codigoBarra: l.codigoBarra, nome: l.nome, quantidade: l.quantidade }]);
  return [...porLoja.entries()].sort(([a], [b]) => a - b).map(([codigo, linhas]) => ({ loja: nomeLoja(codigo), linhas }));
}

/**
 * A planilha de um fornecedor leva só o que o Pedido pede a ele: as linhas (produto, Loja) com esse fornecedor, somando as
 * quantidades. Pedido sem fornecedor nas linhas (anterior à escolha por linha) manda tudo a todos.
 */
function itensDoFornecedor(pedido: Pedido, codigo: number): { item: Pedido["itens"][number]; quantidade: number }[] {
  const porLinha = pedido.itens.some((i) => i.quantidades.some((q) => (q.codigosFornecedor ?? []).length > 0));
  if (!porLinha) return pedido.itens.map((item) => ({ item, quantidade: totalDoItem(item) }));
  return pedido.itens
    .map((item) => ({ item, quantidade: item.quantidades.filter((q) => (q.codigosFornecedor ?? []).includes(codigo)).reduce((soma, q) => soma + q.quantidade, 0) }))
    .filter((x) => x.quantidade > 0);
}

const totalDoItem = (item: Pedido["itens"][number]) => item.quantidades.reduce((soma, q) => soma + q.quantidade, 0);

/** O fabricante vem do ERP; sem resposta a planilha sai com a coluna em branco. */
async function ultimasCompras(client: ErpQuery | undefined, pedido: Pedido, fornecedores: number[]): Promise<Map<string, { preco: number; dia: string }>> {
  const mapa = new Map<string, { preco: number; dia: string }>();
  if (!client || fornecedores.length === 0 || pedido.itens.length === 0) return mapa;
  try {
    const params = Object.fromEntries(pedido.itens.map((i, n) => [`p${n}`, i.produtoId]));
    for (const r of await client.query<{ produtoId: string; codigoFornecedor: number; preco: number | null; dia: string | null }>(ultimasComprasSql(pedido.itens.length, fornecedores), params)) {
      if (r.dia && Number(r.preco) > 0) mapa.set(`${r.produtoId}|${Number(r.codigoFornecedor)}`, { preco: Number(r.preco), dia: r.dia });
    }
  } catch {
    // Sem o ERP a planilha e a comparação seguem sem o último preço.
  }
  return mapa;
}

export async function detalhesDosProdutos(client: ErpQuery | undefined, pedido: Pedido): Promise<Map<string, { fabricante: string | null; codigoProduto: number | null }>> {
  const mapa = new Map<string, { fabricante: string | null; codigoProduto: number | null }>();
  if (!client) return mapa;
  try {
    const params = Object.fromEntries(pedido.itens.map((i, n) => [`p${n}`, i.produtoId]));
    for (const r of await client.query<{ produtoId: string; codigoProduto: number | null; fabricante: string | null }>(produtosSql(pedido.itens.length), params)) mapa.set(String(r.produtoId), { fabricante: plano(r.fabricante), codigoProduto: r.codigoProduto == null ? null : Number(r.codigoProduto) });
  } catch {
    // A planilha ainda serve ao fornecedor sem estas colunas.
  }
  return mapa;
}
