# Worktree local files

`pnpm prepare` retains Husky and sets the repository-local `core.hooksPath` to
the main worktree's absolute `.husky/_` directory. Run prepare in the main
worktree first. New worktrees can then run `post-checkout` before dependencies
are installed. Existing pre-commit hooks still run in the active worktree.
Moving the main checkout requires running prepare again. Keep it available
while linked worktrees are in use. `HUSKY=0` continues to disable hook setup.

On `git worktree add`, the hook reads `scripts/worktree-files.json` from the main
checkout. `copy` entries become independent files; `symlink` entries point to the
main checkout, so edits through those links affect the main checkout too. The
default copies `AGENTS.md` and `.codex/docs`. Only those paths and descendants of
`.codex/docs` are allowed. Source links are not followed. Environment files,
dependencies and other agent state are excluded. Dependencies need their own
installation and approval; this hook never installs them.

Missing sources are skipped. Existing destinations, including links, are left
untouched; an existing directory is not merged or refreshed. Ordinary branch
switches do not run initialization. Local document changes are not merged by Git
and must be reconciled explicitly when a ticket finishes. Files remain ignored.
Hook failures return nonzero, but Git may already have created the worktree.
Inspect it before retrying; do not repeat `worktree add` blindly.

For an existing worktree, run from that worktree using the main checkout's script:

```sh
node /path/to/main-checkout/scripts/worktree-setup.mjs --copy
```

`--copy` copies both lists and never replaces an existing target. It is intended
for a fresh existing worktree. If links already exist, inspect and remove only
the intended links before using it; the script does not delete them.

Run the isolated integration checks from the main checkout:

```sh
node --test scripts/worktree-setup.test.mjs
```

These use temporary Git repositories and the installed Husky wrappers. They
exercise real worktree creation without an application server or database.
Git's hook invocation rules: <https://git-scm.com/docs/githooks#_post_checkout>.
