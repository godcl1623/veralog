import { Hono } from "hono";
import { Jwt } from "hono/utils/jwt";
import { describe, expect, it } from "vitest";

import { signAccessToken } from "../utils/jwt";
import { authMiddleware } from "./auth";

const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

/** 미들웨어 + protected echo 라우트로 구성된 테스트용 Hono 인스턴스 */
function makeApp() {
  const app = new Hono();
  app.use("/protected", authMiddleware);
  app.get("/protected", (c) => c.json({ userId: c.get("user").id }));
  return app;
}

describe("authMiddleware", () => {
  it("유효 토큰을 쿠키로 받으면 200 + userId 일치", async () => {
    const token = await signAccessToken(TEST_USER_ID);
    const app = makeApp();

    const res = await app.request("/protected", {
      headers: { Cookie: `access_token=${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: TEST_USER_ID });
  });

  it("유효 토큰을 Authorization Bearer 헤더로 받으면 200", async () => {
    const token = await signAccessToken(TEST_USER_ID);
    const app = makeApp();

    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: TEST_USER_ID });
  });

  it("토큰이 없으면 401 + Unauthorized", async () => {
    const app = makeApp();

    const res = await app.request("/protected");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("잘못된 서명 토큰은 401", async () => {
    const foreignToken = await Jwt.sign(
      { sub: TEST_USER_ID },
      "wrong-secret",
      "HS256"
    );
    const app = makeApp();

    const res = await app.request("/protected", {
      headers: { Cookie: `access_token=${foreignToken}` },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("만료된 토큰은 401", async () => {
    const expiredToken = await Jwt.sign(
      {
        sub: TEST_USER_ID,
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600,
      },
      process.env.JWT_SECRET ?? "",
      "HS256"
    );
    const app = makeApp();

    const res = await app.request("/protected", {
      headers: { Cookie: `access_token=${expiredToken}` },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("쿠키와 헤더가 모두 있으면 쿠키 값이 우선이다", async () => {
    const cookieToken = await signAccessToken(TEST_USER_ID);
    const headerToken = await signAccessToken("other-user-id");
    const app = makeApp();

    const res = await app.request("/protected", {
      headers: {
        Cookie: `access_token=${cookieToken}`,
        Authorization: `Bearer ${headerToken}`,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: TEST_USER_ID });
  });

  it("'Bearer' 접두사 없는 헤더는 무시되고 401", async () => {
    const token = await signAccessToken(TEST_USER_ID);
    const app = makeApp();

    const res = await app.request("/protected", {
      headers: { Authorization: token },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
