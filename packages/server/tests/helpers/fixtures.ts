import type { Role, User, WorkspaceRecord } from "@platform/shared";
import { PasswordService } from "../../src/iam/password-service.js";
import { SYSTEM_PERMISSIONS } from "../../src/iam/system-permissions.js";
import { MemoryUserStore } from "../../src/iam/user-store.js";

export const TEST_PASSWORD = "Senha@123";

const recipePermissions = [
  "recipe:fechamento_mes:view",
  "recipe:fechamento_mes:query:vendas_equipe",
  "recipe:fechamento_mes:query:vendas_proprias",
  "recipe:fechamento_mes:action:adicionar_penalidade",
  "recipe:fechamento_mes:action:visualizar_penalidades",
  "recipe:fechamento_mes:action:remover_penalidade",
];

const roles: Role[] = [
  {
    id: "role_admin",
    name: "Administrador",
    description: "Acesso total à plataforma, gestão de usuários e criação de áreas de trabalho.",
    permissions: [...SYSTEM_PERMISSIONS.map((p) => p.key), ...recipePermissions],
  },
  {
    id: "role_operador",
    name: "Operador de Fechamento",
    description: "Acesso ao fechamento geral de vendas e aplicação de penalidades.",
    permissions: [
      "system:workspaces:read",
      "system:workspaces:create",
      "system:workspaces:close",
      "recipe:fechamento_mes:view",
      "recipe:fechamento_mes:query:vendas_equipe",
      "recipe:fechamento_mes:action:adicionar_penalidade",
      "recipe:fechamento_mes:action:visualizar_penalidades",
      "recipe:fechamento_mes:action:remover_penalidade",
    ],
  },
  {
    id: "role_vendedor",
    name: "Vendedor",
    description: "Acesso exclusivo ao relatório individual de suas próprias vendas.",
    permissions: [
      "recipe:fechamento_mes:view",
      "recipe:fechamento_mes:query:vendas_proprias",
      "recipe:fechamento_mes:action:visualizar_penalidades",
    ],
  },
];

function user(id: string, fullname: string, username: string, email: string, roleId: string, externals: User["externals"]): User {
  return {
    id,
    fullname,
    username,
    email,
    passwordHash: PasswordService.hash(TEST_PASSWORD),
    roleId,
    externals,
    status: "active",
    createdAt: new Date().toISOString(),
  };
}

export function createSeededUserStore(): MemoryUserStore {
  return new MemoryUserStore({
    roles,
    users: [
      user("usr_1001", "Carlos Oliveira", "carlos.admin", "carlos@farmacia.com.br", "role_admin", { inovafarma: 1, sap: 9001 }),
      user("usr_1002", "João da Silva (Vendedor 42)", "joao.silva", "joao.silva@farmacia.com.br", "role_vendedor", { inovafarma: 42, sap: 9042 }),
      user("usr_1003", "Maria Souza (Gerente)", "maria.souza", "maria.souza@farmacia.com.br", "role_operador", { inovafarma: 99, sap: 9099 }),
    ],
  });
}

export const seededWorkspaces: WorkspaceRecord[] = [
  {
    id: "ws_fechamento_jan_2026",
    recipeId: "fechamento_mes",
    name: "Fechamento Mensal — Janeiro / 2026",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    status: "open",
    createdAt: "2026-02-01T08:00:00Z",
    updatedAt: "2026-02-01T08:00:00Z",
  },
  {
    id: "ws_fechamento_dez_2025",
    recipeId: "fechamento_mes",
    name: "Fechamento Mensal — Dezembro / 2025",
    startDate: "2025-12-01",
    endDate: "2025-12-31",
    status: "closed",
    createdAt: "2026-01-02T09:30:00Z",
    updatedAt: "2026-01-02T09:30:00Z",
  },
];

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
