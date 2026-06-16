import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { categories } from "./categories";
import { projects } from "./projects";
import { users } from "./users";

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    originalProjectId: uuid("original_project_id").references(
      () => projects.id,
      { onDelete: "set null" }
    ),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    title: varchar("title").notNull(),
    content: text("content"),
    deletedAt: timestamp("deleted_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("notes_user_id_idx").on(table.userId),
    index("notes_project_id_idx")
      .on(table.projectId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("notes_category_id_idx").on(table.categoryId),
    index("notes_created_at_idx").on(table.createdAt),
    index("notes_deleted_at_idx")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);
