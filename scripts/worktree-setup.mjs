import { execFileSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const source = dirname(
  git("rev-parse", "--path-format=absolute", "--git-common-dir")
);
const target = git("rev-parse", "--show-toplevel");
const args = process.argv.slice(2);

function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function validate(path) {
  if (
    typeof path !== "string" ||
    !path ||
    isAbsolute(path) ||
    path
      .split(/[\\/]/)
      .some(
        (part) =>
          !part ||
          part === ".." ||
          part === "." ||
          part.startsWith(".env") ||
          [".git", "node_modules"].includes(part)
      ) ||
    !(
      path === "AGENTS.md" ||
      path === ".codex/docs" ||
      path.startsWith(".codex/docs/")
    )
  ) {
    throw new Error(`Disallowed worktree path: ${path}`);
  }
}

function copyMissing(from, to) {
  if (present(to)) return;
  const stat = lstatSync(from);
  // Do not follow links into private state or files outside the allowlist.
  if (stat.isSymbolicLink())
    throw new Error(`Source link cannot be copied: ${from}`);
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      validate(relative(source, join(from, entry)));
      copyMissing(join(from, entry), join(to, entry));
    }
  } else if (stat.isFile()) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to, constants.COPYFILE_EXCL);
  } else {
    throw new Error(`Unsupported source file: ${from}`);
  }
}

if (args[0] === "--install-hook") {
  if (process.env.HUSKY !== "0") {
    const hooks = join(source, ".husky", "_");
    if (!existsSync(join(hooks, "h")))
      throw new Error("Run prepare in the main worktree first.");
    git("config", "--local", "core.hooksPath", hooks);
    console.log("worktree-setup: shared Husky hook path configured");
  }
} else if (
  target !== source &&
  (args[0] === "--copy" || (/^0+$/.test(args[0] ?? "") && args[2] === "1"))
) {
  const config = JSON.parse(
    readFileSync(new URL("worktree-files.json", import.meta.url), "utf8")
  );
  for (const mode of ["copy", "symlink"]) {
    for (const path of config[mode]) {
      validate(path);
      const from = resolve(source, path);
      const to = resolve(target, path);
      if (present(to) || !present(from)) continue;
      // Refuse an existing linked parent that could redirect writes elsewhere.
      for (
        let parent = dirname(to);
        parent !== target;
        parent = dirname(parent)
      ) {
        if (present(parent) && lstatSync(parent).isSymbolicLink()) {
          throw new Error(`Destination parent is a link: ${parent}`);
        }
      }
      if (mode === "copy" || args[0] === "--copy") copyMissing(from, to);
      else {
        if (lstatSync(from).isSymbolicLink())
          throw new Error(`Source is a link: ${from}`);
        mkdirSync(dirname(to), { recursive: true });
        symlinkSync(from, to, lstatSync(from).isDirectory() ? "dir" : "file");
      }
      console.log(
        `worktree-setup: ${args[0] === "--copy" ? "copy" : mode} ${path}`
      );
    }
  }
} else if (args[0]?.startsWith("--")) {
  throw new Error(`Unsupported argument or main-worktree target: ${args[0]}`);
}
