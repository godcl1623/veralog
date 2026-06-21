import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { users } from "./users";

export const userDevices = pgTable("user_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceName: varchar("device_name"),
  refreshToken: varchar("refresh_token"),
  lastAccessedAt: timestamp("last_accessed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type NewUserDevice = typeof userDevices.$inferInsert;
export type UserDevice = typeof userDevices.$inferSelect;
