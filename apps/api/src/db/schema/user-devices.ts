import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { users } from "./users";

export const userDevices = pgTable("user_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  deviceName: varchar("device_name"),
  refreshToken: varchar("refresh_token"),
  lastAccessedAt: timestamp("last_accessed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
