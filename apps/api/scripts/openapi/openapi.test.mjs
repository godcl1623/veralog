import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { OpenAPIHono } from "@hono/zod-openapi";
import ts from "typescript";

import { authRoutes, logoutRoute } from "../../src/routes/v1/auth/contract.ts";
import { createDocument, serializeDocument } from "./document.mjs";
import { checkDocument, outputPath } from "./export-openapi.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const expected = [
  ["get", "/api/v1/auth/google", "authGoogleStart"],
  ["get", "/api/v1/auth/google/callback", "authGoogleCallback"],
  ["post", "/api/v1/auth/refresh", "authRefresh"],
  ["delete", "/api/v1/auth/logout", "authLogout"],
];

test("only the four implemented operations have stable unique identities", () => {
  const doc = createDocument();
  assert.equal(doc.openapi, "3.1.0");
  const actual = Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => [
      method,
      path,
      operation.operationId,
    ])
  );
  assert.deepEqual(actual.sort(), [...expected].sort());
  assert.equal(new Set(actual.map((entry) => entry[2])).size, 4);
  assert.deepEqual(Object.keys(doc.components.schemas), ["AuthEmptyResponse"]);
  assert.deepEqual(doc.components.schemas.AuthEmptyResponse.properties.data, {
    type: "null",
  });
  assert.deepEqual(doc.components.schemas.AuthEmptyResponse.required, ["data"]);
  for (const route of authRoutes) assert.equal(route.request, undefined);
});

test("all local schema references and security schemes resolve", () => {
  const doc = createDocument();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith("#/"));
      let target = doc;
      for (const segment of value.$ref.slice(2).split("/")) {
        target = target?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
      }
      assert.ok(target, value.$ref);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(doc);
  for (const [method, path] of expected) {
    for (const requirement of doc.paths[path][method].security) {
      for (const name of Object.keys(requirement))
        assert.ok(doc.components.securitySchemes[name], name);
    }
  }
});

test("JSON sessions, empty failures and navigation responses remain distinct", () => {
  const doc = createDocument();
  for (const [method, path] of expected.slice(2)) {
    const op = doc.paths[path][method];
    assert.equal(op.requestBody, undefined);
    assert.equal(
      op.responses[200].content["application/json"].schema.$ref,
      "#/components/schemas/AuthEmptyResponse"
    );
    for (const status of [401, 403])
      assert.equal(op.responses[status].content, undefined);
    assert.ok(
      op.parameters.some(
        (p) => p.in === "header" && p.name === "Origin" && p.required
      )
    );
    assert.ok(
      op.security.every(
        (s) => "RefreshCookie" in s && "CsrfCookie" in s && "CsrfHeader" in s
      )
    );
  }
  assert.equal(doc.paths["/api/v1/auth/logout"].delete.security.length, 2);
  for (const [method, path] of expected.slice(0, 2)) {
    const response = doc.paths[path][method].responses[302];
    assert.equal(response.content, undefined);
    assert.ok(response.headers.Location);
  }
  for (const status of [400, 502, 500])
    assert.equal(
      doc.paths["/api/v1/auth/google"].get.responses[status].content,
      undefined
    );
});

test("duplicate definitions fail before registry overwrites them", () => {
  authRoutes.push(authRoutes[0]);
  try {
    assert.throws(createDocument, /Duplicate operation/);
  } finally {
    authRoutes.pop();
  }
});

test("raw metadata introduces no request validators and runtime middleware keeps order", async () => {
  const app = new OpenAPIHono();
  const calls = [];
  app.openapi(
    {
      ...logoutRoute,
      middleware: [
        async (_ctx, next) => {
          calls.push("access");
          await next();
        },
      ],
    },
    (ctx) => {
      calls.push("handler");
      return ctx.body(null, 403);
    }
  );
  const response = await app.request("http://localhost/logout", {
    method: "DELETE",
    body: "not-json",
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "");
  assert.deepEqual(calls, ["access", "handler"]);
});

test("actual route registrations reference the shared definitions", async () => {
  const expectations = {
    "index.ts": ["googleStartRoute", "googleCallbackRoute"],
    "refresh.ts": ["refreshRoute"],
    "logout.ts": ["logoutRoute"],
  };
  for (const [file, identifiers] of Object.entries(expectations)) {
    const source = await readFile(
      new URL(`../../src/routes/v1/auth/${file}`, import.meta.url),
      "utf8"
    );
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const registrations = [];
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const owner = node.expression.expression.getText(ast);
        if (!["auth", "refreshRouter", "logoutRouter"].includes(owner)) {
          ts.forEachChild(node, visit);
          return;
        }
        const method = node.expression.name.text;
        if (
          ["get", "post", "delete", "put", "patch"].includes(method) &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          assert.fail(`Unexpected separate path registration in ${file}`);
        }
        if (method === "openapi") {
          const first = node.arguments[0];
          if (ts.isIdentifier(first)) registrations.push(first.text);
          else {
            assert.equal(file, "logout.ts");
            assert.ok(ts.isObjectLiteralExpression(first));
            const spread = first.properties.find(ts.isSpreadAssignment);
            assert.equal(spread.expression.getText(ast), "logoutRoute");
            const middleware = first.properties.find(
              (p) =>
                ts.isPropertyAssignment(p) &&
                p.name.getText(ast) === "middleware"
            );
            assert.equal(middleware.initializer.getText(ast), "authMiddleware");
            registrations.push("logoutRoute");
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.deepEqual(registrations, identifiers);
  }
  const entry = await readFile(
    new URL("../../src/index.ts", import.meta.url),
    "utf8"
  );
  const v1 = await readFile(
    new URL("../../src/routes/v1/index.ts", import.meta.url),
    "utf8"
  );
  assert.match(entry, /app\.route\("\/api\/v1", v1\)/);
  assert.match(v1, /v1\.route\("\/auth", auth\)/);
});

test("stable serialization, missing/stale detection and check without writes", async () => {
  assert.equal(await serializeDocument(), await serializeDocument());
  const temp = await mkdtemp(join(tmpdir(), "veralog-openapi-"));
  const path = join(temp, "openapi.json");
  try {
    await assert.rejects(checkDocument(path), { code: "ENOENT" });
    await writeFile(path, await serializeDocument());
    assert.equal(await checkDocument(path), true);
    await writeFile(path, "{}\n");
    assert.equal(await checkDocument(path), false);
    assert.equal(await readFile(path, "utf8"), "{}\n");
    const canonical = await readFile(outputPath, "utf8");
    const child = spawnSync(
      process.execPath,
      [join(directory, "export-openapi.mjs"), "--check"],
      { cwd: temp, env: {}, encoding: "utf8" }
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(await readFile(outputPath, "utf8"), canonical);
    const staleRead = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const original = fs.readFile;
      fs.readFile = (path, ...args) => String(path) === ${JSON.stringify(outputPath)}
        ? Promise.resolve('{}\\n') : original(path, ...args);
      syncBuiltinESMExports();
    `;
    const stale = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(staleRead)}`,
        join(directory, "export-openapi.mjs"),
        "--check",
      ],
      { cwd: temp, env: {}, encoding: "utf8" }
    );
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /OpenAPI spec is stale/);
    assert.equal(await readFile(outputPath, "utf8"), canonical);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("offline export imports no application environment, DB or server modules", () => {
  const guard = `
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
    import fs from 'node:fs'; import fsp from 'node:fs/promises';
    const deny = () => { throw new Error('Forbidden external side effect'); };
    process.loadEnvFile = deny; globalThis.fetch = deny;
    net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny;
    http.request = deny; http.get = deny; https.request = deny; https.get = deny;
    for (const [object, methods] of [[fs, ['readFileSync', 'readFile']], [fsp, ['readFile']]]) {
      for (const name of methods) {
        const original = object[name];
        object[name] = function(path, ...args) {
          if (/(?:^|[/\\\\])\\.env(?:[./]|$)/.test(String(path))) deny();
          return original.call(this, path, ...args);
        };
      }
    }
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, next) {
      const result = next(specifier, context);
      if ((result.url.includes('/src/') && !result.url.includes('/node_modules/') && !result.url.endsWith('/auth/contract.ts')) || /\\.env(?:[./]|$)/.test(result.url)) throw new Error('Forbidden application import: ' + result.url);
      return result;
    } });
  `;
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(guard)}`,
      join(directory, "export-openapi.mjs"),
      "--check",
    ],
    { env: {}, encoding: "utf8", timeout: 15000 }
  );
  assert.equal(child.status, 0, child.stderr);
  for (const expression of [
    "process.loadEnvFile('.env')",
    "(await import('node:fs')).readFileSync('.env')",
    "(await import('node:net')).connect(5432)",
    "(await import('node:net')).createServer().listen(0)",
    "await fetch('https://example.invalid')",
  ]) {
    const denied = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(guard)}`,
        "--input-type=module",
        "-e",
        expression,
      ],
      { env: {}, encoding: "utf8", timeout: 15000 }
    );
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /Forbidden external side effect/);
  }
});
