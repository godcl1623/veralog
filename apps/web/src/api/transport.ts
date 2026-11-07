import type { UseMutationOptions } from "@tanstack/react-query";
import type { AxiosError, AxiosRequestConfig } from "axios";
import axios, { AxiosHeaders } from "axios";

export const apiClient = axios.create({ withCredentials: true });

function csrfToken(): string | undefined {
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("csrf_token="));
  return entry?.slice("csrf_token=".length);
}

export function apiRequest<T>(
  config: Pick<AxiosRequestConfig, "url" | "method" | "signal">,
  options?: Pick<AxiosRequestConfig, "signal">,
): Promise<T> {
  const headers = new AxiosHeaders();
  // Origin belongs to the browser; CSRF must be read after any cookie rotation.
  if (
    !["GET", "HEAD", "OPTIONS"].includes((config.method ?? "GET").toUpperCase())
  ) {
    const token = csrfToken();
    if (token) headers.set("X-CSRF-Token", token);
    else headers.delete("X-CSRF-Token");
  }
  return apiClient
    .request<T>({
      ...config,
      headers,
      signal: options?.signal ?? config.signal,
      withCredentials: true,
    })
    .then(({ data }) => data);
}

export type ErrorType<TError> = AxiosError<TError>;

// Rotating refresh/logout must never be replayed by a global mutation retry default.
export function authMutationOptions<TData, TError, TVariables, TContext>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationOptions<TData, TError, TVariables, TContext> {
  return { ...options, retry: false };
}
