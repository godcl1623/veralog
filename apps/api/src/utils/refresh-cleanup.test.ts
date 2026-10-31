import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ db: {} }));
import { startRefreshReplayCleanup } from "./refresh-cleanup";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("refresh replay cleanup scheduling", () => {
  it("runs at startup and every minute, then stops", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const stop = startRefreshReplayCleanup(cleanup);
    await vi.advanceTimersByTimeAsync(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it("does not overlap and recovers after errors without logging error payloads", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const cleanup = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      )
      .mockRejectedValueOnce(new Error("sensitive-error-payload"))
      .mockResolvedValue(undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const stop = startRefreshReplayCleanup(cleanup);
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(cleanup).toHaveBeenCalledTimes(1);
      finish();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(log).toHaveBeenCalledWith("Refresh replay cleanup failed");
      expect(log.mock.calls.flat().join(" ")).not.toContain(
        "sensitive-error-payload"
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(cleanup).toHaveBeenCalledTimes(3);
    } finally {
      stop();
    }
  });
});
