import { and, isNotNull, sql } from "drizzle-orm";

import { db } from "../db/client";
import { userDevices } from "../db/schema";

export async function clearExpiredRefreshResults(): Promise<void> {
  await db
    .update(userDevices)
    .set({ refreshReplayResult: null })
    .where(
      and(
        isNotNull(userDevices.refreshReplayResult),
        sql`${userDevices.refreshReplayUntil} <= clock_timestamp()`
      )
    );
}
