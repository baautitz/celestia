import type { FormFieldDef } from "./fields.js";

/**
 * ERP Driver suportado pelo servidor, com os campos que o formulário de cadastro deve pedir.
 */
export interface ErpDriverMeta {
  id: string;
  label: string;
  fields: FormFieldDef[];
  /** Campos de Externals que o ERP Driver declara para mapear um User ao ERP. */
  externalFields: FormFieldDef[];
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

/**
 * Externals de um User em um ERP: os campos que o Plugin declara e os valores gravados.
 */
export interface ErpExternalsEntry {
  erpId: string;
  erpName: string;
  fields: FormFieldDef[];
  values: Record<string, string | number>;
}
