import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { db, pool } from "../db/client.js";
import { PasswordService } from "../iam/password-service.js";
import { PostgresUserStore } from "../iam/postgres-user-store.js";
import { SYSTEM_PERMISSIONS } from "../iam/system-permissions.js";

const ADMIN_ROLE_ID = "role_admin";

async function main() {
  const { values } = parseArgs({
    options: {
      username: { type: "string" },
      fullname: { type: "string" },
      email: { type: "string" },
    },
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const username = values.username || (await rl.question("Usuário: ")).trim();
  const fullname = values.fullname || (await rl.question("Nome completo: ")).trim();
  const email = values.email || (await rl.question("E-mail (opcional): ")).trim() || undefined;
  // ponytail: a senha é ecoada no terminal; trocar por prompt oculto se for um problema
  const password = await rl.question("Senha: ");
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
  const user = await store.createUser({ username, fullname, email, password, roleId: ADMIN_ROLE_ID });
  console.log(`Administrador '${user.username}' criado (${user.id}).`);
}

main()
  .catch((err: Error) => {
    console.error(`Erro: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
