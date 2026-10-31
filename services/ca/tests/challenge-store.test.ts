import { describe, it, expect } from "vitest";
import { CHALLENGE_TTL_MS, CODE_TTL_MS, ChallengeStore, MAX_PENDING_CHALLENGES } from "../src/challenge-store.js";

function setup() {
  const clock = { now: 1_000_000 };
  return { clock, store: new ChallengeStore(() => clock.now) };
}

describe("ChallengeStore", () => {
  it("troca o código do desafio pelo usuário e pelo Dispositivo, uma única vez", () => {
    const { store } = setup();
    const id = store.create("user-1");
    const code = store.bindDevice(id, "device-1")!;
    expect(store.exchange(id, code)).toEqual({ granted: true, userId: "user-1", deviceId: "device-1" });
    expect(store.exchange(id, code)).toEqual({ granted: false });
  });

  it("consome o desafio mesmo com o código errado: errar dá uma chance só", () => {
    const { store } = setup();
    const id = store.create("user-1");
    const code = store.bindDevice(id, "device-1")!;
    expect(store.exchange(id, "errado")).toEqual({ granted: false, userId: "user-1" });
    expect(store.exchange(id, code)).toEqual({ granted: false });
  });

  it("nega sem código, sem Dispositivo ligado e com desafio desconhecido", () => {
    const { store } = setup();
    const id = store.create("user-1");
    expect(store.exchange(id, undefined)).toEqual({ granted: false, userId: "user-1" });
    expect(store.exchange("desconhecido", "x")).toEqual({ granted: false });
  });

  it("não liga um Dispositivo a desafio desconhecido nem duas vezes", () => {
    const { store } = setup();
    expect(store.bindDevice("desconhecido", "device-1")).toBeUndefined();
    const id = store.create("user-1");
    expect(store.bindDevice(id, "device-1")).toBeDefined();
    expect(store.bindDevice(id, "device-2")).toBeUndefined();
  });

  it("o código vale 60 segundos e o desafio 5 minutos", () => {
    const a = setup();
    const idA = a.store.create("user-1");
    const codeA = a.store.bindDevice(idA, "device-1")!;
    a.clock.now += CODE_TTL_MS + 1;
    expect(a.store.exchange(idA, codeA)).toEqual({ granted: false, userId: "user-1" });

    const b = setup();
    const idB = b.store.create("user-1");
    b.clock.now += CHALLENGE_TTL_MS + 1;
    expect(b.store.bindDevice(idB, "device-1")).toBeUndefined();
  });

  it("limita os desafios pendentes descartando o mais antigo", () => {
    const { store } = setup();
    const first = store.create("user-0");
    for (let i = 1; i <= MAX_PENDING_CHALLENGES; i++) store.create(`user-${i}`);
    expect(store.size).toBe(MAX_PENDING_CHALLENGES);
    expect(store.bindDevice(first, "device-1")).toBeUndefined();
  });
});
