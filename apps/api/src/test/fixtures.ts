import { users } from "../db/schema";
import { db } from "./db";

export async function createUser(
  overrides: Partial<typeof users.$inferInsert> = {}
) {
  const [user] = await db
    .insert(users)
    .values({ nickname: "test-user", ...overrides })
    .returning();
  return user;
}
