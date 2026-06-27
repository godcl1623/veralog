import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { userDevices, userOauthAccounts, users } from "../../../db/schema";
import { db } from "../../../test/db";
import { createOAuthAccount, createUser } from "../../../test/fixtures";
import { mockGoogle } from "../../../test/mocks/arctic";
import { auth } from "../auth";

const GOOGLE_SUB = "google-123";
const VALID_STATE = "valid-state-abc";
const VALID_CODE_VERIFIER = "valid-code-verifier-xyz";

function makeCallbackRequest(
  opts: {
    state?: string;
    code?: string;
    cookieState?: string;
    cookieCodeVerifier?: string;
  } = {}
) {
  const state = opts.state ?? VALID_STATE;
  const code = opts.code ?? "valid-auth-code";
  const cookieState = opts.cookieState ?? state;
  const cookieCodeVerifier = opts.cookieCodeVerifier ?? VALID_CODE_VERIFIER;

  return {
    path: `/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
    headers: {
      Cookie: `google_oauth_state=${cookieState}; google_oauth_code_verifier=${cookieCodeVerifier}`,
    },
  };
}

const FRONTEND_BASE_URL =
  process.env.FRONTEND_BASE_URL ?? "http://localhost:5173";

let mock: ReturnType<typeof mockGoogle> | null = null;

afterEach(() => {
  mock?.mockRestore();
  mock = null;
});

describe("GET /google/callback", () => {
  it("1. state 불일치 시 400", async () => {
    const req = makeCallbackRequest({ cookieState: "A", state: "B" });
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid state" });
  });

  it("2. 만료/위조된 code로 OAuth2RequestError 시 400", async () => {
    mock = mockGoogle({
      tokenStatus: 400,
      tokenResponse: { error: "invalid_grant" },
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "OAuth2 request error" });
  });

  it("3. 기존 유저(deletedAt NULL) 로그인 → 302 메인 + 쿠키 + device", async () => {
    const user = await createUser();
    await createOAuthAccount(user.id, {
      provider: "google",
      providerAccountId: GOOGLE_SUB,
    });

    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: {
        sub: GOOGLE_SUB,
        name: "Test User",
        email: "test@example.com",
        picture: "https://example.com/avatar.png",
      },
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(FRONTEND_BASE_URL);

    // access_token + refresh_token 쿠키 확인
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.some((c) => c.startsWith("access_token="))).toBe(true);
    expect(setCookie.some((c) => c.startsWith("refresh_token="))).toBe(true);

    // user_devices 1행
    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, user.id));
    expect(devices).toHaveLength(1);
    expect(devices[0].refreshToken).not.toBeNull();
  });

  it("4. 168h 이내 deletedAt → 복구", async () => {
    const user = await createUser({
      deletedAt: new Date(Date.now() - 100 * 60 * 60 * 1000),
    });
    await createOAuthAccount(user.id, {
      provider: "google",
      providerAccountId: GOOGLE_SUB,
    });

    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: { sub: GOOGLE_SUB },
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(FRONTEND_BASE_URL);

    // deletedAt 복구 확인
    const [updated] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(updated.deletedAt).toBeNull();

    // device 1행
    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, user.id));
    expect(devices).toHaveLength(1);
  });

  it("5. 168h 초과 deletedAt → hard delete + 신규 유저", async () => {
    const oldUser = await createUser({
      deletedAt: new Date(Date.now() - 200 * 60 * 60 * 1000),
    });
    await createOAuthAccount(oldUser.id, {
      provider: "google",
      providerAccountId: GOOGLE_SUB,
    });

    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: { sub: GOOGLE_SUB },
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/terms?new=true`
    );

    // 기존 user 삭제 확인
    const oldUserCheck = await db
      .select()
      .from(users)
      .where(eq(users.id, oldUser.id));
    expect(oldUserCheck).toHaveLength(0);

    // 새 user가 1행만 존재
    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0].nickname).toMatch(/^user_/);

    // oauth 1행 (새 user에 연결)
    const oauths = await db
      .select()
      .from(userOauthAccounts)
      .where(
        and(
          eq(userOauthAccounts.provider, "google"),
          eq(userOauthAccounts.providerAccountId, GOOGLE_SUB)
        )
      );
    expect(oauths).toHaveLength(1);

    // device 1행 (새 user에 속함)
    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, allUsers[0].id));
    expect(devices).toHaveLength(1);
  });

  it("6. 신규 유저 → 302 약관 페이지 + DB 행 생성", async () => {
    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: {
        sub: GOOGLE_SUB,
        picture: "https://example.com/avatar.png",
      },
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/terms?new=true`
    );

    // users 1행
    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0].nickname).toMatch(/^user_/);
    expect(allUsers[0].avatarUrl).toBe("https://example.com/avatar.png");

    // oauth 1행
    const oauths = await db
      .select()
      .from(userOauthAccounts)
      .where(
        and(
          eq(userOauthAccounts.provider, "google"),
          eq(userOauthAccounts.providerAccountId, GOOGLE_SUB)
        )
      );
    expect(oauths).toHaveLength(1);

    // devices 1행
    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, allUsers[0].id));
    expect(devices).toHaveLength(1);
  });

  it("7. race condition: 동일 sub 동시 요청 → users 1 + oauth 1 + devices 2", async () => {
    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: { sub: GOOGLE_SUB },
    });

    const req = makeCallbackRequest();

    const [res1, res2] = await Promise.all([
      auth.request(req.path, { headers: req.headers }),
      auth.request(req.path, { headers: req.headers }),
    ]);

    expect(res1.status).toBe(302);
    expect(res2.status).toBe(302);

    // 중복 생성 없음
    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(1);

    const oauths = await db
      .select()
      .from(userOauthAccounts)
      .where(
        and(
          eq(userOauthAccounts.provider, "google"),
          eq(userOauthAccounts.providerAccountId, GOOGLE_SUB)
        )
      );
    expect(oauths).toHaveLength(1);

    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, allUsers[0].id));
    expect(devices).toHaveLength(2);
  });

  it("8. UserInfo 5xx → 502", async () => {
    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: {},
      userinfoStatus: 500,
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to fetch from Google" });
  });

  it("9. 168h 경계(1ms 초과) → hard delete 분기", async () => {
    const deletedAt = new Date(Date.now() - 168 * 3600 * 1000 - 1);
    const oldUser = await createUser({ deletedAt });
    await createOAuthAccount(oldUser.id, {
      provider: "google",
      providerAccountId: GOOGLE_SUB,
    });

    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: { sub: GOOGLE_SUB },
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/terms?new=true`
    );

    // 기존 user hard delete 확인
    const oldCheck = await db
      .select()
      .from(users)
      .where(eq(users.id, oldUser.id));
    expect(oldCheck).toHaveLength(0);

    // 새 user 1행
    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(1);
  });
});
