import { pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { users } from "./users";

export const userOauthAccounts = pgTable(
  "user_oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider").notNull(),
    providerAccountId: varchar("provider_account_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("user_oauth_accounts_provider_account_unique").on(
      table.provider,
      table.providerAccountId
    ),
  ]
);
