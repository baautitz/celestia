/** Limites de tempo da sessão (refresh token). Todos em segundos e configuráveis por env. */
export interface SessionPolicy {
  /** Janela em que o reuso de um token já rotacionado é tolerado (abas simultâneas, resposta de renovação perdida). */
  reuseGraceSeconds: number;
  /** Vida máxima de uma sessão, do login ao fim, mesmo com uso contínuo. */
  absoluteSeconds: number;
  /** Tempo sem renovar a partir do qual a sessão exige a senha de novo. */
  idleSeconds: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  reuseGraceSeconds: 30,
  absoluteSeconds: 12 * 3600,
  idleSeconds: 30 * 60,
};

function positiveSeconds(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} precisa ser um número inteiro de segundos maior que zero.`);
  return value;
}

/** Lê SESSION_REUSE_GRACE_SECONDS, SESSION_ABSOLUTE_SECONDS e SESSION_IDLE_SECONDS; o que faltar usa o padrão. */
export function loadSessionPolicy(env: NodeJS.ProcessEnv = process.env): SessionPolicy {
  return {
    reuseGraceSeconds: positiveSeconds(env, "SESSION_REUSE_GRACE_SECONDS", DEFAULT_SESSION_POLICY.reuseGraceSeconds),
    absoluteSeconds: positiveSeconds(env, "SESSION_ABSOLUTE_SECONDS", DEFAULT_SESSION_POLICY.absoluteSeconds),
    idleSeconds: positiveSeconds(env, "SESSION_IDLE_SECONDS", DEFAULT_SESSION_POLICY.idleSeconds),
  };
}
