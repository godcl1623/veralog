import {
  focusManager,
  onlineManager,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAuthLogout, useAuthRefresh } from "./generated/auth";
import { createApiQueryClient } from "./query-client";
import { apiClient } from "./transport";

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe("API query client", () => {
  it("retains inactive data beyond default GC and refreshes only on request", async () => {
    vi.useFakeTimers();
    const client = createApiQueryClient();
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce("original")
      .mockResolvedValue("updated");
    const options = { queryKey: ["cache-policy-fixture"], queryFn };
    client.mount();
    try {
      await client.fetchQuery(options);
      const first = new QueryObserver(client, options);
      const unsubscribe = first.subscribe(() => {});
      unsubscribe();
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      expect(client.getQueryData(options.queryKey)).toBe("original");
      // Even an explicitly stale cache must not refetch merely on remount/focus.
      await client.invalidateQueries({
        queryKey: options.queryKey,
        refetchType: "none",
      });
      const second = new QueryObserver(client, options);
      const stop = second.subscribe(() => {});
      try {
        focusManager.setFocused(false);
        onlineManager.setOnline(false);
        focusManager.setFocused(true);
        onlineManager.setOnline(true);
        await vi.advanceTimersByTimeAsync(60 * 1000);
        expect(second.getCurrentResult().data).toBe("original");
        expect(queryFn).toHaveBeenCalledTimes(1);
        await second.refetch();
        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(second.getCurrentResult().data).toBe("updated");
      } finally {
        stop();
      }
    } finally {
      client.unmount();
      client.clear();
    }
  });

  it("fetches missing data once and does not retry query errors", async () => {
    const client = createApiQueryClient();
    const failure = new Error("policy fixture failure");
    const queryFn = vi.fn().mockRejectedValue(failure);
    try {
      await expect(
        client.fetchQuery({ queryKey: ["failed-fixture"], queryFn }),
      ).rejects.toBe(failure);
      expect(queryFn).toHaveBeenCalledTimes(1);
    } finally {
      client.clear();
    }
  });

  it("renders both generated hooks with a provider without sending requests", () => {
    const client = createApiQueryClient();
    const originalAdapter = apiClient.defaults.adapter;
    const adapter = vi.fn().mockRejectedValue(new Error("unexpected request"));
    apiClient.defaults.adapter = adapter;
    function Consumer() {
      const refresh = useAuthRefresh();
      const logout = useAuthLogout();
      return createElement(
        "output",
        null,
        `${refresh.status}/${logout.status}`,
      );
    }
    try {
      const html = renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, createElement(Consumer)),
      );
      expect(html).toContain("idle/idle");
      expect(adapter).not.toHaveBeenCalled();
    } finally {
      apiClient.defaults.adapter = originalAdapter;
      client.clear();
    }
  });
});
