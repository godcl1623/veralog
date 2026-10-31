import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { userDevices } from "../../../db/schema";
import { db } from "../../../test/db";
import { createDevice, createUser } from "../../../test/fixtures";
import {
  createCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../../../utils/csrf";
import { clearExpiredRefreshResults } from "../../../utils/refresh-cleanup";
import { loadRefreshReplayCipher } from "../../../utils/refresh-replay";
import * as sessionTime from "../../../utils/session-time";
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

  it("5-2. 유예 안 직전 refresh 재사용 → 동일 세 토큰 + 세션 유지", async () => {
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

    expect(replay.status).toBe(200);
    expect(replay.headers.getSetCookie().map((c) => c.split(";")[0])).toEqual(
      first.headers.getSetCookie().map((c) => c.split(";")[0])
    );
    expect(await getDevice(device.id)).toBeDefined();
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
    const now = vi.spyOn(sessionTime, "readSessionTime").mockResolvedValue(1);

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

  it("5-9. 동시 Rotation은 동일 결과를 반환하고 두 기기 모두 유지", async () => {
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

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(
      responses[0].headers.getSetCookie().map((c) => c.split(";")[0])
    ).toEqual(responses[1].headers.getSetCookie().map((c) => c.split(";")[0]));
    expect(await getDevice(device.id)).toBeDefined();
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
      const clock = vi
        .spyOn(sessionTime, "readSessionTime")
        .mockResolvedValue(time + offset);
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function value(response: Response, name: string): string {
  return decodeURIComponent(
    response.headers
      .getSetCookie()
      .find((c) => c.startsWith(name + "="))!
      .split(";")[0]
      .slice(name.length + 1)
  );
}
async function rotated() {
  const user = await createUser();
  const raw = "synthetic-replay-state";
  const device = await createDevice(user.id, { refreshToken: hashToken(raw) });
  const csrf = createCsrfToken(device.id, raw);
  const first = await auth.request("/refresh", {
    method: "POST",
    headers: headers(raw, csrf),
  });
  expect(first.status).toBe(200);
  return {
    user,
    device,
    raw,
    csrf,
    first,
    session: await getDevice(device.id),
  };
}

describe("bounded refresh replay", () => {
  it.each([-1, 0, 1])(
    "compares the grace boundary after locking, offset %s ms",
    async (offset) => {
      const r = await rotated();
      const other = await createDevice(r.user.id, {
        refreshToken: hashToken("synthetic-boundary-other"),
      });
      vi.spyOn(sessionTime, "readSessionTime").mockResolvedValue(
        r.session.refreshReplayUntil!.getTime() + offset
      );
      const response = await auth.request("/refresh", {
        method: "POST",
        headers: headers(r.raw, r.csrf),
      });
      expect(response.status).toBe(offset < 0 ? 200 : 401);
      if (offset < 0) {
        expect(value(response, "refresh_token")).toBe(
          value(r.first, "refresh_token")
        );
        expect(value(response, "access_token")).toBe(
          value(r.first, "access_token")
        );
        expect(value(response, "csrf_token")).toBe(
          value(r.first, "csrf_token")
        );
        expect((await getDevice(r.device.id)).refreshReplayUntil).toEqual(
          r.session.refreshReplayUntil
        );
        expect((await getDevice(r.device.id)).refreshExpiresAt).toEqual(
          r.session.refreshExpiresAt
        );
      } else expect(await getDevice(r.device.id)).toBeUndefined();
      expect(await getDevice(other.id)).toBeDefined();
    }
  );
  it("a discarded first response can recover without another rotation or lifetime extension", async () => {
    const r = await rotated();
    const response = await auth.request("/refresh", {
      method: "POST",
      headers: headers(r.raw, r.csrf),
    });
    expect(response.status).toBe(200);
    expect(value(response, "csrf_token")).toBe(value(r.first, "csrf_token"));
    expect(await getDevice(r.device.id)).toEqual(r.session);
    for (const token of [
      value(r.first, "access_token"),
      value(r.first, "refresh_token"),
      value(r.first, "csrf_token"),
    ])
      expect(r.session.refreshReplayResult).not.toContain(token);
  });
  it("superseded or deleted sessions do not replay old results or resurrect rows", async () => {
    const r = await rotated();
    const next = value(r.first, "refresh_token");
    const nextCsrf = value(r.first, "csrf_token");
    const second = await auth.request("/refresh", {
      method: "POST",
      headers: headers(next, nextCsrf),
    });
    expect(second.status).toBe(200);
    const stale = await auth.request("/refresh", {
      method: "POST",
      headers: headers(r.raw, r.csrf),
    });
    expect(stale.status).toBe(401);
    expect((await getDevice(r.device.id)).refreshToken).toBe(
      hashToken(value(second, "refresh_token"))
    );
    const logoutHeaders = headers(
      value(second, "refresh_token"),
      value(second, "csrf_token")
    );
    logoutHeaders.Cookie += `; access_token=${value(second, "access_token")}`;
    const logout = await auth.request("/logout", {
      method: "DELETE",
      headers: logoutHeaders,
    });
    expect(logout.status).toBe(200);
    expect(
      (
        await auth.request("/refresh", {
          method: "POST",
          headers: headers(next, nextCsrf),
        })
      ).status
    ).toBe(401);
    expect(await getDevice(r.device.id)).toBeUndefined();
  });
  it("a session expiring inside the replay window cannot be recovered", async () => {
    const r = await rotated();
    await db
      .update(userDevices)
      .set({ refreshExpiresAt: new Date(1) })
      .where(eq(userDevices.id, r.device.id));
    const response = await auth.request("/refresh", {
      method: "POST",
      headers: headers(r.raw, r.csrf),
    });
    expect(response.status).toBe(401);
    expect(await getDevice(r.device.id)).toBeUndefined();
    expect(response.headers.getSetCookie()).toHaveLength(3);
  });
  it.each(["corrupt", "missing", "unknown-key"])(
    "%s replay data returns 500 without cookies or session deletion",
    async (mode) => {
      const r = await rotated();
      if (mode !== "unknown-key")
        await db
          .update(userDevices)
          .set({ refreshReplayResult: mode === "missing" ? null : "corrupt" })
          .where(eq(userDevices.id, r.device.id));
      else
        vi.stubEnv(
          "AUTH_REFRESH_REPLAY_KEYS",
          JSON.stringify([
            { id: "test-v2", key: Buffer.alloc(32, 8).toString("base64") },
          ])
        );
      if (mode === "unknown-key")
        vi.stubEnv("AUTH_REFRESH_REPLAY_ACTIVE_KEY_ID", "test-v2");
      const before = await getDevice(r.device.id);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await auth.request("/refresh", {
        method: "POST",
        headers: headers(r.raw, r.csrf),
      });
      expect(response.status).toBe(500);
      expect(response.headers.getSetCookie()).toHaveLength(0);
      expect(await getDevice(r.device.id)).toEqual(before);
      expect(log.mock.calls).toEqual([["Refresh session operation failed"]]);
    }
  );
  it("transaction failure rolls back and does not expose internal error details", async () => {
    const r = await rotated();
    const before = await getDevice(r.device.id);
    const transaction = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("synthetic-private-failure"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await auth.request("/refresh", {
      method: "POST",
      headers: headers(r.raw, r.csrf),
    });
    transaction.mockRestore();
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(await getDevice(r.device.id)).toEqual(before);
  });
  it("cleanup removes expired ciphertext only, preserving session and reuse detection", async () => {
    const r = await rotated();
    const active = await createDevice(r.user.id, {
      refreshToken: "other-hash",
      refreshReplayResult: "active-result",
      refreshReplayUntil: new Date(Date.now() + 60_000),
    });
    await db
      .update(userDevices)
      .set({ refreshReplayUntil: new Date(1) })
      .where(eq(userDevices.id, r.device.id));
    await clearExpiredRefreshResults();
    const cleaned = await getDevice(r.device.id);
    expect(cleaned.refreshReplayResult).toBeNull();
    expect(cleaned.refreshReplayUntil).toEqual(new Date(1));
    expect(cleaned.previousRefreshTokenHash).toBe(hashToken(r.raw));
    expect((await getDevice(active.id)).refreshReplayResult).toBe(
      "active-result"
    );
    expect(
      (
        await auth.request("/refresh", {
          method: "POST",
          headers: headers(r.raw, r.csrf),
        })
      ).status
    ).toBe(401);
    expect(await getDevice(active.id)).toBeDefined();
  });
  it("time spent waiting for a row lock counts toward the deadline", async () => {
    const r = await rotated();
    const cipher = loadRefreshReplayCipher();
    const binding = {
      sessionId: r.device.id,
      currentHash: r.session.refreshToken!,
      previousHash: hashToken(r.raw),
      validUntil: r.session.refreshReplayUntil!.getTime(),
    };
    const bundle = cipher.open(r.session.refreshReplayResult!, binding);
    let waiting!: Promise<Response>;
    await db.transaction(async (tx) => {
      const now = await sessionTime.readSessionTime(tx);
      const validUntil = now + 200;
      await tx
        .update(userDevices)
        .set({
          refreshReplayUntil: new Date(validUntil),
          refreshReplayResult: cipher.seal(bundle, { ...binding, validUntil }),
        })
        .where(eq(userDevices.id, r.device.id));
      waiting = Promise.resolve(
        auth.request("/refresh", {
          method: "POST",
          headers: headers(r.raw, r.csrf),
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect((await waiting!).status).toBe(401);
    expect(await getDevice(r.device.id)).toBeUndefined();
  });
});

it("cleanup racing a current-token rotation cannot erase the fresh result", async () => {
  const r = await rotated();
  await db
    .update(userDevices)
    .set({ refreshReplayUntil: new Date(1) })
    .where(eq(userDevices.id, r.device.id));
  const [response] = await Promise.all([
    auth.request("/refresh", {
      method: "POST",
      headers: headers(
        value(r.first, "refresh_token"),
        value(r.first, "csrf_token")
      ),
    }),
    clearExpiredRefreshResults(),
  ]);
  expect(response.status).toBe(200);
  const latest = await getDevice(r.device.id);
  expect(latest.refreshReplayResult).not.toBeNull();
  expect(latest.refreshReplayUntil!.getTime()).toBeGreaterThan(Date.now());
  const recovery = await auth.request("/refresh", {
    method: "POST",
    headers: headers(
      value(r.first, "refresh_token"),
      value(r.first, "csrf_token")
    ),
  });
  expect(recovery.status).toBe(200);
  expect(value(recovery, "refresh_token")).toBe(
    value(response, "refresh_token")
  );
});
