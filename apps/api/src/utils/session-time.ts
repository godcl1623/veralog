import { sql } from "drizzle-orm";

import type { db } from "../db/client";

export async function readSessionTime(
  executor: Pick<typeof db, "execute">
): Promise<number> {
  // now() is fixed at transaction start and would ignore time spent waiting for a row lock.
  const [row] = await executor.execute<{ milliseconds: number }>(sql`
    select floor(extract(epoch from clock_timestamp()) * 1000)::float8 as milliseconds
  `);
  const time = Number(row.milliseconds);
  if (!Number.isSafeInteger(time) || time <= 0)
    throw new Error("Invalid session clock");
  return time;
}
