import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("a fresh API build emits the entry referenced by both start commands", (t) => {
  const output = mkdtempSync(join(tmpdir(), "veralog-api-build-"));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--project",
      join(root, "apps/api/tsconfig.json"),
      "--outDir",
      output,
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(root, "apps/api/package.json"), "utf8")
  );
  for (const name of ["start:dev", "start:prod"]) {
    const entry = manifest.scripts[name].match(/(?:^|\s)dist\/(\S+)$/)?.[1];
    assert.ok(entry, `${name} must reference the API dist directory`);
    const emitted = resolve(output, entry);
    assert.ok(emitted.startsWith(output + "/"));
    assert.ok(
      existsSync(emitted),
      `${name} entry is missing from a fresh build`
    );
  }
});
