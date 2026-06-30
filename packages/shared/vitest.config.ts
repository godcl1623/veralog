import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/*", "dist/**"],
    },
    passWithNoTests: true,
  },
});
