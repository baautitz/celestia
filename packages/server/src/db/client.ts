import { drizzle } from "drizzle-orm/node-postgres";
import { createPostgresPool } from "./connection.js";

export const pool = createPostgresPool();
export const db = drizzle({ client: pool });
