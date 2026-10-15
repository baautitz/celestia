# Convenção de nomes de permissão

> Orientação, não obrigatória. Não há lint nem script que falhe por não segui-la.

## Formato

`<modulo>:<recurso>:<verbo>`, tudo em minúsculo.

- Módulo: o `moduleId` do `defineModule`.
- Recurso: no singular (`meta`, não `metas`).
- Verbo: inglês, infinitivo; `snake_case` quando composto (`reset_password`).

## Verbos

| Grupo | Verbos | Observação |
|---|---|---|
| CRUD | `read`, `create`, `update`, `delete` | `read` lista e vê dados/API |
| Ciclo de vida | `close`, `reopen`, `approve`, `reject`, `publish` | |
| Dados em massa | `export`, `import` | |
| Sensíveis | verbo próprio e específico (`reset_password`) | nunca escondido dentro de `update` |
| Tela | `view` | só telas e variantes (`<modulo>:<recurso>:view`); distinto de `read` |

Evite `manage`: agrega tudo e vira privilégio genérico. Prefira um verbo por capacidade.

## Escopo por sufixo

Quando o mesmo verbo vale para conjuntos diferentes, use sufixo: `read_all`, `read_own`.
Deixa de ser verbo puro; use só quando há variantes reais. Declare do mais amplo ao mais
restrito: a primeira variante que casa vence (`byPermission` / `pickVariant`).

## Mensagem de negação (`deniedMessage`)

Em PT-BR, diga o que falta e quem resolve, não a chave técnica:
"Só o financeiro fecha o mês."

```ts
const perms = definePermissions("metas", {
  "meta:approve": {
    label: "Aprovar metas",
    deniedMessage: "Só a diretoria comercial aprova metas.",
  },
});

const approve = guarded(perms.ref("meta:approve"), (ctx, id: string) => { /* ... */ });
```

- A chave em `definePermissions` é `<recurso>:<verbo>`; o módulo é prefixado (`metas:meta:approve`).
- `perms.ref` com chave inexistente lança erro na declaração.
- Permissão vazia em `guarded`/`byPermission` também lança na declaração.
- Ambos falham fechado: nunca viram "permitido".

## Eventos

Mesmo vocabulário: `<modulo>.<recurso>.<verbo>` (ex.: `metas.meta.approve`).

- `before` / `after` é a fase do handler, não parte do nome.
- `before` só valida e cancela com motivo (`ctx.cancel(...)` ou `CancelEvent`); nunca grava.
- Falha fechada: timeout (padrão 2000 ms) ou erro em `before` cancela o evento.
- `after` roda depois do commit; falhas são isoladas e vão para `onError`.

## Chaves atuais do sistema

Fonte: `packages/server/src/iam/system-permissions.ts`. As chaves `system:*` têm 3 partes
(`system:<modulo>:<verbo>`): o módulo faz o papel do recurso. A coluna "Fora" marca o que
foge da convenção.

| Módulo | Verbos | Fora |
|---|---|---|
| users | `create`, `read`, `update`, `reset_password`, `delete` | |
| roles | `create`, `read`, `update`, `delete` | |
| workspaces | `create`, `update`, `delete`, `close`, `reopen` | |
| sources | `manage` | `system:sources:manage` |
| audit | `read` | |

Legado a desmembrar (sem mudança agora): `system:sources:manage`.
