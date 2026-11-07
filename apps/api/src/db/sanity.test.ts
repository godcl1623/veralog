import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "../test/db";
import { createUser } from "../test/fixtures";
import { users } from "./schema";

// Verifies the real test DB, migration, fixtures and per-test cleanup together.
describe("test infrastructure sanity", () => {
  it("DB 연결 + 마이그레이션 적용 확인 (users 테이블 존재)", async () => {
    // 연결 확인 — throw 없이 resolve
    await expect(db.execute(sql`SELECT 1`)).resolves.toBeDefined();

    // global-setup의 마이그레이션 적용 검증 — users 테이블이 존재해야 한다
    const rows = (await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    `)) as unknown as Array<{ table_name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.table_name).toBe("users");
  });

  it("fixtures.createUser 동작 확인 (다음 it의 TRUNCATE 검증 기반 데이터)", async () => {
    const user = await createUser();

    expect(user.id).toBeDefined();
    expect(user.createdAt).toBeInstanceOf(Date);

    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(user.id);
  });

  it("setup.ts의 beforeEach TRUNCATE 검증 — 다음 it 시작 시 이전 it 데이터 모두 제거", async () => {
    // 이 it가 시작될 때 setup.ts의 beforeEach가 실행되어
    // 직전 it의 createUser 데이터가 TRUNCATE된 상태여야 한다.
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(0);
  });
});
