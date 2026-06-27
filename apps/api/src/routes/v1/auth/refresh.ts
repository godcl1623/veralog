import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { db } from "../../../db/client";
import { userDevices } from "../../../db/schema";
import { setAuthCookies } from "../../../utils/cookies";
import { REFRESH_TOKEN_COOKIE_NAME, signAccessToken } from "../../../utils/jwt";
import { generateRefreshToken, hashToken } from "../../../utils/token";

export const refreshRouter = new Hono();

refreshRouter.post("/refresh", async (ctx) => {
  const refreshToken = getCookie(ctx, REFRESH_TOKEN_COOKIE_NAME);
  if (!refreshToken) {
    return ctx.json({ error: "Unauthorized" }, 401);
  }

  const reqHash = hashToken(refreshToken);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${reqHash}))`);

    const [active] = await tx
      .select()
      .from(userDevices)
      .where(eq(userDevices.refreshToken, reqHash));

    if (active) {
      const newRefreshToken = generateRefreshToken();
      const newHash = hashToken(newRefreshToken);
      await tx
        .update(userDevices)
        .set({
          previousRefreshTokenHash: reqHash,
          refreshToken: newHash,
          lastAccessedAt: new Date(),
        })
        .where(eq(userDevices.id, active.id));
      const accessToken = await signAccessToken(active.userId);
      return { accessToken, newRefreshToken };
    }

    const [stale] = await tx
      .select()
      .from(userDevices)
      .where(eq(userDevices.previousRefreshTokenHash, reqHash));

    if (stale) {
      await tx.delete(userDevices).where(eq(userDevices.id, stale.id));
    }
    return null;
  });

  if (!result) {
    return ctx.json({ error: "Unauthorized" }, 401);
  }

  setAuthCookies(ctx, result.accessToken, result.newRefreshToken);
  return ctx.json({ ok: true }, 200);
});
