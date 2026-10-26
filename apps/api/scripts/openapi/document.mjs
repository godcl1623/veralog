import { OpenAPIHono } from "@hono/zod-openapi";
import { format } from "prettier";

import { authRoutes } from "../../src/routes/v1/auth/contract.ts";

export function createDocument() {
  const app = new OpenAPIHono();
  const names = new Set();
  const paths = new Set();
  for (const route of authRoutes) {
    const path = `/api/v1/auth${route.path}`;
    const identity = `${route.method} ${path}`;
    if (names.has(route.operationId) || paths.has(identity)) {
      throw new Error(`Duplicate operation: ${identity}`);
    }
    names.add(route.operationId);
    paths.add(identity);
    app.openAPIRegistry.registerPath({ ...route, path });
  }
  for (const [name, cookie] of [
    ["AccessCookie", "access_token"],
    ["RefreshCookie", "refresh_token"],
    ["CsrfCookie", "csrf_token"],
  ]) {
    app.openAPIRegistry.registerComponent("securitySchemes", name, {
      type: "apiKey",
      in: "cookie",
      name: cookie,
    });
  }
  app.openAPIRegistry.registerComponent("securitySchemes", "CsrfHeader", {
    type: "apiKey",
    in: "header",
    name: "X-CSRF-Token",
    description:
      "Must equal the signed csrf_token cookie and be bound to the session and Refresh token. Scheme presence alone cannot express these checks.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Fallback only when access_token cookie is absent.",
  });
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Veralog API", version: "1.0.0" },
  });
}

export async function serializeDocument() {
  // Stable object keys, without reordering meaningful parameter/security arrays.
  const json = JSON.stringify(
    createDocument(),
    (_key, value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        );
      }
      return value;
    },
    2
  );
  // Use the workspace's existing formatter so regeneration matches review checks.
  return format(json, {
    parser: "json",
    printWidth: 80,
    tabWidth: 2,
    useTabs: false,
  });
}
