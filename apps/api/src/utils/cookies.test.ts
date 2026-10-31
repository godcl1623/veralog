import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  clearAuthCookies,
  setAuthCookieBundle,
  setAuthCookies,
} from "./cookies";
import { csrfMatchesRefresh, readCsrfToken } from "./csrf";

describe("authentication cookie contract", () => {
  it("sets three Secure SameSite=Lax cookies, only CSRF is readable", async () => {
    const id = randomUUID();
    const app = new Hono();
    app.get("/", (c) => {
      setAuthCookies(c, "access-test", "refresh-test", id);
      return c.body(null, 204);
    });
    const response = await app.request("/");
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    for (const cookie of cookies) {
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).not.toContain("Domain=");
    }
    const access = cookies.find((x) => x.startsWith("access_token="))!;
    const refresh = cookies.find((x) => x.startsWith("refresh_token="))!;
    const csrf = cookies.find((x) => x.startsWith("csrf_token="))!;
    expect(access).toContain("HttpOnly");
    expect(access).toContain("Max-Age=900");
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("Max-Age=604800");
    expect(csrf).not.toContain("HttpOnly");
    expect(csrf).toContain("Max-Age=604800");
    const value = decodeURIComponent(
      csrf.split(";")[0].slice("csrf_token=".length)
    );
    expect(readCsrfToken(value)?.sessionId).toBe(id);
    expect(csrfMatchesRefresh(readCsrfToken(value)!, "refresh-test")).toBe(
      true
    );
  });

  it("expires all three cookies on the same host/path", async () => {
    const app = new Hono();
    app.delete("/", (c) => {
      clearAuthCookies(c);
      return c.body(null, 204);
    });
    const response = await app.request("/", { method: "DELETE" });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    for (const cookie of cookies) {
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("Path=/");
    }
  });
});

it("replays identical values with absolute expiry and only their remaining lifetimes", async () => {
  const bundle = {
    accessToken: "same-access",
    refreshToken: "same-refresh",
    csrfToken: "same-csrf",
    accessExpiresAt: 900_000,
    refreshExpiresAt: 604_800_000,
  };
  const app = new Hono();
  app.get("/", (c) => {
    setAuthCookieBundle(c, bundle, 2_500);
    return c.body(null, 204);
  });
  const response = await app.request("/");
  const cookies = response.headers.getSetCookie();
  expect(cookies[0]).toContain("access_token=same-access");
  expect(cookies[0]).toContain("Max-Age=897");
  expect(cookies[0]).toContain(new Date(bundle.accessExpiresAt).toUTCString());
  expect(cookies[1]).toContain("Max-Age=604797");
  expect(cookies[2]).toContain("csrf_token=same-csrf");
  expect(cookies[2]).not.toContain("HttpOnly");
});
