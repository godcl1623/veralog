import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { clearAuthCookies, setAuthCookies } from "./cookies";
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
