import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { userDevices, userOauthAccounts, users } from "../../../db/schema";
import { db } from "../../../test/db";
import { createOAuthAccount, createUser } from "../../../test/fixtures";
import { mockGoogle } from "../../../test/mocks/arctic";
import { readCsrfToken } from "../../../utils/csrf";
import { hashToken, REFRESH_TOKEN_TTL_SECONDS } from "../../../utils/token";
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
  vi.restoreAllMocks();
});

describe("GET /google/callback", () => {
  it("1. state 불일치 시 state_invalid 리다이렉트", async () => {
    const req = makeCallbackRequest({ cookieState: "A", state: "B" });
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/auth/callback?status=state_invalid`
    );
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("2. 만료/위조된 code는 code_invalid 리다이렉트", async () => {
    mock = mockGoogle({
      tokenStatus: 400,
      tokenResponse: { error: "invalid_grant" },
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/auth/callback?status=code_invalid`
    );
    expect(res.headers.getSetCookie()).toHaveLength(0);
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

  it("8. UserInfo 5xx → userinfo_failed 리다이렉트", async () => {
    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: {},
      userinfoStatus: 500,
    });

    const req = makeCallbackRequest();
    const res = await auth.request(req.path, { headers: req.headers });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/auth/callback?status=userinfo_failed`
    );
    expect(res.headers.getSetCookie()).toHaveLength(0);
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

  it.each([
    ["?code=x", {}, "state_missing"],
    ["?state=ok", { Cookie: "google_oauth_state=ok" }, "code_missing"],
    ["?state=ok&code=x", { Cookie: "google_oauth_state=ok" }, "pkce_missing"],
    [
      "?state=ok&error=access_denied&error_description=private",
      { Cookie: "google_oauth_state=ok" },
      "access_denied",
    ],
    [
      "?state=ok&error=arbitrary-private-error",
      { Cookie: "google_oauth_state=ok" },
      "provider_error",
    ],
  ] as const)(
    "callback validation: %s -> %s",
    async (query, headers, status) => {
      const response = await auth.request("/google/callback" + query, {
        headers: { ...headers },
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `${FRONTEND_BASE_URL}/auth/callback?status=${status}`
      );
      expect(response.headers.getSetCookie()).toHaveLength(0);
      expect(await db.select().from(users)).toHaveLength(0);
    }
  );

  it("issues a hashed refresh, seven-day expiry, and session-bound CSRF", async () => {
    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: { sub: GOOGLE_SUB },
    });
    const req = makeCallbackRequest();
    const start = Date.now();
    const response = await auth.request(req.path, { headers: req.headers });
    const end = Date.now();
    expect(response.status).toBe(302);
    const cookies = response.headers.getSetCookie();
    const refreshCookie = cookies.find((c) => c.startsWith("refresh_token="))!;
    const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="))!;
    const refresh = decodeURIComponent(
      refreshCookie.split(";")[0].slice("refresh_token=".length)
    );
    const csrf = decodeURIComponent(
      csrfCookie.split(";")[0].slice("csrf_token=".length)
    );
    const [device] = await db.select().from(userDevices);
    expect(device.refreshToken).toBe(hashToken(refresh));
    expect(device.refreshToken).not.toBe(refresh);
    expect(device.refreshExpiresAt!.getTime()).toBeGreaterThanOrEqual(
      start + REFRESH_TOKEN_TTL_SECONDS * 1000
    );
    expect(device.refreshExpiresAt!.getTime()).toBeLessThanOrEqual(
      end + REFRESH_TOKEN_TTL_SECONDS * 1000
    );
    expect(readCsrfToken(csrf)?.sessionId).toBe(device.id);
    expect(csrfCookie).not.toContain("HttpOnly");
    expect(refreshCookie).toContain("HttpOnly");
    expect(
      cookies.every((c) => c.includes("Secure") && c.includes("SameSite=Lax"))
    ).toBe(true);
  });

  it("uses a generic allowlisted status for network failure, without exposing details", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("private-provider-details")
    );
    const req = makeCallbackRequest();
    const response = await auth.request(req.path, { headers: req.headers });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/auth/callback?status=google_unavailable`
    );
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("only allows the configured frontend origin in credentialed preflight", async () => {
    const allowed = await auth.request("/refresh", {
      method: "OPTIONS",
      headers: {
        Origin: FRONTEND_BASE_URL,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "X-CSRF-Token",
      },
    });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      FRONTEND_BASE_URL
    );
    expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true"
    );
    const rejected = await auth.request("/refresh", {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(rejected.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("distinguishes token exchange rejection without exposing Google's description", async () => {
    mock = mockGoogle({
      tokenStatus: 400,
      tokenResponse: {
        error: "invalid_client",
        error_description: "private-client-details",
      },
    });
    const req = makeCallbackRequest();
    const response = await auth.request(req.path, { headers: req.headers });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/auth/callback?status=token_exchange_failed`
    );
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("uses internal_error for unexpected storage errors without leaking exception text", async () => {
    mock = mockGoogle({
      tokenResponse: { access_token: "google-access", token_type: "Bearer" },
      userinfoResponse: { sub: GOOGLE_SUB },
    });
    vi.spyOn(db, "transaction").mockRejectedValueOnce(
      new Error("private-database-error")
    );
    const req = makeCallbackRequest();
    const response = await auth.request(req.path, { headers: req.headers });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${FRONTEND_BASE_URL}/auth/callback?status=internal_error`
    );
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });
});
