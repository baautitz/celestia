# User Authorization & Explicit Approval Rules

> **Audience**: Autonomous Coding Agents, Antigravity, Claude Code, Cursor, Copilot, Cline, Windsurf.  
> **Status**: STRICT HARD INVARIANT — NON-NEGOTIABLE.

---

## 1. Zero Autonomous Decision-Making (Explicit User Approval Required)
- The agent must **NEVER** take unilateral decisions regarding:
  - Layout structure and visual composition.
  - Architecture and patterns.
  - Business logic and workflows.
- For **EVERY SINGLE STEP** to be executed, the agent MUST explicitly ask the user for permission and confirmation before executing the step.

---

## 2. Prohibition of Custom Styled `<div>` Elements Without Prior Authorization
- The agent must **NEVER** create custom components or layouts built with arbitrary styled `<div>` tags without explicit prior approval from the user.
- All UI elements must use standard official `shadcn/ui` components from `@/components/ui/*`.
- If a custom container or layout abstraction is considered, the agent MUST explicitly ask the user if it is permitted before creating or modifying it.

---

## 3. Mandatory Official Documentation Lookup in EVERYTHING (Model is Outdated by Definition)
- **THE MODEL IS OUTDATED**: You MUST acknowledge that internal LLM training memory is naturally outdated and prone to false assumptions as software evolves rapidly.
- **MANDATORY DOCS LOOKUP FOR ALL TOPICS**: NEVER rely on memory for ANYTHING — whether it's Backend (Hono, Argon2, JWT, SQL), Types (TypeScript, Zod), Frontend (React 19, Vite), UI primitives (shadcn/ui, Radix, Base UI, Tailwind CSS), or Tooling.
- **ALWAYS** check official documentation and primary sources before planning, diagnosing, or modifying code.
- **PROHIBITION OF HACKS**: NEVER invent workarounds, guess APIs, use inline styles, or create custom hacks when canonical patterns exist in the official documentation.
- Stop taking unilateral decisions: adhere strictly to the user's directions and confirm each step.

---

## 4. Granular One-Line Conventional Commits & Mandatory Approval Plan
- All git commits in this repository MUST strictly use the **One-Line Conventional Commits** format (`<type>(<scope>): <short description in english>`).
- Commits must be granular, logical, and separated by concern.
- **MANDATORY COMMIT PLANNING**:
  - The agent must **NEVER** run `git commit` without presenting the planned list of commits first.
  - The agent MUST ALWAYS display the commit messages and files to be committed, ask for user approval, and proceed ONLY upon explicit confirmation.
