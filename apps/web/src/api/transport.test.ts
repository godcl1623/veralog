import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import axios, { AxiosError, AxiosHeaders } from "axios";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  authLogout,
  authRefresh,
  getAuthRefreshMutationOptions,
} from "./generated/auth";
import { apiClient } from "./transport";

let requests: InternalAxiosRequestConfig[];
const originalAdapter = apiClient.defaults.adapter;
let adapter: AxiosAdapter;

beforeEach(() => {
  requests = [];
  vi.stubGlobal("document", { cookie: "csrf_token=first; other=value" });
  adapter = async (config) => {
    requests.push(config);
    return {
      data: { data: null },
      status: 200,
      statusText: "OK",
      headers: new AxiosHeaders(),
      config,
    };
  };
  apiClient.defaults.adapter = (config) => adapter(config);
});

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
  vi.unstubAllGlobals();
});

describe("generated authentication transport", () => {
  it("uses the exact null-only envelope and never retries a failed mutation", async () => {
    expectTypeOf<Awaited<ReturnType<typeof authRefresh>>>().toEqualTypeOf<{
      data: null;
    }>();
    adapter = async (config) => {
      requests.push(config);
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
    };
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: 3 } },
    });
    try {
      const observer = new MutationObserver(
        client,
        getAuthRefreshMutationOptions(),
      );
      await expect(observer.mutate()).rejects.toMatchObject({
        code: AxiosError.ERR_NETWORK,
      });
      expect(requests).toHaveLength(1);
    } finally {
      client.clear();
    }
  });

  it("sends the two real mutations with credentials, no body, and the latest CSRF", async () => {
    expect(await authRefresh()).toEqual({ data: null });
    vi.stubGlobal("document", { cookie: "csrf_token=rotated" });
    expect(await authLogout()).toEqual({ data: null });
    expect(
      requests.map((r) => [r.method, r.url, r.withCredentials, r.data]),
    ).toEqual([
      ["post", "/api/v1/auth/refresh", true, undefined],
      ["delete", "/api/v1/auth/logout", true, undefined],
    ]);
    expect(requests.map((r) => r.headers.get("X-CSRF-Token"))).toEqual([
      "first",
      "rotated",
    ]);
    expect(
      requests.every(
        (r) => !r.headers.has("Origin") && !r.headers.has("Authorization"),
      ),
    ).toBe(true);
  });

  it("does not retain the previous CSRF after cookie removal", async () => {
    await authRefresh();
    vi.stubGlobal("document", { cookie: "" });
    await authRefresh();
    expect(requests[1].headers.has("X-CSRF-Token")).toBe(false);
  });

  it.each([401, 403])(
    "preserves an empty %s as an HTTP error without retry",
    async (status) => {
      adapter = async (config) => {
        requests.push(config);
        throw new AxiosError(
          "HTTP failure",
          AxiosError.ERR_BAD_REQUEST,
          config,
          undefined,
          {
            data: "",
            status,
            statusText: "Rejected",
            headers: new AxiosHeaders(),
            config,
          },
        );
      };
      await expect(authRefresh()).rejects.toMatchObject({
        response: { status, data: "" },
      });
      expect(requests).toHaveLength(1);
    },
  );

  it("propagates network failure and cancellation without re-sending", async () => {
    adapter = async (config) => {
      requests.push(config);
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
    };
    await expect(authRefresh()).rejects.toMatchObject({
      code: AxiosError.ERR_NETWORK,
    });
    expect(requests).toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    await expect(authLogout({ signal: controller.signal })).rejects.toSatisfy(
      axios.isCancel,
    );
    expect(requests).toHaveLength(1);
  });

  it("forwards the signal through generated options and disables mutation retries by default", async () => {
    const controller = new AbortController();
    await authRefresh({ signal: controller.signal });
    expect(requests[0].signal).toBe(controller.signal);
    const options = getAuthRefreshMutationOptions({ mutation: { retry: 3 } });
    expect(options.retry).toBe(false);
    expect(options.mutationFn).toBeTypeOf("function");
  });
});
