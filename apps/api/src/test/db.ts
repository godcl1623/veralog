import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { assertTestDatabaseUrl } from "./database-target";

// Test imports cannot fall back to the application's DATABASE_URL.
const target = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
export const testClient = postgres(target, { max: 1 });
export const db = drizzle(testClient, { schema });
