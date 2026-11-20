// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleLock } from "./idle-lock";

describe("IdleLock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (overrides: Partial<ConstructorParameters<typeof IdleLock>[0]> = {}) => {
    const onIdle = vi.fn();
    const lock = new IdleLock({ idleSeconds: 10, onIdle, now: () => Date.now(), ...overrides });
    lock.start();
    return { lock, onIdle };
  };

  it("avisa quando passa o limite sem ação do usuário", () => {
    const { onIdle } = make();
    vi.advanceTimersByTime(9_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("ação do usuário (teclado, mouse) reinicia a contagem", () => {
    const { onIdle } = make();
    vi.advanceTimersByTime(8_000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    vi.advanceTimersByTime(8_000);
    expect(onIdle).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("mousedown"));
    vi.advanceTimersByTime(9_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("espera a requisição em andamento terminar antes de avisar", () => {
    let busy = true;
    const { onIdle } = make({ isBusy: () => busy });
    vi.advanceTimersByTime(30_000);
    expect(onIdle).not.toHaveBeenCalled();
    busy = false;
    vi.advanceTimersByTime(2_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("avisa uma vez só e para ao ser parado", () => {
    const { lock, onIdle } = make();
    vi.advanceTimersByTime(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    lock.stop();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    vi.advanceTimersByTime(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
