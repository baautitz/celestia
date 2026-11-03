import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { PRODUTO_SQL, type LinhaProduto } from "./produtos-erp.js";
import { horaDoErp, inicioDoDiaNoErp } from "./baixas-da-loja.js";
import { restanteDoEstoque, type BaixasDoPeriodoDeps } from "./baixas-do-periodo.js";
import { dataBr } from "./datas.js";
import { ERP_INDISPONIVEL, erroDoErp, SEM_CONEXAO } from "./metas-comum.js";
import { inclusaoRetroativa, lojasDoErp, recusaDeLoja } from "./pre-vencidos-comum.js";
import type { PeriodsService } from "./pre-vencidos-routes.js";
import { ITEM_PRE_VENCIDO_ACTIONS, ITEM_PRE_VENCIDO_PLUGIN, ITEM_PRE_VENCIDO_TARGET, type AtributosItemPreVencido } from "./estoque-pre-vencidos-audit.js";
import type { ItemPreVencido } from "./estoque-pre-vencidos-store.js";
import type { AuditService } from "./vinculo-audit.js";
import type { VinculoStore } from "./vinculo-store.js";

/** Estoque, congelamentos e Correções (`BaixasDoPeriodoDeps`): o Restante de agora parte do último congelamento. */
export interface EstoquePreVencidosRoutesDeps extends BaixasDoPeriodoDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  vinculos: VinculoStore;
  /** Serviço `periods` do Module `closing_period`: a inclusão retroativa vai até o início do Período aberto. */
  periods: PeriodsService;
  audit: AuditService;
}

type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

const VERSAO_DESATUALIZADA = { error: "O Item foi alterado por outra pessoa. A lista foi recarregada.", code: "versao_desatualizada" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Validade = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe a validade como mês e ano (AAAA-MM).");
const Quantidade = z.number({ invalid_type_error: "Informe a quantidade." }).int("Informe uma quantidade inteira.").min(1, "Informe uma quantidade maior que zero.").max(1_000_000);
const DiaDeInclusao = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de inclusão (AAAA-MM-DD).");
const Novo = z.object({
  codigoLoja: z.number().int().min(1),
  produtoId: z.string().regex(UUID, "Produto inválido."),
  quantidade: Quantidade,
  validade: Validade,
  /** Data de inclusão retroativa (`AAAA-MM-DD`, na hora do ERP); sem ela, agora. */
  incluidoEm: DiaDeInclusao.optional(),
});
const Edicao = z.object({ quantidade: Quantidade, validade: Validade, incluidoEm: DiaDeInclusao.optional(), version: z.number().int().min(1) });

/** O que a API devolve: nunca o código do produto no ERP. */
export const itemPublico = ({ codigoProduto: _codigoProduto, ...resto }: ItemPreVencido) => resto;

/** Rotas do Estoque de Pré-vencidos: incluir, listar, editar e excluir Itens nas Lojas do Vínculo. */
export function registerEstoquePreVencidosRoutes({ routes, permissions, auth, vinculos, periods, audit, ...baixasDeps }: EstoquePreVencidosRoutesDeps): void {
  const { erpClient, store } = baixasDeps;
  const gerir = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-estoque:manage");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, gerir.key);
  const gerirBaixas = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-baixas:manage");

  /**
   * Instante de inclusão de um Item novo: agora, ou o início do dia retroativo pedido, que só quem gere as Baixas
   * informa e que vai até o início do Closing Period aberto (mesmo já terminado), nunca antes nem para o futuro. Na edição,
   * `atual` é a data de inclusão de agora: um Item incluído antes do Período aberto já entrou num Período fechado e
   * não muda de data.
   */
  const inclusao = async (c: AuthContext, dia: string | undefined, atual?: string): Promise<{ incluidoEm: string } | { erro: string; status: 400 | 403 }> => {
    if (dia === undefined) return { incluidoEm: new Date().toISOString() };
    if (!permissions.has(c.get("user")?.permissions, gerirBaixas.key)) return { erro: gerirBaixas.deniedMessage ?? "Acesso negado.", status: 403 };
    const limites = await inclusaoRetroativa(periods);
    if (!limites) return { erro: "Não há Período aberto: a data de inclusão não pode retroagir.", status: 400 };
    if (dia > limites.hoje) return { erro: "A data de inclusão não pode ser no futuro.", status: 400 };
    if (atual !== undefined && horaDoErp(atual).slice(0, 10) < limites.inicio) return { erro: "O Item foi incluído antes do Período aberto: a data de inclusão dele não muda mais.", status: 400 };
    if (dia < limites.inicio) return { erro: `A data de inclusão não pode ser antes do início do Período aberto (${dataBr(limites.inicio)}).`, status: 400 };
    return { incluidoEm: inicioDoDiaNoErp(dia) };
  };

  const nomeDaLoja = async (codigo: number) => (await lojasDoErp(erpClient())).find((l) => l.codigo === codigo)?.nome ?? "";

  const registrar = async (c: AuthContext, action: string, item: ItemPreVencido, anterior: AtributosItemPreVencido["anterior"] = null) => {
    const user = c.get("user");
    const atributos: AtributosItemPreVencido = {
      codigoLoja: item.codigoLoja,
      nomeLoja: await nomeDaLoja(item.codigoLoja),
      nomeProduto: item.nomeProduto,
      codigoBarra: item.codigoBarra,
      quantidade: item.quantidade,
      validade: item.validade,
      incluidoEm: item.incluidoEm,
      anterior,
    };
    return audit.record({
      plugin: ITEM_PRE_VENCIDO_PLUGIN,
      action,
      actor: { id: user?.sub ?? "", name: user?.fullname ?? "" },
      target: { type: ITEM_PRE_VENCIDO_TARGET, id: item.id },
      attributes: atributos,
    });
  };

  const recusaLoja = recusaDeLoja(permissions, vinculos, gerir);

  routes.get("/pre-vencidos/estoque/itens", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const codigoLoja = Number(c.req.query("codigoLoja"));
    if (!Number.isInteger(codigoLoja) || codigoLoja < 1) return c.json({ error: "Parâmetro 'codigoLoja' é obrigatório." }, 400);
    const recusa = await recusaLoja(c, codigoLoja);
    if (recusa) return recusa;
    const itens = await store.listar(codigoLoja);
    let restante: Record<string, number>;
    try {
      restante = await restanteDoEstoque(baixasDeps, codigoLoja, itens);
    } catch (err) {
      return c.json(erroDoErp(err), 503);
    }
    // Os zerados saem da lista por padrão; `zerados=true` os traz de volta.
    const zerados = c.req.query("zerados") === "true";
    return c.json(itens.map((i) => ({ ...itemPublico(i), restante: restante[i.id] ?? i.quantidade })).filter((i) => zerados || i.restante > 0));
  });

  routes.post("/pre-vencidos/estoque/itens", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const parsed = Novo.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { codigoLoja, produtoId, quantidade, validade } = parsed.data;
    const recusa = await recusaLoja(c, codigoLoja);
    if (recusa) return recusa;
    const quando = await inclusao(c, parsed.data.incluidoEm);
    if ("erro" in quando) return c.json({ error: quando.erro }, quando.status);

    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    let produto: LinhaProduto | undefined;
    try {
      [produto] = await client.query<LinhaProduto>(PRODUTO_SQL, { produtoId });
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
    if (!produto) return c.json({ error: "Produto não encontrado no ERP." }, 404);

    const criado = await store.criar({
      codigoLoja,
      produtoId: produto.produtoId,
      codigoProduto: Number(produto.codigoProduto),
      nomeProduto: (produto.nome || "").trim(),
      codigoBarra: produto.codigoBarra,
      validade,
      quantidade,
      incluidoEm: quando.incluidoEm,
    });
    await registrar(c, ITEM_PRE_VENCIDO_ACTIONS.criar, criado);
    // Recém-incluído: nenhuma venda o gastou ainda, salvo na inclusão retroativa, que a recarga da lista mostra.
    return c.json({ ...itemPublico(criado), restante: criado.quantidade }, 201);
  });

  /** Item de uma Loja do Vínculo de quem pede; senão devolve a resposta de recusa. */
  const itemDaLoja = async (c: AuthContext) => {
    if (!pode(c)) return { recusa: c.json({ error: gerir.deniedMessage }, 403) } as const;
    const item = await store.get(c.req.param("id") ?? "");
    if (!item) return { recusa: c.json({ error: "Item não encontrado." }, 404) } as const;
    const recusa = await recusaLoja(c, item.codigoLoja);
    return recusa ? ({ recusa } as const) : ({ item } as const);
  };

  routes.put("/pre-vencidos/estoque/itens/:id", auth, async (c: AuthContext) => {
    const alvo = await itemDaLoja(c);
    if ("recusa" in alvo) return alvo.recusa;
    const parsed = Edicao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { version, incluidoEm: dia, ...valores } = parsed.data;
    let incluidoEm: string | undefined;
    if (dia !== undefined) {
      const quando = await inclusao(c, dia, alvo.item.incluidoEm);
      if ("erro" in quando) return c.json({ error: quando.erro }, quando.status);
      incluidoEm = quando.incluidoEm;
    }
    const atualizado = await store.atualizar(alvo.item.id, incluidoEm === undefined ? valores : { ...valores, incluidoEm }, version);
    if (!atualizado) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, ITEM_PRE_VENCIDO_ACTIONS.editar, atualizado, {
      quantidade: alvo.item.quantidade,
      validade: alvo.item.validade,
      ...(incluidoEm === undefined ? {} : { incluidoEm: alvo.item.incluidoEm }),
    });
    // Sem `restante`: depende das vendas do ERP; a tela recarrega a lista.
    return c.json(itemPublico(atualizado));
  });

  routes.delete("/pre-vencidos/estoque/itens/:id", auth, async (c: AuthContext) => {
    const alvo = await itemDaLoja(c);
    if ("recusa" in alvo) return alvo.recusa;
    const version = Number(c.req.query("version"));
    if (!Number.isInteger(version) || version < 1) return c.json({ error: "Parâmetro 'version' é obrigatório." }, 400);
    if (!(await store.excluir(alvo.item.id, version))) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, ITEM_PRE_VENCIDO_ACTIONS.excluir, alvo.item);
    return c.json({ success: true });
  });
}
