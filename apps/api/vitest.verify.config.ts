import { defineConfig } from "vitest/config";

import { assertTestDatabaseUrl } from "./src/test/database-target";

const databaseUrlTest = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s"],
    fileParallelism: false,
    globalSetup: ["./src/test/verify-global-setup.ts"],
    setupFiles: ["./src/test/auth-setup.ts"],
    env: {
      DATABASE_URL_TEST: databaseUrlTest,
      DATABASE_URL: "",
      JWT_SECRET: "veralog-auth-test-signing-key-not-for-production",
      GOOGLE_CLIENT_ID: "auth-test-client",
      GOOGLE_CLIENT_SECRET: "auth-test-client-secret",
      GOOGLE_CLIENT_REDIRECT_URI:
        "http://localhost:3000/api/v1/auth/google/callback",
      FRONTEND_BASE_URL: "http://localhost:5173",
      AUTH_ALLOWED_ORIGINS: "http://localhost:5173",
    },
  },
});
