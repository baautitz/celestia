---
status: accepted
---

# Sem compatibilidade: o banco é reconstruído a cada módulo

Não há clientes em produção, então renomear conceitos, URLs e chaves de Permission quebra sem camada de compatibilidade, e as migrations são regeneradas do zero, uma pasta e um schema Postgres por Module. Isso vale até a primeira release oficial. Quando ela sair, esta regra deixa de valer, este ADR é substituído e as mudanças passam a ser migrações incrementais.
