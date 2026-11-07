import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "../..");

test("isolated generation detects drift and preserves output on parse failure", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "veralog-client-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const target = join(fixture, "apps/web");
  const put = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  for (const path of [
    "package.json",
    "eslint.config.js",
    "packages/api-contract/openapi.json",
    "apps/web/package.json",
    "apps/web/tsconfig.json",
    "apps/web/tsconfig.app.json",
    "apps/web/tsconfig.node.json",
    "tsconfig.base.json",
    "apps/web/orval.config.mjs",
    "apps/web/scripts/api-client.mjs",
    "apps/web/src/api/transport.ts",
  ])
    put(join(fixture, path), readFileSync(join(repo, path)));
  symlinkSync(join(repo, "node_modules"), join(fixture, "node_modules"), "dir");
  symlinkSync(join(web, "node_modules"), join(target, "node_modules"), "dir");
  cpSync(join(web, "src/api/generated"), join(target, "src/api/generated"), {
    recursive: true,
  });
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/api-client.mjs", ...args], {
      cwd: target,
      encoding: "utf8",
      timeout: 30000,
      env: { PATH: process.env.PATH, NO_COLOR: "1" },
    });
  let result = run("--check");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const model = join(target, "src/api/generated/models/authEmptyResponse.ts");
  const original = readFileSync(model, "utf8");
  assert.match(original, /data: null;/);
  const stale = original.replace("data: null;", "data: string;");
  writeFileSync(model, stale);
  result = run("--check");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /API client is stale/);
  assert.equal(readFileSync(model, "utf8"), stale);
  result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(model, "utf8"), original);
  const auth = join(target, "src/api/generated/auth.ts");
  const before = readFileSync(auth, "utf8");
  assert.deepEqual(
    [...before.matchAll(/export const (auth\w+) =/g)].map((m) => m[1]).sort(),
    ["authLogout", "authRefresh"],
  );
  assert.doesNotMatch(before, /authGoogle|Origin:/);
  put(join(fixture, "packages/api-contract/openapi.json"), "{ invalid");
  result = run();
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(auth, "utf8"), before);
  assert.equal(readFileSync(model, "utf8"), original);
});
