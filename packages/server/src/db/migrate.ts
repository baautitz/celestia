import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

migrate(db, { migrationsFolder: "./drizzle" }).finally(() => pool.end());
