import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";

import { db } from "../../../db/client";
import { userDevices } from "../../../db/schema";
import { clearAuthCookies, setAuthCookies } from "../../../utils/cookies";
import { csrfMatchesRefresh, verifyCsrfRequest } from "../../../utils/csrf";
import { REFRESH_TOKEN_COOKIE_NAME, signAccessToken } from "../../../utils/jwt";
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
  const result = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(userDevices)
      .where(eq(userDevices.id, csrf.sessionId))
      .for("update");
    if (!session) return { kind: "unknown" } as const;

    if (session.refreshToken !== reqHash) {
      if (session.previousRefreshTokenHash === reqHash) {
        await tx.delete(userDevices).where(eq(userDevices.id, session.id));
      }
      return { kind: "unknown" } as const;
    }
    // Old rows have no trustworthy expiry; do not silently grant a fresh week.
    if (!session.refreshExpiresAt) return { kind: "unknown" } as const;
    const now = new Date(Date.now());
    if (session.refreshExpiresAt.getTime() <= now.getTime()) {
      await tx.delete(userDevices).where(eq(userDevices.id, session.id));
      return { kind: "expired" } as const;
    }

    const newRefreshToken = generateRefreshToken();
    await tx
      .update(userDevices)
      .set({
        previousRefreshTokenHash: reqHash,
        refreshToken: hashToken(newRefreshToken),
        lastAccessedAt: now,
        refreshExpiresAt: new Date(
          now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000
        ),
      })
      .where(eq(userDevices.id, session.id));
    return {
      kind: "success",
      sessionId: session.id,
      accessToken: await signAccessToken(session.userId),
      refreshToken: newRefreshToken,
    } as const;
  });

  if (result.kind !== "success") {
    if (result.kind === "expired") clearAuthCookies(ctx);
    return ctx.body(null, 401);
  }
  setAuthCookies(
    ctx,
    result.accessToken,
    result.refreshToken,
    result.sessionId
  );
  return ctx.json({ data: null }, 200);
});
