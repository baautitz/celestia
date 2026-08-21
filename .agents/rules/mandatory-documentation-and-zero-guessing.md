# Protocolo Obrigatório: Proibição Absoluta de Adivinhação & Consulta Mandatória à Documentação Oficial em TUDO

> **Status**: INVARIANTE GLOBAL INEGOCIÁVEL (APLICA-SE A TODOS OS AGENTES E SESSÕES)  
> **Escopo**: Backend (Hono, JWT, Argon2, SQL), Frontend (React 19, Vite, shadcn/ui, Radix, Base UI, Tailwind CSS v4), Tipagem (TypeScript, Zod), SDUI, Testes e Tooling.

---

## 1. Premissa Fundamental: O Modelo É Desatualizado
- A memória interna do modelo sobre bibliotecas, frameworks, versões e sintaxes é **inerentemente defasada e propensa a alucinações**.
- É **expressamente proibido** confiar na memória para deduzir comportamento de componentes, CSS, seletores de dados (`data-[...]`), APIs ou arquitetura.

---

## 2. Consulta Mandatória à Documentação Oficial
Para **QUALQUER** implementação, refatoração, correção de bug ou layout:
1. O agente **DEVE consultar previamente a documentação oficial** (via busca ou ferramentas disponíveis) antes de escrever qualquer código.
2. Nenhuma suposição é permitida. Tudo deve ser verificado na fonte canônica oficial vigente.

---

## 3. Proibição Total de Gambiarras, Inline Styles e Hacks
- **Nunca inventar soluções improvisadas**: proibido o uso de *inline styles* (`style={{...}}`), tags ou wrappers arbitrários, ou soluções que desviem do padrão canônico da biblioteca.
- Quando o problema exigir scroll, layouts complexos ou formulários, utilizar **exclusivamente os componentes oficiais** da biblioteca (ex: `<ScrollArea>`, `<SheetContent>`, `<Form>`, etc.) conforme a documentação oficial.

---

## 4. Aprovação Passo a Passo Estrita e Sem Decisões Unilaterais
- O agente **NUNCA** toma decisões unilaterais sobre layout, lógica de negócio ou estrutura.
- Cada etapa deve ser explicada e submetida à confirmação explícita do usuário antes da execução.
