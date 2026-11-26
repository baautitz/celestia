import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { detalhesDosProdutos, nomesSql } from "./cotacao-routes.js";
import type { CotacaoStore } from "./cotacao-store.js";
import { ator, Codigo, CodigoEmTexto, erroDoErp, recusaDeValidacao, SEM_CONEXAO, Version, versaoDesatualizada, type AuthContext } from "./metas-comum.js";
import type { ErpQuery } from "./metas-comum.js";
import { PEDIDO_TARGET, PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import { chaveDaLinha, conferir, estadoDaLinha, statusDoPedido, type LinhaConferida } from "./pedidos-conferencia.js";
import { produtosDaLista } from "./pedidos-limites-consumo.js";
import { DadosRegraLimite } from "./pedidos-limites.js";
import { CONFIRMACAO_ACTIONS } from "./pedidos-confirmacao-audit.js";
import { entradasDoPedido, entradasDosPedidos, entradasPorOrigem } from "./pedidos-nf.js";
import { nomeDoArquivo } from "./nome-arquivo.js";
import { lojasDoErp } from "./pre-vencidos-comum.js";
import { gerarPdf, gerarPdfDeLoja, itensDaLojaFornecedora, itensDoFornecedor, itensDoFornecedorPorLoja } from "./pedido-pdf.js";
import { fornecedoresDa, paraCotar, semLinhasDeLoja, soDeLojas, type Pedido } from "./pedidos.js";
import type { PedidoStore } from "./pedidos-store.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { AuditService } from "./vinculo-audit.js";

export interface ConfirmacaoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  pedidos: PedidoStore;
  cotacoes: CotacaoStore;
  audit: AuditService;
}

const BASE = "/pedidos/pedidos/:id";
const NAO_ENCONTRADO = "Pedido não encontrado.";
const DESATUALIZADO = versaoDesatualizada("O Pedido foi alterado por outra pessoa ou já não está cotado. A tela foi recarregada.");
const SEM_NOME = "Não foi possível consultar o nome do fornecedor no ERP. O PDF não foi gerado; tente novamente em instantes.";
const EM_RECEBIMENTO = ["confirmado", "parcialmente_recebido", "recebido"];

const Parcela = z.object({ codigoLoja: Codigo, codigoFornecedor: Codigo, quantidade: z.number().positive().max(1_000_000) });
const Escolha = z.union([Codigo, z.array(Parcela).min(1).max(900)]);

/** `quantidades`: por produto, a quantidade que o fornecedor escolhido vai atender (editada na comparação). */
const Confirmacao = z.object({ escolhas: z.record(z.string().min(1).max(36), Escolha), quantidades: z.record(z.string().min(1).max(36), z.number().min(0).max(1_000_000)).optional(), version: Version });

/** Confirmação do Pedido cotado, PDF por fornecedor e conferência com as entradas de NF do ERP. */
export function registerConfirmacaoRoutes({ routes, permissions, auth, erpClient, pedidos, cotacoes, audit }: ConfirmacaoRoutesDeps): void {
  const confirmar = INOVAFARMA_PERMISSIONS.ref("pedidos-pedidos:confirmar");
  const gerir = INOVAFARMA_PERMISSIONS.ref("pedidos-pedidos:gerir");

  const registrar = (c: AuthContext, action: string, pedido: Pedido, attributes: Record<string, unknown>) =>
    audit.record({ plugin: PEDIDOS_PLUGIN, action, actor: ator(c), target: { type: PEDIDO_TARGET, id: pedido.id }, attributes });

  /** Pedido da rota; a recusa quando falta a Permission ou o Pedido não existe. */
  const doPedido = async (c: AuthContext, exigida: typeof confirmar) => {
    if (!permissions.has(c.get("user")?.permissions, exigida.key)) return { recusa: c.json({ error: exigida.deniedMessage }, 403) } as const;
    const pedido = await pedidos.pedido(c.req.param("id") ?? "");
    return pedido ? ({ pedido } as const) : ({ recusa: c.json({ error: NAO_ENCONTRADO }, 404) } as const);
  };

  /** Quais produtos dos Pedidos casam com o Filtro de produtos da aba Pedidos. */
  routes.post("/pedidos/pedidos/filtrar-produtos", auth, async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, gerir.key)) return c.json({ error: gerir.deniedMessage }, 403);
    const lido = z.object({ entradas: DadosRegraLimite.shape.entradas }).safeParse(await c.req.json().catch(() => null));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const ids = [...new Set((await pedidos.listar()).flatMap((p) => p.itens.map((i) => i.produtoId)))];
      return c.json({ produtoIds: [...(await produtosDaLista(client, lido.data, ids))] });
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  /** Andamento da entrada de cada Pedido confirmado, calculado ao vivo com as NFs do ERP (a lista não precisa abrir o Pedido). */
  routes.get("/pedidos/pedidos/recebimentos", auth, async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, gerir.key)) return c.json({ error: gerir.deniedMessage }, 403);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const abertos = (await pedidos.listar()).filter((p) => EM_RECEBIMENTO.includes(p.status));
      const entradas = await entradasDosPedidos(client, abertos);
      return c.json(
        abertos.map((p) => {
          const linhas = conferir(p, entradas.get(p) ?? new Map());
          return {
            pedidoId: p.id,
            pedida: linhas.reduce((t, l) => t + l.pedida, 0),
            recebida: linhas.reduce((t, l) => t + Math.min(l.recebida, l.pedida), 0),
            produtos: produtosDe(linhas).length,
            produtosOk: produtosDe(linhas).filter((l) => l.every(completa)).length,
          };
        }),
      );
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  /** Linhas do Pedido com o recebido de cada Loja e a distribuidora escolhida do produto, para a janela de entrada. */
  routes.get(`${BASE}/recebimento`, auth, async (c: AuthContext) => {
    const achado = await doPedido(c, gerir);
    if ("recusa" in achado) return achado.recusa;
    const { pedido } = achado;
    if (!EM_RECEBIMENTO.includes(pedido.status)) return c.json({ error: "Confirme o Pedido antes de acompanhar a entrada." }, 409);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const porOrigem = await entradasPorOrigem(client, pedido);
      const somadas = new Map([...porOrigem].map(([chave, origens]) => [chave, [...origens.values()].reduce((t, n) => t + n, 0)]));
      const linhas = conferir(pedido, somadas);
      const chegaram = [...porOrigem.values()].flatMap((origens) => [...origens.keys()]);
      const codigos = [...new Set([...Object.values(pedido.escolhas).flatMap(fornecedoresDa), ...chegaram.filter((c) => c > 0)])];
      const nomes = new Map<number, string>();
      if (codigos.length > 0) {
        const params = Object.fromEntries(codigos.map((cod, i) => [`c${i}`, cod]));
        for (const r of await client.query<{ codigo: number; nome: string | null }>(nomesSql(codigos.length), params)) nomes.set(Number(r.codigo), r.nome?.trim() || `Fornecedor ${r.codigo}`);
      }
      const detalhes = await detalhesDosProdutos(client, pedido);
      const temLojas = chegaram.some((c) => c < 0) || pedido.itens.some((i) => i.quantidades.some((q) => q.lojasFornecedoras?.length));
      const nomesLojas = temLojas ? new Map((await lojasDoErp(client)).map((l) => [l.codigo, l.nome])) : new Map<number, string>();
      // Origem: código da distribuidora, negativo do código da Loja que transferiu, ou 0 quando o ERP não diz.
      const nomeDa = (origem: number) => (origem > 0 ? (nomes.get(origem) ?? `Fornecedor ${origem}`) : origem < 0 ? (nomesLojas.get(-origem) ?? `Loja ${-origem}`) : "Origem não identificada");
      return c.json({
        linhas: linhas.flatMap((l) => {
          const linha = pedido.itens.find((i) => i.produtoId === l.produtoId)?.quantidades.find((q) => q.codigoLoja === l.codigoLoja);
          const escolha = pedido.escolhas[l.produtoId];
          // Uma linha por fornecedor: o que se pediu a cada um e o que de fato veio dele; quem mandou sem ter sido pedido entra com 0.
          const pedidas = new Map<number, number>();
          const pedir = (origem: number, quantidade: number) => quantidade > 0 && pedidas.set(origem, (pedidas.get(origem) ?? 0) + quantidade);
          if (Array.isArray(escolha)) for (const p of escolha) p.codigoLoja === l.codigoLoja && pedir(p.codigoFornecedor, p.quantidade);
          else if (escolha !== undefined && linha) pedir(escolha, paraCotar(linha));
          for (const p of linha?.lojasFornecedoras ?? []) pedir(-p.codigoLoja, p.quantidade);
          const recebidas = porOrigem.get(chaveDaLinha(l.produtoId, l.codigoLoja)) ?? new Map<number, number>();
          const lojaOk = completa(l);
          return [...new Set([...pedidas.keys(), ...recebidas.keys()])].map((origem) => {
            const pedida = pedidas.get(origem) ?? 0;
            const recebida = recebidas.get(origem) ?? 0;
            return { produtoId: l.produtoId, nome: l.nome, codigoProduto: detalhes.get(l.produtoId)?.codigoProduto ?? null, codigoLoja: l.codigoLoja, codigoFornecedor: origem, fornecedor: nomeDa(origem), pedida, recebida, estado: estadoDaLinha(pedida, recebida), lojaOk };
          });
        }),
      });
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.post(`${BASE}/confirmar`, auth, async (c: AuthContext) => {
    const achado = await doPedido(c, confirmar);
    if ("recusa" in achado) return achado.recusa;
    const lido = Confirmacao.safeParse(await c.req.json().catch(() => null));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const { escolhas, quantidades, version } = lido.data;
    const { pedido } = achado;
    // Pedido só de Lojas não tem cotação: confirma direto do rascunho.
    const semCotacao = soDeLojas(pedido) && ["rascunho", "aguardando_precos", "cotado"].includes(pedido.status);
    if (!semCotacao && pedido.status !== "cotado") return c.json(DESATUALIZADO, 409);
    const lista = await cotacoes.listar(pedido.id);
    const precoDe = (produtoId: string, codigo: number) => lista.find((x) => x.codigoFornecedor === codigo)?.precos?.[produtoId] ?? null;
    const cotaveis = semLinhasDeLoja(pedido).itens;
    const produtos = new Set(cotaveis.map((i) => i.produtoId));
    if (Object.keys(escolhas).some((id) => !produtos.has(id))) return c.json({ error: "Há produto fora do Pedido na escolha." }, 400);
    for (const i of cotaveis) {
      const ofertado = lista.some((x) => (x.precos?.[i.produtoId] ?? null) !== null);
      const escolhido = escolhas[i.produtoId];
      if (!ofertado) continue;
      if (escolhido === undefined) return c.json({ error: `Escolha o fornecedor de ${i.nome}.` }, 400);
      if (fornecedoresDa(escolhido).some((codigo) => precoDe(i.produtoId, codigo) === null)) return c.json({ error: `O fornecedor escolhido não ofereceu preço para ${i.nome}.` }, 400);
      if (Array.isArray(escolhido)) {
        const lojasDoItem = new Set(i.quantidades.filter((q) => q.quantidade > 0).map((q) => q.codigoLoja));
        const pares = new Set(escolhido.map((p) => `${p.codigoLoja}|${p.codigoFornecedor}`));
        if (pares.size !== escolhido.length || escolhido.some((p) => !lojasDoItem.has(p.codigoLoja))) return c.json({ error: `Divisão inválida de ${i.nome}.` }, 400);
      }
    }
    if (Object.keys(escolhas).some((id) => !lista.some((x) => (x.precos?.[id] ?? null) !== null))) return c.json({ error: "Há produto sem oferta na escolha." }, 400);
    if (Object.keys(quantidades ?? {}).some((id) => escolhas[id] === undefined)) return c.json({ error: "Há quantidade de produto sem fornecedor escolhido." }, 400);
    if (semCotacao && Object.keys(escolhas).length > 0) return c.json({ error: "Pedido só de Lojas não tem fornecedor a escolher." }, 400);
    const confirmado = semCotacao ? await pedidos.confirmarSemCotacao(pedido.id, version) : await pedidos.confirmar(pedido.id, escolhas, version);
    if (!confirmado) return c.json(DESATUALIZADO, 409);
    // A quantidade confirmada vai para o fornecedor escolhido do produto: é a que o PDF dele leva.
    const porFornecedor = new Map<number, Record<string, number>>();
    for (const [produtoId, quantidade] of Object.entries(quantidades ?? {})) {
      const codigo = escolhas[produtoId];
      // No produto dividido a quantidade de cada distribuidora vem das parcelas.
      if (typeof codigo === "number") porFornecedor.set(codigo, { ...porFornecedor.get(codigo), [produtoId]: quantidade });
    }
    for (const [codigo, qtds] of porFornecedor) await cotacoes.definirQuantidades(pedido.id, codigo, qtds);
    const linhas = confirmado.itens.flatMap((i) => i.quantidades);
    await registrar(c, CONFIRMACAO_ACTIONS.confirmar, confirmado, {
      produtos: confirmado.itens.filter((i) => escolhas[i.produtoId] !== undefined || i.quantidades.some((q) => q.lojasFornecedoras?.length)).length,
      fornecedores: new Set(Object.values(escolhas).flatMap(fornecedoresDa)).size + new Set(linhas.flatMap((q) => (q.lojasFornecedoras ?? []).map((l) => l.codigoLoja))).size,
    });
    return c.json(confirmado);
  });

  routes.get(`${BASE}/pdf/:codigo`, auth, async (c: AuthContext) => {
    const achado = await doPedido(c, confirmar);
    if ("recusa" in achado) return achado.recusa;
    const { pedido } = achado;
    if (!EM_RECEBIMENTO.includes(pedido.status)) return c.json({ error: "Confirme o Pedido antes de gerar o PDF." }, 409);
    const codigo = CodigoEmTexto.safeParse(c.req.param("codigo"));
    const cotacao = codigo.success ? (await cotacoes.listar(pedido.id)).find((x) => x.codigoFornecedor === codigo.data) : undefined;
    const itens = cotacao?.precos ? itensDoFornecedor(pedido, cotacao.codigoFornecedor, cotacao.precos, cotacao.quantidades) : [];
    if (!cotacao || itens.length === 0) return c.json({ error: "Nenhum produto do Pedido foi escolhido neste fornecedor." }, 404);
    // O nome vem sempre do ERP: sem ele o PDF seria enviado ao fornecedor errado ou sem identificação.
    const nome = await nomeDoFornecedor(erpClient(), cotacao.codigoFornecedor);
    if (!nome) return c.json({ error: SEM_NOME }, 422);
    // `?modo=loja`: uma seção por Loja, com a quantidade que cada uma pediu (a quantidade confirmada pela distribuidora é um total, sem divisão por Loja).
    const porLoja = c.req.query("modo") === "loja";
    const nomesLojas = porLoja ? new Map((await lojasDoErp(erpClient())).map((l) => [l.codigo, l.nome])) : new Map<number, string>();
    const lojas = porLoja && cotacao.precos ? itensDoFornecedorPorLoja(pedido, cotacao.codigoFornecedor, cotacao.precos, (codigo) => nomesLojas.get(codigo) ?? `Loja ${codigo}`) : undefined;
    if (porLoja && !lojas?.length) return c.json({ error: "Nenhum produto do Pedido foi escolhido neste fornecedor." }, 404);
    const arquivo = await gerarPdf({ fornecedor: nome, data: new Date(pedido.confirmadoEm ?? pedido.criadoEm).toLocaleDateString("pt-BR"), itens, lojas });
    return c.json({ nome: `${nomeDoArquivo(`Pedido ${nome} ${pedido.criadoEm.slice(0, 10)}${porLoja ? " por Loja" : ""}`)}.pdf`, conteudo: arquivo.toString("base64") });
  });

  routes.get(`${BASE}/pdf-loja/:codigo`, auth, async (c: AuthContext) => {
    const achado = await doPedido(c, confirmar);
    if ("recusa" in achado) return achado.recusa;
    const { pedido } = achado;
    // Sai já antes da confirmação: a Loja pode separar sem esperar os preços das distribuidoras.
    if (pedido.status === "cancelado") return c.json({ error: "O Pedido foi cancelado." }, 409);
    const codigo = CodigoEmTexto.safeParse(c.req.param("codigo"));
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const nomesLojas = new Map((await lojasDoErp(client)).map((l) => [l.codigo, l.nome]));
      const nomeDe = (n: number) => nomesLojas.get(n) ?? `Loja ${n}`;
      const destinos = codigo.success ? itensDaLojaFornecedora(pedido, codigo.data, nomeDe) : [];
      if (!codigo.success || destinos.length === 0) return c.json({ error: "Nenhum produto do Pedido foi pedido a esta Loja." }, 404);
      const nome = nomeDe(codigo.data);
      const arquivo = await gerarPdfDeLoja({ fornecedora: nome, data: new Date(pedido.confirmadoEm ?? pedido.criadoEm).toLocaleDateString("pt-BR"), destinos });
      return c.json({ nome: `${nomeDoArquivo(`Transferência ${nome} ${pedido.criadoEm.slice(0, 10)}`)}.pdf`, conteudo: arquivo.toString("base64") });
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.post(`${BASE}/conferir`, auth, async (c: AuthContext) => {
    const achado = await doPedido(c, gerir);
    if ("recusa" in achado) return achado.recusa;
    const { pedido } = achado;
    if (!EM_RECEBIMENTO.includes(pedido.status)) return c.json({ error: "Confirme o Pedido antes de conferir com a NF." }, 409);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const linhas = conferir(pedido, await entradasDoPedido(client, pedido));
      const status = statusDoPedido(linhas);
      const atual = status === pedido.status ? pedido : ((await pedidos.registrarRecebimento(pedido.id, status)) ?? pedido);
      await registrar(c, CONFIRMACAO_ACTIONS.conferir, atual, { status });
      return c.json({ pedido: atual, linhas });
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });
}

const completa = (l: LinhaConferida) => l.estado === "recebido" || l.estado === "excedente";
const produtosDe = (linhas: LinhaConferida[]) => {
  const porProduto = new Map<string, LinhaConferida[]>();
  for (const l of linhas) porProduto.set(l.produtoId, [...(porProduto.get(l.produtoId) ?? []), l]);
  return [...porProduto.values()];
};

/** O nome do fornecedor no ERP; null quando o ERP falha ou não o devolve. */
async function nomeDoFornecedor(client: ErpQuery | undefined, codigo: number): Promise<string | null> {
  if (!client) return null;
  try {
    const [r] = await client.query<{ nome: string | null }>(nomesSql(1), { c0: codigo });
    return r?.nome?.trim() || null;
  } catch {
    return null;
  }
}
