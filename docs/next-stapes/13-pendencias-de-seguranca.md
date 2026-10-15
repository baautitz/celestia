# 13. Pendências de segurança

Tamanho: M. Depende de: 01 (parte). Origem: revisão independente do hardening (`fix/server-auth-hardening`).

## O que já foi corrigido (não reabrir)

Auth obrigatória, resolver fail-closed, `"*"` honrado e preservado, "*" só por admin, regra "só
concede o que possui", só admin age sobre admin, último admin protegido, segredo JWT sem constante,
datas ISO estritas, 404 de recursos desconhecidos, CORS por allowlist, login sem enumeração,
ids com UUID, mensagens JWT genéricas, rotas de persistence removidas. Baseline congela tudo isso.

## Abertas

| ID | Achado | Gravidade | Quando |
|---|---|---|---|
| M4 | refresh token não revogável nem rotacionado; logout não invalida | MÉDIO | no `01` (`tokenVersion` só no refresh) |
| B3 | `updateUser` + `setAdmin` não atômicos; check "último admin" sem transação | BAIXO | no `01` |
| B2 | quem tem `roles:update` pode **remover** permissões de qualquer role (negação de serviço administrativa; só adições são checadas) | BAIXO | decisão (D10) |
| I1 | mensagem de grant lista até 10 chaves que o chamador não possui | INFO | aceitar ou omitir lista |
| I3 | `roleId` inexistente revela existência de role a quem só tem `users:create` | INFO | aceitar |
| - | access token (5 min) fica defasado após mudança de role/status | aceito | D9 |
| - | cookie de refresh sem `Secure` explícito | a verificar | confirmar em produção |
| - | sem limitação de tentativas de login (rate limit) | não avaliado | considerar |

## Passos

1. Implementar M4 e B3 junto da extração do `iam` (ver 01).
2. Rotação de refresh com `jti` e denylist só se houver requisito de revogação imediata.
3. Verificar o cookie: `Secure` em produção (`NODE_ENV=production`), `HttpOnly`, `SameSite=Lax`,
   `Path=/api/auth`.
4. Avaliar rate limit por IP e por usuário no login.
5. Auditoria de dependências de produção (`pnpm audit --prod`); a externa listou 6 altos e 11
   moderados, parte em ferramentas de desenvolvimento classificadas como produção.

## Dúvidas para responder

- **D9** Revalidar status/role contra o store a cada requisição (revoga na hora, mas muda o modelo
  stateless) ou aceitar a janela de 5 minutos?
- **D10** Restringir a remoção de permissões de role a quem **possui** as chaves removidas?
- Existe requisito de revogar sessões na hora (demissão de funcionário, vazamento)?
