import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { z } from "zod";

import type { AuthCookieBundle } from "./cookies";

export const REFRESH_REPLAY_WINDOW_MS = 10_000;

export type ReplayBinding = {
  sessionId: string;
  currentHash: string;
  previousHash: string;
  validUntil: number;
};

const keySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  key: z.string(),
});
const envelopeSchema = z.object({
  version: z.literal(1),
  keyId: keySchema.shape.id,
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  data: z
    .string()
    .min(1)
    .max(16_384)
    .regex(/^[A-Za-z0-9_-]+$/),
});
const bundleSchema = z.object({
  accessToken: z.string().min(1).max(4096),
  refreshToken: z.string().min(1).max(4096),
  csrfToken: z.string().min(1).max(4096),
  accessExpiresAt: z.number().int().positive(),
  refreshExpiresAt: z.number().int().positive(),
});

export function createRefreshReplayCipher(
  activeId: string,
  configuredKeys: unknown,
  jwtSecret: string
) {
  const parsed = z.array(keySchema).min(1).safeParse(configuredKeys);
  const keys = new Map<string, Buffer>();
  if (!parsed.success)
    throw new Error("Invalid refresh replay key configuration");
  for (const entry of parsed.data) {
    const key = Buffer.from(entry.key, "base64");
    if (
      keys.has(entry.id) ||
      key.length !== 32 ||
      key.toString("base64") !== entry.key ||
      entry.key === jwtSecret ||
      key.equals(Buffer.from(jwtSecret))
    )
      throw new Error("Invalid refresh replay key configuration");
    keys.set(entry.id, key);
  }
  if (!keys.has(activeId))
    throw new Error("Invalid refresh replay key configuration");

  function aad(keyId: string, binding: ReplayBinding): Buffer {
    return Buffer.from(
      JSON.stringify([
        "veralog:refresh-replay:v1",
        keyId,
        binding.sessionId,
        binding.currentHash,
        binding.previousHash,
        binding.validUntil,
      ])
    );
  }

  return {
    seal(bundle: AuthCookieBundle, binding: ReplayBinding): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keys.get(activeId)!, iv);
      cipher.setAAD(aad(activeId, binding));
      const data = Buffer.concat([
        cipher.update(JSON.stringify(bundleSchema.parse(bundle)), "utf8"),
        cipher.final(),
      ]);
      return JSON.stringify({
        version: 1,
        keyId: activeId,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        data: data.toString("base64url"),
      });
    },
    open(value: string, binding: ReplayBinding): AuthCookieBundle {
      try {
        if (value.length > 20_000) throw new Error();
        const envelope = envelopeSchema.parse(JSON.parse(value));
        const key = keys.get(envelope.keyId);
        if (!key) throw new Error();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(envelope.iv, "base64url")
        );
        decipher.setAAD(aad(envelope.keyId, binding));
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
        const plain = Buffer.concat([
          decipher.update(Buffer.from(envelope.data, "base64url")),
          decipher.final(),
        ]);
        return bundleSchema.parse(JSON.parse(plain.toString("utf8")));
      } catch {
        // Never attach decrypted values, ciphertext or key material to errors.
        throw new Error("Invalid refresh replay data");
      }
    },
  };
}

export function loadRefreshReplayCipher() {
  try {
    return createRefreshReplayCipher(
      process.env.AUTH_REFRESH_REPLAY_ACTIVE_KEY_ID ?? "",
      JSON.parse(process.env.AUTH_REFRESH_REPLAY_KEYS ?? "null"),
      process.env.JWT_SECRET ?? ""
    );
  } catch {
    throw new Error("Invalid refresh replay key configuration");
  }
}

export function isRefreshReplayAllowed(
  validUntil: number,
  now: number
): boolean {
  return now < validUntil;
}
