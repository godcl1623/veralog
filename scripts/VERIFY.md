# Repository verification

Run from the repository root with Node 24.15.0, pnpm 11.8.0 and dependencies
already installed:

```sh
pnpm verify > /tmp/veralog-verify.log 2>&1
echo exit=$?
```

The final exit line belongs to pnpm, not to a pipe or a log-reading command.
The runner stops at the first failure and preserves its nonzero exit code.
There are no skip flags, implicit dependency installations or automatic fixes.

Provide DATABASE_URL_TEST in the process environment before running. The runner
does not load environment files or print credentials. It accepts only postgres
or postgresql URLs targeting localhost, 127.0.0.1 or [::1], port 5432 (including
the default port), database veralog_test, without URL query options/fragments.
It removes DATABASE_URL from child environments. Missing/invalid input fails
before any verification step. It never creates a database or runs db:migrate.

The user has confirmed veralog_test is dedicated to tests; veralog is the actual
development database and must not be used. API setup verifies current_database()
before applying the checked-in Drizzle migrations. Each API test then truncates
user_term_agreements, user_devices, user_oauth_accounts, note_tags, notes, tags,
categories, projects, terms and users with RESTART IDENTITY CASCADE. CASCADE may
affect other referencing tables. Existing test data is not preserved; fixtures
are recreated by tests. No real Google OAuth or production keys are required.

The runner executes package lint, API/web/shared type checks, root script tests,
all API source tests, shared tests, web transport/provider tests, OpenAPI tests
and drift check, Orval drift and failure regression, then shared/API/web builds.
The API uses synthetic authentication settings and the dedicated test DB module.
The web tests use the existing Node environment; browser/MSW consumer work belongs
to VERALOG-13. Shared currently has no tests and retains its existing
passWithNoTests setting; this is reported explicitly and does not mean tests ran.
Vite tests/builds disable environment-file discovery with envDir:false. The
ordinary product build command retains its existing environment behavior.

Existing generator and worktree regression tests create their own isolated
fixtures and remove them on completion. The runner adds no temporary repository
or recovery script. Build outputs remain in the normal ignored output paths.
Tests and builds do not prove real browser cookies, deployment or DB production
behavior. Record the tested HEAD, command, exit code and actual counts before
claiming completion.
