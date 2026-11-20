import { describe, it, expect, vi } from "vitest";
import { EventBus, CancelEvent } from "./events.js";

type M = { save: { id: number } };
const mk = () => {
  const onError = vi.fn();
  return { bus: new EventBus<M>(onError), onError };
};

describe("EventBus", () => {
  it("ordena por prioridade e registro", async () => {
    const { bus } = mk();
    const o: string[] = [];
    bus.before("save", () => void o.push("c"), { priority: 5 });
    bus.before("save", () => void o.push("a"), { priority: -1 });
    bus.before("save", () => void o.push("b"));
    bus.before("save", () => void o.push("b2"));
    await bus.run("save", { id: 1 }, () => 1);
    expect(o).toEqual(["a", "b", "b2", "c"]);
  });

  it("cancel para a cadeia, sem action nem after", async () => {
    const { bus } = mk();
    const action = vi.fn();
    const after = vi.fn();
    const second = vi.fn();
    bus.before("save", (c) => c.cancel("nope"), { module: "m1" });
    bus.before("save", second);
    bus.after("save", after);
    expect(await bus.run("save", { id: 1 }, action)).toEqual({ cancelled: true, reason: "nope", by: "m1" });
    expect(action).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("CancelEvent lançado cancela", async () => {
    const { bus } = mk();
    bus.before("save", () => { throw new CancelEvent("x"); }, { module: "m" });
    expect(await bus.emit("save", { id: 1 })).toEqual({ cancelled: true, reason: "x", by: "m" });
  });

  it("after recebe result; action que lança não dispara after", async () => {
    const { bus } = mk();
    const after = vi.fn();
    bus.after("save", after);
    await bus.run("save", { id: 1 }, () => "ok");
    expect(after).toHaveBeenCalledWith({ id: 1, result: "ok" }, { signal: expect.any(AbortSignal) });
    after.mockClear();
    await expect(bus.run("save", { id: 1 }, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(after).not.toHaveBeenCalled();
  });

  it("falha em after é isolada", async () => {
    const { bus, onError } = mk();
    const ok = vi.fn();
    bus.after("save", () => { throw new Error("x"); });
    bus.after("save", ok);
    const r = await bus.run("save", { id: 1 }, () => 1);
    expect(r).toEqual({ cancelled: false, result: 1 });
    expect(ok).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("erro genérico no before cancela (fail-closed) e registra", async () => {
    const { bus, onError } = mk();
    bus.before("save", () => { throw new Error("bug"); });
    const r = await bus.emit("save", { id: 1 });
    expect(r.cancelled).toBe(true);
    expect(onError).toHaveBeenCalled();
  });

  it("timeout: before cancela, after ignorado", async () => {
    vi.useFakeTimers();
    try {
      const { bus, onError } = mk();
      const never = () => new Promise<void>(() => {});
      bus.before("save", never, { module: "slow", timeoutMs: 100 });
      const p = bus.emit("save", { id: 1 });
      await vi.advanceTimersByTimeAsync(100);
      expect(await p).toEqual({ cancelled: true, reason: "Tempo esgotado em slow", by: "slow" });

      const bus2 = new EventBus<M>(onError);
      const ok = vi.fn();
      bus2.after("save", never, { timeoutMs: 100 });
      bus2.after("save", ok);
      const p2 = bus2.run("save", { id: 1 }, () => 1);
      await vi.advanceTimersByTimeAsync(100);
      expect(await p2).toEqual({ cancelled: false, result: 1 });
      expect(ok).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("off() remove e payload é congelado", async () => {
    const { bus } = mk();
    const h = vi.fn();
    const off = bus.before("save", h);
    off();
    await bus.emit("save", { id: 1 });
    expect(h).not.toHaveBeenCalled();
    let frozen = false;
    bus.before("save", (c) => { frozen = Object.isFrozen(c.payload); });
    await bus.emit("save", { id: 1 });
    expect(frozen).toBe(true);
  });

  it("sem onError, falhas vão ao logger injetado só com evento, módulo e mensagem (nunca o payload nem o erro bruto)", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const bus = new EventBus<M>(undefined, logger);
    bus.after("save", () => { throw Object.assign(new Error("falhou"), { params: ["Seg@1234"] }); }, { module: "m" });
    await bus.run("save", { id: 99 }, () => 1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Falha em handler do evento "save" (módulo "m"): Error: falhou');
  });

  it("o after recebe o result tipado e um signal", async () => {
    const { bus } = mk();
    let seen: { result: number; signal: AbortSignal } | undefined;
    bus.after("save", (p, ctx) => { seen = { result: (p as { result: number }).result, signal: ctx.signal }; });
    await bus.run("save", { id: 1 }, () => 7);
    expect(seen?.result).toBe(7);
    expect(seen?.signal.aborted).toBe(false);
  });

  it("no timeout o signal do handler é abortado, mas o handler que o ignora segue rodando", async () => {
    vi.useFakeTimers();
    try {
      const { bus } = mk();
      let signal: AbortSignal | undefined;
      let finished = false;
      bus.before("save", (c) => {
        signal = c.signal;
        return new Promise<void>((res) => setTimeout(() => { finished = true; res(); }, 500));
      }, { timeoutMs: 100 });
      const p = bus.emit("save", { id: 1 });
      await vi.advanceTimersByTimeAsync(100);
      expect((await p).cancelled).toBe(true);
      expect(signal?.aborted).toBe(true);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
      expect(finished).toBe(true); // o timeout não cancela um handler que ignora o sinal
    } finally {
      vi.useRealTimers();
    }
  });
});
