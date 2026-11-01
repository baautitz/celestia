import type { FormFieldDef } from "./fields.js";

/**
 * ERP Driver suportado pelo servidor, com os campos que o formulário de cadastro deve pedir.
 */
export interface ErpDriverMeta {
  id: string;
  label: string;
  fields: FormFieldDef[];
}

/**
 * ERP cadastrado. Os segredos (campos "password") nunca são devolvidos.
 */
export interface Erp {
  id: string;
  name: string;
  driver: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ErpInput {
  name: string;
  driver: string;
  values: Record<string, unknown>;
}
