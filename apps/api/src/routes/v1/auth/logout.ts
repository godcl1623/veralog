import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { db } from "../../../db/client";
import { userDevices } from "../../../db/schema";
import { authMiddleware } from "../../../middleware/auth";
import { clearAuthCookies } from "../../../utils/cookies";
import { REFRESH_TOKEN_COOKIE_NAME } from "../../../utils/jwt";
import { hashToken } from "../../../utils/token";

export const logoutRouter = new Hono();

logoutRouter.delete("/logout", authMiddleware, async (ctx) => {
  const userId = ctx.get("user").id;
  const refreshToken = getCookie(ctx, REFRESH_TOKEN_COOKIE_NAME);

  if (refreshToken) {
    const hash = hashToken(refreshToken);
    await db
      .delete(userDevices)
      .where(
        and(eq(userDevices.userId, userId), eq(userDevices.refreshToken, hash))
      );
  }

  clearAuthCookies(ctx);
  return ctx.json({ ok: true }, 200);
});
