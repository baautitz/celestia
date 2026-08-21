# 🌌 Celestia — Server-Driven UI & Permission-First IAM Platform

> Plataforma corporativa de alta performance para conciliações, fechamentos operacionais e dashboards de auditoria orientada a **Server-Driven UI (SDUI)** com controle rigoroso de acesso **Permission-First IAM**.

---

## 🚀 Visão Geral

O **Celestia** é um ecossistema projetado para unificar dados de ERPs legados e bancos externos (PostgreSQL, SQL Server, MySQL) com regras de negócio dinâmicas declaradas em **Modelos (Recipes)** TypeScript compiladas em tempo de execução dentro de sandboxes isoladas.

- **Backend**: [Hono](https://hono.dev/) sobre Node.js 20+ com tipagem estrita RPC e baixa sobrecarga de memória.
- **Frontend**: Vite + React 19 + shadcn/ui + Tailwind CSS v4.
- **Segurança & IAM**: Criptografia de senhas com **Argon2id** (OWASP standard), autenticação JWT (5 min) + Refresh Token (7 dias) e catálogo dinâmico de permissões com poda automática de órfãos.
- **Motor SDUI**: Compilação in-memory via `esbuild` e execução segura via `node:vm` com timeout estrito de 5.000ms.
- **Prevenção de SQL Injection**: Motor de templates com conversão automática de tokens `{{workspace.param}}` em bind parameters (`@p1`, `@p2`).

---

## 📦 Estrutura do Monorepo

```text
celestia/
├── packages/
│   ├── shared/                   (@platform/shared)
│   │   └── Tipos e contratos canônicos (Workspace, IAM, SDUI Components, Recipes, RPC)
│   │
│   ├── server/                   (@platform/server)
│   │   └── Backend Hono, Motor de Compilação VM, IAM (Argon2id/JWT), Data Resolver & Postgres Store
│   │
│   └── web/                      (@platform/web)
│       └── Frontend Vite + React 19 + shadcn/ui + Tailwind v4
│           ├── src/components/sdui/     -> Componentes declarativos (SDUITable, SDUICard, SDUIChart)
│           ├── src/components/forms/    -> Formulários dinâmicos e wizards de recipes
│           ├── src/components/ui/       -> Primitivos canônicos shadcn/ui (InputGroup, MoneyInput, MobileCard, etc.)
│           ├── src/pages/               -> Telas da plataforma (Workspaces, Recipes, IAMUsers, IAMRoles, Login)
│           └── src/context/             -> Contextos globais (AuthContext, ImperativeUIContext, HeaderActions)
│
├── recipes/                      (Modelos Declarativos em TypeScript)
│   └── fechamento-mes.recipe.ts  -> Modelo de referência para fechamento mensal de vendas e comissões
│
├── docs/                         (Documentação Técnica Completa)
│   ├── README.md                 -> Especificação detalhada da arquitetura e fluxos
│   ├── component_registry.md     -> Catálogo oficial de componentes Declarativos e Imperativos
│   └── implementation_plan.md    -> Histórico de decisões de engenharia e roadmap
│
└── .agents/                      (Diretrizes e Skills para Agentes Autônomos)
    ├── rules/                    -> Regras mandatórias de UI, segurança e tipagem estrita
    └── skills/                   -> Guias de desenvolvimento SDUI e shadcn/ui
```

---

## 🛠️ Comandos de Desenvolvimento

### Instalação de Dependências
```bash
pnpm install
```

### Build do Monorepo
```bash
# Compilar todos os pacotes (@platform/shared, @platform/server, @platform/web)
pnpm -r run build
```

### Testes Automatizados (Vitest)
```bash
# Executar a suíte completa de testes
pnpm test

# Executar testes em modo watch
pnpm test:watch
```

### Inicialização em Modo Desenvolvimento
```bash
# Iniciar o Backend Hono (Porta 3000)
pnpm dev:server

# Iniciar o Frontend Vite (Porta 5173)
pnpm dev:web
```

---

## 🔒 Modelo de Segurança & IAM

O acesso a qualquer recurso no Celestia obedece à hierarquia estrita **Permission-First**:

1. **Permissões de Sistema**: `system:<modulo>:<acao>` (ex: `system:users:create`, `system:workspaces:create`).
2. **Permissões de Modelo (Recipe)**:
   - Visualização: `recipe:<recipe_id>:view`
   - Consultas a Fontes: `recipe:<recipe_id>:query:<nome>`
   - Ações Operacionais: `recipe:<recipe_id>:action:<id>`
3. **Resolução de Queries**: As queries declaradas em uma fonte externa são avaliadas na **ordem exata de declaração**; a primeira compatível com as permissões do usuário é executada.

---

## 🎨 Padrões de Interface (shadcn/ui)

- **100% Pure shadcn/ui**: Proibição de HTML bruto (`<label>`, `<form>`, `<div>` customizados sem autorização).
- **Campos de Busca**: Uso exclusivo de `InputGroup` (`InputGroup`, `InputGroupAddon`, `InputGroupInput`) com ícones da biblioteca `lucide-react`.
- **Campos Monetários (`type: "money"`)**: Uso do componente `MoneyInput` com máscara automática em Real brasileiro (`R$ 0,00`), `type="text"` e `inputMode="numeric"`.
- **Tabelas Responsivas**: Renderização automática em desktop via `<Table>` e em mobile via `<MobileCard>`.

---

## 📖 Documentação Detalhada

- [Especificação de Arquitetura](docs/README.md)
- [Catálogo de Componentes SDUI](docs/component_registry.md)
- [Diretrizes de Agentes & Invariantes](AGENTS.md)
