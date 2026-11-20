# Auditoria de dependências (`pnpm audit --prod`)

Data: 2026-11-19, pnpm 10.18.2. Saída bruta: 23 achados (3 low, 11 moderate, 9 high, 0 critical), todos em dependências transitivas.

`shadcn`, `tailwindcss`, `@tailwindcss/vite` e as bibliotecas que o Vite empacota estão em `devDependencies` de `packages/web`. Mesmo assim o `pnpm audit --prod` ainda reporta os caminhos `packages/web > shadcn > ...` (o pnpm 10 não separa dev de prod por workspace nesse comando). Eles continuam sendo ruído de ferramenta de desenvolvimento.

| Pacote | Severidade | Caminho | Corrigido em | Exploitável? |
| --- | --- | --- | --- | --- |
| `fast-uri` (10 advisories) | 5 high, 3 moderate, 2 low | `integrations/inovafarma > @hookform/resolvers > ajv > fast-uri` | >= 3.1.9 | Não identificado: entra via `ajv` do resolver de formulários (valida esquemas locais). Resolve-se quando `ajv`/`@hookform/resolvers` atualizarem a versão. |
| `@azure/msal-node` | high | `integrations/inovafarma > drizzle-orm > @types/mssql > tedious > @azure/identity > @azure/msal-node` | >= 7.1.0 | Não identificado: caminho de autenticação Azure AD do `tedious`, dependência dos tipos do `mssql`. Reverifique ao atualizar `mssql`/`drizzle-orm`. |
| `ip-address` (4), `brace-expansion` (3), `minimatch` (1), `systeminformation` (3) | 4 high, 5 moderate, 2 low | `packages/web > shadcn > ...` | ver saída do audit | Não. `shadcn` é a CLI que gera componentes e roda só na máquina do desenvolvedor; nada disso entra no bundle do SPA nem no servidor. |

Reexecute `pnpm audit --prod` a cada atualização de dependências e atualize esta tabela.
