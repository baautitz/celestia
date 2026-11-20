import { zValidator as honoZodValidator } from "@hono/zod-validator";
import type { ValidationErrorBody } from "@platform/shared";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/** `zValidator` que recusa com o contrato `ValidationErrorBody` (HTTP 400), lido pelo cliente web. */
export const zValidator = <S extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: S) =>
  honoZodValidator(target, schema, (result, c) => {
    if (result.success) return undefined;
    const body: ValidationErrorBody = {
      error: { issues: result.error.issues.map(({ path, message }) => ({ path: path.map((p) => (typeof p === "symbol" ? String(p) : p)), message })) },
    };
    return c.json(body, 400);
  });
