# Próximos passos do Celestia

Índice de tudo que falta da refatoração para "core pequeno + módulos". Cada tarefa tem um documento
próprio nesta pasta. Dúvidas ficam anotadas em cada documento, na seção "Dúvidas para responder", e
estão agregadas no fim deste índice.

Gerado em 2026-10-15 (madrugada), ao fim de uma sessão longa. Estado da `main`: `44152b6`.

## Onde paramos

| Camada | Estado |
|---|---|
| `packages/ui` (`@platform/ui`) | pronto: primitivos shadcn, UI imperativa (`useUi`), `DataTable`, forms, contrato `WebModule`; 7 testes |
| `packages/core` (`@platform/core`) | pronto e testado em Node: permissões fail-closed, `EventBus` before/after, runner de migrations, loader com rollback; 36 testes (+1 opt-in) |
| `packages/server` | endurecido; motor de recipes removido; só IAM, conexões de ERP e workspaces; 80 testes; baseline HTTP de 154 chaves |
| `packages/web` | UI imperativa, registro de módulos (`modules.ts`, `modules/core.ts`), sem SDUI |
| Docs | `AGENTS.md`, README, convenção de permissões e regras de agente atualizados |

Fundação pronta. **Nenhum módulo real existe ainda**: o servidor continua um `index.ts` monolítico que
só usa o core em um ponto (`pruneOrphans`). O loader e os eventos estão testados em isolamento, mas
nenhum código de produção os usa.

## Arquitetura alvo (resumo)

- Core pequeno + **módulos** (bounded contexts), cada um com rotas, permissões, migrations e schema
  Postgres próprios. Modelo "plugin do Bukkit": o core liga os módulos, eles não se importam.
- Comunicação entre módulos só por **eventos** (`before` cancelável e só valida; `after` pós-ação e
  com falha isolada) ou por **serviços** expostos e declarados em `dependsOn` (acíclico).
- Permissões `<modulo>:<recurso>:<verbo>`, declaradas por módulo (`definePermissions`), guardadas por
  `guarded`/`byPermission` (primeira variante que casa vence; sem permissão, 403).
- Sem clientes e sem compatibilidade: o banco será reconstruído; `drizzle/` regenera do zero.
- Detalhes das decisões: [decisoes.md](decisoes.md).

## Tarefas

| # | Tarefa | Tam. | Depende de | Documento |
|---|---|---|---|---|
| 01 | Extrair o módulo `iam` | G | 06 | [01-extrair-modulo-iam.md](01-extrair-modulo-iam.md) |
| 02 | Módulo `connections` | M | 01 | [02-modulo-connections.md](02-modulo-connections.md) |
| 03 | Módulo `workspaces` | M | 01 | [03-modulo-workspaces.md](03-modulo-workspaces.md) |
| 04 | Composição do servidor e boot | G | 01, 02, 03 | [04-composicao-servidor-e-boot.md](04-composicao-servidor-e-boot.md) |
| 05 | Regenerar `drizzle/` por módulo | M | 01 a 03 | [05-regenerar-drizzle-por-modulo.md](05-regenerar-drizzle-por-modulo.md) |
| 06 | Core: barrel, `mount`, contexto de permissões | P | nenhuma | [06-core-barrel-mount-contexto.md](06-core-barrel-mount-contexto.md) |
| 07 | Web: catálogo por módulo e telas por permissão | M | 01 | [07-web-catalogo-por-modulo-e-variantes.md](07-web-catalogo-por-modulo-e-variantes.md) |
| 08 | `/integrations`: estrutura e carga | M | 04 | [08-integrations-estrutura-e-carga.md](08-integrations-estrutura-e-carga.md) |
| 09 | Módulo `inovafarma_connector` | G | 02, 08 | [09-inovafarma-connector.md](09-inovafarma-connector.md) |
| 10 | Módulo `inovafarma_fechamento_mes` | G | 03, 09 | [10-inovafarma-fechamento-mes.md](10-inovafarma-fechamento-mes.md) |
| 11 | Testar migrations em Postgres real | P | 06 | [11-testar-migrations-em-postgres-real.md](11-testar-migrations-em-postgres-real.md) |
| 12 | `shared` sem depender de `ui` | P | nenhuma | [12-shared-sem-dependencia-de-ui.md](12-shared-sem-dependencia-de-ui.md) |
| 13 | Pendências de segurança | M | 01 | [13-pendencias-de-seguranca.md](13-pendencias-de-seguranca.md) |
| 14 | Qualidade e arrumação (inclui bug de Hooks) | M | nenhuma | [14-qualidade-e-arrumacao.md](14-qualidade-e-arrumacao.md) |
| 15 | Auditoria externa e lista de desejos (`todo.txt`) | - | - | [15-auditoria-e-lista-de-desejos.md](15-auditoria-e-lista-de-desejos.md) |

Tamanhos: P = algumas horas, M = cerca de um dia, G = vários dias.

## Caminho crítico

`06 -> 01 -> 02 + 03 -> 04 -> 05` fecha a separação do servidor. `08 -> 09 -> 10` é o que o cliente
pediu (metas, fechamento, telas encadeadas). São 7 passos de infraestrutura antes do primeiro valor
visível. Alternativa: começar `09` e `10` sobre o servidor ainda monolítico e extrair o núcleo em
paralelo (dúvida D1 abaixo).

## Dúvidas abertas (resumo; o detalhe está em cada documento)

- [ ] **D1** Ordem: extrair o núcleo primeiro, ou entregar o InovaFarma primeiro? (todos)
- [ ] **D2** Módulos de núcleo em `packages/server/src/modules/<id>`: confirma? (01)
- [ ] **D3** Como os módulos de `/integrations` são carregados (pacote do workspace, lista estática)? (08)
- [ ] **D4** Id de módulo não aceita hífen (`^[a-z][a-z0-9_]*$`): usar `inovafarma_connector`? (08, 09)
- [ ] **D5** Para onde vai `users.externals` (mapeamento usuário -> id no ERP)? (09)
- [ ] **D6** Requisitos de negócio do fechamento: parâmetros de meta e as telas encadeadas (10)
- [ ] **D7** Workspaces precisa de telas no web? Quais? (03)
- [ ] **D8** Perfis iniciais e primeiro admin com o banco reconstruído (05)
- [ ] **D9** Revalidar o access token de 5 min a cada requisição? (13)
- [ ] **D10** Restringir quem remove permissões de outros perfis (B2)? (13)
- [ ] **D11** Nome da pasta: `next-stapes` (como digitado) ou `next-steps`? (este índice)
- [ ] **D12** `AGENTS.md` §12 (pedir confirmação a cada passo) conflita com agentes autônomos (14)
- [ ] **D13** Tema escuro: manter light-only ou ativar? (14)
- [ ] **D14** Impressão, expandir linha, campos customizados por ERP: prioridade e módulo dono (15)
- [ ] **D15** Permissões sem uso (`system:roles:delete`, `system:audit:read`): remover ou implementar? (14)

## Como retomar

```bash
git switch main && git pull
pnpm install --frozen-lockfile
pnpm --filter @platform/shared build && pnpm --filter @platform/core build
pnpm --filter @platform/server test      # 80 testes
pnpm --filter @platform/core test        # 36 testes, 1 opt-in
pnpm --filter @platform/ui test          # 7 testes
pnpm --filter @platform/web build
pnpm check:ui && pnpm check:ui:test      # fronteira da UI
```

Para o baseline HTTP: `UPDATE_BASELINE=1 pnpm --filter @platform/server test baseline` regenera;
sem a variável o teste falha se uma resposta mudar. Ver `packages/server/tests/baseline/README.md`.

## Acordo de trabalho (resumo)

- Visual e comportamento do web idênticos ao original; diferenças medidas viram pergunta, não decisão.
- Commits one-line conventional, granulares. Merge na `main` e push só com ordem explícita.
- Verificar o que o agente afirma antes de aceitar (rodar o comando e ler a linha de resultado).
- Consultar a documentação oficial antes de decidir API de biblioteca (`AGENTS.md` §14).
