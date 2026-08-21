export interface InterpolationContext {
  workspace?: {
    startDate?: string;
    endDate?: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
  };
  user?: {
    id?: string;
    role?: string;
    externals?: Record<string, string | number>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ParameterizedQuery {
  sql: string;
  params: Record<string, unknown>;
  paramNames: string[];
}

export class TemplateEngine {
  /**
   * Converte uma query contendo tokens {{...}} em uma query parametrizada segura contra SQL Injection.
   * Exemplo:
   *   Entrada: "SELECT * FROM vendas WHERE dt BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}"
   *   Saída: { sql: "SELECT * FROM vendas WHERE dt BETWEEN @p1 AND @p2", params: { p1: "2026-01-01", p2: "2026-01-31" } }
   */
  static parse(
    rawQuery: string,
    context: InterpolationContext,
    paramPrefix: "@" | "$" | ":" = "@"
  ): ParameterizedQuery {
    const params: Record<string, unknown> = {};
    const paramNames: string[] = [];
    let paramIndex = 1;

    // Expressão regular para encontrar {{ caminho.do.token }}
    const sql = rawQuery.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, tokenPath: string) => {
      const value = TemplateEngine.resolvePath(tokenPath, context);
      const paramKey = `p${paramIndex++}`;
      const placeholder = `${paramPrefix}${paramKey}`;

      params[paramKey] = value;
      paramNames.push(paramKey);

      return placeholder;
    });

    return { sql, params, paramNames };
  }

  /**
   * Resolve caminhos no formato "workspace.start_date" ou "user.externals.inovafarma".
   */
  private static resolvePath(path: string, context: Record<string, unknown>): unknown {
    const parts = path.split(".");
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        return null;
      }
      const record = current as Record<string, unknown>;
      if (record[part] !== undefined) {
        current = record[part];
      } else if (part === "start_date" && record["startDate"] !== undefined) {
        current = record["startDate"];
      } else if (part === "end_date" && record["endDate"] !== undefined) {
        current = record["endDate"];
      } else if (part === "startDate" && record["start_date"] !== undefined) {
        current = record["start_date"];
      } else if (part === "endDate" && record["end_date"] !== undefined) {
        current = record["end_date"];
      } else if (
        record["params"] !== null &&
        typeof record["params"] === "object" &&
        (record["params"] as Record<string, unknown>)[part] !== undefined
      ) {
        current = (record["params"] as Record<string, unknown>)[part];
      } else {
        current = null;
      }
    }

    return current ?? null;
  }
}
