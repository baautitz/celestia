import { zValidator as honoZodValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/**
 * `zValidator` com o corpo de erro `{ success: false, error: { issues } }`.
 * O zod 4 deixou de serializar `issues` no `ZodError`, e o cliente web (`api-client.ts`) lê `error.issues`
 * para mostrar a mensagem de cada campo.
 */
export const zValidator = <S extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: S) =>
  honoZodValidator(target, schema, (result, c) => {
    if (result.success) return undefined;
    const issues = result.error.issues.map(({ code, message, path }) => ({ code, message, path }));
    return c.json({ success: false as const, error: { issues } }, 400);
  });
