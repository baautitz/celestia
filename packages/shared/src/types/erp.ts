import type { FormFieldDef } from "./fields.js";

/**
 * Tipo de ERP suportado pelo servidor, com os campos que o formulário de cadastro deve pedir.
 */
export interface ErpTypeMeta {
  id: string;
  label: string;
  fields: FormFieldDef[];
}

/**
 * ERP (fonte de dados) cadastrado. Os segredos (campos "password") nunca são devolvidos.
 */
export interface ErpConnection {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ErpConnectionInput {
  name: string;
  type: string;
  values: Record<string, unknown>;
}
