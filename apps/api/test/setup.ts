import { getRequiredEnv } from "@veralog/shared";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach } from "vitest";

import * as schema from "../src/db/schema";

/**
 * Vitest setupFiles: 각 테스트 파일마다 실행됨.
 * 각 테스트 시작 전 모든 테이블을 TRUNCATE하여 테스트 간 격리를 보장한다.
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

const client = postgres(getRequiredEnv("DATABASE_URL_TEST"), { max: 1 });
const db = drizzle(client, { schema });

beforeEach(async () => {
  await db.execute(
    sql.raw(
      `TRUNCATE ${TABLES_FOR_TRUNCATE.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
    )
  );
});

afterAll(async () => {
  await client.end();
});
