import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { authTestEnvironment } from "./src/test/auth-environment";
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
    setupFiles: [
      fileURLToPath(new URL("./src/test/auth-setup.ts", import.meta.url)),
    ],
    env: {
      ...authTestEnvironment,
      DATABASE_URL_TEST: databaseUrlTest,
      DATABASE_URL: "",
    },
  },
});
