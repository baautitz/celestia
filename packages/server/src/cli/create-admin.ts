import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { db, pool } from "../db/client.js";
import { PasswordService } from "../iam/password-service.js";
import { PostgresUserStore } from "../iam/postgres-user-store.js";
import { SYSTEM_PERMISSIONS } from "../iam/system-permissions.js";

const ADMIN_ROLE_ID = "role_admin";

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
  const email = values.email || (await rl.question("E-mail (opcional): ")).trim() || undefined;
  // Sem TTY (stdin redirecionado) não há modo raw: cai na leitura de linha comum.
  const password = process.stdin.isTTY ? (rl.close(), await readHiddenPassword("Senha: ")) : await rl.question("Senha: ");
  rl.close();

  const check = PasswordService.validate(password);
  if (!username || !fullname) throw new Error("Usuário e nome completo são obrigatórios.");
  if (!check.valid) throw new Error(check.error);

  const store = new PostgresUserStore(db);
  if (!(await store.getRole(ADMIN_ROLE_ID))) {
    await store.createRole({
      id: ADMIN_ROLE_ID,
      name: "Administrador",
      description: "Acesso total à plataforma, gestão de usuários e criação de áreas de trabalho.",
      permissions: SYSTEM_PERMISSIONS.map((p) => p.key),
    });
  }
  const existing = await store.findByUsername(username);
  if (existing && values.force) {
    await store.updateUser(existing.id, { roleId: ADMIN_ROLE_ID, status: "active" });
    await store.resetPassword(existing.id, PasswordService.hash(password));
    await store.setAdmin(existing.id, true);
    console.log(`Administrador '${existing.username}' atualizado (${existing.id}): senha redefinida, papel Administrador, conta ativa.`);
    return;
  }
  if (existing) {
    throw new Error(`Usuário '${existing.username}' já existe. Use --force para redefinir a senha e o papel.`);
  }
  const user = await store.createUser({ username, fullname, email, password, roleId: ADMIN_ROLE_ID });
  await store.setAdmin(user.id, true);
  console.log(`Administrador '${user.username}' criado (${user.id}).`);
}

main()
  .catch((err: Error) => {
    console.error(`Erro: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
