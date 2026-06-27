import type { Context } from "hono";
import { setCookie } from "hono/cookie";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE_NAME,
} from "./jwt";
import { REFRESH_TOKEN_TTL_SECONDS } from "./token";

export function setAuthCookies(
  ctx: Context,
  accessToken: string,
  refreshToken: string
): void {
  const baseOpts = {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "Lax" as const,
  };
  setCookie(ctx, ACCESS_TOKEN_COOKIE_NAME, accessToken, {
    ...baseOpts,
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  setCookie(ctx, REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    ...baseOpts,
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}
