import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), "veralog worktree-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const main = join(temp, "main");
  const wt = join(temp, "linked");
  mkdirSync(main);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    HUSKY: "1",
  };
  for (const name of Object.keys(env)) {
    if (
      /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(
        name
      )
    )
      delete env[name];
  }
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const put = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  for (const path of [
    "scripts/worktree-setup.mjs",
    "scripts/worktree-files.json",
    ".husky/post-checkout",
  ]) {
    put(join(main, path), readFileSync(join(root, path)));
  }
  put(join(main, ".gitignore"), "AGENTS.md\n.codex\n.husky/_\n");
  put(join(main, "AGENTS.md"), "local instructions\n");
  put(join(main, ".codex/docs/principles/rules.md"), "rules\n");
  put(join(main, ".codex/private-state"), "must stay local\n");
  git(main, "init", "-q");
  git(main, "config", "user.name", "Worktree Test");
  git(main, "config", "user.email", "worktree-test@example.invalid");
  git(main, "add", ".");
  git(main, "commit", "-qm", "fixture");
  for (const path of ["h", "post-checkout", "pre-commit"]) {
    const target = join(main, ".husky/_", path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, ".husky/_", path), target);
  }
  execFileSync(
    process.execPath,
    [join(main, "scripts/worktree-setup.mjs"), "--install-hook"],
    { cwd: main, env }
  );
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [join(main, "scripts/worktree-setup.mjs"), ...args],
      { cwd: wt, env, encoding: "utf8" }
    );
  return { main, wt, git, put, run, env };
}

test("actual worktree add copies local docs without dependencies; hooks and edits survive", (t) => {
  const f = fixture(t);
  f.git(f.main, "worktree", "add", "-qb", "ticket", f.wt);
  assert.equal(
    readFileSync(join(f.wt, "AGENTS.md"), "utf8"),
    "local instructions\n"
  );
  assert.equal(lstatSync(join(f.wt, "AGENTS.md")).isSymbolicLink(), false);
  assert.equal(
    readFileSync(join(f.wt, ".codex/docs/principles/rules.md"), "utf8"),
    "rules\n"
  );
  assert.equal(existsSync(join(f.wt, ".codex/private-state")), false);
  assert.equal(existsSync(join(f.wt, "node_modules")), false);
  f.put(join(f.wt, "AGENTS.md"), "worktree edit\n");
  assert.equal(f.run("--copy").status, 0);
  f.git(f.wt, "switch", "-qc", "other");
  assert.equal(
    readFileSync(join(f.wt, "AGENTS.md"), "utf8"),
    "worktree edit\n"
  );
  assert.equal(
    readFileSync(join(f.main, "AGENTS.md"), "utf8"),
    "local instructions\n"
  );
  f.put(join(f.main, ".husky/pre-commit"), "printf checked > hook-observed\n");
  f.git(f.wt, "commit", "--allow-empty", "-qm", "check hooks");
  assert.equal(readFileSync(join(f.wt, "hook-observed"), "utf8"), "checked");
});

test("configured symlinks work, and --copy overrides link mode", (t) => {
  const f = fixture(t);
  f.put(
    join(f.main, "scripts/worktree-files.json"),
    JSON.stringify({ copy: [], symlink: ["AGENTS.md", ".codex/docs"] })
  );
  f.git(f.main, "worktree", "add", "-qb", "ticket", f.wt);
  assert.equal(lstatSync(join(f.wt, "AGENTS.md")).isSymbolicLink(), true);
  assert.equal(
    realpathSync(join(f.wt, ".codex/docs")),
    realpathSync(join(f.main, ".codex/docs"))
  );
  const second = join(dirname(f.wt), "copy-only");
  f.git(f.main, "worktree", "add", "--no-checkout", "-qb", "copy-only", second);
  const run = spawnSync(
    process.execPath,
    [join(f.main, "scripts/worktree-setup.mjs"), "--copy"],
    { cwd: second, env: f.env, encoding: "utf8" }
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(lstatSync(join(second, "AGENTS.md")).isSymbolicLink(), false);
});

test("unsafe paths and redirected destinations fail instead of copying", (t) => {
  const f = fixture(t);
  f.git(f.main, "worktree", "add", "--no-checkout", "-qb", "ticket", f.wt);
  for (const path of [
    "../escape",
    ".env",
    ".codex",
    ".codex/private-state",
    "node_modules",
    ".codex/docs/.env.private",
  ]) {
    f.put(
      join(f.main, "scripts/worktree-files.json"),
      JSON.stringify({ copy: [path], symlink: [] })
    );
    const run = f.run("--copy");
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Disallowed worktree path/);
  }
  f.put(
    join(f.main, "scripts/worktree-files.json"),
    JSON.stringify({ copy: [".codex/docs"], symlink: [] })
  );
  const redirected = join(dirname(f.wt), "redirected");
  mkdirSync(redirected);
  symlinkSync(redirected, join(f.wt, ".codex"), "dir");
  f.put(join(f.main, ".codex/docs/other.md"), "source\n");
  f.put(
    join(f.main, "scripts/worktree-files.json"),
    JSON.stringify({ copy: [".codex/docs/other.md"], symlink: [] })
  );
  const redirectedRun = f.run("--copy");
  assert.notEqual(redirectedRun.status, 0);
  assert.match(redirectedRun.stderr, /Destination parent is a link/);
  assert.equal(existsSync(join(redirected, "docs/other.md")), false);
  // A copied source symlink must also fail before its target is read.
  symlinkSync(join(f.main, "AGENTS.md"), join(f.main, ".codex/docs/linked.md"));
  rmSync(join(f.wt, ".codex"));
  f.put(
    join(f.main, "scripts/worktree-files.json"),
    JSON.stringify({ copy: [".codex/docs/linked.md"], symlink: [] })
  );
  assert.match(f.run("--copy").stderr, /Source link cannot be copied/);
});
