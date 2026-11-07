import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  nickname: varchar("nickname").notNull(),
  avatarUrl: varchar("avatar_url"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type NewUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
