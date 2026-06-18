import { getRequiredEnv } from "@veralog/shared";
import { generateCodeVerifier, generateState, Google } from "arctic";
import { Hono } from "hono";

export const auth = new Hono();

const state = generateState();
const codeVerifier = generateCodeVerifier();
const scopes = ["openid", "profile", "email"];
const google = new Google(
  getRequiredEnv("GOOGLE_CLIENT_ID"),
  getRequiredEnv("GOOGLE_CLIENT_SECRET"),
  getRequiredEnv("GOOGLE_CLIENT_REDIRECT_URI")
);

auth.get("/google", (ctx) => {
  return ctx.text("Google Login Page");
});

auth.get("/google/callback", async (ctx) => {
  return ctx.text("Google Callback Handler");
});
