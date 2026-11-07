import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";

import { db, testClient } from "./db";

const tables = [
  "user_term_agreements",
  "user_devices",
  "user_oauth_accounts",
  "note_tags",
  "notes",
  "tags",
  "categories",
  "projects",
  "terms",
  "users",
] as const;

beforeEach(async () => {
  await db.execute(
    sql.raw(
      `TRUNCATE ${tables.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`
    )
  );
});

afterAll(async () => {
  await testClient.end();
});
