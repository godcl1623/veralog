import { Jwt } from "hono/utils/jwt";
import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_TTL_SECONDS,
  decodeAccessToken,
  signAccessToken,
  verifyAccessToken,
} from "./jwt";

describe("jwt", () => {
  const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

  describe("signAccessToken + verifyAccessToken", () => {
    it("round-trip — sign한 토큰을 verify하면 동일 sub 반환", async () => {
      const token = await signAccessToken(TEST_USER_ID);
      const payload = await verifyAccessToken(token);

      expect(payload.sub).toBe(TEST_USER_ID);
      expect(payload.iat).toBeGreaterThan(0);
      expect(payload.exp).toBeGreaterThan(0);
      expect(payload.exp - payload.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it("다른 secret으로 sign된 토큰은 verify 실패", async () => {
      const foreignToken = await Jwt.sign(
        { sub: TEST_USER_ID },
        "wrong-secret",
        "HS256"
      );
      await expect(verifyAccessToken(foreignToken)).rejects.toThrow();
    });
  });

  describe("decodeAccessToken", () => {
    it("서명 검증 없이 payload 반환", async () => {
      const token = await signAccessToken(TEST_USER_ID);
      const decoded = decodeAccessToken(token);

      expect(decoded.sub).toBe(TEST_USER_ID);
    });

    it("만료된 토큰도 디코드 가능 (서명 검증 안 함)", async () => {
      const expiredToken = await Jwt.sign(
        {
          sub: TEST_USER_ID,
          iat: Math.floor(Date.now() / 1000) - 7200,
          exp: Math.floor(Date.now() / 1000) - 3600,
        },
        "irrelevant-secret",
        "HS256"
      );
      const decoded = decodeAccessToken(expiredToken);
      expect(decoded.sub).toBe(TEST_USER_ID);
    });
  });

  describe("상수", () => {
    it("ACCESS_TOKEN_TTL_SECONDS = 900 (15분)", () => {
      expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    });

    it("ACCESS_TOKEN_COOKIE_NAME 정의됨", () => {
      expect(ACCESS_TOKEN_COOKIE_NAME).toBe("access_token");
    });
  });
});
