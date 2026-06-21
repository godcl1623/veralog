import { vi } from "vitest";

/**
 * Google OAuth에서 arctic이/우리가 호출하는 fetch 엔드포인트.
 *
 * arctic의 Google 클래스는 토큰 교환/갱신/폐기를 이 URL들로 보낸다
 * (request.js의 sendTokenRequest, sendTokenRevocationRequest 경로).
 * userinfo는 arctic 경유가 아니라 우리가 직접 호출한다.
 */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/**
 * /token 응답 본문 (OAuth2 표준).
 *
 * 성공 시 arctic은 access_token / refresh_token / expires_in 등을 읽어
 * OAuth2Tokens로 변환한다. 실패 시 error / error_description이 있으면
 * OAuth2RequestError로 throw.
 */
export interface GoogleTokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * /userinfo 응답 본문 (OpenID Connect 표준).
 */
export interface GoogleUserinfoResponseBody {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: string;
}

export interface MockGoogleOptions {
  /** /token 응답 본문. 기본값은 빈 객체 (어느 필드도 채워지지 않음). */
  tokenResponse?: GoogleTokenResponseBody;
  /** /token HTTP 상태. 기본 200. OAuth2 에러 시나리오에서는 400/401 사용. */
  tokenStatus?: number;
  /** /userinfo 응답 본문. 기본값은 빈 객체. */
  userinfoResponse?: GoogleUserinfoResponseBody;
  /** /userinfo HTTP 상태. 기본 200. */
  userinfoStatus?: number;
}

/**
 * Google OAuth의 fetch 응답을 모킹한다.
 *
 * arctic은 내부적으로 globalThis.fetch를 호출한다 (request.js의
 * `await fetch(request)`). 이 헬퍼는 vi.spyOn(globalThis, "fetch")으로
 * 다음 엔드포인트의 응답을 사전 정의된 값으로 반환한다:
 *  - https://oauth2.googleapis.com/token        (토큰 교환/갱신)
 *  - https://oauth2.googleapis.com/revoke       (토큰 폐기)
 *  - https://openidconnect.googleapis.com/v1/userinfo (사용자 정보 조회)
 *
 * 위 세 URL 어느 것도 매칭되지 않으면 throw — 테스트에 누락된 모킹이
 * 있을 때 즉시 발견하도록 강제한다.
 *
 * 사용 예:
 *   beforeEach(() => {
 *     mockGoogle({ tokenResponse, userinfoResponse });
 *   });
 *
 * 반환값은 vi.spyOn이 돌려주는 MockInstance — 호출 횟수나 인자 assertion에 활용.
 */
export function mockGoogle(options: MockGoogleOptions = {}) {
  const {
    tokenResponse = {},
    tokenStatus = 200,
    userinfoResponse = {},
    userinfoStatus = 200,
  } = options;

  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.startsWith(GOOGLE_TOKEN_URL)) {
        return new Response(JSON.stringify(tokenResponse), {
          status: tokenStatus,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.startsWith(GOOGLE_REVOKE_URL)) {
        // arctic의 sendTokenRevocationRequest는 200만 확인하고 본문은 무시.
        return new Response(null, { status: 200 });
      }

      if (url.startsWith(GOOGLE_USERINFO_URL)) {
        return new Response(JSON.stringify(userinfoResponse), {
          status: userinfoStatus,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call to: ${url}`);
    });
}
