import sql from "mssql";
import { assertReadOnlyQuery } from "./read-only-guard.js";
import type { SourceConnector } from "./source-connector.js";

export class MssqlSourceConnector implements SourceConnector {
  private pool: Promise<sql.ConnectionPool> | undefined;

  constructor(private config: sql.config) {}

  private getPool(): Promise<sql.ConnectionPool> {
    if (!this.pool) {
      this.pool = new sql.ConnectionPool(this.config).connect().catch((err: Error) => {
        this.pool = undefined;
        throw err;
      });
    }
    return this.pool;
  }

  async query<TRow = Record<string, unknown>>(sqlText: string, params: Record<string, unknown> = {}): Promise<TRow[]> {
    assertReadOnlyQuery(sqlText);
    const request = (await this.getPool()).request();
    for (const [name, value] of Object.entries(params)) {
      request.input(name, value);
    }
    const result = await request.query(sqlText);
    return result.recordset as TRow[];
  }

  async healthCheck(): Promise<boolean> {
    try {
      await (await this.getPool()).request().query("SELECT 1 AS ok");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await (await this.pool).close();
      this.pool = undefined;
    }
  }
}
