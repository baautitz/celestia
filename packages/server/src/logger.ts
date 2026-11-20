import pino, { type Logger } from "pino";

/** Logger estruturado do servidor (injetável; os Modules recebem a interface `Logger` do Core). */
export type AppLogger = Logger;

/** Campos que nunca podem ir para o log, nos níveis de aninhamento usuais. */
export const LOG_REDACT_PATHS = [
  "password",
  "secrets",
  "secretsEncrypted",
  "token",
  "refresh_token",
  "authorization",
  "cookie",
  "*.password",
  "*.secrets",
  "*.secretsEncrypted",
  "*.token",
  "*.refresh_token",
  "*.authorization",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

export function createLogger(options: { level?: string; destination?: pino.DestinationStream } = {}): AppLogger {
  return pino(
    {
      level: options.level ?? process.env.LOG_LEVEL ?? (process.env.VITEST ? "silent" : "info"),
      redact: { paths: LOG_REDACT_PATHS, censor: "[REDACTED]" },
    },
    options.destination,
  );
}
