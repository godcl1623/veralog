// vitest는 .env를 자동으로 로드하지 않는다. Node 20.6+의 표준 loadEnvFile()로
// 셸 export 의존 없이 .env를 process.env에 주입한다. .env가 없는 경우(예: 단위
// 테스트만 돌릴 때)도 vitest 설정 로딩은 실패하지 않게 한다.
try {
  process.loadEnvFile(".env");
} catch {
  // 의도적 무시: .env 부재는 테스트 인프라 오류가 아니다.
}

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s"],
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/*", "dist/**"],
    },
  },
});
