import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { db } from "../../../db/client";
import { userDevices } from "../../../db/schema";
import { authMiddleware } from "../../../middleware/auth";
import { clearAuthCookies } from "../../../utils/cookies";
import { csrfMatchesRefresh, verifyCsrfRequest } from "../../../utils/csrf";
import { REFRESH_TOKEN_COOKIE_NAME } from "../../../utils/jwt";
import { hashToken } from "../../../utils/token";

export const logoutRouter = new Hono();

logoutRouter.delete("/logout", authMiddleware, async (ctx) => {
  const csrf = verifyCsrfRequest(ctx);
  if (!csrf) return ctx.body(null, 403);
  const refreshToken = getCookie(ctx, REFRESH_TOKEN_COOKIE_NAME);
  if (!refreshToken) return ctx.body(null, 401);
  if (!csrfMatchesRefresh(csrf, refreshToken)) return ctx.body(null, 403);

  const result = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(userDevices)
      .where(eq(userDevices.id, csrf.sessionId))
      .for("update");
    if (!session) return true;
    if (session.userId !== ctx.get("user").id) return false;
    const reqHash = hashToken(refreshToken);
    if (
      session.refreshToken !== reqHash &&
      session.previousRefreshTokenHash !== reqHash
    )
      return false;
    await tx.delete(userDevices).where(eq(userDevices.id, session.id));
    return true;
  });
  if (!result) return ctx.body(null, 401);

  clearAuthCookies(ctx);
  return ctx.json({ data: null }, 200);
});
