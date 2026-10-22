---
status: accepted
---

# Módulos se comunicam por eventos ou por serviços declarados

Um Module não importa outro. A comunicação é por eventos `before` e `after`, ou por um serviço exposto por um Module declarado em `dependsOn`, que é acíclico. O `before` é cancelável, só valida, nunca grava, e falha fechado em erro ou timeout. O `after` roda depois da ação e sua falha não afeta a ação. Um ciclo ou uma dependência desconhecida derruba o boot sem montar nada. Um Module que falha ao carregar desfaz seus handlers, não monta rotas, mantém suas Permissions no registro e impede a poda de Permissions dos Roles.

## Alternativas descartadas

- Importação direta entre Modules: acopla o build e impede incluir um Plugin sem os outros.
- Só eventos, sem serviços: obriga a emitir um evento para toda consulta simples entre Modules.
