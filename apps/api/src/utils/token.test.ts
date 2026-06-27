import { describe, expect, it } from "vitest";

import {
  generateRefreshToken,
  hashToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./token";

describe("token", () => {
  describe("REFRESH_TOKEN_TTL_SECONDS", () => {
    it("14일 (1209600초)", () => {
      expect(REFRESH_TOKEN_TTL_SECONDS).toBe(60 * 60 * 24 * 14);
    });
  });

  describe("hashToken", () => {
    it("동일 입력 → 동일 해시 (결정론적)", () => {
      const h1 = hashToken("abc");
      const h2 = hashToken("abc");
      expect(h1).toBe(h2);
    });

    it("SHA-256 hex (64자)", () => {
      const h = hashToken("abc");
      expect(h).toHaveLength(64);
      expect(h).toMatch(/^[0-9a-f]+$/);
    });

    it("다른 입력 → 다른 해시", () => {
      expect(hashToken("abc")).not.toBe(hashToken("abd"));
    });
  });

  describe("generateRefreshToken", () => {
    it("UUID 형식", () => {
      const t = generateRefreshToken();
      expect(t).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("호출마다 다른 값", () => {
      const a = generateRefreshToken();
      const b = generateRefreshToken();
      expect(a).not.toBe(b);
    });
  });
});
