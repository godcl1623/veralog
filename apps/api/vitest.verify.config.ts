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
    setupFiles: ["./src/test/setup.ts"],
    env: { DATABASE_URL_TEST: databaseUrlTest, DATABASE_URL: "" },
  },
});
