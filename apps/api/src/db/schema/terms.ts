import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const terms = pgTable(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: varchar("category").notNull(),
    version: varchar("version").notNull(),
    title: varchar("title").notNull(),
    content: text("content").notNull(),
    isRequired: boolean("is_required").notNull(),
    effectiveAt: timestamp("effective_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("terms_effective_at_idx").on(table.effectiveAt)]
);
