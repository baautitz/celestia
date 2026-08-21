# SDUI & IAM Coding Standards & Architectural Invariants

Regras e restrições obrigatórias para IAs e desenvolvedores na plataforma Celestia (SDUI & IAM):

---

## 1. Segurança de Queries SQL (Prevenção de SQL Injection)
- **Proibição de Concatenação Crua**: NUNCA interpole valores diretamente na string SQL de queries de sources.
- **Parametrização Obrigatória**: Todo token `{{workspace.param}}` ou `{{user.externals.source}}` deve ser processado pelo `TemplateEngine` como parâmetro bind posicional (`@p1`, `@p2` para SQL Server; `$1`, `$2` para Postgres).

---

## 2. Autenticação, Senhas e IAM (Permission-First)
- **Hashing de Senhas**: Use exclusivamente **Argon2id** (`@node-rs/argon2`, OWASP `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`). Jamais use bcrypt, scrypt ou SHA puro.
- **Política de Senhas**: Mínimo 8 caracteres (maiúscula, minúscula, número e caractere especial).
- **Sem "Esqueci Minha Senha"**: Redefinição de senha exclusiva por Administradores via `POST /api/iam/users/:id/reset-password` (`system:users:reset_password`).
- **Formato de Permissões**:
  - `system:<modulo>:<acao>` (ex: `system:users:create`, `system:workspaces:create`)
  - `recipe:<recipe_id>:view`
  - `recipe:<recipe_id>:query:<nome>` (ex: `recipe:fechamento_mes:query:all`)
  - `recipe:<recipe_id>:action:<id>` (ex: `recipe:fechamento_mes:action:adicionar_penalidade`)
- **Resolução de Queries por Ordem de Declaração**: Queries em uma source são avaliadas na ordem em que foram declaradas; a primeira com permissão compatível é executada.

---

## 3. Validação Obrigatória de Datas da Área de Trabalho (Workspace)
- Toda Área de Trabalho exige `start_date` e `end_date` (formato `AAAA-MM-DD`).
- **Proteção Temporal Estrita**: `end_date >= start_date`. Requisições com data final anterior à data inicial DEVEM ser rejeitadas com HTTP 400 (`"A Data Final não pode ser anterior à Data Inicial."`).

---

## 4. Padrões de Recipes em TypeScript
- Toda recipe deve ser definida usando a função tipada `defineRecipe()`.
- **Valores Padrão em Persistência**: Todo campo no `itemSchema` de coleções de persistência DEVE explicitar a propriedade `defaultValue` (`0.00` para `money`/`number`, `""` para `string`, `false` para `boolean`).
- **Controle de Concorrência Otimista**: Toda mutação operacional (`persistence.push`, `persistence.set`, `persistence.delete`) DEVE enviar e validar o parâmetro `workspace_version` (rejeitando com HTTP 409 caso a versão no banco esteja desatualizada).
- **Nomenclatura PT-BR na UI**: **Modelo** para Recipe, **Área de Trabalho** para Workspace.

---

## 5. Modelo de Ações Operacionais (Imperativas)
- As ações de linha (`actions`) devem utilizar os métodos imperativos de UI (`await ui.confirm`, `await ui.prompt`, `await ui.dialog.open`) ao invés de estruturas JSON de árvore AST.
- Os métodos de UI retornam Promises resolvidas pela interação do usuário (`null` se cancelado), permitindo controle de fluxo via `if (!result) return;`.
- Actions são executadas em sandbox `node:vm` com timeout de **5.000ms**.
