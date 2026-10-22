---
status: accepted
---

# Uma instância por cliente, com Plugins compostos no build

O Celestia não é SaaS: cada cliente roda a própria instância, numa VPS própria. "Comprar um Plugin" significa incluí-lo no build daquele cliente, então não há ativação em tempo de execução, loja de Plugins nem multi-tenancy. Um Plugin que depende de outro traz o outro para o build.

## Alternativas descartadas

- SaaS multi-tenant com ativação de Plugins por cliente: custo de isolamento e de gestão sem necessidade hoje.
- Plugins pré-compilados e distribuídos: só faz sentido com loja ou um segundo cliente.
