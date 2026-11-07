import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "../db/schema";
import { assertTestDatabaseUrl } from "./database-target";

export default async function globalSetup(): Promise<void> {
  const target = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  const client = postgres(target, { max: 1 });
  try {
    await migrate(drizzle(client, { schema }), {
      migrationsFolder: "./drizzle",
    });
  } finally {
    await client.end();
  }
}
