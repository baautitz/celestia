import type { MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { COLUNA_DESEMPENHO_TARGET, COLUNAS_DESEMPENHO_ACTIONS, COLUNAS_DESEMPENHO_PLUGIN, type ValoresColuna } from "./colunas-desempenho-audit.js";
import { DadosColunaDesempenho, descreverColuna, problemaDaColuna, usadaEmUniao, type ColunaDesempenho } from "./colunas-desempenho.js";
import type { ColunaDesempenhoStore } from "./colunas-desempenho-store.js";
import { NomeDuplicadoError } from "./erros-de-store.js";
import { ator, recusaDeValidacao, Version, versaoDaQuery, versaoDesatualizada, type AuthContext } from "./metas-comum.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { AuditService } from "./vinculo-audit.js";
import type { z } from "zod";

export interface ColunasDesempenhoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  store: ColunaDesempenhoStore;
  audit: AuditService;
}

const NAO_ENCONTRADA = "Coluna não encontrada.";
const NOME_DUPLICADO = "Já existe uma coluna com este nome.";
const VERSAO_DESATUALIZADA = versaoDesatualizada("A coluna foi alterada por outra pessoa. A lista foi recarregada.");
const Edicao = DadosColunaDesempenho.extend({ version: Version });

/** Colunas personalizadas do Desempenho de Vendas: o cliente monta o que cada uma soma. */
export function registerColunasDesempenhoRoutes({ routes, permissions, auth, store, audit }: ColunasDesempenhoRoutesDeps): void {
  const manage = INOVAFARMA_PERMISSIONS.ref("colunas-desempenho:manage");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, manage.key);

  const valores = (c: Pick<ColunaDesempenho, "nome" | "entradas" | "uniao">, todas: ColunaDesempenho[]): ValoresColuna => ({ nome: c.nome, conteudo: descreverColuna(c, todas) });

  const registrar = (c: AuthContext, action: string, coluna: ColunaDesempenho, todas: ColunaDesempenho[], anterior: ColunaDesempenho | null = null) =>
    audit.record({
      plugin: COLUNAS_DESEMPENHO_PLUGIN,
      action,
      actor: ator(c),
      target: { type: COLUNA_DESEMPENHO_TARGET, id: coluna.id },
      attributes: { ...valores(coluna, todas), anterior: anterior && valores(anterior, todas) },
    });

  /** Lê e valida o corpo contra as outras colunas; devolve os dados ou a resposta de recusa. */
  const ler = async <S extends typeof DadosColunaDesempenho | typeof Edicao>(c: AuthContext, schema: S, id?: string) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return { recusa: recusaDeValidacao(c, parsed.error) } as const;
    const problema = problemaDaColuna(parsed.data, await store.listar(), id);
    if (problema) return { recusa: c.json({ error: problema }, 400) } as const;
    return { dados: parsed.data as z.infer<S> } as const;
  };

  routes.get("/colunas-desempenho", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    return c.json(await store.listar());
  });

  routes.post("/colunas-desempenho", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const lido = await ler(c, DadosColunaDesempenho);
    if ("recusa" in lido) return lido.recusa;
    let criada: ColunaDesempenho;
    try {
      criada = await store.criar(lido.dados);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
      throw err;
    }
    await registrar(c, COLUNAS_DESEMPENHO_ACTIONS.criar, criada, await store.listar());
    return c.json(criada, 201);
  });

  routes.put("/colunas-desempenho/:id", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const anterior = await store.coluna(c.req.param("id") ?? "");
    if (!anterior) return c.json({ error: NAO_ENCONTRADA }, 404);
    const lido = await ler(c, Edicao, anterior.id);
    if ("recusa" in lido) return lido.recusa;
    const { version, ...dados } = lido.dados;
    // Uma coluna usada numa união não vira ela mesma uma união: a condição da outra deixaria de ser plana.
    if (dados.uniao.length > 0 && usadaEmUniao(anterior.id, await store.listar()).length > 0) return c.json({ error: "Esta coluna é usada na união de outra: ela não pode virar uma união." }, 400);
    let atualizada: ColunaDesempenho | null;
    try {
      atualizada = await store.atualizar(anterior.id, dados, version);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
      throw err;
    }
    if (!atualizada) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, COLUNAS_DESEMPENHO_ACTIONS.editar, atualizada, await store.listar(), anterior);
    return c.json(atualizada);
  });

  routes.delete("/colunas-desempenho/:id", auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: manage.deniedMessage }, 403);
    const versao = versaoDaQuery(c);
    if ("recusa" in versao) return versao.recusa;
    const todas = await store.listar();
    const coluna = todas.find((x) => x.id === c.req.param("id"));
    if (!coluna) return c.json({ error: NAO_ENCONTRADA }, 404);
    const usos = usadaEmUniao(coluna.id, todas);
    if (usos.length > 0) return c.json({ error: `A coluna é usada na união de ${usos.map((u) => `"${u.nome}"`).join(", ")}: remova-a de lá antes.` }, 409);
    if (!(await store.remover(coluna.id, versao.version))) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, COLUNAS_DESEMPENHO_ACTIONS.remover, coluna, todas);
    return c.body(null, 204);
  });
}
