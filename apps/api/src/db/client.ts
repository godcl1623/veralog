import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// 테스트 환경에서는 DATABASE_URL_TEST를 우선 사용한다.
// vitest.config.ts가 setup.ts보다 먼저 실행되므로 모듈 레벨에서 두 가지를 모두 확인.
const databaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL!;
const client = postgres(databaseUrl);
export const db = drizzle(client, { schema });
