export const authTestEnvironment = {
  AUTH_REFRESH_REPLAY_ACTIVE_KEY_ID: "test-v1",
  AUTH_REFRESH_REPLAY_KEYS: JSON.stringify([
    { id: "test-v1", key: Buffer.alloc(32, 7).toString("base64") },
  ]),
  JWT_SECRET: "veralog-auth-test-signing-key-not-for-production",
  GOOGLE_CLIENT_ID: "auth-test-client",
  GOOGLE_CLIENT_SECRET: "auth-test-client-secret",
  GOOGLE_CLIENT_REDIRECT_URI:
    "http://localhost:3000/api/v1/auth/google/callback",
  FRONTEND_BASE_URL: "http://localhost:5173",
  AUTH_ALLOWED_ORIGINS: "http://localhost:5173",
};
