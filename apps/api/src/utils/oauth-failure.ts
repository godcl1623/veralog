import { getRequiredEnv } from "@veralog/shared";
import type { Context } from "hono";

export type OAuthFailureStatus =
  | "access_denied"
  | "provider_error"
  | "state_missing"
  | "state_invalid"
  | "code_missing"
  | "pkce_missing"
  | "code_invalid"
  | "token_exchange_failed"
  | "google_unavailable"
  | "userinfo_failed"
  | "internal_error";

export class OAuthCallbackFailure extends Error {
  constructor(readonly status: OAuthFailureStatus) {
    super(status);
  }
}

export function redirectOAuthFailure(ctx: Context, status: OAuthFailureStatus) {
  const url = new URL("/auth/callback", getRequiredEnv("FRONTEND_BASE_URL"));
  url.searchParams.set("status", status);
  return ctx.redirect(url.toString());
}
