import postgres from "postgres";

import { assertTestDatabaseUrl } from "./database-target";
import globalSetup from "./global-setup";

export default async function verifyGlobalSetup(): Promise<void> {
  const target = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  const client = postgres(target, { max: 1 });
  try {
    const rows = await client<
      { name: string }[]
    >`select current_database() as name`;
    if (rows[0]?.name !== "veralog_test") {
      throw new Error("Connected database is not veralog_test");
    }
  } catch {
    throw new Error("Approved test database identity could not be verified");
  } finally {
    await client.end();
  }
  await globalSetup();
}
