# Frontend & UI Architecture Rules — 100% shadcn/ui Standard

> **Audience**: Autonomous Coding Agents, Antigravity, Claude Code, Cursor, Copilot, Cline, Windsurf.  
> **Package**: `@platform/web` (Vite + React 19 + TypeScript + shadcn/ui).

---

## 1. Absolute Rule: 100% Pure `shadcn/ui` Standard (No Raw HTML)

Every component rendered in the application MUST be built exclusively with official `shadcn/ui` primitives located in `@/components/ui/*`.

- **FORMS**: NEVER use raw `<form>`, `<label>`, or uncontrolled `<input>`. ALWAYS use:
  - `<Form>`
  - `<FormField>`
  - `<FormItem>`
  - `<FormLabel>`
  - `<FormControl>`
  - `<FormMessage>`
  - `<FormDescription>`
  - Combined with `react-hook-form` and `@hookform/resolvers/zod` with typed schemas.
- **LABELS**: ALWAYS import and use `<Label>` from `@/components/ui/label`. NEVER use raw `<label>` tags.
- **CONTAINERS & SURFACES**: ALWAYS use `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardDescription>`, `<CardContent>`, `<CardFooter>`.
- **DATA DISPLAY & TABLES**: ALWAYS use `<Table>`, `<TableHeader>`, `<TableBody>`, `<TableRow>`, `<TableHead>`, `<TableCell>`.
- **FEEDBACK & MODALS**: ALWAYS use `<Dialog>`, `<AlertDialog>`, `<Badge>`, `<Skeleton>`, `<Separator>`, `<Sonner>`.
- **SCROLLING & OVERFLOW**: ALWAYS use `<ScrollArea>` from `@/components/ui/scroll-area` or canonical flex container patterns from the official docs. NEVER use inline styles (`style={{...}}`) or arbitrary CSS workarounds.
- **ZERO GUESSWORK**: ALWAYS consult official docs at `https://ui.shadcn.com` prior to implementing or fixing any component. NEVER trust internal memory alone.

---

## 2. Button Sizing & Ergonomics Policy (Non-Negotiable)

- **NORMAL / DEFAULT SIZES ONLY**: **NEVER use `size="sm"` or compact `h-8` buttons by default.**
- All buttons must use standard, comfortable, accessible sizes:
  - Primary & standard buttons: `size="default"` (standard `h-10` height, comfortable padding).
  - Hero or prominent action buttons: `size="lg"`.
  - Icon buttons in toolbars: `size="icon"` (standard `h-10 w-10` or minimum `h-9 w-9`).
- Buttons must have clear labels, accessible contrast, and prominent touch targets for enterprise operation.

---

## 3. Typography & Styling Guidelines

- Use semantic Tailwind tokens mapped to shadcn CSS variables (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `bg-primary`, `text-destructive`).
- Spacing: Comfortable enterprise layouts with standard grid gaps (`gap-4`, `gap-6`) and standard card padding (`p-6`).

---

## 4. State Management & Navigation

- Authentication status is managed in `AuthContext.tsx`.
- Page navigations after login/mutations must use `navigate("/target", { replace: true })`.
- Imperative dialogs triggered from SDUI actions (`ui.dialog.open`, `ui.confirm`) must use the Promise-based `ImperativeUIContext.tsx`.
