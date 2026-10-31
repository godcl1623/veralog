import { sql } from "drizzle-orm";
import { index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { users } from "./users";

export const userDevices = pgTable(
  "user_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceName: varchar("device_name"),
    refreshToken: varchar("refresh_token"),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    previousRefreshTokenHash: varchar("previous_refresh_token_hash"),
    refreshReplayResult: varchar("refresh_replay_result"),
    refreshReplayUntil: timestamp("refresh_replay_until", {
      withTimezone: true,
    }),
    lastAccessedAt: timestamp("last_accessed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("user_devices_refresh_replay_cleanup_idx")
      .on(table.refreshReplayUntil)
      .where(sql`${table.refreshReplayResult} is not null`),
  ]
);

export type NewUserDevice = typeof userDevices.$inferInsert;
export type UserDevice = typeof userDevices.$inferSelect;
