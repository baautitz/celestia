import type { CreateUserInput, Role, User } from "@platform/shared";
import { CLOSING_PERIOD_PERMISSIONS } from "../../src/closing-period/closing-period-permissions.js";
import { PasswordService } from "../../src/iam/password-service.js";
import { SYSTEM_PERMISSIONS } from "../../src/iam/system-permissions.js";
import { MemoryUserStore } from "../../src/iam/user-store.js";

/**
 * Store dos testes: Usuários nascem com acesso sem certificado, porque a maioria dos testes faz login só com senha.
 * Quem testa a exigência de certificado passa `allowWithoutCertificate: false` de forma explícita.
 */
export class TestUserStore extends MemoryUserStore {
  constructor(initialData?: { users?: User[]; roles?: Role[] }) {
    super({
      ...initialData,
      users: initialData?.users?.map((u) => ({ ...u, allowWithoutCertificate: u.allowWithoutCertificate ?? true })),
    });
  }

  override createUser(input: CreateUserInput): Promise<User> {
    return super.createUser({ allowWithoutCertificate: true, ...input });
  }
}

export const TEST_PASSWORD = "Senha@123";

const roles: Role[] = [
  {
    id: "role_admin",
    name: "Administrador",
    description: "Acesso total à plataforma, gestão de usuários e gestão de Períodos de Fechamento.",
    permissions: [...SYSTEM_PERMISSIONS, ...CLOSING_PERIOD_PERMISSIONS.items].map((p) => p.key),
  },
  {
    id: "role_operador",
    name: "Operador de Fechamento",
    description: "Visualiza e cria Períodos de Fechamento.",
    permissions: [
      CLOSING_PERIOD_PERMISSIONS.keys["period:read"],
      CLOSING_PERIOD_PERMISSIONS.keys["period:create"],
    ],
  },
  {
    id: "role_colaborador",
    name: "Colaborador",
    description: "Sem permissões do sistema.",
    permissions: [],
  },
];

function user(id: string, fullname: string, username: string, email: string, roleId: string): User {
  return {
    id,
    fullname,
    username,
    email,
    passwordHash: PasswordService.hash(TEST_PASSWORD),
    roleId,
    status: "active",
    allowWithoutCertificate: true,
    createdAt: new Date().toISOString(),
  };
}

/** `admin: true` acrescenta `test.root` (isAdmin) para testes que só precisam de acesso total. */
export function createSeededUserStore(opts: { admin?: boolean } = {}): TestUserStore {
  const root: User[] = opts.admin
    ? [{ ...user("usr_9000", "Test Root", "test.root", "root@farmacia.com.br", "role_colaborador"), isAdmin: true }]
    : [];
  return new TestUserStore({
    roles,
    users: [
      user("usr_1001", "Carlos Oliveira", "carlos.admin", "carlos@farmacia.com.br", "role_admin"),
      user("usr_1002", "João da Silva (Colaborador 42)", "joao.silva", "joao.silva@farmacia.com.br", "role_colaborador"),
      user("usr_1003", "Maria Souza (Gerente)", "maria.souza", "maria.souza@farmacia.com.br", "role_operador"),
      ...root,
    ],
  });
}

/** Login de um usuário semeado; devolve o header Authorization pronto para `app.request`. */
export async function authHeader(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  username = "carlos.admin"
): Promise<Record<string, string>> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const { access_token } = (await res.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

interface Requester {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
}

/** Faz toda requisição de `app.request` sair autenticada (login lazy) quando não traz Authorization. */
export function withAuth<T extends Requester>(app: T, username = "carlos.admin"): T {
  const original = app.request.bind(app);
  let header: Promise<Record<string, string>> | undefined;
  app.request = (async (input: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Authorization") && !input.startsWith("/api/auth/")) {
      header ??= authHeader({ request: original }, username);
      headers.set("Authorization", (await header).Authorization);
    }
    return original(input, { ...init, headers });
  }) as T["request"];
  return app;
}
