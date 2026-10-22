# Auditoria de dependências (`pnpm audit --prod`)

Data: 2026-10-22. Resultado bruto após corrigir o `hono`: 48 achados (4 low, 26 moderate, 17 high, 1 critical). Antes: 53.

O `--prod` do pnpm inclui tudo que está em `dependencies` de qualquer workspace, e isso mistura ferramentas de desenvolvimento com o que roda em produção. A análise abaixo separa as duas coisas.

## Corrigido neste ticket

- `hono` subiu de 4.13.3 para >= 4.13.13 (raiz, `core`, `server`): 5 advisories moderados (`parseBody` com aninhamento ilimitado, `serveStatic`, `toSSG`, parser de query, `hono/jsx`). O código usa `parseBody`/`serveStatic`/`toSSG`/`hono/jsx`? Não (`grep` em `packages/*/src`); a atualização é higiene.

## Ferramentas de dev classificadas como produção (ruído)

| Caminho | Pacotes afetados | Por que não é exploitável |
| --- | --- | --- |
| `packages/web > shadcn > ...` | `@modelcontextprotocol/sdk`, `proxy-addr` (critical), `ip-address`, `qs`, `fast-uri`, `@dotenvx/dotenvx`, `undici`, `brace-expansion`, `braces`, `js-yaml`, `cosmiconfig`, `ts-morph`, `postcss-selector-parser` | `shadcn` é a CLI que gera componentes; roda só na máquina do desenvolvedor. Nada disso entra no bundle do SPA nem no servidor. O "critical" (`proxy-addr`) vem do SDK MCP embutido nessa CLI. |
| `packages/web > @tailwindcss/vite > vite / @tailwindcss/node` | `vite` (2 high, 5 moderate, 1 low), `source-map-js` | Vite é o servidor de desenvolvimento e o bundler. Os advisories exigem o dev server exposto; em produção só se serve o resultado estático de `vite build`. |
| raiz `esbuild ^0.24.0` | `esbuild` moderate (dev server aceita requisições de qualquer origem) | Só afeta `esbuild --serve`, que não é usado. É ferramenta de build. |

Ação recomendada (fora do escopo do ticket): mover `shadcn`, `@tailwindcss/vite` e `esbuild` para `devDependencies`, e então `pnpm audit --prod` deixa de listá-los. Essa mudança de `package.json` do `web` e da raiz não foi feita aqui por tocar o empacotamento.

## Código que realmente vai ao cliente ou ao servidor

| Pacote | Advisories | Exploitável? |
| --- | --- | --- |
| `react-router` (via `react-router-dom` em `packages/ui`) | 2 moderate: open redirect com barra invertida em `<Link>`/`useNavigate`; injeção de construtor em `deserializeErrors()` (hidratação SSR) | Open redirect: só se um destino vier de entrada não confiável; a navegação atual usa rotas fixas. `deserializeErrors` é SSR, e o app é SPA sem SSR: não aplicável. Recomenda-se subir para >= 7.18.0 (major, validar à parte). |
| `hono` | corrigido (acima) | Não |

Servidor (`@platform/server`): nenhum advisory pendente em dependências que ele carrega em runtime.

## Conclusão

Nenhum achado aberto é explorável na implantação atual (SPA estática + API Hono). O único item de runtime a tratar é a atualização de `react-router` (defesa em profundidade). O principal trabalho restante é reclassificar as ferramentas de dev para `devDependencies`.
