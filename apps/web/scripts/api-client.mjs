import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "orval";

import { createApiConfig } from "../orval.config.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "../..");
const output = join(web, "src/api/generated");
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === "--check")) {
  throw new Error("Usage: node scripts/api-client.mjs [--check]");
}
const check = args[0] === "--check";

function inventory(dir, prefix = "") {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink())
        throw new Error("Generated files must not be symlinks");
      return entry.isDirectory()
        ? Object.entries(inventory(join(dir, entry.name), name + "/"))
        : [[name, readFileSync(join(dir, entry.name), "utf8")]];
    }),
  );
}

mkdirSync(dirname(output), { recursive: true });
const temp = mkdtempSync(join(dirname(output), ".orval-"));
try {
  await generate(createApiConfig(temp).auth, web, { throwOnError: true });
  const paths = Object.keys(inventory(temp))
    .sort()
    .map((p) => join(temp, p));
  if (!paths.length) throw new Error("Orval produced no files");
  execFileSync(
    process.execPath,
    [join(repo, "node_modules/eslint/bin/eslint.js"), "--fix", ...paths],
    { cwd: repo, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [join(repo, "node_modules/prettier/bin/prettier.cjs"), "--write", ...paths],
    { cwd: repo, stdio: "inherit" },
  );
  const expected = inventory(temp);
  const actual = inventory(output);
  const changes = [
    ...new Set([...Object.keys(expected), ...Object.keys(actual)]),
  ]
    .filter((p) => expected[p] !== actual[p])
    .sort();
  if (check) {
    if (changes.length) {
      console.error("API client is stale: " + changes.join(", "));
      process.exitCode = 1;
    } else console.log("API client matches the common OpenAPI document.");
  } else if (changes.length) {
    // Parsing and formatting finish before the owned generated tree is replaced.
    rmSync(output, { recursive: true, force: true });
    cpSync(temp, output, { recursive: true });
    console.log("Updated generated API client.");
  } else console.log("Generated API client unchanged.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
