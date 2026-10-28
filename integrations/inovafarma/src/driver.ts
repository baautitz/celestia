import { INOVAFARMA_EXTERNALS } from "./externals.js";

interface DriverFieldBase {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

/** Subconjunto dos campos de formulário da plataforma usados pelo Driver (estruturalmente compatível com FormFieldDef). */
export type DriverField =
  | (DriverFieldBase & { type: "text"; defaultValue?: string })
  | (DriverFieldBase & { type: "password" })
  | (DriverFieldBase & { type: "number"; defaultValue?: number; min?: number; max?: number })
  | (DriverFieldBase & { type: "switch"; defaultValue?: boolean });

export interface ErpDriverDef {
  id: string;
  label: string;
  fields: DriverField[];
  externalFields: { name: string; label: string; type: "text" }[];
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
 * Declaração do ERP Driver InovaFarma (conexão MSSQL + externals de colaborador e loja).
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
    externalFields: [...INOVAFARMA_EXTERNALS],
    createClient: createMssqlClient,
  };
}
