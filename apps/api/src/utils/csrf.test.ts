import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCsrfToken,
  csrfMatchesRefresh,
  isAllowedOrigin,
  readCsrfToken,
  verifyCsrfRequest,
} from "./csrf";

afterEach(() => vi.unstubAllEnvs());

describe("session-bound CSRF", () => {
  it("issues distinct signed tokens bound to a session and refresh", () => {
    const id = randomUUID();
    const token = createCsrfToken(id, "refresh-a");
    const value = readCsrfToken(token);
    expect(token).not.toBe(createCsrfToken(id, "refresh-a"));
    expect(value?.sessionId).toBe(id);
    expect(csrfMatchesRefresh(value!, "refresh-a")).toBe(true);
    expect(csrfMatchesRefresh(value!, "refresh-b")).toBe(false);
  });

  it("rejects payload and signature tampering", () => {
    const token = createCsrfToken(randomUUID(), "refresh");
    const [payload, signature] = token.split(".");
    const changed = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString()),
        sessionId: randomUUID(),
      })
    ).toString("base64url");
    expect(readCsrfToken(changed + "." + signature)).toBeNull();
    expect(readCsrfToken(payload + ".invalid")).toBeNull();
    expect(readCsrfToken(".".repeat(2049))).toBeNull();
  });

  it("rejects a token signed with a different key", () => {
    const token = createCsrfToken(randomUUID(), "refresh");
    vi.stubEnv("JWT_SECRET", "another-test-key");
    expect(readCsrfToken(token)).toBeNull();
  });

  it.each([
    undefined,
    "null",
    "https://untrusted.example",
    "http://localhost:5173.evil.example",
  ])("rejects disallowed origin %s", (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });

  it("requires a matching explicit header, not the automatically sent cookie alone", async () => {
    const token = createCsrfToken(randomUUID(), "refresh");
    const app = new Hono();
    app.post("/", (c) => c.body(null, verifyCsrfRequest(c) ? 204 : 403));
    const headers = {
      Origin: "http://localhost:5173",
      Cookie: "csrf_token=" + token,
    };
    expect((await app.request("/", { method: "POST", headers })).status).toBe(
      403
    );
    expect(
      (
        await app.request("/", {
          method: "POST",
          headers: { ...headers, "X-CSRF-Token": token },
        })
      ).status
    ).toBe(204);
    expect(
      (
        await app.request("/", {
          method: "POST",
          headers: { ...headers, "X-CSRF-Token": "wrong" },
        })
      ).status
    ).toBe(403);
  });
});
