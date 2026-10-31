import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRefreshReplayCipher,
  isRefreshReplayAllowed,
  loadRefreshReplayCipher,
} from "./refresh-replay";

const first = { id: "v1", key: Buffer.alloc(32, 7).toString("base64") };
const second = { id: "v2", key: Buffer.alloc(32, 8).toString("base64") };
const bundle = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  csrfToken: "synthetic-csrf",
  accessExpiresAt: 1_800_000_900_000,
  refreshExpiresAt: 1_800_604_800_000,
};
const binding = {
  sessionId: "device-1",
  currentHash: "current",
  previousHash: "previous",
  validUntil: 1_800_000_010_000,
};
const cipher = () =>
  createRefreshReplayCipher("v1", [first], "separate-jwt-secret");

afterEach(() => vi.unstubAllEnvs());

describe("encrypted refresh replay", () => {
  it("authenticates the same complete result without persisting plaintext and uses fresh nonces", () => {
    const c = cipher();
    const sealed = c.seal(bundle, binding);
    expect(c.open(sealed, binding)).toEqual(bundle);
    for (const value of [
      bundle.accessToken,
      bundle.refreshToken,
      bundle.csrfToken,
      first.key,
    ])
      expect(sealed).not.toContain(value);
    expect(c.seal(bundle, binding)).not.toBe(sealed);
  });
  it.each(["sessionId", "currentHash", "previousHash", "validUntil"] as const)(
    "rejects changes to binding %s",
    (field) => {
      const c = cipher();
      const changed = {
        ...binding,
        [field]: field === "validUntil" ? binding.validUntil + 1 : "different",
      };
      expect(() => c.open(c.seal(bundle, binding), changed)).toThrow(
        "Invalid refresh replay data"
      );
    }
  );
  it.each(["iv", "tag", "data"])("rejects changed %s", (field) => {
    const c = cipher();
    const envelope = JSON.parse(c.seal(bundle, binding));
    envelope[field] =
      (envelope[field][0] === "A" ? "B" : "A") + envelope[field].slice(1);
    expect(() => c.open(JSON.stringify(envelope), binding)).toThrow(
      "Invalid refresh replay data"
    );
  });
  it("rejects unknown keys, wrong key material, malformed data and unsupported versions", () => {
    const c = cipher();
    const sealed = c.seal(bundle, binding);
    const wrong = createRefreshReplayCipher(
      "v1",
      [{ ...first, key: second.key }],
      "jwt"
    );
    expect(() => wrong.open(sealed, binding)).toThrow(
      "Invalid refresh replay data"
    );
    const other = createRefreshReplayCipher("v2", [second], "jwt");
    expect(() => other.open(sealed, binding)).toThrow(
      "Invalid refresh replay data"
    );
    for (const value of [
      "not json",
      "{}",
      JSON.stringify({ ...JSON.parse(sealed), version: 2 }),
    ])
      expect(() => c.open(value, binding)).toThrow(
        "Invalid refresh replay data"
      );
  });
  it("reads old-key results during key rotation but writes only the active key", () => {
    const sealed = cipher().seal(bundle, binding);
    const next = createRefreshReplayCipher("v2", [first, second], "jwt");
    expect(next.open(sealed, binding)).toEqual(bundle);
    expect(JSON.parse(next.seal(bundle, binding)).keyId).toBe("v2");
  });
  it("fails closed on missing, short, duplicate or JWT-reused keys", () => {
    for (const keys of [null, [], [{ ...first, key: "short" }], [first, first]])
      expect(() => createRefreshReplayCipher("v1", keys, "jwt")).toThrow(
        "Invalid refresh replay key configuration"
      );
    expect(() =>
      createRefreshReplayCipher("missing", [first], "jwt")
    ).toThrow();
    expect(() => createRefreshReplayCipher("v1", [first], first.key)).toThrow();
    vi.stubEnv("AUTH_REFRESH_REPLAY_KEYS", "not json");
    expect(loadRefreshReplayCipher).toThrow(
      "Invalid refresh replay key configuration"
    );
    vi.stubEnv("AUTH_REFRESH_REPLAY_KEYS", JSON.stringify([first]));
    vi.stubEnv("AUTH_REFRESH_REPLAY_ACTIVE_KEY_ID", "v1");
    expect(
      loadRefreshReplayCipher().open(cipher().seal(bundle, binding), binding)
    ).toEqual(bundle);
  });
  it.each([-1, 0, 1])(
    "accepts only strictly before the 10-second boundary, offset %s",
    (offset) => {
      expect(isRefreshReplayAllowed(10_000, 10_000 + offset)).toBe(offset < 0);
    }
  );
});
