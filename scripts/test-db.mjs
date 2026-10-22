#!/usr/bin/env node
// Sobe um Postgres descartável em Docker (somente 127.0.0.1, porta aleatória),
// roda a suíte completa com os testes de integração habilitados e derruba o banco.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const IMAGE = "postgres:18-alpine";
const name = `celestia-test-pg-${randomBytes(4).toString("hex")}`;
const password = randomBytes(12).toString("hex");
const database = "celestia_test";
const user = "celestia_test";

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...opts });
}

function cleanup() {
  docker(["rm", "-f", "-v", name], { stdio: "ignore" });
}

const run = docker([
  "run", "-d", "--rm", "--name", name,
  "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_USER=${user}`, "-e", `POSTGRES_DB=${database}`,
  "-p", "127.0.0.1::5432", IMAGE,
]);
if (run.status !== 0) {
  console.error(`Falha ao subir o Postgres descartável (Docker disponível?):\n${run.stderr}`);
  process.exit(1);
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

let exitCode = 1;
try {
  const portOut = docker(["port", name, "5432/tcp"]).stdout.trim().split("\n")[0] ?? "";
  const port = portOut.split(":").pop();
  if (!port || !/^\d+$/.test(port)) throw new Error(`Porta do container não encontrada: "${portOut}"`);

  // O entrypoint reinicia o servidor após o init; só vale a conexão TCP real pelo host publicado.
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = docker(["exec", name, "psql", "-U", user, "-d", database, "-h", "127.0.0.1", "-c", "select 1"]).status === 0;
    if (!ready) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("Postgres descartável não ficou pronto a tempo.");

  const env = {
    ...process.env,
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_PORT: port,
    POSTGRES_USER: user,
    POSTGRES_PASSWORD: password,
    POSTGRES_DB: database,
    MIGRATIONS_TEST_DB: "1",
  };
  exitCode = await new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "vitest", "run", ...process.argv.slice(2)], { stdio: "inherit", env });
    child.on("exit", (code) => resolve(code ?? 1));
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  cleanup();
}
process.exit(exitCode);
