import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/**/*.{test,spec}.?(c|m)[jt]s"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/*", "dist/**"],
    },
  },
});
