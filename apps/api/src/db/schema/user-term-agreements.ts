import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { terms } from "./terms";
import { users } from "./users";

export const userTermAgreements = pgTable("user_term_agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  termId: uuid("term_id")
    .notNull()
    .references(() => terms.id, { onDelete: "cascade" }),
  agreedAt: timestamp("agreed_at").notNull().defaultNow(),
});
