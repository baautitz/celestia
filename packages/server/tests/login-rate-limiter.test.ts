import { describe, it, expect } from "vitest";
import { LoginRateLimiter } from "../src/iam/login-rate-limiter.js";

describe("LoginRateLimiter: memória", () => {
  it("descarta buckets expirados ao registrar novas falhas", () => {
    let now = 0;
    const limiter = new LoginRateLimiter({ windowMs: 1000, now: () => now });
    for (let i = 0; i < 50; i++) limiter.recordFailure(`u${i}`);
    expect(limiter.size).toBe(50);
    now = 1001;
    limiter.recordFailure("novo");
    expect(limiter.size).toBe(1);
  });

  it("limita o total de buckets mesmo dentro da janela (usernames escolhidos pelo atacante)", () => {
    const limiter = new LoginRateLimiter({ maxBuckets: 100 });
    for (let i = 0; i < 1000; i++) limiter.recordFailure(`u${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it("mantém o bloqueio de quem acabou de falhar ao descartar os mais antigos", () => {
    const limiter = new LoginRateLimiter({ maxBuckets: 10, maxPerUsername: 2 });
    for (let i = 0; i < 100; i++) limiter.recordFailure(`u${i}`);
    limiter.recordFailure("alvo");
    limiter.recordFailure("alvo");
    expect(limiter.retryAfterSeconds("alvo")).toBeGreaterThan(0);
  });
});
