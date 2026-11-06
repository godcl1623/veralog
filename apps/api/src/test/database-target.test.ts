import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assertTestDatabaseUrl } from "./database-target";

afterEach(() => vi.unstubAllEnvs());

describe("verification database target", () => {
  it.each([
    "postgres://synthetic:synthetic@localhost/veralog_test",
    "postgresql://synthetic:synthetic@127.0.0.1:5432/veralog_test",
    "postgres://synthetic:synthetic@[::1]:5432/veralog_test",
  ])("accepts only the approved local target", (value) => {
    expect(new URL(assertTestDatabaseUrl(value)).port).toBe("5432");
  });

  it.each([
    undefined,
    "",
    "not a URL",
    "https://localhost:5432/veralog_test",
    "postgres://remote.invalid:5432/veralog_test",
    "postgres://localhost:5433/veralog_test",
    "postgres://localhost:5432/veralog",
    "postgres://localhost:5432/other_test",
    "postgres://localhost:5432/veralog_test?host=remote.invalid",
    "postgres://localhost:5432/veralog_test?database=veralog",
    "postgres://localhost:5432/veralog_test?port=5433",
    "postgres://localhost:5432/veralog_test?options=synthetic",
    "postgres://localhost:5432/veralog_test#fragment",
  ])(
    "rejects missing or unapproved targets without exposing credentials",
    (value) => {
      expect(() => assertTestDatabaseUrl(value)).toThrow(
        "DATABASE_URL_TEST must target local :5432/veralog_test without URL options"
      );
    }
  );

  it("does not include a malformed secret-bearing input in the error", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgres://user:synthetic-private-password@remote.invalid/veralog"
      )
    ).toThrowError(
      new Error(
        "DATABASE_URL_TEST must target local :5432/veralog_test without URL options"
      )
    );
  });
  it.each(["5433", "6543"])(
    "fixes the actual driver port when PGPORT=%s and the URL omits a port",
    async (port) => {
      vi.stubEnv("PGPORT", port);
      const target = assertTestDatabaseUrl(
        "postgres://synthetic:synthetic@localhost/veralog_test"
      );
      const client = postgres(target, { max: 1 });
      try {
        expect(client.options.port).toEqual([5432]);
      } finally {
        await client.end();
      }
    }
  );
});
