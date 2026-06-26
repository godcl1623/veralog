import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { ACCESS_TOKEN_COOKIE_NAME, verifyAccessToken } from "../utils/jwt";

// Hono 컨텍스트 변수 타입 확장 — hono/jwt와 동일한 패턴.
// 미들웨어 통과 후 c.get("user")로 { id }을 얻을 수 있다.
declare module "hono" {
  interface ContextVariableMap {
    user: { id: string };
  }
}

/**
 * Access Token 인증 미들웨어.
 *
 * 동작:
 * 1. `access_token` 쿠키에서 토큰 추출. 없으면 `Authorization: Bearer ...` 헤더 시도.
 * 2. 토큰이 없거나 검증 실패 시 401 반환.
 * 3. 검증 성공 시 `c.set("user", { id: payload.sub })`로 사용자 ID 주입.
 *
 * 검증 실패 상세(서명 오류/만료 등)는 응답에 노출하지 않는다.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  let token = getCookie(c, ACCESS_TOKEN_COOKIE_NAME);

  if (!token) {
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = await verifyAccessToken(token);
    c.set("user", { id: payload.sub });
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};
