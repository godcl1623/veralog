import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";

import { db } from "../../../db/client";
import { userDevices } from "../../../db/schema";
import type { AuthCookieBundle } from "../../../utils/cookies";
import { clearAuthCookies, setAuthCookieBundle } from "../../../utils/cookies";
import {
  createCsrfToken,
  csrfMatchesRefresh,
  readCsrfToken,
  verifyCsrfRequest,
} from "../../../utils/csrf";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE_NAME,
  signAccessToken,
} from "../../../utils/jwt";
import {
  isRefreshReplayAllowed,
  loadRefreshReplayCipher,
  REFRESH_REPLAY_WINDOW_MS,
} from "../../../utils/refresh-replay";
import { readSessionTime } from "../../../utils/session-time";
import {
  generateRefreshToken,
  hashToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../../../utils/token";
import { refreshRoute } from "./contract";

export const refreshRouter = new OpenAPIHono();

refreshRouter.openapi(refreshRoute, async (ctx) => {
  const csrf = verifyCsrfRequest(ctx);
  if (!csrf) return ctx.body(null, 403);
  const refreshToken = getCookie(ctx, REFRESH_TOKEN_COOKIE_NAME);
  if (!refreshToken) return ctx.body(null, 401);
  if (!csrfMatchesRefresh(csrf, refreshToken)) return ctx.body(null, 403);

  const reqHash = hashToken(refreshToken);
  try {
    const result = await db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(userDevices)
        .where(eq(userDevices.id, csrf.sessionId))
        .for("update");
      if (!session) return { kind: "unknown" } as const;
      const isCurrent = session.refreshToken === reqHash;
      if (!isCurrent && session.previousRefreshTokenHash !== reqHash)
        return { kind: "unknown" } as const;
      // Legacy rows without trustworthy expiry never gain a fresh week.
      if (!session.refreshExpiresAt) return { kind: "unknown" } as const;
      const now = await readSessionTime(tx);
      if (session.refreshExpiresAt.getTime() <= now) {
        await tx.delete(userDevices).where(eq(userDevices.id, session.id));
        return { kind: "expired" } as const;
      }

      const cipher = loadRefreshReplayCipher();
      if (!isCurrent) {
        if (
          !session.refreshReplayUntil ||
          !isRefreshReplayAllowed(session.refreshReplayUntil.getTime(), now)
        ) {
          await tx.delete(userDevices).where(eq(userDevices.id, session.id));
          return { kind: "unknown" } as const;
        }
        if (!session.refreshReplayResult || !session.refreshToken)
          throw new Error("Missing refresh replay result");
        const bundle = cipher.open(session.refreshReplayResult, {
          sessionId: session.id,
          currentHash: session.refreshToken,
          previousHash: reqHash,
          validUntil: session.refreshReplayUntil.getTime(),
        });
        const returnedCsrf = readCsrfToken(bundle.csrfToken);
        if (
          hashToken(bundle.refreshToken) !== session.refreshToken ||
          bundle.refreshExpiresAt !== session.refreshExpiresAt.getTime() ||
          bundle.accessExpiresAt <= now ||
          !returnedCsrf ||
          returnedCsrf.sessionId !== session.id ||
          !csrfMatchesRefresh(returnedCsrf, bundle.refreshToken)
        )
          throw new Error("Inconsistent refresh replay result");
        return { kind: "success", bundle } as const;
      }

      const nextRefresh = generateRefreshToken();
      const validUntil = now + REFRESH_REPLAY_WINDOW_MS;
      const bundle: AuthCookieBundle = {
        accessToken: await signAccessToken(session.userId, now),
        refreshToken: nextRefresh,
        csrfToken: createCsrfToken(session.id, nextRefresh),
        accessExpiresAt:
          (Math.floor(now / 1000) + ACCESS_TOKEN_TTL_SECONDS) * 1000,
        refreshExpiresAt: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
      };
      const nextHash = hashToken(nextRefresh);
      const encrypted = cipher.seal(bundle, {
        sessionId: session.id,
        currentHash: nextHash,
        previousHash: reqHash,
        validUntil,
      });
      await tx
        .update(userDevices)
        .set({
          previousRefreshTokenHash: reqHash,
          refreshToken: nextHash,
          lastAccessedAt: new Date(now),
          refreshExpiresAt: new Date(bundle.refreshExpiresAt),
          refreshReplayResult: encrypted,
          refreshReplayUntil: new Date(validUntil),
        })
        .where(eq(userDevices.id, session.id));
      return { kind: "success", bundle } as const;
    });
    if (result.kind !== "success") {
      if (result.kind === "expired") clearAuthCookies(ctx);
      return ctx.body(null, 401);
    }
    setAuthCookieBundle(ctx, result.bundle, await readSessionTime(db));
    return ctx.json({ data: null }, 200);
  } catch {
    // DB errors may include SQL parameters. Never log token results or exception payloads.
    console.error("Refresh session operation failed");
    return ctx.body(null, 500);
  }
});
