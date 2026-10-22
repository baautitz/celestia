---
status: accepted
---

# Audit Log global e autodescritivo

Há um único Audit Log para o sistema inteiro. Cada Log Entry tem um envelope fixo (quando, quem, de qual Plugin, a ação, o tipo e o id do alvo) e atributos flexíveis em `jsonb`, validados na gravação pelo schema que o Plugin declara para cada ação, com a versão do schema guardada na entrada. O log só recebe acréscimos, e cada entrada guarda um resumo legível em texto, para continuar compreensível depois que o Plugin sai do build.

## Alternativas descartadas

- Uma tabela de log por Plugin: quebra a visão única do que um usuário fez e some junto com o Plugin.
- JSON sem schema: sem validação, o log vira dado inconsistente em pouco tempo.
- Colunas fixas para tudo: não comporta os atributos que cada Plugin precisa registrar.

Os atributos específicos de cada ação serão definidos quando os Plugins existirem.
