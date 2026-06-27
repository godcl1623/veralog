import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { userDevices } from "../../../db/schema";
import { db } from "../../../test/db";
import { createDevice, createUser } from "../../../test/fixtures";
import { hashToken } from "../../../utils/token";
import { auth } from "../auth";

function makeRefreshRequest(refreshToken?: string) {
  const headers: Record<string, string> = {};
  if (refreshToken) {
    headers.Cookie = `refresh_token=${refreshToken}`;
  }
  return { method: "POST" as const, path: "/refresh", headers };
}

describe("POST /auth/refresh", () => {
  it("5-1. 유효 refresh → 200 + Rotation", async () => {
    const user = await createUser();
    const validToken = "valid-token-abc-123";
    await createDevice(user.id, { refreshToken: hashToken(validToken) });

    const { path, method, headers } = makeRefreshRequest(validToken);
    const res = await auth.request(path, { method, headers });

    expect(res.status).toBe(200);

    // Set-Cookie에 access_token과 refresh_token 모두 존재
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.some((c) => c.startsWith("access_token="))).toBe(true);
    expect(setCookie.some((c) => c.startsWith("refresh_token="))).toBe(true);

    // Rotation: 새 refresh_token ≠ validToken
    const newRefreshCookie = setCookie.find((c) =>
      c.startsWith("refresh_token=")
    )!;
    const newRefreshToken = newRefreshCookie
      .replace("refresh_token=", "")
      .split(";")[0];
    expect(newRefreshToken).not.toBe(validToken);

    // DB: refresh_token이 Rotation됨
    const [device] = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, user.id));
    expect(device.refreshToken).not.toBe(hashToken(validToken));
    expect(device.previousRefreshTokenHash).toBe(hashToken(validToken));
    expect(device.lastAccessedAt).not.toBeNull();
  });

  it("5-2. 이전 토큰 재사용 감지 → 401 + 디바이스 무효화", async () => {
    const user = await createUser();
    const validToken = "valid-token-xyz";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(validToken),
      previousRefreshTokenHash: hashToken("older-token"),
    });

    // 먼저 validToken으로 한 번 refresh 성공해야 함 (Rotation)
    await auth.request("/refresh", {
      method: "POST",
      headers: { Cookie: `refresh_token=${validToken}` },
    });

    // 보관된 oldToken (validToken) 재사용 시도
    const res = await auth.request("/refresh", {
      method: "POST",
      headers: { Cookie: `refresh_token=${validToken}` },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });

    // 디바이스 행 삭제 확인
    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.id, device.id));
    expect(devices).toHaveLength(0);
  });

  it("5-3. 존재하지 않는 디바이스 → 401", async () => {
    const randomToken = "random-token-that-does-not-exist";
    const res = await auth.request("/refresh", {
      method: "POST",
      headers: { Cookie: `refresh_token=${randomToken}` },
    });

    expect(res.status).toBe(401);
  });

  it("5-4. 해시 불일치 (재사용 아님) → 401", async () => {
    const user = await createUser();
    const storedToken = "stored-token";
    await createDevice(user.id, { refreshToken: hashToken(storedToken) });

    // storedToken의 해시와 다른 토큰으로 요청
    const differentToken = "different-token";
    const res = await auth.request("/refresh", {
      method: "POST",
      headers: { Cookie: `refresh_token=${differentToken}` },
    });

    expect(res.status).toBe(401);

    // DB 디바이스 행은 그대로 유지
    const devices = await db
      .select()
      .from(userDevices)
      .where(eq(userDevices.userId, user.id));
    expect(devices).toHaveLength(1);
    expect(devices[0].refreshToken).toBe(hashToken(storedToken));
  });

  it("5-5. 쿠키 없음 → 401", async () => {
    const res = await auth.request("/refresh", { method: "POST" });

    expect(res.status).toBe(401);
  });
});
