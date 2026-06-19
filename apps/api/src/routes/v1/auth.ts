import { getRequiredEnv } from "@veralog/shared";
import {
  ArcticFetchError,
  generateCodeVerifier,
  generateState,
  Google,
  OAuth2RequestError,
} from "arctic";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";

export const auth = new Hono();

const google = new Google(
  getRequiredEnv("GOOGLE_CLIENT_ID"),
  getRequiredEnv("GOOGLE_CLIENT_SECRET"),
  getRequiredEnv("GOOGLE_CLIENT_REDIRECT_URI")
);

const SCOPES = ["openid", "profile", "email"];
const OAUTH_COOKIE_MAX_AGE = 600; // 10 minutes

auth.get("/google", async (ctx) => {
  try {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = google.createAuthorizationURL(state, codeVerifier, SCOPES);

    const cookieOptions = {
      path: "/",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: OAUTH_COOKIE_MAX_AGE,
      sameSite: "Lax" as const,
    };

    setCookie(ctx, "google_oauth_state", state, cookieOptions);
    setCookie(ctx, "google_oauth_code_verifier", codeVerifier, cookieOptions);

    return ctx.redirect(url.toString());
  } catch (error) {
    if (error instanceof OAuth2RequestError) {
      return ctx.json({ error: "OAuth2 request error" }, 400);
    }
    if (error instanceof ArcticFetchError) {
      return ctx.json({ error: "Failed to fetch from Google" }, 502);
    }
    return ctx.json({ error: "Internal server error" }, 500);
  }
});

auth.get("/google/callback", async (ctx) => {
  return ctx.text("Google Callback Handler");
});
