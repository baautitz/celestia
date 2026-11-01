import type { FormFieldDef } from "@platform/core";

/** Campo de formulário da plataforma, compartilhado com o servidor via `@platform/core`. */
export type DriverField = FormFieldDef;

export interface ErpDriverDef {
  id: string;
  label: string;
  fields: DriverField[];
  createClient(values: Record<string, unknown>): {
    query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
    healthCheck?(): Promise<boolean>;
    close?(): Promise<void>;
  };
}

export interface InovafarmaDriverOptions {
  createMssqlClient(values: Record<string, unknown>): {
    query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
    healthCheck?(): Promise<boolean>;
    close?(): Promise<void>;
  };
}

/**
 * Declaração do ERP Driver InovaFarma (conexão MSSQL).
 */
export function createInovafarmaDriver({ createMssqlClient }: InovafarmaDriverOptions): ErpDriverDef {
  return {
    id: "inovafarma",
    label: "InovaFarma",
    fields: [
      { name: "host", label: "Servidor", type: "text", required: true, placeholder: "erp.empresa.com.br" },
      { name: "port", label: "Porta", type: "number", required: true, defaultValue: 1433, min: 1, max: 65535 },
      { name: "database", label: "Banco de dados", type: "text", required: true },
      { name: "username", label: "Usuário", type: "text", required: true },
      { name: "password", label: "Senha", type: "password", required: true },
      {
        name: "trustServerCertificate",
        label: "Confiar no certificado do servidor",
        type: "switch",
        defaultValue: true,
        description: "Ative para servidores com certificado autoassinado.",
      },
    ],
    createClient: createMssqlClient,
  };
}
