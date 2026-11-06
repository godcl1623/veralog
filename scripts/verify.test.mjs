import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runSteps } from "./verify.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeStep = (label, code) => ({
  label,
  command: process.execPath,
  args: ["-e", code],
});

test("a failed child preserves its exit code and prevents the next step", () => {
  const observed = [];
  const code = runSteps(
    [
      nodeStep("fails", "process.exit(17)"),
      nodeStep("must not run", "process.exit(0)"),
    ],
    {},
    (command, args, options) => {
      observed.push(args.at(-1));
      return spawnSync(command, args, { ...options, stdio: "pipe" });
    }
  );
  assert.equal(code, 17);
  assert.deepEqual(observed, ["process.exit(17)"]);
});

test("success requires every child to finish", () => {
  let calls = 0;
  const code = runSteps(
    [nodeStep("first", "process.exit(0)"), nodeStep("last", "process.exit(0)")],
    {},
    (command, args, options) => {
      calls++;
      return spawnSync(command, args, { ...options, stdio: "pipe" });
    }
  );
  assert.equal(code, 0);
  assert.equal(calls, 2);
});

test("an unavailable executable fails without running another step", () => {
  let calls = 0;
  const code = runSteps(
    [
      {
        label: "unavailable",
        command: join(root, "missing-verification-executable"),
        args: [],
      },
      nodeStep("must not run", "process.exit(0)"),
    ],
    {},
    (command, args, options) => {
      calls++;
      return spawnSync(command, args, { ...options, stdio: "pipe" });
    }
  );
  assert.equal(code, 1);
  assert.equal(calls, 1);
});

test("a signal or missing exit status can never report success", () => {
  for (const result of [
    { status: null, signal: "SIGTERM" },
    { status: null },
    { status: 0, error: new Error("synthetic spawn failure") },
  ]) {
    let calls = 0;
    const code = runSteps(
      [nodeStep("interrupted", ""), nodeStep("must not run", "")],
      {},
      () => {
        calls++;
        return result;
      }
    );
    assert.equal(code, 1);
    assert.equal(calls, 1);
  }
});

test("the CLI rejects missing/unsafe targets before any step and never falls back", () => {
  for (const target of [
    undefined,
    "postgres://synthetic:synthetic-private-password@remote.invalid/veralog_test",
    "postgres://localhost/veralog",
  ]) {
    const env = { ...process.env, DATABASE_URL: "synthetic-private-password" };
    delete env.DATABASE_URL_TEST;
    if (target !== undefined) env.DATABASE_URL_TEST = target;
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/verify.mjs")],
      {
        cwd: root,
        env,
        encoding: "utf8",
      }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL_TEST must target local/);
    assert.doesNotMatch(result.stdout, /verify:/);
    assert.doesNotMatch(result.stderr, /synthetic-private-password/);
  }
});

test("the CLI has no skip flags", () => {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify.mjs"), "--skip-db"],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL_TEST: "postgres://localhost/veralog_test",
      },
      encoding: "utf8",
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not accept arguments/);
  assert.doesNotMatch(result.stdout, /verify:/);
});
