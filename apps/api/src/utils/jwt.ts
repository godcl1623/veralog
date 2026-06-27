import { getRequiredEnv } from "@veralog/shared";
import { Jwt } from "hono/utils/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";

const JWT_SECRET = getRequiredEnv("JWT_SECRET");

/** Access Token 만료 시간 (초). 15분. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;

/** Access Token을 담는 쿠키 이름. */
export const ACCESS_TOKEN_COOKIE_NAME = "access_token";

/** Refresh Token을 담는 쿠키 이름. */
export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";

/** Access Token의 JWT payload. hono/jwt 표준 claim 사용. */
export type AccessTokenPayload = {
  /** subject — 사용자 ID (users.id) */
  sub: string;
  /** issued at (초) */
  iat: number;
  /** expiration (초) */
  exp: number;
};

/**
 * Access Token을 발급한다.
 *
 * @param userId - 사용자 ID (users.id)
 * @returns 서명된 JWT 문자열 (HS256, 15분 만료)
 */
export async function signAccessToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return Jwt.sign(
    { sub: userId, iat: now, exp: now + ACCESS_TOKEN_TTL_SECONDS },
    JWT_SECRET,
    "HS256"
  );
}

/**
 * Access Token의 서명을 검증하고 payload를 반환한다.
 *
 * @param token - 클라이언트가 보낸 JWT
 * @throws 서명 오류, 만료 등 verify 실패 시
 */
export async function verifyAccessToken(
  token: string
): Promise<AccessTokenPayload> {
  return Jwt.verify(token, JWT_SECRET, "HS256") as Promise<AccessTokenPayload>;
}

/**
 * Access Token을 서명 검증 없이 디코드한다.
 *
 * 디버깅/로깅 전용 — 인증 판단에는 verifyAccessToken을 사용할 것.
 * 반환 타입은 hono의 표준 {@link JWTPayload}로, sub/iat/exp의 존재와 타입을 보장하지 않는다.
 *
 * @returns JWT payload (서명 미검증)
 */
export function decodeAccessToken(token: string): JWTPayload {
  const { payload } = Jwt.decode(token);
  return payload;
}
