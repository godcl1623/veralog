import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The user permits test processes to load credentials without exposing them.
process.loadEnvFile(".env");

let target: URL;
try {
  target = new URL(process.env.DATABASE_URL_TEST ?? "");
} catch {
  throw new Error("A local veralog_test connection is required");
}

if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  (target.port && target.port !== "5432") ||
  target.pathname !== "/veralog_test"
) {
  throw new Error("Only the approved local veralog_test database is allowed");
}

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/routes/v1/auth/*.test.ts",
      "src/middleware/auth.test.ts",
      "src/utils/{jwt,token,csrf,cookies}.test.ts",
    ],
    fileParallelism: false,
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: [
      fileURLToPath(new URL("./src/test/auth-setup.ts", import.meta.url)),
    ],
    env: {
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
