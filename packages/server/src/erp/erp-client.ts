export interface ErpClient {
  /**
   * Executa uma consulta SQL parametrizada no banco do ERP.
   */
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<TRow[]>;

  /**
   * Testa a conectividade com o ERP.
   */
  healthCheck?(): Promise<boolean>;

  /**
   * Fecha as conexões do pool.
   */
  close?(): Promise<void>;
}

/** Clientes ativos, indexados pelo id do ERP. */
export type ErpClientRegistry = Record<string, ErpClient>;
