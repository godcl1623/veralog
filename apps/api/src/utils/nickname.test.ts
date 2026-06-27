import { describe, expect, it } from "vitest";

import { generateRandomNickname } from "./nickname";

describe("nickname", () => {
  describe("generateRandomNickname", () => {
    it("`user_` 접두사 + 8자 hex", () => {
      const n = generateRandomNickname();
      expect(n).toMatch(/^user_[0-9a-f]{8}$/);
    });

    it("호출마다 다른 값", () => {
      const a = generateRandomNickname();
      const b = generateRandomNickname();
      expect(a).not.toBe(b);
    });
  });
});
