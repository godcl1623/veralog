import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";

import { db } from "../../../db/client.js";
import { userDevices } from "../../../db/schema/index.js";
import { authMiddleware } from "../../../middleware/auth.js";
import { clearAuthCookies } from "../../../utils/cookies.js";
import { csrfMatchesRefresh, verifyCsrfRequest } from "../../../utils/csrf.js";
import { REFRESH_TOKEN_COOKIE_NAME } from "../../../utils/jwt.js";
import { hashToken } from "../../../utils/token.js";
import { logoutRoute } from "./contract.js";

export const logoutRouter = new OpenAPIHono();

logoutRouter.openapi(
  { ...logoutRoute, middleware: authMiddleware },
  async (ctx) => {
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
  }
);
