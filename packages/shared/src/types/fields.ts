/**
 * Configuração de Lookup assíncrono em fonte externa (ERP).
 */
export interface LookupConfig {
  source: string;
  query: string;
  valueKey?: string;
  labelKey?: string;
  searchParam?: string;
}

/**
 * Interface base comum a todos os campos de formulário e editores de célula.
 */
export interface BaseFormFieldDef {
  name: string;
  label: string;
  required?: boolean;
  readOnly?: boolean;
  description?: string;
  placeholder?: string;
}

// ─── 1. TEXTO CURTO ───────────────────────────────────────────────
export interface TextFormFieldDef extends BaseFormFieldDef {
  type: "text";
  defaultValue?: string;
  maxLength?: number;
}

// ─── 2. TEXTO LONGO MULTILINHA ────────────────────────────────────
export interface TextareaFormFieldDef extends BaseFormFieldDef {
  type: "textarea";
  defaultValue?: string;
  rows?: number;
  maxLength?: number;
}

// ─── 3. NÚMERO GENÉRICO (QUANTIDADES / PERCENTUAIS) ───────────────
export interface NumberFormFieldDef extends BaseFormFieldDef {
  type: "number";
  defaultValue?: number;
  /** Casas decimais (0 para inteiros). Default: 0 */
  precision?: number;
  /** Sufixo visual no input (Ex: "%", "un", "kg", "cx") */
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
}

// ─── 4. MOEDA (MONEY COM MÁSCARA EM TEMPO REAL) ───────────────────
export interface MoneyFormFieldDef extends BaseFormFieldDef {
  type: "money";
  defaultValue?: number;
  /** Número de casas decimais (Ex: 2 para R$ 1.500,00, 3 ou 4 para fracionados). Default: 2 */
  precision?: number;
  /** Símbolo da moeda. Default: "R$" */
  prefix?: string;
  /** Permite números negativos. Default: false */
  allowNegative?: boolean;
  min?: number;
  max?: number;
}

// ─── 5. DATA ÚNICA (YYYY-MM-DD) ───────────────────────────────────
export interface DateFormFieldDef extends BaseFormFieldDef {
  type: "date";
  defaultValue?: string;
  minDate?: string;
  maxDate?: string;
}

// ─── 6. DATA E HORA (ISO DATETIME) ────────────────────────────────
export interface DatetimeFormFieldDef extends BaseFormFieldDef {
  type: "datetime";
  defaultValue?: string;
}

// ─── 7. PERÍODO DE DATAS ──────────────────────────────────────────
export interface DateRangeFormFieldDef extends BaseFormFieldDef {
  type: "date_range";
  defaultValue?: {
    startDate: string;
    endDate: string;
  };
}

// ─── 8. BOOLEANO / TOGGLE SWITCH ──────────────────────────────────
export interface SwitchFormFieldDef extends BaseFormFieldDef {
  type: "switch";
  defaultValue?: boolean;
}

// ─── 9. SELEÇÃO ÚNICA ESTÁTICA ────────────────────────────────────
export interface SelectFormFieldDef extends BaseFormFieldDef {
  type: "select";
  defaultValue?: string | number;
  options: Array<{ value: string | number; label: string }> | string[];
}

// ─── 10. SELEÇÃO MÚLTIPLA ESTÁTICA OU POR LOOKUP ──────────────────
export interface MultiSelectFormFieldDef extends BaseFormFieldDef {
  type: "multi_select";
  defaultValue?: (string | number)[];
  options?: Array<{ value: string | number; label: string }> | string[];
  lookup?: LookupConfig;
}

// ─── 11. LOOKUP SELECT ASSÍNCRONO NO BANCO/ERP ────────────────────
export interface LookupSelectFormFieldDef extends BaseFormFieldDef {
  type: "lookup_select";
  defaultValue?: string | number;
  lookup: LookupConfig;
}

// ─── 12. CAMPO OCULTO / CONTROLE ──────────────────────────────────
export interface HiddenFormFieldDef extends BaseFormFieldDef {
  type: "hidden";
  defaultValue?: unknown;
}

/**
 * União Discriminada com Herança para todos os campos suportados pela plataforma.
 * Oferece validação em tempo de compilação e autocomplete cirúrgico por 'type'.
 */
export type FormFieldDef =
  | TextFormFieldDef
  | TextareaFormFieldDef
  | NumberFormFieldDef
  | MoneyFormFieldDef
  | DateFormFieldDef
  | DatetimeFormFieldDef
  | DateRangeFormFieldDef
  | SwitchFormFieldDef
  | SelectFormFieldDef
  | MultiSelectFormFieldDef
  | LookupSelectFormFieldDef
  | HiddenFormFieldDef;

/**
 * Tipos primitivos extraídos automaticamente da união discriminada.
 */
export type FieldType = FormFieldDef["type"];

/**
 * Mapeamento de FieldType para o tipo TypeScript real correspondente.
 */
export type InferFieldType<T extends FieldType> =
  Extract<FormFieldDef, { type: T }>["defaultValue"];

/**
 * Mapeia um itemSchema com tipos primitivos para um objeto tipado TypeScript.
 */
export type InferSchema<T extends Record<string, { type: FieldType; defaultValue?: unknown }>> = {
  [K in keyof T]: InferFieldType<T[K]["type"]>;
};
