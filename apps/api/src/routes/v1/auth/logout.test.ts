import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { userDevices } from "../../../db/schema";
import { db } from "../../../test/db";
import { createDevice, createUser } from "../../../test/fixtures";
import { signAccessToken } from "../../../utils/jwt";
import { hashToken } from "../../../utils/token";
import { auth } from "../auth";

function makeLogoutRequest(accessToken?: string, refreshToken?: string) {
  const cookies: string[] = [];
  if (accessToken) cookies.push(`access_token=${accessToken}`);
  if (refreshToken) cookies.push(`refresh_token=${refreshToken}`);
  const headers: Record<string, string> = {};
  if (cookies.length > 0) headers.Cookie = cookies.join("; ");
  return { method: "DELETE" as const, path: "/logout", headers };
}

describe("DELETE /auth/logout", () => {
  it("6-1. 유효 access + refresh → 200 + 디바이스 행 삭제 + 쿠키 만료", async () => {
    const user = await createUser();
    const validRefresh = "valid-rt-abc-123";
    await createDevice(user.id, { refreshToken: hashToken(validRefresh) });
    const accessToken = await signAccessToken(user.id);

    const { method, path, headers } = makeLogoutRequest(
      accessToken,
      validRefresh
    );
    const res = await auth.request(path, { method, headers });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.some((c) => c.startsWith("access_token="))).toBe(true);
    expect(setCookie.some((c) => c.startsWith("refresh_token="))).toBe(true);

    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, user.id));
    expect(devices).toHaveLength(0);
  });

  it("6-2. Access Token 없음 → 401 + 디바이스 행 유지", async () => {
    const user = await createUser();
    await createDevice(user.id, { refreshToken: hashToken("any-rt") });

    const res = await auth.request("/logout", { method: "DELETE" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });

    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, user.id));
    expect(devices).toHaveLength(1);
  });

  it("6-3. Access Token 무효 → 401 + 디바이스 행 유지", async () => {
    const user = await createUser();
    const validRefresh = "valid-rt-xyz";
    await createDevice(user.id, { refreshToken: hashToken(validRefresh) });

    const { method, path, headers } = makeLogoutRequest(
      "invalid.token.here",
      validRefresh
    );
    const res = await auth.request(path, { method, headers });

    expect(res.status).toBe(401);

    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, user.id));
    expect(devices).toHaveLength(1);
  });

  it("6-4. 이미 삭제된 디바이스 (멱등) → 200 + 쿠키 만료", async () => {
    const user = await createUser();
    // 디바이스 행을 일부러 생성하지 않음
    const accessToken = await signAccessToken(user.id);

    const { method, path, headers } = makeLogoutRequest(
      accessToken,
      "stale-rt-not-in-db"
    );
    const res = await auth.request(path, { method, headers });

    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.some((c) => c.startsWith("access_token="))).toBe(true);
    expect(setCookie.some((c) => c.startsWith("refresh_token="))).toBe(true);
  });

  it("6-5. Access Token 유효 + refresh_token 없음 → 200 + 쿠키 만료, 디바이스 행 유지", async () => {
    const user = await createUser();
    await createDevice(user.id, { refreshToken: hashToken("existing-rt") });
    const accessToken = await signAccessToken(user.id);

    const { method, path, headers } = makeLogoutRequest(accessToken);
    const res = await auth.request(path, { method, headers });

    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.some((c) => c.startsWith("access_token="))).toBe(true);
    expect(setCookie.some((c) => c.startsWith("refresh_token="))).toBe(true);

    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, user.id));
    expect(devices).toHaveLength(1);
  });
});
