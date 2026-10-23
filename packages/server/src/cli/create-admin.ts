import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { assertMigrationsUpToDate } from "@platform/core/migrations";
import { migrationPlan } from "../boot/compose.js";
import { createPlatform } from "../index.js";
import { DEFAULT_ADMIN_ROLE_ID } from "../iam/initial-roles.js";
import { PasswordService } from "../iam/password-service.js";
import { PostgresUserStore } from "../iam/postgres-user-store.js";
import type { UserStore } from "../iam/user-store.js";

export interface UpsertAdminInput {
  username: string;
  fullname: string;
  password: string;
  email?: string;
  force?: boolean;
}

export interface UpsertAdminResult {
  id: string;
  username: string;
  created: boolean;
}

/**
 * Cria (ou atualiza com `force: true`) um Administrator ativo vinculado à Role inicial `gestor`.
 * Não cria uma Role "admin": Administrator é uma flag no User (`isAdmin = true`), não uma Role.
 */
export async function upsertAdminUser(store: UserStore, input: UpsertAdminInput): Promise<UpsertAdminResult> {
  const username = input.username.trim();
  const fullname = input.fullname.trim();
  const email = input.email?.trim() || undefined;
  if (!username || !fullname) throw new Error("Usuário e nome completo são obrigatórios.");

  const check = PasswordService.validate(input.password);
  if (!check.valid) throw new Error(check.error);

  const role = await store.getRole(DEFAULT_ADMIN_ROLE_ID);
  if (!role) {
    throw new Error(
      `Role inicial '${DEFAULT_ADMIN_ROLE_ID}' não encontrada. Execute o comando de migração (pnpm db:migrate) antes de criar o primeiro Administrator.`,
    );
  }

  const existing = await store.findByUsername(username);
  if (existing && input.force) {
    await store.updateUser(existing.id, { fullname, email, roleId: DEFAULT_ADMIN_ROLE_ID, status: "active", isAdmin: true });
    await store.resetPassword(existing.id, PasswordService.hash(input.password));
    return { id: existing.id, username: existing.username, created: false };
  }
  if (existing) {
    throw new Error(`Usuário '${existing.username}' já existe. Use --force para redefinir a senha e promover a Administrator.`);
  }

  const user = await store.createUser({
    username,
    fullname,
    email,
    password: input.password,
    roleId: DEFAULT_ADMIN_ROLE_ID,
  });
  await store.setAdmin(user.id, true);
  return { id: user.id, username: user.username, created: true };
}

/** Lê a senha sem ecoar os caracteres (modo raw do TTY; Ctrl+C não gera SIGINT nesse modo). */
function readHiddenPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    let password = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = (done: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      done();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish(() => resolve(password));
        if (char === "\x03") return finish(() => reject(new Error("Cancelado.")));
        if (char === "\x7f" || char === "\b") password = password.slice(0, -1);
        else password += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const { db, pool } = await import("../db/client.js");
  try {
    await assertMigrationsUpToDate(db, migrationPlan(createPlatform().modules));

    const { values } = parseArgs({
      options: {
        username: { type: "string" },
        fullname: { type: "string" },
        email: { type: "string" },
        force: { type: "boolean", default: false },
      },
    });

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const username = values.username || (await rl.question("Usuário: ")).trim();
    const fullname = values.fullname || (await rl.question("Nome completo: ")).trim();
    const email = values.email ?? ((await rl.question("E-mail (opcional): ")).trim() || undefined);
    // Sem TTY (stdin redirecionado) não há modo raw: aceita ADMIN_PASSWORD ou cai na leitura de linha comum.
    const password =
      process.env.ADMIN_PASSWORD ||
      (process.stdin.isTTY ? (rl.close(), await readHiddenPassword("Senha: ")) : await rl.question("Senha: "));
    rl.close();

    const store = new PostgresUserStore(db);
    const result = await upsertAdminUser(store, {
      username,
      fullname,
      email,
      password,
      force: values.force,
    });

    if (result.created) {
      console.log(`Administrator '${result.username}' criado (${result.id}) com Role '${DEFAULT_ADMIN_ROLE_ID}'.`);
    } else {
      console.log(
        `Administrator '${result.username}' atualizado (${result.id}): senha redefinida, Role '${DEFAULT_ADMIN_ROLE_ID}', conta ativa.`,
      );
    }
  } finally {
    await pool.end();
  }
}

if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test" && !process.env?.VITEST) {
  main().catch((err: Error) => {
    console.error(`Erro: ${err.message}`);
    process.exitCode = 1;
  });
}
