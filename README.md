# Celestia

Plataforma corporativa com IAM permission-first, feita para operações críticas como fechamentos mensais, auditoria de varejo, comissões de vendas e conciliação com ERPs.

Um core pequeno carrega os módulos do sistema base (`iam`, `audit`), os Plugins nativos (`closing_period`, `erp`) e os Plugins de cliente. Cada cliente tem a própria instância, e os Plugins que comprou entram no build dele ([ADR 0003](docs/adr/0003-uma-instancia-por-cliente-plugins-no-build.md)). Não é SaaS.

## Stack

- **Backend:** Node.js >= 24, TypeScript, Hono e Postgres com Drizzle.
- **Segurança:** Argon2id, JWT de 5 minutos, refresh token de 7 dias e acesso por certificado de Dispositivo.
- **Frontend:** Vite, React 19, shadcn/ui e Tailwind CSS v4.

## Monorepo

| Pacote | Conteúdo |
|---|---|
| `packages/core` (`@platform/core`) | Framework de módulos: contrato, loader, eventos, migrations, permissões |
| `packages/server` (`@platform/server`) | API Hono, IAM, Audit Log, conexões ERP, Closing Periods |
| `packages/shared` (`@platform/shared`) | Tipos e contratos compartilhados |
| `packages/ui` (`@platform/ui`) | Primitivos shadcn/ui, UI imperativa, DataTable, formulários |
| `packages/web` (`@platform/web`) | SPA |
| `packages/e2e` (`@platform/e2e`) | Testes de navegador com Playwright |
| `services/ca` (`@platform/ca`) | Autoridade certificadora: emite, revoga e lê os certificados dos Dispositivos |
| `integrations/*` | Plugins de cliente, como `inovafarma` |

## Como rodar

Requer Node.js >= 24, pnpm e Docker (para o Postgres).

```bash
pnpm install
cp .env.example .env            # preencha os valores; as instruções estão no próprio arquivo
docker compose up -d postgres
pnpm build
pnpm db:migrate
pnpm create-admin               # cria o primeiro Administrator
pnpm dev                        # API, autoridade certificadora e SPA
```

O SPA abre em `http://localhost:5173`. A API roda na porta 3000 e a autoridade certificadora na 3001. Em desenvolvimento, o certificado é simulado por padrão (`CA_CERT_SOURCE=mock`).

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe API, autoridade certificadora e SPA (separados: `dev:server`, `dev:ca`, `dev:web`) |
| `pnpm dev:cert` | Sobe o Traefik local para testar o certificado de verdade no navegador |
| `pnpm build` | Compila todos os pacotes |
| `pnpm test` | Testes unitários e de componente (Vitest) |
| `pnpm test:db` | Testes com integração em Postgres, num container descartável |
| `pnpm test:e2e` | Testes de navegador (Playwright) |
| `pnpm lint` | ESLint em todos os pacotes |
| `pnpm check:ui` | Verifica os limites de UI |
| `pnpm check:plugins` | Verifica os limites dos Plugins |
| `pnpm check` | Roda verificações, lint, build e testes unitários |
| `pnpm db:migrate` | Aplica as migrations dos módulos e da autoridade certificadora |
| `pnpm create-admin` | Cria um Administrator, ou o redefine com `--force` |
| `pnpm create-ca` | Cria a CA que assina os Dispositivos |

## Produção

São duas imagens, construídas da raiz do repositório. O Postgres é um serviço à parte.

```bash
docker build -f packages/server/Dockerfile -t celestia .       # API e SPA
docker build -f services/ca/Dockerfile -t celestia-ca .        # autoridade certificadora
```

Ao subir, cada imagem aplica as próprias migrations, e a `celestia-ca` cria a CA se o volume em `/data/ca` estiver vazio. Faça backup da `ca.key`: sem ela, é preciso emitir todos os Dispositivos de novo.

Variáveis e passo a passo de instalação: [Imagens Docker](docs/conventions/device-certificates.md#imagens-docker).

## IAM e permissões

Todo Usuário tem uma Role, e a Role tem permissões. O acesso é negado por padrão, exceto para o Administrator, que ignora a matriz de permissões. Quem não tem a opção **Acesso sem certificado** só entra a partir de um Dispositivo ativo.

## Documentação

- **Glossário:** [GLOSSARY-MAP.md](GLOSSARY-MAP.md)
- **Padrões de código:** [CODING_STANDARDS.md](CODING_STANDARDS.md)
- **Decisões de arquitetura:** [docs/adr/](docs/adr/)
- **Convenções:**
  - [Banco de dados](docs/conventions/database.md)
  - [Permissões e eventos](docs/conventions/permissions.md)
  - [UI](docs/conventions/ui.md)
  - [Plugins](docs/conventions/plugins.md)
  - [Dispositivos e certificados](docs/conventions/device-certificates.md)
  - [Testes](docs/conventions/testing.md)
- **Agentes de código:** [AGENTS.md](AGENTS.md)
