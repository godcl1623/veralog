# Generated authentication client

The API owns the source routes and produces `packages/api-contract/openapi.json`.
Orval in this web package consumes that file, never the API server. Wire DTOs
come from the generated models; do not duplicate them in `packages/shared` or
import its Node environment utilities into the browser.

Run from the repository root with Node 24.15.0 and pnpm 11.8.0:

```sh
pnpm --config.verify-deps-before-run=false --filter @veralog/web api:generate
pnpm --config.verify-deps-before-run=false --filter @veralog/web api:check
pnpm --config.verify-deps-before-run=false --filter @veralog/web test:api
pnpm --config.verify-deps-before-run=false --filter @veralog/web test:api-generation
pnpm --config.verify-deps-before-run=false --filter @veralog/web exec tsc -b
pnpm --config.verify-deps-before-run=false --filter @veralog/web lint
```

The pnpm option prevents implicit installation; dependencies must already be
installed. Orval is declared as `^8.45.0`; the lockfile records the tested
resolution. Updates require regenerating, reviewing and verifying the outputs.
After at least one month without relevant problems, review an exact pin using
the recorded observation period, actual versions and outstanding issues. A
calendar date alone does not trigger a pin. Major version 9 is outside this range.

`api:generate` parses and validates the local specification, denies external
references, generates into a temporary sibling directory, then applies the
existing ESLint and Prettier rules. Only after success does it replace the owned
`generated/` tree. It never edits `transport.ts`. Commit the common contract,
configuration, transport, generated code and corresponding tests together when
their contracts change. `api:check` compares regenerated file names and bytes
without changing the committed tree. Both commands temporarily write a sibling
directory and clean it up. Do not put handwritten files inside `generated/`.

Only the current AuthSession operations are generated: refresh and logout.
They return the complete `{ data: null }` envelope. OAuth is browser navigation,
not a generated query. No general protected GET API exists yet.

`transport.ts` uses the existing Axios dependency with credentials, reads the
latest readable `csrf_token` cookie for each unsafe request, and preserves HTTP
errors including empty 401/403 responses. It never reads Access/Refresh cookies,
stores tokens, or sets Origin manually. Current requests have no body and the
mutator intentionally accepts only URL, method and signal. Mutation options
disable retries even when the app has a global retry default. Raw calls also
perform one request; cancellation and network failures are propagated.

URLs already include `/api/v1`; do not prepend another `/api`. Development and
production are intended to expose the API through the frontend's same-origin
`/api` proxy. Proxy/HTTPS/certificate deployment and browser cookie verification
are separate work. This change does not relax Secure/SameSite/host-only settings
or the API's Origin/CSRF validation, and it does not configure a deployment.

The isolated Node Vitest config sets `envDir: false`, has no DB setup and uses a
test Axios adapter. It proves the generated functions' request behavior, not
real cookie storage/CORS or backend session behavior. The generation test uses
temporary repository copies to prove stale detection and preservation on parse
failure. No real API/DB/OAuth requests are made.

Automatic refresh, concurrent refresh coordination, logout races, multiple tabs,
QueryClient/provider defaults and the representative MSW/consumer flow still
need the remaining VERALOG-12/13 decisions and checks. Do not treat these
generated hooks as a completed login flow.
