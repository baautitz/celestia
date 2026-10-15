// owner: T2 events
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
}
export type BeforeHandler<P> = (ctx: BeforeContext<P>) => void | Promise<void>;
export type AfterHandler<P> = (payload: Readonly<P>) => void | Promise<void>;

interface Entry {
  handler: (arg: never) => void | Promise<void>;
  phase: "before" | "after";
  priority: number;
  timeoutMs: number;
  module?: string;
  seq: number;
}

const TIMEOUT = Symbol("timeout");

async function withTimeout(fn: () => void | Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((res) => {
    timer = setTimeout(() => res(TIMEOUT), ms);
  });
  try {
    const r = await Promise.race([Promise.resolve().then(fn), timeout]);
    if (r === TIMEOUT) throw TIMEOUT;
  } finally {
    clearTimeout(timer);
  }
}

export type ErrorSink = (err: Error, info: { event: string; module?: string }) => void;

export class EventBus<EventMap extends Record<string, object>> {
  private entries = new Map<keyof EventMap, Entry[]>();
  private seq = 0;

  constructor(private onError: ErrorSink = (e) => console.error(e)) {}

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
      const ctx: BeforeContext<EventMap[K]> = {
        payload: frozen,
        cancel: (r) => {
          reason ??= r;
        },
      };
      try {
        await withTimeout(() => (e.handler as BeforeHandler<EventMap[K]>)(ctx), e.timeoutMs);
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
  async commit<K extends keyof EventMap>(event: K, payload: object): Promise<void> {
    const frozen = Object.freeze({ ...payload });
    for (const e of this.sorted(event, "after")) {
      try {
        await withTimeout(() => (e.handler as AfterHandler<object>)(frozen), e.timeoutMs);
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
    await this.commit(event, { ...payload, result });
    return { cancelled: false, result };
  }
}
