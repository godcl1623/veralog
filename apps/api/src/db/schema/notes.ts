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

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    originalProjectId: uuid("original_project_id")
      .notNull()
      .references(() => projects.id),
    categoryId: uuid("category_id").references(() => categories.id),
    title: varchar("title").notNull(),
    content: text("content"),
    deletedAt: timestamp("deleted_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("notes_project_id_idx").on(table.projectId),
    index("notes_category_id_idx").on(table.categoryId),
    index("notes_created_at_idx").on(table.createdAt),
    index("notes_deleted_at_idx")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);
