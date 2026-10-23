export interface LoginRateLimiterOptions {
  /** Falhas toleradas por username dentro da janela. */
  maxPerUsername?: number;
  /** Falhas toleradas por IP dentro da janela. */
  maxPerIp?: number;
  windowMs?: number;
  /** Teto de buckets em memória; ao exceder, descarta os mais antigos. */
  maxBuckets?: number;
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Limite de tentativas de login (em memória, por instância).
 * Conta apenas falhas; a chave do username é o texto enviado, exista ou não o User,
 * então o bloqueio nunca revela se a conta existe.
 */
export class LoginRateLimiter {
  private readonly maxPerUsername: number;
  private readonly maxPerIp: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: LoginRateLimiterOptions = {}) {
    this.maxPerUsername = options.maxPerUsername ?? 5;
    this.maxPerIp = options.maxPerIp ?? 20;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.maxBuckets = options.maxBuckets ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Buckets atualmente guardados (para testes e monitoramento). */
  get size(): number {
    return this.buckets.size;
  }

  private active(key: string): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private static usernameKey(username: string): string {
    return `u:${username.trim().toLowerCase()}`;
  }

  /** Segundos até liberar, ou 0 se a tentativa pode prosseguir. */
  retryAfterSeconds(username: string, ip: string | undefined): number {
    const limits: Array<[string, number]> = [[LoginRateLimiter.usernameKey(username), this.maxPerUsername]];
    if (ip) limits.push([`i:${ip}`, this.maxPerIp]);
    let resetAt = 0;
    for (const [key, max] of limits) {
      const bucket = this.active(key);
      if (bucket && bucket.count >= max) resetAt = Math.max(resetAt, bucket.resetAt);
    }
    return resetAt ? Math.max(1, Math.ceil((resetAt - this.now()) / 1000)) : 0;
  }

  recordFailure(username: string, ip: string | undefined): void {
    this.prune();
    for (const key of [LoginRateLimiter.usernameKey(username), ip ? `i:${ip}` : undefined]) {
      if (!key) continue;
      const bucket = this.active(key) ?? { count: 0, resetAt: this.now() + this.windowMs };
      bucket.count += 1;
      // Reinserir move a chave para o fim: o Map itera do mais antigo ao mais recente.
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    }
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= this.maxBuckets) break;
      this.buckets.delete(key);
    }
  }

  recordSuccess(username: string): void {
    this.buckets.delete(LoginRateLimiter.usernameKey(username));
  }

  private prune(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}
