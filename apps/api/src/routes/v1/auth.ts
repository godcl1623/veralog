import { Hono } from "hono";

export const auth = new Hono();

auth.get("/google", (ctx) => {
  return ctx.text("Google Login Page");
});

auth.get("/google/callback", async (ctx) => {
  return ctx.text("Google Callback Handler");
});
