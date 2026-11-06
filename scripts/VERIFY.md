# Repository verification

Run from the repository root with Node 24.15.0, pnpm 11.8.0 and dependencies
already installed:

```sh
pnpm verify > /tmp/veralog-verify.log 2>&1
echo exit=$?
```

Provide DATABASE_URL_TEST in the process environment first. The runner never
loads environment files or prints credentials. It accepts only postgres or
postgresql URLs for localhost, 127.0.0.1 or [::1], port 5432, database veralog_test,
without query options or fragments. Omitted ports become explicit 5432 so
PGPORT cannot redirect connections. DATABASE_URL is removed from child processes.

The user has confirmed veralog_test is dedicated to tests. The actual development
DB veralog must not be used. Setup checks current_database(), applies the
checked-in Drizzle migrations, then truncates user_term_agreements, user_devices,
user_oauth_accounts, note_tags, notes, tags, categories, projects, terms and users
with RESTART IDENTITY CASCADE before each API test. CASCADE can affect additional
referencing tables. Test data is not preserved; fixtures recreate it. The runner
never creates a database or invokes db:migrate.

The fixed sequence is package lint, API source/test types, web/shared types,
root script tests, every current API source test, shared tests, shared/API builds
and the web production build. Vite tests/builds use envDir:false. The ordinary
product build keeps its existing environment behavior. The runner never installs
dependencies, fixes sources or accepts skip flags. A failed command prevents
later steps and preserves a nonzero exit code.

Shared currently has no test files and retains the previously approved
passWithNoTests behavior; a zero count is reported explicitly. Web has no
functional test files or test:api script at this develop stage. It is type checked,
linted and built; no empty web test run is presented as success. This baseline
contains actual API safety and DB sanity tests and must not pass an empty API
suite. Root runner tests exercise real child-process failures and success. A fresh-build
regression compiles the actual API into an empty test output directory and checks
that both existing start commands reference emitted files. That output is removed
after the test; stale build artifacts cannot satisfy the check. Source/test/config
type coverage stays in the separate noEmit type step.

Authentication, OpenAPI and Orval are not yet present on this baseline. Their
feature PRs must add their tests and drift checks as fixed required verify steps
in the same change. The runner does not detect missing scripts and silently skip
them. Worktree script tests will join the existing root test discovery when that
feature is added. Preserve the full checks when reassembling the original branch.

Tests and builds do not prove browser cookies, real OAuth, multiple API processes,
production DB behavior or deployment. Record the actual tested HEAD, exit code
and counts in the ticket handoff. Build outputs use normal ignored paths; no
extra temporary repository or recovery script is created.
