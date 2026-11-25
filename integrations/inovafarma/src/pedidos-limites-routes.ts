import type { MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { horaDoErp } from "./baixas-da-loja.js";
import type { CotacaoStore } from "./cotacao-store.js";
import { FORNECEDORES_SQL } from "./cotacao-routes.js";
import { NomeDuplicadoError } from "./erros-de-store.js";
import { registrarBuscaDaLista } from "./lista-busca-routes.js";
import { ator, erroDoErp, recusaDeValidacao, SEM_CONEXAO, Version, versaoDaQuery, versaoDesatualizada, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import { LIMITE_REGRA_TARGET, LIMITE_VALOR_TARGET, LIMITES_ACTIONS } from "./pedidos-limites-audit.js";
import { consumoDoLimite } from "./pedidos-limites-consumo.js";
import { DadosRegraLimite, DadosValorLimite, type RegraLimite, type ValorLimite } from "./pedidos-limites.js";
import { RegraComValoresError, RegraInexistenteError, type LimitesStore } from "./pedidos-limites-store.js";
import type { PedidoStore } from "./pedidos-store.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { lojasDoErp } from "./pre-vencidos-comum.js";
import { parametrosBusca } from "./produtos-erp.js";
import type { AuditService } from "./vinculo-audit.js";

export interface PedidosLimitesRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  limites: LimitesStore;
  pedidos: PedidoStore;
  cotacoes: CotacaoStore;
  audit: AuditService;
}

const BASE = "/pedidos/limites";
const REGRA_NAO_ENCONTRADA = "Regra de Limite não encontrada.";
const VALOR_NAO_ENCONTRADO = "Valor do Limite não encontrado.";
const NOME_DUPLICADO = "Já existe uma Regra de Limite com este nome.";
const COM_VALORES = "A Regra de Limite tem Valores lançados. Exclua os Valores antes de excluir a Regra.";
const DESATUALIZADO = versaoDesatualizada("O Limite foi alterado por outra pessoa. A tela foi recarregada.");

const EdicaoRegra = DadosRegraLimite.extend({ version: Version });
const EdicaoValor = DadosValorLimite.safeExtend({ version: Version });

const atributosDaRegra = (r: RegraLimite) => ({ nome: r.nome, entradas: r.entradas.length, fornecedores: r.fornecedores });

/** Limite de Compras: Regras, Valores e o consumo de cada Valor, calculado ao vivo com o ERP (só leitura nele). */
export function registerPedidosLimitesRoutes({ routes, permissions, auth, erpClient, limites, pedidos, cotacoes, audit }: PedidosLimitesRoutesDeps): void {
  const ver = INOVAFARMA_PERMISSIONS.ref("pedidos-limites:ver");
  const gerir = INOVAFARMA_PERMISSIONS.ref("pedidos-limites:gerir");
  const tem = (c: AuthContext, key: string) => permissions.has(c.get("user")?.permissions, key);
  const recusa = (c: AuthContext, exigida: typeof ver | typeof gerir) => (tem(c, exigida.key) ? null : c.json({ error: exigida.deniedMessage }, 403));
  const corpo = (c: AuthContext) => c.req.json().catch(() => null);
  const regraDe = async (id: string) => (await limites.regras()).find((r) => r.id === id);
  const valorDe = async (id: string) => (await limites.valores()).find((v) => v.id === id);

  const registrar = (c: AuthContext, action: string, type: string, id: string, attributes: Record<string, unknown>) =>
    audit.record({ plugin: PEDIDOS_PLUGIN, action, actor: ator(c), target: { type, id }, attributes });

  const registrarValor = async (c: AuthContext, action: string, valor: ValorLimite) => {
    const { distribuicao } = valor;
    await registrar(c, action, LIMITE_VALOR_TARGET, valor.id, {
      regra: (await regraDe(valor.regraId))?.nome ?? valor.regraId,
      inicio: valor.inicio,
      fim: valor.fim,
      totalCentavos: distribuicao.tipo === "todas" ? distribuicao.valorCentavos : distribuicao.lojas.reduce((t, l) => t + l.valorCentavos, 0),
      lojas: distribuicao.tipo === "todas" ? [] : distribuicao.lojas.map((l) => l.codigoLoja),
    });
  };

  /** As recusas que o store levanta; o resto segue como erro. */
  const recusaDoStore = (c: AuthContext, err: unknown) => {
    if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
    if (err instanceof RegraComValoresError) return c.json({ error: COM_VALORES }, 409);
    if (err instanceof RegraInexistenteError) return c.json({ error: REGRA_NAO_ENCONTRADA }, 404);
    throw err;
  };

  routes.get(BASE, auth, async (c: AuthContext) => {
    const negado = recusa(c, ver);
    if (negado) return negado;
    const [regras, valores, lojas] = await Promise.all([limites.regras(), limites.valores(), lojasDoErp(erpClient())]);
    return c.json({ hoje: horaDoErp(new Date().toISOString()).slice(0, 10), podeGerir: tem(c, gerir.key), lojas, regras, valores });
  });

  registrarBuscaDaLista({ routes, auth, erpClient, base: `${BASE}/lista`, recusa: (c) => recusa(c, gerir) });

  /** As distribuidoras ativas do ERP, para a Regra. */
  routes.get(`${BASE}/fornecedores`, auth, async (c: AuthContext) => {
    const negado = recusa(c, ver);
    if (negado) return negado;
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const linhas = await client.query<{ codigo: number; nome: string | null }>(FORNECEDORES_SQL, parametrosBusca(""));
      return c.json(linhas.map((l) => ({ codigo: Number(l.codigo), nome: l.nome?.trim() || `Distribuidora ${l.codigo}` })));
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.post(`${BASE}/regras`, auth, async (c: AuthContext) => {
    const negado = recusa(c, gerir);
    if (negado) return negado;
    const lido = DadosRegraLimite.safeParse(await corpo(c));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    try {
      const regra = await limites.criarRegra(lido.data);
      await registrar(c, LIMITES_ACTIONS.criarRegra, LIMITE_REGRA_TARGET, regra.id, atributosDaRegra(regra));
      return c.json(regra, 201);
    } catch (err: unknown) {
      return recusaDoStore(c, err);
    }
  });

  routes.put(`${BASE}/regras/:id`, auth, async (c: AuthContext) => {
    const negado = recusa(c, gerir);
    if (negado) return negado;
    const id = c.req.param("id") ?? "";
    if (!(await regraDe(id))) return c.json({ error: REGRA_NAO_ENCONTRADA }, 404);
    const lido = EdicaoRegra.safeParse(await corpo(c));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const { version, ...dados } = lido.data;
    try {
      const regra = await limites.atualizarRegra(id, dados, version);
      if (!regra) return c.json(DESATUALIZADO, 409);
      await registrar(c, LIMITES_ACTIONS.editarRegra, LIMITE_REGRA_TARGET, regra.id, atributosDaRegra(regra));
      return c.json(regra);
    } catch (err: unknown) {
      return recusaDoStore(c, err);
    }
  });

  routes.delete(`${BASE}/regras/:id`, auth, async (c: AuthContext) => {
    const negado = recusa(c, gerir);
    if (negado) return negado;
    const versao = versaoDaQuery(c);
    if ("recusa" in versao) return versao.recusa;
    const regra = await regraDe(c.req.param("id") ?? "");
    if (!regra) return c.json({ error: REGRA_NAO_ENCONTRADA }, 404);
    try {
      if (!(await limites.removerRegra(regra.id, versao.version))) return c.json(DESATUALIZADO, 409);
    } catch (err: unknown) {
      return recusaDoStore(c, err);
    }
    await registrar(c, LIMITES_ACTIONS.removerRegra, LIMITE_REGRA_TARGET, regra.id, atributosDaRegra(regra));
    return c.body(null, 204);
  });

  routes.post(`${BASE}/valores`, auth, async (c: AuthContext) => {
    const negado = recusa(c, gerir);
    if (negado) return negado;
    const lido = DadosValorLimite.safeParse(await corpo(c));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    try {
      const valor = await limites.criarValor(lido.data);
      await registrarValor(c, LIMITES_ACTIONS.criarValor, valor);
      return c.json(valor, 201);
    } catch (err: unknown) {
      return recusaDoStore(c, err);
    }
  });

  routes.put(`${BASE}/valores/:id`, auth, async (c: AuthContext) => {
    const negado = recusa(c, gerir);
    if (negado) return negado;
    const id = c.req.param("id") ?? "";
    if (!(await valorDe(id))) return c.json({ error: VALOR_NAO_ENCONTRADO }, 404);
    const lido = EdicaoValor.safeParse(await corpo(c));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const { version, ...dados } = lido.data;
    try {
      const valor = await limites.atualizarValor(id, dados, version);
      if (!valor) return c.json(DESATUALIZADO, 409);
      await registrarValor(c, LIMITES_ACTIONS.editarValor, valor);
      return c.json(valor);
    } catch (err: unknown) {
      return recusaDoStore(c, err);
    }
  });

  routes.delete(`${BASE}/valores/:id`, auth, async (c: AuthContext) => {
    const negado = recusa(c, gerir);
    if (negado) return negado;
    const versao = versaoDaQuery(c);
    if ("recusa" in versao) return versao.recusa;
    const valor = await valorDe(c.req.param("id") ?? "");
    if (!valor) return c.json({ error: VALOR_NAO_ENCONTRADO }, 404);
    if (!(await limites.removerValor(valor.id, versao.version))) return c.json(DESATUALIZADO, 409);
    await registrarValor(c, LIMITES_ACTIONS.removerValor, valor);
    return c.body(null, 204);
  });

  routes.get(`${BASE}/valores/:id/consumo`, auth, async (c: AuthContext) => {
    const negado = recusa(c, ver);
    if (negado) return negado;
    const valor = await valorDe(c.req.param("id") ?? "");
    const regra = valor && (await regraDe(valor.regraId));
    if (!valor || !regra) return c.json({ error: VALOR_NAO_ENCONTRADO }, 404);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      return c.json(await consumoDoLimite({ client, pedidos, cotacoes }, regra, valor));
    } catch (err: unknown) {
      console.error("Pedidos: falha no consumo do Limite de Compras.", err);
      return c.json(erroDoErp(err), 503);
    }
  });
}
