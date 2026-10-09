import type { FormFieldDef } from "@platform/shared";
import { MssqlSourceConnector } from "./mssql-source-connector.js";
import type { SourceConnector } from "./source-connector.js";

export type ErpValues = Record<string, unknown>;

export interface ErpTypeDef {
  id: string;
  label: string;
  /** Campos do formulário de cadastro; os do tipo "password" são tratados como segredo (cifrados). */
  fields: FormFieldDef[];
  createConnector(values: ErpValues): SourceConnector;
}

const mssql: ErpTypeDef = {
  id: "mssql",
  label: "SQL Server",
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
      defaultValue: false,
      description: "Ative para servidores com certificado autoassinado.",
    },
  ],
  createConnector: (values) =>
    new MssqlSourceConnector({
      server: String(values.host),
      port: Number(values.port),
      database: String(values.database),
      user: String(values.username),
      password: String(values.password),
      options: { encrypt: true, trustServerCertificate: values.trustServerCertificate === true, readOnlyIntent: true },
      requestTimeout: 30000,
      pool: { max: 5 },
    }),
};

export const ERP_TYPES: Record<string, ErpTypeDef> = { [mssql.id]: mssql };

/**
 * Valida os valores enviados contra os campos do tipo e separa config (pública) de segredos.
 * Segredo vazio reaproveita o valor já salvo (`currentSecrets`), quando existir.
 */
export function parseErpValues(
  type: ErpTypeDef,
  input: ErpValues,
  currentSecrets: Record<string, string> = {}
): { config: ErpValues; secrets: Record<string, string> } {
  const config: ErpValues = {};
  const secrets: Record<string, string> = {};

  for (const field of type.fields) {
    const raw = input[field.name];
    const empty = raw === undefined || raw === null || raw === "";

    if (field.type === "password") {
      const value = empty ? currentSecrets[field.name] : String(raw);
      if (!value && field.required) throw new Error(`${field.label} é obrigatório.`);
      if (value) secrets[field.name] = value;
    } else if (field.type === "switch") {
      config[field.name] = raw === true;
    } else if (field.type === "number") {
      const value = empty ? field.defaultValue : Number(raw);
      if (value === undefined && field.required) throw new Error(`${field.label} é obrigatório.`);
      if (value !== undefined && !Number.isFinite(value)) throw new Error(`${field.label} deve ser um número.`);
      if (value !== undefined && ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) {
        throw new Error(`${field.label} fora do intervalo permitido.`);
      }
      config[field.name] = value;
    } else {
      if (empty && field.required) throw new Error(`${field.label} é obrigatório.`);
      if (!empty) config[field.name] = String(raw);
    }
  }
  return { config, secrets };
}
