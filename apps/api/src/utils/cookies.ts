import type { Context } from "hono";
import { setCookie } from "hono/cookie";

import { createCsrfToken, CSRF_COOKIE_NAME } from "./csrf";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE_NAME,
} from "./jwt";
import { REFRESH_TOKEN_TTL_SECONDS } from "./token";

const baseOpts = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "Lax" as const,
};

export function setAuthCookies(
  ctx: Context,
  accessToken: string,
  refreshToken: string,
  sessionId: string
): void {
  const csrfToken = createCsrfToken(sessionId, refreshToken);
  setCookie(ctx, ACCESS_TOKEN_COOKIE_NAME, accessToken, {
    ...baseOpts,
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  setCookie(ctx, REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    ...baseOpts,
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
  setCookie(ctx, CSRF_COOKIE_NAME, csrfToken, {
    ...baseOpts,
    httpOnly: false,
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function clearAuthCookies(ctx: Context): void {
  setCookie(ctx, ACCESS_TOKEN_COOKIE_NAME, "", { ...baseOpts, maxAge: 0 });
  setCookie(ctx, REFRESH_TOKEN_COOKIE_NAME, "", { ...baseOpts, maxAge: 0 });
  setCookie(ctx, CSRF_COOKIE_NAME, "", {
    ...baseOpts,
    httpOnly: false,
    maxAge: 0,
  });
}
