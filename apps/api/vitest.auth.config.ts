import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { authTestEnvironment } from "./src/test/auth-environment";

// The user permits test processes to load credentials without exposing them.
if (!process.env.DATABASE_URL_TEST) process.loadEnvFile(".env");

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
    env: authTestEnvironment,
  },
});
