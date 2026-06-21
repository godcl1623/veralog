import { getRequiredEnv } from "@veralog/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";

/**
 * 테스트 전용 DB 인스턴스.
 *
 * 테스트 파일은 운영 DB 클라이언트(`src/db/client.ts`)를 직접 import하지 말고
 * 본 모듈을 import할 것. 운영 클라이언트는 DATABASE_URL을 무조건 사용하므로,
 * 테스트가 실수로 import하면 운영 DB에 붙는 사고가 난다.
 *
 * 안전 가드: DATABASE_URL_TEST 값에 '_test'가 없으면 throw 한다.
 * 이는 운영 DB가 들어왔을 때 1차로 잡아내는 방어선이다.
 */

const TEST_URL_MARKER = "_test";
const databaseUrlTest = getRequiredEnv("DATABASE_URL_TEST");

if (!databaseUrlTest.includes(TEST_URL_MARKER)) {
  throw new Error(
    `DATABASE_URL_TEST가 테스트용이 아닙니다 ('_test' 미포함). 운영 DB를 가리키고 있는지 확인하세요.`
  );
}

const client = postgres(databaseUrlTest, { max: 1 });
export const db = drizzle(client, { schema });
