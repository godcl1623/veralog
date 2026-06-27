import { createHash, randomUUID } from "node:crypto";

/** Refresh Token 만료 (초). 14일. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14;

/** 토큰을 SHA-256 해시한다 (user_devices.refreshToken 저장용). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 랜덤 Refresh Token을 생성한다 (randomUUID 기반). */
export function generateRefreshToken(): string {
  return randomUUID();
}
