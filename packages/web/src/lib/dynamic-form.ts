import { z } from "zod";
import type { FormFieldDef } from "@platform/shared";

export type DynamicFormValues = Record<string, unknown>;

/**
 * Gera os valores padrão a partir da lista de campos do Modelo.
 */
export function buildDynamicDefaultValues(fields: FormFieldDef[]): DynamicFormValues {
  const defaults: DynamicFormValues = {};

  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      defaults[field.name] = field.defaultValue;
      continue;
    }

    switch (field.type) {
      case "switch":
        defaults[field.name] = false;
        break;
      case "multi_select":
        defaults[field.name] = [];
        break;
      case "number":
      case "money":
        defaults[field.name] = "";
        break;
      default:
        defaults[field.name] = "";
    }
  }

  return defaults;
}

/**
 * Gera um schema Zod dinâmico a partir da lista de campos do Modelo.
 * Cada campo receive uma mensagem de validação própria com o label.
 */
export function buildDynamicSchema(fields: FormFieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    const errorMsg = `${field.label} é obrigatório.`;

    switch (field.type) {
      case "textarea":
      case "date":
      case "datetime":
      case "text":
      case "lookup_select":
      case "select": {
        let s = z.string({ message: field.required ? errorMsg : undefined });
        if (field.required) s = s.min(1, errorMsg);
        shape[field.name] = s;
        break;
      }

      case "number":
      case "money": {
        const numField = z.preprocess(
          (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
          z.number({ message: "Informe um número válido." })
        );
        shape[field.name] = field.required ? numField : numField.optional();
        break;
      }

      case "switch":
        shape[field.name] = z.boolean();
        break;

      case "multi_select":
        shape[field.name] = z.array(z.union([z.string(), z.number()]));
        break;

      case "date_range":
        shape[field.name] = z
          .object({ startDate: z.string(), endDate: z.string() })
          .optional();
        break;

      default:
        shape[field.name] = z.unknown().optional();
    }
  }

  return z.object(shape);
}

/**
 * Normaliza os valores do formulário para o formato aceito pelo backend.
 * O MultiSelect armazena como string[]; as demais typagens são preservadas.
 */
export function normalizeDynamicFormValues(
  fields: FormFieldDef[],
  raw: DynamicFormValues
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    const val = raw[field.name];

    if (field.type === "multi_select") {
      result[field.name] = Array.isArray(val)
        ? val.map((v) => (typeof v === "string" && !isNaN(Number(v)) && v !== "" ? Number(v) : v))
        : [];
    } else {
      result[field.name] = val;
    }
  }

  return result;
}
