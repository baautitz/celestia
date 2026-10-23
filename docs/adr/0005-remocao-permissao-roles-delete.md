---
status: accepted
---

# Remoção da permissão system:roles:delete do catálogo

A chave de permissão `system:roles:delete` constava no catálogo declarado pelo Module `iam`, mas nenhuma rota HTTP (`DELETE /api/iam/roles/:id`) ou ação de interface foi implementada na plataforma. Para evitar permissões mortas no catálogo e na tela de Grupos de Acesso (Roles), a permissão foi removida do catálogo e do perfil inicial `gestor`.

Caso no futuro surja o requisito de exclusão de perfis de acesso, a permissão e o endpoint correspondente serão reintroduzidos com as devidas regras de negócio (por exemplo: impedimento de exclusão de perfis em uso por usuários ativos, restrições para perfis essenciais do sistema e emissão de eventos auditáveis de ciclo de vida).

## Alternativas descartadas

- Manter `system:roles:delete` no catálogo sem rota ou botão correspondente: induz o administrador a erro ao conceder uma permissão que não tem efeito real na plataforma.
- Implementar exclusão de roles de forma precipitada sem especificação clara de regras para usuários vinculados (reassociação em cascata vs. bloqueio estrito).
