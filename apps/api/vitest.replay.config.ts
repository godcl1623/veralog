import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: ["src/utils/{refresh-replay,refresh-cleanup,cookies}.test.ts"],
    env: { JWT_SECRET: "synthetic-replay-unit-test-signing-key" },
  },
});
