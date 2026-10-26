import { createRoute, z } from "@hono/zod-openapi";

const emptySuccess = z.object({ data: z.null() }).openapi("AuthEmptyResponse");
const emptyErrors = {
  401: { description: "Authentication failed. Empty response body." },
  403: {
    description: "Origin or CSRF verification failed. Empty response body.",
  },
};
const authCookieHeaders = {
  "Set-Cookie": {
    description:
      "Separate Set-Cookie headers for access_token, refresh_token and csrf_token. Secure; SameSite=Lax; Path=/; host-only. Access/Refresh are HttpOnly; CSRF is readable. Access TTL 900s; Refresh/CSRF TTL 604800s.",
    schema: { type: "string" as const },
  },
};
const successResponse = {
  description: "Success. The data property is required and always null.",
  content: { "application/json": { schema: emptySuccess } },
  headers: authCookieHeaders,
};
const redirectHeaders = {
  Location: {
    description: "Browser navigation target.",
    schema: { type: "string" as const },
  },
};
const csrfParameters = [
  {
    in: "header" as const,
    name: "Origin",
    required: true,
    description:
      "Must match the configured allowed origin. Missing/null is rejected.",
    schema: { type: "string" as const },
  },
];
const csrfSecurity = { RefreshCookie: [], CsrfCookie: [], CsrfHeader: [] };

export const googleStartRoute = createRoute({
  method: "get",
  path: "/google",
  operationId: "authGoogleStart",
  tags: ["AuthNavigation"],
  summary: "Start Google sign-in through browser navigation",
  description:
    "Sets HttpOnly, Lax, host-only google_oauth_state and google_oauth_code_verifier cookies for 600s (Secure in production). Not a JSON query operation.",
  security: [],
  responses: {
    302: {
      description: "Navigate to Google authorization with state and PKCE.",
      headers: {
        ...redirectHeaders,
        "Set-Cookie": {
          description: "Separate OAuth state and PKCE cookie headers.",
          schema: { type: "string" },
        },
      },
    },
    400: { description: "OAuth request rejected. Empty body." },
    502: { description: "OAuth provider unavailable. Empty body." },
    500: { description: "Unexpected sign-in failure. Empty body." },
  },
});

export const googleCallbackRoute = createRoute({
  method: "get",
  path: "/google/callback",
  operationId: "authGoogleCallback",
  tags: ["AuthNavigation"],
  summary: "Handle Google callback and navigate to the frontend",
  description:
    "Validates state before provider error, code and PKCE checks using existing handler logic. Success navigates to the frontend base URL, or /terms?new=true for new users, and sets authentication cookies. Failure navigates to /auth/callback?status=access_denied|provider_error|state_missing|state_invalid|code_missing|pkce_missing|code_invalid|token_exchange_failed|google_unavailable|userinfo_failed|internal_error. No tokens or raw provider errors enter the URL. Not a JSON query operation.",
  security: [],
  parameters: [
    ...["code", "state", "error"].map((name) => ({
      in: "query" as const,
      name,
      required: false,
      description:
        "Conditional OAuth callback value. Missing/invalid values follow existing redirect handling, not schema validation errors.",
      schema: { type: "string" as const },
    })),
    ...["google_oauth_state", "google_oauth_code_verifier"].map((name) => ({
      in: "cookie" as const,
      name,
      required: false,
      description:
        "OAuth state/PKCE cookie required for successful callback. Failure redirects to the frontend.",
      schema: { type: "string" as const },
    })),
  ],
  responses: {
    302: {
      description: "Success or classified OAuth failure navigation.",
      headers: { ...redirectHeaders, ...authCookieHeaders },
    },
  },
});

export const refreshRoute = createRoute({
  method: "post",
  path: "/refresh",
  operationId: "authRefresh",
  tags: ["AuthSession"],
  summary: "Rotate this device's refresh session and authentication cookies",
  description:
    "No request body. Refresh cookie only; Bearer is not accepted. Requires allowed Origin and matching CSRF cookie/header signed for the session and Refresh token. CSRF checks precede session lookup. Refresh expires after 604800s, extended on rotation. Rotation locks the device row; replay of the previous token revokes that session. Expired sessions clear authentication cookies; other 401/403 responses do not promise cookie changes.",
  parameters: csrfParameters,
  security: [csrfSecurity],
  responses: { 200: successResponse, ...emptyErrors },
});

export const logoutRoute = createRoute({
  method: "delete",
  path: "/logout",
  operationId: "authLogout",
  tags: ["AuthSession"],
  summary:
    "Revoke this device's refresh session and clear authentication cookies",
  description:
    "No request body. Access cookie is checked first; Bearer is considered only when that cookie is absent, not invalid/empty. Access authentication precedes CSRF verification. Requires allowed Origin and matching signed CSRF cookie/header bound to Refresh. Revokes only this device; other sessions remain. An already-issued Access token may remain valid for its remaining 900s lifetime; ordinary Access validation does not query the DB. Success clears all three cookies with Max-Age=0, rather than renewing them.",
  parameters: csrfParameters,
  security: [
    { AccessCookie: [], ...csrfSecurity },
    { BearerAuth: [], ...csrfSecurity },
  ],
  responses: {
    200: {
      ...successResponse,
      headers: {
        "Set-Cookie": {
          description:
            "Separate deletion headers for access_token, refresh_token and csrf_token; Max-Age=0; Secure; SameSite=Lax; Path=/; host-only. Access/Refresh are HttpOnly.",
          schema: { type: "string" },
        },
      },
    },
    ...emptyErrors,
  },
});

export const authRoutes = [
  googleStartRoute,
  googleCallbackRoute,
  refreshRoute,
  logoutRoute,
];
