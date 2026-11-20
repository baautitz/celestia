// owner: T2 events
import type { Logger } from "./module.js";

export interface EventHandlerOptions {
  /** "before": valida/cancela antes da ação. "after": notifica depois do commit. Padrão "after". */
  phase?: "before" | "after";
  /** Menor roda primeiro; desempate pela ordem de registro. Padrão 0. */
  priority?: number;
  /** Padrão 2000 ms. */
  timeoutMs?: number;
  module?: string;
}

export type EmitResult = { cancelled: false } | { cancelled: true; reason: string; by?: string };

/** Lançar dentro de um handler `before` cancela o evento com o motivo. */
export class CancelEvent extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "CancelEvent";
  }
}

/**
 * Contexto do `before`: SOMENTE leitura. O payload é congelado (shallow); handlers `before`
 * devem apenas validar, nunca gravar (não há como impedir tecnicamente).
 */
export interface BeforeContext<P> {
  readonly payload: Readonly<P>;
  cancel(reason: string): void;
  /** Abortado quando o `timeoutMs` do handler estoura; repasse-o a I/O cancelável (fetch, consultas) para não deixar trabalho órfão. */
  readonly signal: AbortSignal;
}

/** Payload entregue aos handlers `after`: o do evento mais o `result` da ação. */
export type AfterPayload<P, R = unknown> = P & { readonly result: R };
export interface AfterContext {
  /** Abortado quando o `timeoutMs` do handler estoura. */
  readonly signal: AbortSignal;
}

export type BeforeHandler<P> = (ctx: BeforeContext<P>) => void | Promise<void>;
export type AfterHandler<P, R = unknown> = (payload: Readonly<AfterPayload<P, R>>, ctx: AfterContext) => void | Promise<void>;

interface Entry {
  handler: (...args: never[]) => void | Promise<void>;
  phase: "before" | "after";
  priority: number;
  timeoutMs: number;
  module?: string;
  seq: number;
}

const TIMEOUT = Symbol("timeout");

/**
 * Espera `fn` por no máximo `ms`. Estourar o prazo NÃO cancela o handler (JavaScript não interrompe uma Promise em
 * andamento): o `AbortSignal` é abortado e a cadeia segue, mas o handler que ignorar o sinal continua rodando e pode
 * concluir depois, inclusive com efeitos. Por isso handlers devem repassar o `signal` a qualquer I/O cancelável.
 */
async function withTimeout(fn: (signal: AbortSignal) => void | Promise<void>, ms: number): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((res) => {
    timer = setTimeout(() => res(TIMEOUT), ms);
  });
  try {
    const r = await Promise.race([Promise.resolve().then(() => fn(controller.signal)), timeout]);
    if (r === TIMEOUT) {
      controller.abort(new Error("Tempo esgotado"));
      throw TIMEOUT;
    }
  } finally {
    clearTimeout(timer);
  }
}

export type ErrorSink = (err: Error, info: { event: string; module?: string }) => void;

/** Sink padrão: só evento, módulo e mensagem. Nunca o payload nem o objeto do erro (pode carregar parâmetros e segredos). */
const loggingSink =
  (logger: Logger): ErrorSink =>
  (err, { event, module }) =>
    logger.error(`Falha em handler do evento "${event}"${module ? ` (módulo "${module}")` : ""}: ${err.name}: ${err.message}`);

export class EventBus<EventMap extends Record<string, object>> {
  private entries = new Map<keyof EventMap, Entry[]>();
  private seq = 0;
  private readonly onError: ErrorSink;

  /** `onError` recebe as falhas isoladas dos handlers; sem ele, vão para o `logger` injetado (padrão: console). */
  constructor(onError?: ErrorSink, logger: Logger = console) {
    this.onError = onError ?? loggingSink(logger);
  }

  on<K extends keyof EventMap>(
    event: K,
    handler: BeforeHandler<EventMap[K]> | AfterHandler<EventMap[K]>,
    options: EventHandlerOptions = {},
  ): () => void {
    const entry: Entry = {
      handler: handler as Entry["handler"],
      phase: options.phase ?? "after",
      priority: options.priority ?? 0,
      timeoutMs: options.timeoutMs ?? 2000,
      module: options.module,
      seq: this.seq++,
    };
    const list = this.entries.get(event) ?? [];
    list.push(entry);
    this.entries.set(event, list);
    return () => {
      const l = this.entries.get(event);
      if (l) this.entries.set(event, l.filter((e) => e !== entry));
    };
  }

  before<K extends keyof EventMap>(event: K, handler: BeforeHandler<EventMap[K]>, options: Omit<EventHandlerOptions, "phase"> = {}) {
    return this.on(event, handler, { ...options, phase: "before" });
  }

  after<K extends keyof EventMap>(event: K, handler: AfterHandler<EventMap[K]>, options: Omit<EventHandlerOptions, "phase"> = {}) {
    return this.on(event, handler, { ...options, phase: "after" });
  }

  private sorted(event: keyof EventMap, phase: "before" | "after"): Entry[] {
    return (this.entries.get(event) ?? [])
      .filter((e) => e.phase === phase)
      .sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  }

  private fail(err: unknown, event: keyof EventMap, module?: string): void {
    this.onError(err instanceof Error ? err : new Error(String(err)), { event: String(event), module });
  }

  /** Primitiva: roda só os `before` em série; não dispara `after`. */
  async emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<EmitResult> {
    const frozen: Readonly<EventMap[K]> = Object.freeze({ ...payload });
    for (const e of this.sorted(event, "before")) {
      let reason: string | undefined;
      try {
        await withTimeout((signal) => {
          const ctx: BeforeContext<EventMap[K]> = {
            payload: frozen,
            cancel: (r) => {
              reason ??= r;
            },
            signal,
          };
          return (e.handler as BeforeHandler<EventMap[K]>)(ctx);
        }, e.timeoutMs);
      } catch (err) {
        if (err === TIMEOUT) {
          reason = `Tempo esgotado em ${e.module ?? "handler"}`;
        } else if (err instanceof CancelEvent) {
          reason = err.reason;
        } else {
          this.fail(err, event, e.module);
          reason = `Falha ao validar em ${e.module ?? "handler"}`;
        }
      }
      if (reason !== undefined) return { cancelled: true, reason, by: e.module };
    }
    return { cancelled: false };
  }

  /** Primitiva: dispara os `after`; falhas isoladas e enviadas a `onError`. */
  async commit<K extends keyof EventMap, R = unknown>(event: K, payload: AfterPayload<EventMap[K], R>): Promise<void> {
    const frozen: Readonly<AfterPayload<EventMap[K], R>> = Object.freeze({ ...payload });
    for (const e of this.sorted(event, "after")) {
      try {
        await withTimeout((signal) => (e.handler as AfterHandler<EventMap[K], R>)(frozen, { signal }), e.timeoutMs);
      } catch (err) {
        this.fail(err === TIMEOUT ? new Error(`Tempo esgotado em ${e.module ?? "handler"}`) : err, event, e.module);
      }
    }
  }

  /**
   * API principal: before -> action -> after({...payload, result}).
   * Cancelado: action não roda. action lança: after não roda e o erro propaga.
   */
  async run<K extends keyof EventMap, R>(
    event: K,
    payload: EventMap[K],
    action: () => R | Promise<R>,
  ): Promise<{ cancelled: true; reason: string; by?: string } | { cancelled: false; result: R }> {
    const r = await this.emit(event, payload);
    if (r.cancelled) return r;
    const result = await action();
    await this.commit<K, R>(event, { ...payload, result });
    return { cancelled: false, result };
  }
}
