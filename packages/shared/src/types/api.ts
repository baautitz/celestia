/** Problema de um campo, como a API o devolve numa recusa de validação (HTTP 400). */
export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/** Corpo de uma recusa de validação da API; qualquer outra falha traz `error` como texto. */
export interface ValidationErrorBody {
  error: { issues: ValidationIssue[] };
}
