import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  connect: vi.fn(),
  migrate: vi.fn(),
}));
vi.mock("postgres", () => ({
  default: mocks.connect,
}));
vi.mock("./global-setup", () => ({
  default: mocks.migrate,
}));

import verifyGlobalSetup from "./verify-global-setup";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    "DATABASE_URL_TEST",
    "postgres://synthetic:synthetic@localhost:5432/veralog_test"
  );
  mocks.query.mockResolvedValue([{ name: "veralog_test" }]);
  mocks.end.mockResolvedValue(undefined);
  mocks.migrate.mockResolvedValue(undefined);
  mocks.connect.mockReturnValue(Object.assign(mocks.query, { end: mocks.end }));
});

afterEach(() => vi.unstubAllEnvs());

describe("verification setup before migration", () => {
  it("checks identity and closes that connection before applying migrations", async () => {
    await verifyGlobalSetup();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.migrate).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.end.mock.invocationCallOrder[0]
    );
    expect(mocks.end.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.migrate.mock.invocationCallOrder[0]
    );
  });

  it("never connects or migrates an unapproved target", async () => {
    vi.stubEnv("DATABASE_URL_TEST", "postgres://localhost/veralog");
    await expect(verifyGlobalSetup()).rejects.toThrow("DATABASE_URL_TEST");
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.migrate).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [{ name: "veralog" }] },
    { rows: [{ name: "other_test" }] },
    { rows: [] },
  ])(
    "never migrates when the server reports a different database",
    async ({ rows }) => {
      mocks.query.mockResolvedValue(rows);
      await expect(verifyGlobalSetup()).rejects.toThrow(
        "Approved test database identity could not be verified"
      );
      expect(mocks.end).toHaveBeenCalledTimes(1);
      expect(mocks.migrate).not.toHaveBeenCalled();
    }
  );

  it("closes a failed connection and hides driver details", async () => {
    mocks.query.mockRejectedValue(new Error("synthetic-private-password"));
    await expect(verifyGlobalSetup()).rejects.toThrow(
      "Approved test database identity could not be verified"
    );
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.migrate).not.toHaveBeenCalled();
  });
  it("passes the explicit port to identity and migration connections", async () => {
    vi.stubEnv("PGPORT", "6543");
    vi.stubEnv(
      "DATABASE_URL_TEST",
      "postgres://synthetic:synthetic@localhost/veralog_test"
    );
    const normalized =
      "postgres://synthetic:synthetic@localhost:5432/veralog_test";
    mocks.migrate.mockImplementationOnce(async () => {
      expect(process.env.DATABASE_URL_TEST).toBe(normalized);
    });
    await verifyGlobalSetup();
    expect(mocks.connect).toHaveBeenCalledWith(normalized, { max: 1 });
    expect(mocks.migrate).toHaveBeenCalledTimes(1);
  });
});
