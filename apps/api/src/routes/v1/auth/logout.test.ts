import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { userDevices } from "../../../db/schema";
import { authMiddleware } from "../../../middleware/auth";
import { db } from "../../../test/db";
import { createDevice, createUser } from "../../../test/fixtures";
import {
  createCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../../../utils/csrf";
import { signAccessToken } from "../../../utils/jwt";
import { hashToken } from "../../../utils/token";
import { auth } from "../auth";

const origin = "http://localhost:5173";

function headers(
  accessToken?: string,
  refreshToken?: string,
  csrfToken?: string
) {
  const cookies: string[] = [];
  if (accessToken) cookies.push(`access_token=${accessToken}`);
  if (refreshToken) cookies.push(`refresh_token=${refreshToken}`);
  if (csrfToken) cookies.push(`${CSRF_COOKIE_NAME}=${csrfToken}`);
  return {
    Origin: origin,
    ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
    ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
  };
}

async function getDevices(userId: string) {
  return db.select().from(userDevices).where(eq(userDevices.userId, userId));
}

describe("DELETE /auth/logout", () => {
  it("6-1. 유효 access + refresh + CSRF → 200 + 해당 세션 삭제 + 세 쿠키 만료", async () => {
    const user = await createUser();
    const rawToken = "synthetic-logout-valid-refresh";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const other = await createDevice(user.id, {
      refreshToken: hashToken("synthetic-logout-other-device"),
    });
    const accessToken = await signAccessToken(user.id);
    const csrf = createCsrfToken(device.id, rawToken);

    const res = await auth.request("/logout", {
      method: "DELETE",
      headers: headers(accessToken, rawToken, csrf),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(
      res.headers.getSetCookie().filter((cookie) => /Max-Age=0/i.test(cookie))
    ).toHaveLength(3);
    expect(await getDevices(user.id)).toEqual([
      expect.objectContaining({ id: other.id }),
    ]);
  });

  it("6-2. Access Token 없음 → 401 + 디바이스 행 유지", async () => {
    const user = await createUser();
    const device = await createDevice(user.id, {
      refreshToken: hashToken("synthetic-logout-no-access"),
    });

    const res = await auth.request("/logout", { method: "DELETE" });

    expect(res.status).toBe(401);
    expect(await getDevices(user.id)).toEqual([
      expect.objectContaining({ id: device.id }),
    ]);
  });

  it("6-3. Access Token 무효 → 401 + 디바이스 행 유지", async () => {
    const user = await createUser();
    const rawToken = "synthetic-logout-invalid-access";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });

    const res = await auth.request("/logout", {
      method: "DELETE",
      headers: headers(
        "invalid.synthetic.access",
        rawToken,
        createCsrfToken(device.id, rawToken)
      ),
    });

    expect(res.status).toBe(401);
    expect(await getDevices(user.id)).toEqual([
      expect.objectContaining({ id: device.id }),
    ]);
  });

  it("6-4. 이미 삭제된 세션, 정상 CSRF + Access → 200 멱등 + 세 쿠키 만료", async () => {
    const user = await createUser();
    const rawToken = "synthetic-logout-already-deleted";
    const deleted = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const other = await createDevice(user.id, {
      refreshToken: hashToken("synthetic-logout-idempotent-other"),
    });
    const accessToken = await signAccessToken(user.id);
    const csrf = createCsrfToken(deleted.id, rawToken);
    await db.delete(userDevices).where(eq(userDevices.id, deleted.id));

    const res = await auth.request("/logout", {
      method: "DELETE",
      headers: headers(accessToken, rawToken, csrf),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(
      res.headers.getSetCookie().filter((cookie) => /Max-Age=0/i.test(cookie))
    ).toHaveLength(3);
    expect(await getDevices(user.id)).toEqual([
      expect.objectContaining({ id: other.id }),
    ]);
  });

  it("6-5. refresh 쿠키 부재, 정상 CSRF + Access → 401 + 세션 유지", async () => {
    const user = await createUser();
    const rawToken = "synthetic-logout-missing-refresh";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const accessToken = await signAccessToken(user.id);
    const csrf = createCsrfToken(device.id, rawToken);
    const res = await auth.request("/logout", {
      method: "DELETE",
      headers: headers(accessToken, undefined, csrf),
    });

    expect(res.status).toBe(401);
    expect(await getDevices(user.id)).toEqual([
      expect.objectContaining({ id: device.id }),
    ]);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("6-6. Origin 또는 CSRF 실패 → 403 + 세션 유지", async () => {
    const user = await createUser();
    const rawToken = "synthetic-logout-csrf-contract";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const accessToken = await signAccessToken(user.id);
    const csrf = createCsrfToken(device.id, rawToken);
    const changedHeaderCsrf = createCsrfToken(device.id, rawToken);
    const requests: Record<string, string>[] = [
      {
        ...headers(accessToken, rawToken, csrf),
        Origin: "http://evil.example",
      },
      {
        Cookie: `access_token=${accessToken}; refresh_token=${rawToken}; ${CSRF_COOKIE_NAME}=${csrf}`,
        [CSRF_HEADER_NAME]: csrf,
      },
      headers(accessToken, rawToken),
      {
        ...headers(accessToken, rawToken, "forged-csrf-token"),
        "X-CSRF-Token": "forged-csrf-token",
      },
      {
        ...headers(accessToken, rawToken, csrf),
        "X-CSRF-Token": changedHeaderCsrf,
      },
      headers(accessToken, "synthetic-logout-other-refresh", csrf),
    ];

    for (const requestHeaders of requests) {
      const res = await auth.request("/logout", {
        method: "DELETE",
        headers: requestHeaders,
      });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toHaveLength(0);
      expect((await getDevices(user.id)).map((device) => device.id)).toContain(
        device.id
      );
    }
  });

  it("6-7. 다른 사용자의 세션 폐기 시도 → 401 + 양쪽 세션 유지", async () => {
    const owner = await createUser();
    const requester = await createUser();
    const rawToken = "synthetic-logout-foreign-session";
    const foreignDevice = await createDevice(owner.id, {
      refreshToken: hashToken(rawToken),
    });
    const accessToken = await signAccessToken(requester.id);
    const csrf = createCsrfToken(foreignDevice.id, rawToken);

    const res = await auth.request("/logout", {
      method: "DELETE",
      headers: headers(accessToken, rawToken, csrf),
    });

    expect(res.status).toBe(401);
    expect(await getDevices(owner.id)).toEqual([
      expect.objectContaining({ id: foreignDevice.id }),
    ]);
    expect(await getDevices(requester.id)).toHaveLength(0);
  });

  it("6-8. Logout 뒤 기존 Access Token은 authMiddleware 검증을 계속 통과", async () => {
    const user = await createUser();
    const rawToken = "synthetic-logout-access-remains-valid";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const accessToken = await signAccessToken(user.id);
    const csrf = createCsrfToken(device.id, rawToken);
    const logout = await auth.request("/logout", {
      method: "DELETE",
      headers: headers(accessToken, rawToken, csrf),
    });
    expect(logout.status).toBe(200);

    const protectedProbe = new Hono();
    protectedProbe.get("/protected", authMiddleware, (ctx) =>
      ctx.json({ authenticated: true })
    );
    const probe = await protectedProbe.request("/protected", {
      headers: { Cookie: `access_token=${accessToken}` },
    });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toEqual({ authenticated: true });
  });

  it("concurrent refresh and logout cannot restore a revoked session", async () => {
    const user = await createUser();
    const raw = "synthetic-refresh-logout-race";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(raw),
    });
    const other = await createDevice(user.id);
    const access = await signAccessToken(user.id);
    const requestHeaders = headers(
      access,
      raw,
      createCsrfToken(device.id, raw)
    );
    const [refresh, logout] = await Promise.all([
      auth.request("/refresh", { method: "POST", headers: requestHeaders }),
      auth.request("/logout", { method: "DELETE", headers: requestHeaders }),
    ]);
    expect([200, 401]).toContain(refresh.status);
    expect(logout.status).toBe(200);
    expect((await getDevices(user.id)).map((row) => row.id)).toEqual([
      other.id,
    ]);
  });
});
