# Refresh replay operation

JWT, per-device sessions and Refresh rotation stay in place. An immediately
previous Refresh may recover the exact Access/Refresh/CSRF result strictly before
10 seconds after rotation. The same result never extends expiry or the deadline.
At/after that boundary the previous token revokes only that device. Older unknown
tokens are rejected without deleting arbitrary sessions. Access may still live
for its remaining 15 minutes. This does not solve every late Set-Cookie race.

## Server keys

Before starting the new API, inject AUTH_REFRESH_REPLAY_ACTIVE_KEY_ID and
AUTH_REFRESH_REPLAY_KEYS on the server. The latter is a JSON array of objects
with id and key fields; each key is a canonical base64-encoded random 32-byte
value, independent of JWT_SECRET. No real keys belong in this repository.
Missing/invalid/duplicate IDs or unknown active IDs fail startup. Tests use
synthetic keys and do not change a real environment file.

To rotate, first deploy readers accepting both old/new keys, then switch the
active writer. Retire the old key only after old writers/in-flight transactions
have drained and their final replay windows have elapsed. Losing a key requires
restoring it; there is no plaintext or JWT-key fallback. Backups retain ciphertext
according to their own retention policy.

## Database and rollout

Apply the additive migration before starting the new binary. Existing hashes and
expiries are preserved, and a valid current token fills the nullable replay data
on its next normal rotation. Rows without trustworthy Refresh expiry remain
unauthorized. Stop/drain old refresh handlers and wait at least 10 seconds before
switching to avoid mixing old immediate-revocation policy with the new policy.
Results minted before that switch cannot be reconstructed.

Cleanup runs at startup and every 60 seconds, clearing expired ciphertext only.
The deadline/previous hash remain for reuse decisions. Downtime/DB errors can
retain ciphertext longer; there is no 10-second physical-deletion guarantee.
Cleanup never deletes device rows or broadens a grace window. Restoring service
uses compatible code/keys and retains additive columns. Rolling back to the old
strict binary changes the promised duplicate behavior and needs a separate decision.

## Verification

Run unit tests without environment/DB setup with:

    pnpm --filter @veralog/api exec vitest run --config vitest.replay.config.ts

The auth suite uses vitest.auth.config.ts, DATABASE_URL_TEST and only the approved
local :5432/veralog_test database. The test process can load credentials without
printing them. It migrates that DB and truncates all ten fixture tables with
CASCADE before each test. Never run this against veralog or substitute db:migrate,
which uses DATABASE_URL. In a linked worktree without an environment file,
supply DATABASE_URL_TEST to the process; the agent must not read secret files.

    pnpm --filter @veralog/api exec vitest run --config vitest.auth.config.ts

These tests do not validate real browser cookie ordering, Google OAuth or deployment.
