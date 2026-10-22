# 15. Auditoria externa e lista de desejos (`todo.txt`)

O arquivo `todo.txt` da raiz (não rastreado) tem duas partes: uma **lista de desejos** de
funcionalidades e uma **auditoria externa** de um estado antigo do sistema (ainda com Recipes e
SDUI). Aqui cada item está mapeado para o estado atual. Nada abaixo foi inventado: os itens
marcados "verificado" foram checados no código da `main` (`44152b6`).

## Lista de desejos

| Pedido | Estado | Onde entra |
|---|---|---|
| Variação por componente, por permissão | `NavEntry.variants` e `byPermission` desenhados, não implementados no web | 07 |
| Componentes por permissões | idem (granularidade: tela ou componente? ver dúvida em 07) | 07 |
| Impressão | não existe | **D14**: módulo dono (relatório do fechamento?) e formato (janela de impressão, PDF) |
| Campos customizados por ERP (empresa, filtros, metas; gerais e específicos que sobrepõem gerais) | não existe | **D14**: pertence ao `connections`/InovaFarma; precisa de modelo (campo por conexão, herança geral -> específico) |
| Tabela com botão expandir | não existe no `DataTable` | evolução do `DataTable` em `packages/ui/src/data-table` |
| Digitar em campos de data | `date-picker` e `date-range-picker` hoje só por seleção | evolução dos primitivos (input mascarado com `date-fns`) |
| Montar dashboards via interface | **conflita** com a decisão de remover recipes | decidir se algum módulo de relatório terá configuração por UI (D14) |
| Sticky header de tabelas | não existe | `DataTable`: cabeçalho fixo (CSS `position: sticky`) |

## Auditoria externa: status por item

| # | Achado | Estado hoje |
|---|---|---|
| 1 | rotas sem login | **resolvido** (verificado; ver 13) |
| 2 | lista vazia de permissões concede acesso | **resolvido** (resolver fail-closed) |
| 3 | mutações confiam no `row` do cliente | **removido** com o motor de ações |
| 4 | isolamento/timeout das ações (`node:vm`) | **removido** com o sandbox |
| 5 | dados em memória, sem adaptador Postgres | **parcial**: há stores Postgres e migrations, mas nunca rodaram contra banco real (11) |
| 6 | JWT/sessão | **parcial**: sem segredo padrão, CORS por allowlist; faltam revogação (M4), `Secure` a confirmar e seeds demo (verificado: não há seed no boot) |
| 7 | `"*"` inconsistente | **resolvido** (`hasPermission` único; poda preserva) |
| 8 | schema expõe SQL de lookup | **removido** com os dashboards |
| 9 | datas, identidade e concorrência | **parcial**: datas ISO e 404 resolvidos; **controle de versão/409 inexistente** (03) |
| 10 | crash do `SelectLabel` fora do `SelectGroup` | **removido** com o SDUI (`QueryProfileSelect`) |
| 11 | Hooks em `map`/`switch` no `DynamicFormFields` | **ABERTO** (verificado; ver 14 item 1) |
| 12 | corrida no carregamento da tabela | **removido** (`SDUITable`); as páginas atuais fazem `fetch` próprio: revisar descarte de respostas obsoletas |
| 13 | acessibilidade do `FormControl` | **resolvido** (repassa `id`/`aria` ao filho com `useRender`) |

Pendências do rodapé da auditoria: **ESLint não executa** (ver 14), alertas de dependências (13),
bundle grande (14) e testes de navegador (14).

## Dúvidas para responder

- **D14** Para cada desejo sem módulo dono (impressão, campos customizados por ERP, dashboards via
  interface, expandir linha, data digitada): qual a prioridade e em que módulo ou lib entra?
- O `todo.txt` pode ser removido depois que estes documentos forem revisados?
