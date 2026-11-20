# Auditoria de dependências (`pnpm audit --prod`)

Data: 2026-11-19, pnpm 10.18.2. Saída bruta: 23 achados (3 low, 11 moderate, 9 high, 0 critical), todos em dependências transitivas.

`shadcn`, `tailwindcss`, `@tailwindcss/vite` e as bibliotecas que o Vite empacota estão em `devDependencies` de `packages/web`. Mesmo assim o `pnpm audit --prod` ainda reporta os caminhos `packages/web > shadcn > ...` (o pnpm 10 não separa dev de prod por workspace nesse comando). Eles continuam sendo ruído de ferramenta de desenvolvimento.

| Pacote | Severidade | Caminho | Corrigido em | Exploitável? |
| --- | --- | --- | --- | --- |
| `fast-uri` (10 advisories) | 5 high, 3 moderate, 2 low | `integrations/inovafarma > @hookform/resolvers > ajv > fast-uri` | >= 3.1.9 | Não identificado: entra via `ajv` do resolver de formulários (valida esquemas locais). Resolve-se quando `ajv`/`@hookform/resolvers` atualizarem a versão. |
| `@azure/msal-node` | high | `integrations/inovafarma > drizzle-orm > @types/mssql > tedious > @azure/identity > @azure/msal-node` | >= 7.1.0 | Não identificado: caminho de autenticação Azure AD do `tedious`, dependência dos tipos do `mssql`. Reverifique ao atualizar `mssql`/`drizzle-orm`. |
| `ip-address` (4), `brace-expansion` (3), `minimatch` (1), `systeminformation` (3) | 4 high, 5 moderate, 2 low | `packages/web > shadcn > ...` | ver saída do audit | Não. `shadcn` é a CLI que gera componentes e roda só na máquina do desenvolvedor; nada disso entra no bundle do SPA nem no servidor. |

Reexecute `pnpm audit --prod` a cada atualização de dependências e atualize esta tabela.

---

# Sessão: refresh token, bloqueio e reautenticação

Modelo atual da sessão (issues #68 e #113). Os limites são configuráveis por env (`SESSION_REUSE_GRACE_SECONDS`, `SESSION_ABSOLUTE_SECONDS`, `SESSION_IDLE_SECONDS`), com padrões em `.env.dev.example` e `.env.hono.example`.

| Ameaça | Controle |
|---|---|
| Cópia do cookie de refresh renovando em paralelo com o dono | Token opaco com rotação a cada uso; o reuso fora da janela de tolerância revoga a família inteira (dono e ladrão saem) e fica no Audit Log (`detect_session_reuse`). |
| Vazamento do banco | Só o hash SHA-256 do token é guardado (`iam.sessions`); o token em claro vive apenas no cookie `HttpOnly`. |
| Sessão que não acaba | Cookie de sessão (morre ao fechar o navegador) mais limite absoluto no servidor (padrão 12 h), porque navegadores que restauram sessão mantêm cookies de sessão. |
| Tela deixada aberta | O cliente bloqueia por ociosidade (só ação do usuário conta) e avisa o servidor; a sessão bloqueada recusa renovar até a senha, mesmo recarregando a página. O Device também confirma a senha. |
| Força bruta no desbloqueio | `/auth/unlock` usa o mesmo `LoginRateLimiter` do login; estourar o limite revoga a sessão. |
| Resposta de renovação perdida ou abas simultâneas | Janela de tolerância curta (padrão 30 s): o mesmo token reapresentado dentro dela recebe outro token da família, sem revogar. |

O Access Token (JWT, 5 min, em memória) segue stateless e não revogável: logout e bloqueio o descartam no cliente, mas ele vale até expirar. A limpeza dos tokens expirados é oportunista, na própria renovação.

