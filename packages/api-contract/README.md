# Veralog API contract

`openapi.json` is the generated OpenAPI 3.1.0 document for the four implemented
authentication endpoints. Commit it alongside changes to its source contracts.
Do not edit this JSON by hand.

The source is `apps/api/src/routes/v1/auth/contract.ts`. The API registers these
same definitions with its existing handlers. Its offline exporter imports only
the pure contracts, without the application router, database, OAuth environment
or server entrypoint. This private workspace package has no runtime dependencies
or build step. `apps/web` will consume this document through Orval in VERALOG-12;
it does not import the API server. Orval and Turbo task/cache wiring are not yet
implemented.

## Update and verify

Use Node 24.12 or newer in the Node 24 line (verified on 24.15.0), pnpm 11.8.0,
and the installed workspace dependencies. Run from the repository root:

```sh
pnpm --config.verify-deps-before-run=false --filter @veralog/api openapi:generate
pnpm --config.verify-deps-before-run=false --filter @veralog/api openapi:check
pnpm --config.verify-deps-before-run=false --filter @veralog/api test:openapi
pnpm --config.verify-deps-before-run=false --filter @veralog/api exec tsc --noEmit
```

The per-command pnpm option prevents its automatic pre-run install; it does not
skip these checks. Dependencies must already be installed. It is useful after
the lockfile-only workspace update when pnpm's installed metadata is older than
the manifests. No global pnpm settings are changed.

Generation writes only this package's `openapi.json`, using a path relative to
the exporter file. Check never rewrites the document and exits nonzero if it is
missing or stale. Node strips the pure contract's erasable TypeScript syntax;
it does not read TypeScript aliases or type-check. `tsc --noEmit` checks types
separately. No `.env` file is needed or loaded.

The Node tests cover the exact operation inventory, local references, unique
identities, null-only success, empty errors, redirects, raw request metadata,
registration correspondence, stable generation and stale detection. A guarded
subprocess rejects application imports, environment loading and network/listen
attempts. Static registration and synthetic handler checks do not execute the
real database authentication flow. They are not a full OpenAPI standards
validator or a browser/OAuth integration test. Standard parse/client-generation
verification follows in VERALOG-12.

Do not run the API's default Vitest command as a substitute: its global setup
migrates the test DB and its setup truncates tables. Those effects need their own
authorized validation scope. HTTP cookie precedence and signed CSRF equality
are described in the document; OpenAPI security requirements alone cannot
enforce them.
