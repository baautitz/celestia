export interface SourceConnector {
  /**
   * Executa uma consulta SQL parametrizada no banco externo.
   */
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<TRow[]>;

  /**
   * Testa a conectividade com o banco de dados.
   */
  healthCheck?(): Promise<boolean>;

  /**
   * Fecha as conexões do pool.
   */
  close?(): Promise<void>;
}

/**
 * Conector Mock para testes unitários e de integração no Vitest.
 */
export class MockSourceConnector implements SourceConnector {
  constructor(private mockData: Record<string, Record<string, unknown>[]> = {}) {}

  /**
   * Configura os dados retornados para uma determinada query ou padrão.
   */
  setMockData(key: string, data: Record<string, unknown>[]): void {
    this.mockData[key] = data;
  }

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<TRow[]> {
    // 1. Procura por chave específica nos dados mock
    for (const [key, data] of Object.entries(this.mockData)) {
      if (key !== "default" && sql.includes(key)) {
        return [...data] as TRow[];
      }
    }

    const defaultData = this.mockData["default"] || [];

    // 2. Se a query for individual (ex: query:self filtrando por vendedor)
    if (params) {
      for (const val of Object.values(params)) {
        if (
          val !== null &&
          val !== undefined &&
          (typeof val === "number" || (typeof val === "string" && !isNaN(Number(val)) && val !== ""))
        ) {
          const numVal = Number(val);
          if (
            sql.includes("e.id =") ||
            sql.includes("v.id =") ||
            sql.includes("vendedor_id =") ||
            sql.includes("inovafarma")
          ) {
            const filtered = defaultData.filter((r) => Number(r.vendedor_id ?? r.id) === numVal);
            if (filtered.length > 0) {
              return [...filtered] as TRow[];
            }
          }
        }
      }
    }

    return [...defaultData] as TRow[];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
