import ivm from "isolated-vm";
import type { ActionContext, RecipeDef } from "@platform/shared";

const MEMORY_LIMIT_MB = 64;
const LOAD_TIMEOUT_MS = 1000;
const CALL_TIMEOUT_MS = 2000;

/**
 * Roda dentro do isolate antes do código do Modelo. Tudo aqui pertence ao isolate (nenhum objeto do host).
 */
const PRELUDE = `
  var module = { exports: {} };
  var exports = module.exports;
  var defineRecipe = function (config) { return config; };
  var require = function () { return { defineRecipe: defineRecipe }; };
  var console = { log: function () {}, info: function () {}, warn: function () {}, error: function () {}, debug: function () {} };
`;

/**
 * Converte o Modelo em JSON: cada função vira { __fn: caminho } e fica guardada em __fns dentro do isolate.
 */
const EXTRACT = `
  const recipe = (module.exports && module.exports.default) || exports.default || module.exports;
  if (!recipe || typeof recipe !== "object" || !recipe.id) {
    throw new Error("O código não exporta um Modelo válido com defineRecipe().");
  }
  const fns = (globalThis.__fns = {});
  const seen = new WeakSet();
  const walk = (value, path) => {
    if (typeof value === "function") {
      fns[path] = value;
      return { __fn: path };
    }
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) throw new Error("O Modelo não pode conter referências circulares.");
    seen.add(value);
    const out = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
      out[key] = walk(value[key], path ? path + "." + key : key);
    }
    seen.delete(value);
    return out;
  };
  return JSON.stringify(walk(recipe, ""));
`;

/**
 * Executa uma action. Os métodos de ui/persistence são stubs que chamam o host por __hostCall, em ordem,
 * e a action só termina depois que todas as chamadas pendentes (mesmo sem await) foram atendidas.
 */
const ACTION_RUNNER = `
  const path = $0;
  const data = JSON.parse($1);
  const hostPaths = JSON.parse($2);
  const callId = $3;
  let chain = Promise.resolve();
  const callHost = (hostPath, args) => {
    const run = () => __hostCall
      .apply(undefined, [callId, hostPath, JSON.stringify(args)], { arguments: { copy: true }, result: { promise: true, copy: true } })
      .then((raw) => (raw === undefined ? undefined : JSON.parse(raw)));
    const next = chain.then(run);
    chain = next.catch(() => undefined);
    return next;
  };
  const ctx = { row: data.row, form: data.form, workspace: data.workspace, ui: {}, persistence: {} };
  for (const hostPath of hostPaths) {
    const parts = hostPath.split(".");
    let target = ctx;
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]] || (target[parts[i]] = {});
    target[parts[parts.length - 1]] = (...args) => callHost(hostPath, args);
  }
  return (async () => {
    await __fns[path](ctx);
    await chain;
  })();
`;

// Funções do host expostas ao isolate (ex.: ui.toast.success). Os parâmetros variam por função, por isso `Function`.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type HostFunction = Function;

function collectHostFunctions(node: object, prefix: string, out: Map<string, HostFunction>): void {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") out.set(path, value);
    else if (value !== null && typeof value === "object") collectHostFunctions(value, path, out);
  }
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Função de um Modelo executada no isolate. Sempre assíncrona do ponto de vista do host. */
export type SandboxedFunction<TArg, TResult> = ((arg: TArg) => Promise<TResult>) & {
  /** Executa a função para todos os itens numa única ida ao isolate. */
  batch: (args: TArg[]) => Promise<TResult[]>;
};

export function isBatchable<TArg, TResult>(fn: unknown): fn is SandboxedFunction<TArg, TResult> {
  return typeof fn === "function" && "batch" in fn && typeof fn.batch === "function";
}

/**
 * Um Modelo carregado num isolate do V8: sem process, fs, rede nem objetos do host.
 * O host só troca JSON com ele; as funções do Modelo viram proxies assíncronos.
 */
export class SandboxedRecipe {
  private isolate!: ivm.Isolate;
  private context!: ivm.Context;
  private disposed = false;
  private nextCallId = 1;
  private hostCalls = new Map<number, Map<string, HostFunction>>();

  private constructor(private readonly jsCode: string) {}

  /** Carrega o código (já em JavaScript CommonJS) e devolve o Modelo com proxies no lugar das funções. */
  static async load(jsCode: string): Promise<{ recipe: RecipeDef; sandbox: SandboxedRecipe }> {
    const sandbox = new SandboxedRecipe(jsCode);
    try {
      const manifest = await sandbox.start();
      return { recipe: sandbox.reviveFunctions(manifest, "") as RecipeDef, sandbox };
    } catch (err) {
      sandbox.dispose();
      throw err;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (!this.isolate.isDisposed) this.isolate.dispose();
  }

  private async start(): Promise<Json> {
    this.isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
    this.context = await this.isolate.createContext();

    await this.context.global.set(
      "__hostCall",
      new ivm.Reference(async (callId: number, path: string, argsJson: string) => {
        const fn = this.hostCalls.get(callId)?.get(path);
        if (!fn) throw new Error(`Função '${path}' indisponível.`);
        const result: unknown = await Reflect.apply(fn, undefined, JSON.parse(argsJson));
        return result === undefined ? undefined : JSON.stringify(result);
      })
    );
    await this.context.eval(PRELUDE, { timeout: LOAD_TIMEOUT_MS });
    await this.context.eval(this.jsCode, { timeout: LOAD_TIMEOUT_MS });
    const manifest = await this.context.evalClosure(EXTRACT, [], { timeout: LOAD_TIMEOUT_MS, result: { copy: true } });
    return JSON.parse(manifest as string) as Json;
  }

  /** Se o isolate morreu (ex.: estourou a memória), sobe outro com o mesmo código. */
  private async ensureAlive(): Promise<void> {
    if (this.disposed) throw new Error("Modelo descarregado.");
    if (this.isolate.isDisposed) await this.start();
  }

  private reviveFunctions(node: Json, path: string): unknown {
    if (Array.isArray(node)) return node.map((item, index) => this.reviveFunctions(item, path ? `${path}.${index}` : String(index)));
    if (node === null || typeof node !== "object") return node;

    const marker = node.__fn;
    if (typeof marker === "string") return /(^|\.)actions\.\d+\.action$/.test(marker) ? this.actionProxy(marker) : this.functionProxy(marker);

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = this.reviveFunctions(value, path ? `${path}.${key}` : key);
    return out;
  }

  private functionProxy(path: string): SandboxedFunction<unknown, unknown> {
    const call = async (arg: unknown): Promise<unknown> => {
      await this.ensureAlive();
      const raw = await this.context.evalClosure(
        "const r = __fns[$0](JSON.parse($1)); return r === undefined ? undefined : JSON.stringify(r);",
        [path, JSON.stringify(arg ?? null)],
        { timeout: CALL_TIMEOUT_MS, result: { copy: true } }
      );
      return raw === undefined ? undefined : JSON.parse(raw as string);
    };
    const batch = async (args: unknown[]): Promise<unknown[]> => {
      await this.ensureAlive();
      const raw = await this.context.evalClosure(
        "return JSON.stringify(JSON.parse($1).map((a) => { const r = __fns[$0](a); return r === undefined ? null : r; }));",
        [path, JSON.stringify(args)],
        { timeout: CALL_TIMEOUT_MS, result: { copy: true } }
      );
      return JSON.parse(raw as string) as unknown[];
    };
    return Object.assign(call, { batch });
  }

  private actionProxy(path: string): (ctx: ActionContext) => Promise<void> {
    return async (ctx) => {
      await this.ensureAlive();
      const hostFns = new Map<string, HostFunction>();
      collectHostFunctions({ ui: ctx.ui, persistence: ctx.persistence }, "", hostFns);

      const callId = this.nextCallId++;
      this.hostCalls.set(callId, hostFns);
      try {
        await this.context.evalClosure(
          ACTION_RUNNER,
          [path, JSON.stringify({ row: ctx.row, form: ctx.form ?? null, workspace: ctx.workspace }), JSON.stringify([...hostFns.keys()]), callId],
          { timeout: CALL_TIMEOUT_MS, result: { promise: true } }
        );
      } finally {
        this.hostCalls.delete(callId);
      }
    };
  }
}
