import { getRequiredEnv } from "@veralog/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "../db/schema";

/**
 * Vitest globalSetup: 테스트 실행 전 1회 실행.
 * 테스트 DB에 마이그레이션을 적용하고 연결을 종료한다.
 *
 * 사전 조건:
 *   - DATABASE_URL_TEST 환경변수 설정
 *   - scripts/setup-test-db.sql로 veralog_test DB 생성 완료
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrlTest = getRequiredEnv("DATABASE_URL_TEST");

  const client = postgres(databaseUrlTest, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
