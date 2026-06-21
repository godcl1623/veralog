import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";

/**
 * Vitest setupFiles: 각 테스트 파일마다 실행됨.
 * 각 테스트 시작 전 모든 테이블을 TRUNCATE하여 테스트 간 격리를 보장한다.
 *
 * DATABASE_URL_TEST가 설정되어 있으면 connection을 만들고 TRUNCATE를 실행한다.
 * 미설정(예: 단위 테스트만 실행) 시 skip — 단위 테스트도 setupFiles를 거치지만
 * 모듈 로드 시점에 throw하지 않는다.
 *
 * 테스트는 모두 동일한 모듈 인스턴스를 공유하므로 connection은 모듈 스코프에서
 * 한 번만 만들고, afterAll에서 닫는다.
 */

// CASCADE 의존성 순서: 자식 → 부모. Postgres는 자동으로 부모까지 정리하지만
// 명시적으로 나열해두면 가독성이 좋다.
const TABLES_FOR_TRUNCATE = [
  "user_term_agreements",
  "user_devices",
  "user_oauth_accounts",
  "note_tags",
  "notes",
  "tags",
  "categories",
  "projects",
  "terms",
  "users",
] as const;

const TEST_URL_MARKER = "_test";
const databaseUrlTest = process.env.DATABASE_URL_TEST ?? null;

let client: Sql | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

if (databaseUrlTest) {
  if (!databaseUrlTest.includes(TEST_URL_MARKER)) {
    throw new Error(
      `DATABASE_URL_TEST가 테스트용이 아닙니다 ('_test' 미포함). 운영 DB를 가리키고 있는지 확인하세요.`
    );
  }
  client = postgres(databaseUrlTest, { max: 1 });
  db = drizzle(client, { schema });
}

beforeEach(async () => {
  if (!db) return; // DATABASE_URL_TEST 미설정 — 단위 테스트 (DB 미사용)
  await db.execute(
    sql.raw(
      `TRUNCATE ${TABLES_FOR_TRUNCATE.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
    )
  );
});

afterAll(async () => {
  if (client) await client.end();
});
