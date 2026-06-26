import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "../test/db";
import { createUser } from "../test/fixtures";
import { users } from "./schema";

/**
 * Sanity test: 테스트 인프라 전체를 한 번에 검증한다.
 *
 *   - vitest config (.env 자동 로드)
 *   - global-setup (마이그레이션 적용)
 *   - setup.ts (매 테스트마다 TRUNCATE)
 *   - test/db.ts (DB connection)
 *   - test/fixtures.ts (createUser 동작)
 *
 * 운영 코드 변경과 무관하게 항상 통과해야 한다. 통과 시 인프라 OK,
 * 실패 시 환경 점검(.env, Postgres, setup-test-db.sql 실행)을 우선할 것.
 */
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
