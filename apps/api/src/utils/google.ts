const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleUserInfo {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

/**
 * Google UserInfo를 조회한다. arctic이 미제공하므로 직접 fetch.
 *
 * @throws UserInfo fetch 실패 (5xx) 또는 sub 누락 시
 */
export async function fetchGoogleUserInfo(
  accessToken: string
): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`UserInfo fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as Partial<GoogleUserInfo>;
  if (!body.sub) throw new Error("UserInfo missing sub");
  return {
    sub: body.sub,
    name: body.name,
    email: body.email,
    picture: body.picture,
  };
}
