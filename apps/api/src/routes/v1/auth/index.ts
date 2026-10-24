import { getRequiredEnv } from "@veralog/shared";
import {
  ArcticFetchError,
  generateCodeVerifier,
  generateState,
  Google,
  OAuth2RequestError,
} from "arctic";
import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";

import { db } from "../../../db/client";
import { userDevices, userOauthAccounts, users } from "../../../db/schema";
import { setAuthCookies } from "../../../utils/cookies";
import { isAllowedOrigin } from "../../../utils/csrf";
import { fetchGoogleUserInfo } from "../../../utils/google";
import { signAccessToken } from "../../../utils/jwt";
import { generateRandomNickname } from "../../../utils/nickname";
import {
  OAuthCallbackFailure,
  redirectOAuthFailure,
} from "../../../utils/oauth-failure";
import {
  generateRefreshToken,
  hashToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../../../utils/token";
import { logoutRouter } from "./logout";
import { refreshRouter } from "./refresh";

export const auth = new Hono();

auth.use(
  "*",
  cors({
    origin: (origin) => (isAllowedOrigin(origin) ? origin : ""),
    credentials: true,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  })
);

const google = new Google(
  getRequiredEnv("GOOGLE_CLIENT_ID"),
  getRequiredEnv("GOOGLE_CLIENT_SECRET"),
  getRequiredEnv("GOOGLE_CLIENT_REDIRECT_URI")
);

const SCOPES = ["openid", "profile", "email"];
const OAUTH_COOKIE_MAX_AGE = 600; // 10 minutes

auth.route("/", refreshRouter);
auth.route("/", logoutRouter);

auth.get("/google", async (ctx) => {
  try {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = google.createAuthorizationURL(state, codeVerifier, SCOPES);

    const cookieOptions = {
      path: "/",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: OAUTH_COOKIE_MAX_AGE,
      sameSite: "Lax" as const,
    };

    setCookie(ctx, "google_oauth_state", state, cookieOptions);
    setCookie(ctx, "google_oauth_code_verifier", codeVerifier, cookieOptions);

    return ctx.redirect(url.toString());
  } catch (error) {
    if (error instanceof OAuth2RequestError) {
      return ctx.body(null, 400);
    }
    if (error instanceof ArcticFetchError) {
      return ctx.body(null, 502);
    }
    return ctx.body(null, 500);
  }
});

function extractAndValidateState(ctx: Context): { code: string } {
  const code = ctx.req.query("code");
  const queryState = ctx.req.query("state");
  const cookieState = getCookie(ctx, "google_oauth_state");
  if (!queryState || !cookieState) {
    throw new OAuthCallbackFailure("state_missing");
  }
  if (queryState !== cookieState) {
    throw new OAuthCallbackFailure("state_invalid");
  }
  const error = ctx.req.query("error");
  if (error)
    throw new OAuthCallbackFailure(
      error === "access_denied" ? "access_denied" : "provider_error"
    );
  if (!code) throw new OAuthCallbackFailure("code_missing");
  return { code };
}

async function exchangeCodeForTokens(
  code: string,
  ctx: Context
): Promise<{ accessToken: () => string }> {
  const codeVerifier = getCookie(ctx, "google_oauth_code_verifier");
  if (!codeVerifier) {
    throw new OAuthCallbackFailure("pkce_missing");
  }
  return await google.validateAuthorizationCode(code, codeVerifier);
}

async function getOrCreateUser(args: {
  provider: "google";
  providerAccountId: string;
  nickname: string;
  avatarUrl: string | undefined;
  deviceName: string | undefined;
}): Promise<{
  userId: string;
  isNewUser: boolean;
  refreshToken: string;
  sessionId: string;
}> {
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${args.provider + ":" + args.providerAccountId}))`
    );

    const [account] = await tx
      .select({ oauth: userOauthAccounts, user: users })
      .from(userOauthAccounts)
      .leftJoin(users, eq(userOauthAccounts.userId, users.id))
      .where(
        and(
          eq(userOauthAccounts.provider, args.provider),
          eq(userOauthAccounts.providerAccountId, args.providerAccountId)
        )
      );

    let userId: string;
    let isNewUser = false;

    if (!account || !account.user) {
      const [u] = await tx
        .insert(users)
        .values({ nickname: args.nickname, avatarUrl: args.avatarUrl })
        .returning();
      await tx.insert(userOauthAccounts).values({
        userId: u.id,
        provider: args.provider,
        providerAccountId: args.providerAccountId,
      });
      userId = u.id;
      isNewUser = true;
    } else if (account.user.deletedAt === null) {
      userId = account.user.id;
    } else {
      const ageMs = Date.now() - account.user.deletedAt.getTime();
      if (ageMs <= 168 * 60 * 60 * 1000) {
        await tx
          .update(users)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(users.id, account.user.id));
        userId = account.user.id;
      } else {
        await tx.delete(users).where(eq(users.id, account.user.id));
        const [u] = await tx
          .insert(users)
          .values({ nickname: args.nickname, avatarUrl: args.avatarUrl })
          .returning();
        await tx.insert(userOauthAccounts).values({
          userId: u.id,
          provider: args.provider,
          providerAccountId: args.providerAccountId,
        });
        userId = u.id;
        isNewUser = true;
      }
    }

    const refreshToken = generateRefreshToken();
    const [device] = await tx
      .insert(userDevices)
      .values({
        userId,
        deviceName: args.deviceName,
        refreshToken: hashToken(refreshToken),
        lastAccessedAt: new Date(),
        refreshExpiresAt: new Date(
          Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000
        ),
      })
      .returning({ id: userDevices.id });

    return { userId, isNewUser, refreshToken, sessionId: device.id };
  });
}

auth.get("/google/callback", async (ctx) => {
  try {
    const { code } = extractAndValidateState(ctx);
    const tokens = await exchangeCodeForTokens(code, ctx);
    const userInfo = await fetchGoogleUserInfo(tokens.accessToken()).catch(
      () => {
        throw new OAuthCallbackFailure("userinfo_failed");
      }
    );

    const { userId, isNewUser, refreshToken, sessionId } =
      await getOrCreateUser({
        provider: "google",
        providerAccountId: userInfo.sub,
        nickname: generateRandomNickname(),
        avatarUrl: userInfo.picture,
        deviceName: ctx.req.header("User-Agent") ?? undefined,
      });

    const accessToken = await signAccessToken(userId);
    setAuthCookies(ctx, accessToken, refreshToken, sessionId);

    const frontendBaseUrl = getRequiredEnv("FRONTEND_BASE_URL");
    const target = isNewUser
      ? `${frontendBaseUrl}/terms?new=true`
      : frontendBaseUrl;
    return ctx.redirect(target);
  } catch (error) {
    if (error instanceof OAuthCallbackFailure)
      return redirectOAuthFailure(ctx, error.status);
    if (error instanceof OAuth2RequestError) {
      return redirectOAuthFailure(
        ctx,
        error.code === "invalid_grant"
          ? "code_invalid"
          : "token_exchange_failed"
      );
    }
    if (error instanceof ArcticFetchError)
      return redirectOAuthFailure(ctx, "google_unavailable");
    return redirectOAuthFailure(ctx, "internal_error");
  }
});
