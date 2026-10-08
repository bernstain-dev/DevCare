# Verification report

Executed locally on **8 October 2026**, using Node 24.15.0 on Windows. No external credentials, real client records or production passwords were provided.

| Check                                         | Actual result                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                      | Passed; lockfile installs cleanly; npm audit reported zero vulnerabilities                                                                         |
| `npm run typecheck`                           | Passed                                                                                                                                             |
| `npm run lint`                                | Passed                                                                                                                                             |
| `npm test`                                    | 11 tests passed in 2 test files                                                                                                                    |
| `npm run test:database`                       | 105 checks passed against isolated PostgreSQL 18.4                                                                                                 |
| `npm run test:browser`                        | 10 checks passed across desktop Chromium and Pixel 7 emulation                                                                                     |
| Deno check of both Edge Function entry points | Passed with Deno 2.9.6                                                                                                                             |
| `npm run build`                               | Passed; code split production output in `dist`                                                                                                     |
| Local production preview nested URL           | `/tickets/55555555-5555-4555-8555-555555555555` returned HTTP 200 with the built app root and module script                                        |
| Supabase CLI                                  | Explicit `npx --yes supabase@2.120.0 --version` returned `2.120.0`                                                                                 |
| Ignored files / source inspection             | Frontend/backend env files, dependencies, build output and screenshots are ignored; scanned source contains no actual service keys or private keys |

The SQL suite applies all three migrations to a fresh temporary database and runs real PostgreSQL queries as `anon`, `authenticated` and `service_role`, with minimal test Auth/Storage schemas. It verifies all 50 role/status-transition combinations, required resolution/reopen text, automatic reply transitions, trusted authors, private notes, ownership protection, shared memberships, notifications, archival, concurrent creation of 24 distinct references, concurrent attachment limits, cleanup/finalization exclusion, cleanup retries and disabled user/account/membership access. It stops its own database afterward and does not access the system's existing databases.

Browser tests use explicit, test-only Supabase API fixtures. They verify login/recovery/invitation screens, role-specific navigation, client ticket submission and replies, feature-request notices, failed-file retry without duplicate submission, admin account/project forms, invitation controls, resolution confirmation/reopening, private-note UI exclusion, mobile navigation, page-width containment, and nested ticket-route reload. Automated axe checks found no WCAG A/AA violations on the tested login, dashboard and ticket pages. This is not a full accessibility certification, actual-device test or live backend verification.

## Not performed

- Real Supabase Auth/PostgREST/Storage/Edge integration suite (`npm run test:integration`): no disposable project credentials were available. The executable suite is supplied. For a hosted disposable project set `DEVCARE_TEST_EMAIL_DOMAIN` to a test mail domain/catch-all you control; local email capture can use `example.test`.
- Actual SMTP delivery, invitation acceptance and password recovery using hosted email callbacks: these require configured SMTP, exact Auth redirect URLs and real test mailboxes.
- Supabase migration/function deployment, admin bootstrap and backup restoration against a hosted project.
- GitHub remote push, GitHub Actions execution, Cloudflare preview/production deployment and hosted direct-link refresh. No authenticated deployment access was available, and no deployed URL is claimed.

The local HTTP preview check verifies Vite's built SPA fallback. The shipped Cloudflare `_redirects`/`_headers` are present in the build, but actual Pages routing/headers must be checked after deployment. Browser fixtures and the isolated SQL suite complement each other; neither replaces the real API integration and SMTP release checks.

See [DEPLOYMENT.md](DEPLOYMENT.md) for exact configuration, migration, bootstrap, deployment, backup/restore and rollback steps. Do not launch with real clients until the remaining hosted checks pass.

## Admin setup follow-up (8 October 2026)

After operator configuration became available in ignored local files, read-only hosted checks confirmed that the configured admin profile exists, is active, and has a confirmed Auth email. The corrected frontend project URL and publishable key returned HTTP 200 from Auth settings. Running the updated bootstrap command for that existing admin returned the ready-account message without sending an invitation or changing accounts.

Following the configuration and bootstrap fixes, typecheck, lint, production build, 14 Vitest tests, 9 Node bootstrap tests, and all 10 desktop/mobile browser checks passed. The running local login and recovery routes also loaded in Chromium without page errors. Bootstrap tests cover loopback callbacks, invalid configuration, safe error reporting, existing-admin reruns, refusal of additional/disabled admins, invitation destinations, existing confirmed users and failed profile promotion. Invitation API calls in unit tests are simulated; no email was sent by these checks. Actual SMTP delivery, setting the user's password and end-to-end hosted sign-in remain unverified. The original database and Edge Function checks above were not rerun for this frontend/operator-script change.

After an Auth email-rate-limit error was reported, an interactive operator recovery command was added. `npm test` passed 14 Vitest tests and 17 Node tests (31 total), and `npm run lint` passed. Additional tests verify recovery eligibility, refusal of mismatched/unconfirmed identities and disabled/non-admin profiles, password validation, API error redaction, noninteractive-input refusal, hidden input and terminal-state restoration on completion/cancellation. Running `npm run recover:admin` from a noninteractive tool process correctly refused before any password mutation. No real password was set, no recovery email was requested, and hosted password recovery through the new command remains for the operator to execute. Frontend build/browser/database checks were not rerun for this script/documentation-only addition.

## Client invitation troubleshooting (8 October 2026)

Read-only hosted checks found one active client business record and no client profiles. The operator confirmed that the default Supabase mail service is in use; this service restricts recipients to organization team members in addition to its email quota. No invitation was attempted by the agent. Custom SMTP credentials and actual delivery remain for the operator to configure/verify.

The invitation function now maps allowlisted Auth codes to distinct actionable errors, preserves rate-limit HTTP statuses, rejects malformed invitation origins, and logs only safe operation/code/status fields. Typecheck, lint, build, 32 Vitest tests, 17 Node tests (49 total), 12 desktop/mobile browser checks and Deno typecheck of `admin-users/index.ts` passed. New tests verify callback validation, recipient restrictions versus quotas, safe error reporting, preserved invite form input and explicit retry after failure.

Authenticated Supabase CLI deployment of `admin-users` to the configured/linked project succeeded; the function is ACTIVE at version 2. Live checks returned HTTP 204 for the allowed local-origin preflight and HTTP 401 with `Sign in required` for an unauthenticated POST. These checks verify deployment/CORS and rejection of unauthenticated calls, not actual SMTP delivery, authenticated invitation success or the full hosted security suite. No frontend hosting deployment or database migration was performed in this follow-up.

## Vercel preparation (9 October 2026)

Added `vercel.json` with the Vite preset, install/build/output settings, SPA rewrites and security headers; `.vercelignore` excludes local secrets, operator scripts, CLI state and generated artifacts. Documentation covers Vercel Git/CLI deployment, commercial-plan requirements, isolated preview backends, hosted Supabase callbacks/origins and deployment protection.

Typecheck, lint, 32 Vitest tests plus 17 Node tests (49 total), and production build passed again using an ignored workspace-local npm cache. The config also matched the published Vercel schema with meta-schema validation disabled: the published document declares draft-04 but includes newer numeric `exclusiveMinimum` definitions in unrelated function/service branches, which prevented strict meta-schema validation. No hosting-specific browser test or Vercel routing/header check has passed yet. Previous browser/database/API outcomes above remain historical results, not new hosted checks.

The first Vercel CLI installation failed because the default C: npm-cache drive had no free space. Installation in the D: workspace cache succeeded. Vercel CLI 63.1.0 `whoami` returned `Logged out`; there is no linked Vercel project or configured disposable preview Supabase environment. User sign-in and preview-backend selection are pending. No Vercel deployment or production promotion occurred and no Vercel URL is claimed. A workspace-local `--global-config .verification/vercel-user` option is documented to keep CLI state off the full drive; this folder is excluded from Git and uploads.
