import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { userDevices } from "../../../db/schema";
import { db } from "../../../test/db";
import { createDevice, createUser } from "../../../test/fixtures";
import {
  createCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../../../utils/csrf";
import { hashToken, REFRESH_TOKEN_TTL_SECONDS } from "../../../utils/token";
import { auth } from "../auth";

const origin = "http://localhost:5173";

function headers(refreshToken?: string, csrfToken?: string) {
  const cookies: string[] = [];
  if (refreshToken) cookies.push(`refresh_token=${refreshToken}`);
  if (csrfToken) cookies.push(`${CSRF_COOKIE_NAME}=${csrfToken}`);
  return {
    Origin: origin,
    ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
    ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
  };
}

async function getDevice(id: string) {
  const [device] = await db
    .select()
    .from(userDevices)
    .where(eq(userDevices.id, id));
  return device;
}

describe("POST /auth/refresh", () => {
  it("5-1. 유효 refresh와 서명된 CSRF → 200 + 7일 Rotation", async () => {
    const user = await createUser();
    const rawToken = "synthetic-refresh-token-valid-1";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
      refreshExpiresAt: new Date(Date.now() + 1000),
    });
    const csrf = createCsrfToken(device.id, rawToken);
    const started = Date.now();

    const res = await auth.request("/refresh", {
      method: "POST",
      headers: headers(rawToken, csrf),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("access_token="))).toBe(
      true
    );
    expect(cookies.some((cookie) => cookie.startsWith("refresh_token="))).toBe(
      true
    );
    expect(
      cookies.some((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))
    ).toBe(true);
    const nextRawToken = cookies
      .find((cookie) => cookie.startsWith("refresh_token="))!
      .split("=")[1]
      .split(";")[0];
    expect(nextRawToken).not.toBe(rawToken);

    const updated = await getDevice(device.id);
    expect(updated.refreshToken).toBe(hashToken(nextRawToken));
    expect(updated.previousRefreshTokenHash).toBe(hashToken(rawToken));
    expect(updated.lastAccessedAt).not.toBeNull();
    expect(updated.refreshExpiresAt!.getTime()).toBeGreaterThanOrEqual(
      started + REFRESH_TOKEN_TTL_SECONDS * 1000
    );
    expect(updated.refreshExpiresAt!.getTime()).toBeGreaterThan(
      device.refreshExpiresAt!.getTime()
    );
    expect(updated.refreshExpiresAt!.getTime()).toBeLessThanOrEqual(
      Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000
    );
  });

  it("5-2. 이전 refresh와 원래 CSRF 재사용 → 401 + 해당 세션만 삭제", async () => {
    const user = await createUser();
    const rawToken = "synthetic-refresh-token-replay";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const other = await createDevice(user.id, {
      refreshToken: hashToken("synthetic-other-device"),
    });
    const csrf = createCsrfToken(device.id, rawToken);

    const first = await auth.request("/refresh", {
      method: "POST",
      headers: headers(rawToken, csrf),
    });
    expect(first.status).toBe(200);
    const replay = await auth.request("/refresh", {
      method: "POST",
      headers: headers(rawToken, csrf),
    });

    expect(replay.status).toBe(401);
    expect(await getDevice(device.id)).toBeUndefined();
    expect(await getDevice(other.id)).toBeDefined();
  });

  it("5-3. 존재하지 않는 세션 → 401", async () => {
    const rawToken = "synthetic-refresh-no-session";
    const csrf = createCsrfToken(
      "123e4567-e89b-12d3-a456-426614174000",
      rawToken
    );
    const res = await auth.request("/refresh", {
      method: "POST",
      headers: headers(rawToken, csrf),
    });
    expect(res.status).toBe(401);
  });

  it("5-4. 미등록 refresh hash, 정상 서명 CSRF → 401 + 세션 유지", async () => {
    const user = await createUser();
    const storedToken = "synthetic-refresh-stored";
    const unknownToken = "synthetic-refresh-unknown";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(storedToken),
    });
    const csrf = createCsrfToken(device.id, unknownToken);

    const res = await auth.request("/refresh", {
      method: "POST",
      headers: headers(unknownToken, csrf),
    });

    expect(res.status).toBe(401);
    expect((await getDevice(device.id)).refreshToken).toBe(
      hashToken(storedToken)
    );
  });

  it("5-5. CSRF 검증 후 refresh 쿠키 부재 → 401 + 세션 유지", async () => {
    const user = await createUser();
    const rawToken = "synthetic-refresh-missing-cookie";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const csrf = createCsrfToken(device.id, rawToken);

    const res = await auth.request("/refresh", {
      method: "POST",
      headers: headers(undefined, csrf),
    });

    expect(res.status).toBe(401);
    expect((await getDevice(device.id)).refreshToken).toBe(hashToken(rawToken));
  });

  it("5-6. Origin 또는 CSRF 누락·위조·불일치·다른 refresh 바인딩 → 403, 쿠키/DB 불변", async () => {
    const user = await createUser();
    const rawToken = "synthetic-refresh-csrf-contract";
    const wrongToken = "synthetic-refresh-other-binding";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const csrf = createCsrfToken(device.id, rawToken);
    const changedHeaderCsrf = createCsrfToken(device.id, rawToken);
    const requests: Record<string, string>[] = [
      { ...headers(rawToken, csrf), Origin: "http://evil.example" },
      {
        Cookie: `refresh_token=${rawToken}; ${CSRF_COOKIE_NAME}=${csrf}`,
        [CSRF_HEADER_NAME]: csrf,
      },
      { Cookie: `refresh_token=${rawToken}` },
      {
        ...headers(rawToken, "forged-csrf-token"),
        "X-CSRF-Token": "forged-csrf-token",
      },
      { ...headers(rawToken, csrf), "X-CSRF-Token": changedHeaderCsrf },
      headers(wrongToken, csrf),
    ];

    for (const requestHeaders of requests) {
      const res = await auth.request("/refresh", {
        method: "POST",
        headers: requestHeaders,
      });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toHaveLength(0);
      expect((await getDevice(device.id)).refreshToken).toBe(
        hashToken(rawToken)
      );
    }
  });

  it("5-7. 만료 시각 null → 401 + 행 유지", async () => {
    const user = await createUser();
    const rawToken = "synthetic-refresh-null-expiry";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
      refreshExpiresAt: null,
    });
    const csrf = createCsrfToken(device.id, rawToken);

    const res = await auth.request("/refresh", {
      method: "POST",
      headers: headers(rawToken, csrf),
    });

    expect(res.status).toBe(401);
    expect(await getDevice(device.id)).toBeDefined();
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("5-8. 만료 경계 시각 → 401 + 행 삭제 및 쿠키 정리", async () => {
    const user = await createUser();
    const rawToken = "synthetic-refresh-expiry-boundary";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
      refreshExpiresAt: new Date(1),
    });
    const csrf = createCsrfToken(device.id, rawToken);
    const now = vi.spyOn(Date, "now").mockReturnValue(1);

    let res: Response;
    try {
      res = await auth.request("/refresh", {
        method: "POST",
        headers: headers(rawToken, csrf),
      });
    } finally {
      now.mockRestore();
    }

    expect(res!.status).toBe(401);
    expect(await getDevice(device.id)).toBeUndefined();
    expect(
      res!.headers.getSetCookie().filter((cookie) => /Max-Age=0/i.test(cookie))
    ).toHaveLength(3);
  });

  it("5-9. 동시 Rotation, strict 정책에서 세션은 부활하지 않고 다른 기기는 유지", async () => {
    const user = await createUser();
    const rawToken = "synthetic-refresh-concurrent";
    const device = await createDevice(user.id, {
      refreshToken: hashToken(rawToken),
    });
    const other = await createDevice(user.id, {
      refreshToken: hashToken("synthetic-refresh-concurrent-other"),
    });
    const csrf = createCsrfToken(device.id, rawToken);

    const responses = await Promise.all([
      auth.request("/refresh", {
        method: "POST",
        headers: headers(rawToken, csrf),
      }),
      auth.request("/refresh", {
        method: "POST",
        headers: headers(rawToken, csrf),
      }),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 401]);
    expect(await getDevice(device.id)).toBeUndefined();
    expect(await getDevice(other.id)).toBeDefined();
  });

  it.each(["authorization", "body"])(
    "refresh must be a cookie, not %s",
    async (source) => {
      const user = await createUser();
      const raw = "synthetic-cookie-only-refresh";
      const device = await createDevice(user.id, {
        refreshToken: hashToken(raw),
      });
      const requestHeaders: Record<string, string> = {
        ...headers(undefined, createCsrfToken(device.id, raw)),
        "Content-Type": "application/json",
      };
      if (source === "authorization")
        requestHeaders.Authorization = "Bearer " + raw;
      const response = await auth.request("/refresh", {
        method: "POST",
        headers: requestHeaders,
        ...(source === "body"
          ? { body: JSON.stringify({ refreshToken: raw }) }
          : {}),
      });
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toHaveLength(0);
      expect((await getDevice(device.id)).refreshToken).toBe(hashToken(raw));
    }
  );

  it.each([-1, 0, 1])(
    "compares expiry at offset %s ms on the server",
    async (offset) => {
      const time = 1800000000000;
      const user = await createUser();
      const raw = "synthetic-expiry-clock-refresh";
      const device = await createDevice(user.id, {
        refreshToken: hashToken(raw),
        refreshExpiresAt: new Date(time),
      });
      const clock = vi.spyOn(Date, "now").mockReturnValue(time + offset);
      try {
        const response = await auth.request("/refresh", {
          method: "POST",
          headers: headers(raw, createCsrfToken(device.id, raw)),
        });
        expect(response.status).toBe(offset < 0 ? 200 : 401);
      } finally {
        clock.mockRestore();
      }
      if (offset < 0)
        expect((await getDevice(device.id)).refreshExpiresAt!.getTime()).toBe(
          time + offset + REFRESH_TOKEN_TTL_SECONDS * 1000
        );
      else expect(await getDevice(device.id)).toBeUndefined();
    }
  );
});
