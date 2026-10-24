import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getRequiredEnv } from "@veralog/shared";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import { hashToken } from "./token";

export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "X-CSRF-Token";

type CsrfSession = { sessionId: string; refreshHash: string; nonce: string };

function sign(value: string): string {
  const key = createHmac("sha256", getRequiredEnv("JWT_SECRET"))
    .update("veralog:csrf:key:v1")
    .digest();
  return createHmac("sha256", key).update(value).digest("base64url");
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCsrfToken(
  sessionId: string,
  refreshToken: string
): string {
  const payload: CsrfSession = {
    sessionId,
    refreshHash: hashToken(refreshToken),
    nonce: randomBytes(32).toString("base64url"),
  };
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${value}.${sign(value)}`;
}

export function readCsrfToken(token: string): CsrfSession | null {
  if (token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !equal(sign(parts[0]), parts[1])) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload.sessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        payload.sessionId
      ) ||
      typeof payload.refreshHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(payload.refreshHash) ||
      typeof payload.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce)
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin || origin === "null") return false;
  const configured =
    process.env.AUTH_ALLOWED_ORIGINS ?? getRequiredEnv("FRONTEND_BASE_URL");
  return configured
    .split(",")
    .some((value) => new URL(value.trim()).origin === origin);
}

export function verifyCsrfRequest(ctx: Context): CsrfSession | null {
  if (!isAllowedOrigin(ctx.req.header("Origin"))) return null;
  const cookie = getCookie(ctx, CSRF_COOKIE_NAME);
  const header = ctx.req.header(CSRF_HEADER_NAME);
  if (!cookie || !header || cookie.length > 2048 || !equal(cookie, header))
    return null;
  return readCsrfToken(header);
}

export function csrfMatchesRefresh(
  csrf: CsrfSession,
  refreshToken: string
): boolean {
  return equal(csrf.refreshHash, hashToken(refreshToken));
}
