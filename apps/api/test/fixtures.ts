import { randomUUID } from "node:crypto";

import type {
  NewUser,
  NewUserDevice,
  NewUserOauthAccount,
} from "../src/db/schema";
import { userDevices, userOauthAccounts, users } from "../src/db/schema";
import { db } from "./db";

/**
 * 테스트용 user 행을 삽입하고 반환한다.
 *
 * 호출 예:
 *   const user = await createUser({ nickname: "alice" });
 */
export async function createUser(overrides: Partial<NewUser> = {}) {
  const [user] = await db
    .insert(users)
    .values({
      nickname: "test-user",
      ...overrides,
    })
    .returning();
  return user;
}

/**
 * 테스트용 user_oauth_accounts 행을 삽입하고 반환한다.
 *
 * providerAccountId는 기본적으로 randomUUID를 사용한다 — UNIQUE 제약을
 * 가진 컬럼이라 테스트 간 충돌을 막기 위해 매번 새 값이 안전하다.
 *
 * 호출 예:
 *   const account = await createOAuthAccount(user.id, { provider: "google" });
 */
export async function createOAuthAccount(
  userId: string,
  overrides: Partial<NewUserOauthAccount> = {}
) {
  const [account] = await db
    .insert(userOauthAccounts)
    .values({
      userId,
      provider: "google",
      providerAccountId: randomUUID(),
      ...overrides,
    })
    .returning();
  return account;
}

/**
 * 테스트용 user_devices 행을 삽입하고 반환한다.
 *
 * deviceName, refreshToken, lastAccessedAt 모두 nullable이므로 기본값 없이도
 * 행 생성이 가능하다.
 *
 * 호출 예:
 *   const device = await createDevice(user.id, { refreshToken: "hashed..." });
 */
export async function createDevice(
  userId: string,
  overrides: Partial<NewUserDevice> = {}
) {
  const [device] = await db
    .insert(userDevices)
    .values({
      userId,
      ...overrides,
    })
    .returning();
  return device;
}
