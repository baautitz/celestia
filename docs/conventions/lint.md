# Lint

Biome (`pnpm lint`) must print 0 errors and 0 warnings.

- `correctness` and `suspicious` use the `recommended` preset, which covers what the former ESLint setup enforced (js and typescript-eslint recommended, `no-explicit-any`, unused variables, `rules-of-hooks`, `exhaustive-deps`) and more. No rule in these groups is turned off.
- `noDoubleAssertion` is a custom rule: `tools/lint/no-double-assertion.grit`, tested by `scripts/lint-rules.test.ts`.
- `a11y`, `style`, `performance` and `complexity` use the `recommended` preset too. Nothing is turned off.
- `style/noNonNullAssertion` is enforced: narrow with a check or an explicit `Error` at a true invariant. Tests use the small `defined()` helper of each workspace (`tests/helpers/defined.ts`, `src/test/defined.ts`) instead of `!`.
- A `biome-ignore` is allowed only with a concrete reason. Typical case: a value listed as a hook dependency only to re-run the effect (a retry counter, a layout input), not read inside it. `document.cookie` in `sidebar.tsx` is ignored because the Cookie Store API is not available in all supported browsers and the write must be synchronous.
