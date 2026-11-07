import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertTestDatabaseUrl } from "../apps/api/src/test/database-target.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function runSteps(steps, env, run = spawnSync) {
  for (const step of steps) {
    console.log("verify: " + step.label);
    const result = run(step.command, step.args, {
      cwd: step.cwd ?? root,
      env,
      stdio: "inherit",
    });
    if (result.error || result.signal || result.status === null) {
      console.error("Verification could not finish: " + step.label);
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

function verificationSteps() {
  const pnpm = (label, args) => ({
    label,
    command: "pnpm",
    args: ["--config.verify-deps-before-run=false", ...args],
  });
  const api = (label, ...args) =>
    pnpm(label, ["--filter", "@veralog/api", ...args]);
  const web = (label, ...args) =>
    pnpm(label, ["--filter", "@veralog/web", ...args]);
  const shared = (label, ...args) =>
    pnpm(label, ["--filter", "@veralog/shared", ...args]);
  const rootTests = readdirSync(join(root, "scripts"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => join("scripts", name));

  return [
    pnpm("package lint", [
      "exec",
      "eslint",
      "apps/web",
      "apps/api",
      "packages/shared",
    ]),
    shared("shared build", "build"),
    api(
      "API source/test types",
      "exec",
      "tsc",
      "--noEmit",
      "-p",
      "tsconfig.auth-tests.json"
    ),
    web("web types", "exec", "tsc", "-b"),
    api("OpenAPI tests", "test:openapi"),
    api("OpenAPI drift", "openapi:check"),
    shared("shared types", "exec", "tsc", "--noEmit"),
    {
      label: "root script tests",
      command: process.execPath,
      args: ["--test", ...rootTests],
    },
    api(
      "all API tests on veralog_test",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.verify.config.ts"
    ),
    shared("shared tests (currently no test files)", "test"),
    api("API build", "build"),
    {
      label: "web production build without environment files",
      command: process.execPath,
      args: [
        "--input-type=module",
        "-e",
        'import("vite").then(({ build }) => build({ envDir: false }))',
      ],
      cwd: join(root, "apps/web"),
    },
  ];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2) {
      throw new Error("pnpm verify does not accept arguments or skip flags");
    }
    const env = { ...process.env };
    env.DATABASE_URL_TEST = assertTestDatabaseUrl(env.DATABASE_URL_TEST);
    delete env.DATABASE_URL;
    process.exitCode = runSteps(verificationSteps(), env);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Verification failed"
    );
    process.exitCode = 1;
  }
}
