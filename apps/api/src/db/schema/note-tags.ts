import { index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { notes } from "./notes";
import { tags } from "./tags";

export const noteTags = pgTable(
  "note_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("note_tags_id_tag_id_unique").on(table.noteId, table.tagId),
    index("note_tags_tag_id_idx").on(table.tagId),
  ]
);
