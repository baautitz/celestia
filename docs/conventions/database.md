# Banco de Dados, Migrations e Bootstrap

Regras para schemas Postgres, migrations por **Module**, **Roles** iniciais e criação do primeiro **Administrator** (ver [ADR 0004](../adr/0004-sem-compatibilidade-banco-reconstruido.md) e [Server Glossary](../../packages/server/GLOSSARY.md)).

---

## 1. Um Schema e uma Pasta de Migrations por Module

Cada **Module** com persistência em Postgres declara:

1. Seu próprio schema Postgres (`pgSchema("<moduleId>")`) em `src/<module>/schema.ts`:
   - `iam` → schema `iam` (`iam.roles`, `iam.users`)
   - `audit` → schema `audit` (`audit.audit_log_entries` + trigger append-only)
   - `closing_period` → schema `closing_period` (`closing_period.periods`)
   - `erp` → schema `erp` (`erp.erps`, `erp.user_externals`)
2. Sua própria pasta `src/<module>/migrations/` referenciada no `defineModule({ ..., migrations })`.
3. Uma tabela de controle isolada em `drizzle.__migrations_<moduleId>`, gerenciada por `runModuleMigrations` (`@platform/core/migrations`).

Enquanto o [ADR 0004](../adr/0004-sem-compatibilidade-banco-reconstruido.md) estiver em vigor, as migrations de cada Module são regeneradas do zero (uma migration inicial com nome descritivo por Module, p.ex. `<timestamp>_create_iam_tables`).

Para regenerar a migration de um Module a partir do seu `schema.ts`:

```bash
pnpm --filter @platform/server exec drizzle-kit generate \
  --dialect postgresql \
  --schema ./src/<module>/schema.ts \
  --out ./src/<module>/migrations \
  --name create_<descricao>
```

> **Atenção**: garanta `CREATE SCHEMA IF NOT EXISTS "<schema>";` no `migration.sql` gerado, pois `runModuleMigrations` cria o schema antes de invocar o migrator do Drizzle.

---

## 2. Aplicando Migrations (`pnpm db:migrate`)

O servidor **não** aplica migrations automaticamente no boot; o boot apenas verifica se há migrations pendentes (`assertMigrationsUpToDate`) e falha nomeando o Module caso haja.

Para aplicar todas as migrations na ordem do grafo de dependências (`migrationPlan(platform.modules)`):

```bash
pnpm db:migrate
```

- Em um banco vazio, cria os schemas `iam`, `audit`, `closing_period` e `erp`, todas as tabelas e semeia os **Roles** iniciais.
- Rodar `pnpm db:migrate` novamente quando tudo já está aplicado é idempotente e não executa nenhuma alteração.

---

## 3. Roles Iniciais

Todo banco recém-migrado já sobe com dois **Roles** iniciais semeados de forma idempotente (`ON CONFLICT ("id") DO NOTHING`) na migration do Module `iam` (`INITIAL_ROLES` em `packages/server/src/iam/initial-roles.ts`):

| ID (`roles.id`) | Nome       | Descrição                                                                 | Permissões iniciais |
| --------------- | ---------- | ------------------------------------------------------------------------- | ------------------- |
| `gestor`        | `Gestor`   | Gestão de usuários, perfis, ERPs, períodos de fechamento e consulta de auditoria. | Todas as permissões de `iam`, `audit`, `erp` e `closing_period` (`system:users:*`, `system:roles:*`, `system:audit:read`, `system:erps:manage`, `closing_period:period:*`). |
| `operador`      | `Operador` | Operação de períodos de fechamento.                                       | `closing_period:period:read`, `closing_period:period:create`, `closing_period:period:update`, `closing_period:period:close`. |

Se um build de cliente não incluir algum Plugin, a poda de permissões órfãs no boot (`syncOrphanPermissions`) remove automaticamente das Roles as chaves de Plugins ausentes.

---

## 4. Primeiro Administrator (`pnpm create-admin`)

Conforme o [Server Glossary](../../packages/server/GLOSSARY.md), **Administrator** é uma flag no **User** (`is_admin = true`) que ignora a matriz de permissões, e **não** uma Role. Todo User possui exatamente uma Role (`role_id NOT NULL`), portanto o primeiro Administrator é criado vinculado à Role inicial `gestor` (`DEFAULT_ADMIN_ROLE_ID`) com `is_admin = true`.

Após rodar `pnpm db:migrate`, crie o primeiro Administrator com:

```bash
# Modo interativo (TTY lê a senha sem ecoar):
pnpm create-admin

# Modo não-interativo (automação / provisionamento):
ADMIN_PASSWORD='...' pnpm create-admin -- --username admin --fullname "Administrador" --email admin@empresa.com.br

# Redefinir senha e garantir isAdmin = true de um usuário já existente:
ADMIN_PASSWORD='...' pnpm create-admin -- --username admin --fullname "Administrador" --force
```

O comando verifica primeiro se todas as migrations dos Modules estão em dia (`assertMigrationsUpToDate`) e se a Role inicial `gestor` existe no banco.
