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

export function startRefreshReplayCleanup(
  cleanup = clearExpiredRefreshResults
): () => void {
  let running = false;
  let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await cleanup();
    } catch {
      console.error("Refresh replay cleanup failed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
