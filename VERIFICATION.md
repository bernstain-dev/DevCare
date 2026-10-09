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

## Hosted Vercel preview (9 October 2026)

This section supersedes the deployment/sign-in blockers in the preparation entry. The operator signed in successfully and confirmed that real client data will be added later. The existing Supabase project was therefore used only as the current testing backend. Do not add real client data to this preview backend; establish separate production and preview environments before onboarding clients.

Created and linked `devcare` under the authenticated Vercel account and connected `bernstain-dev/DevCare`. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` were configured, scoped to Preview. Vercel uses Node 24.x. The initial command without an explicit target unexpectedly assigned the first deployment to Production; that deployment (`dpl_FgFqJBXSoYyu9g9NNs294pqrAay8`) was removed successfully. Documentation now requires `--target preview`. The final deployment is **READY, target Preview**, ID `dpl_9JjVdkr7dX5SnbvbX13fENFryLGe`:

**[Verified DevCare preview](https://devcare-28om9dtux-fangonbernstain566-collabs-projects.vercel.app)**

The Vercel build ran `npm ci` and `npm run build` successfully; its install audit reported zero vulnerabilities. Authenticated hosted checks used the CLI-created automation bypass without printing it or committing credentials. Normal visitors still receive a redirect to Vercel sign-in; deployment protection remains enabled.

| Hosted check | Actual result |
| --- | --- |
| Direct GET of login, forgot-password, accept-invitation, reset-password, nested project and nested ticket routes | All six returned HTTP 200 with SPA HTML behind Vercel protection |
| Security headers on those routes | CSP, frame denial, nosniff, referrer policy and permissions policy present |
| Entry JavaScript asset | HTTP 200, JavaScript content type, correct testing backend/public key; actual operator service key and generated local Vercel OIDC token absent from the inspected entry bundle |
| Chromium at 1440×1000, 390×844 and 320×740 | Login/auth pages render; no horizontal overflow or page exceptions; unauthenticated nested ticket navigation redirects to login and reload succeeds |
| Hosted-origin preflight for `admin-users` and `files` | Both HTTP 204 with the exact preview origin |
| Unauthenticated POST to both functions | Both HTTP 401 |
| Untrusted-origin preflight to both functions | Both HTTP 403 |
| Hosted Auth configuration | Remote Site URL and both exact hosted callbacks match; existing local callbacks preserved; public Auth settings report `disable_signup: true` |
| SMTP configuration preservation | Custom SMTP was already enabled; all available remote SMTP properties matched before and after the selective Auth update; actual delivery unverified |

Updated the testing project's Edge Function `SITE_URL` and exact `ALLOWED_ORIGINS`, retaining the two local development origins. Updated ignored operator `DEVCARE_SITE_URL` to this preview origin. Read-only remote configuration showed local-only Auth URLs and public signup enabled. Using CLI 2.120.0's declared-property-only configuration support, prepared an ignored minimal config and reviewed its JSON diff before applying it. Only `auth.site_url`, `auth.additional_redirect_urls`, `auth.enable_signup` and `auth.email.enable_signup` changed. A subsequent remote diff contained no remaining declared updates, available SMTP properties were unchanged, and public Auth settings confirmed signup disabled. This completed the previously requested manual dashboard URL step automatically. No database records, account passwords, invitations or recovery emails were created by these checks. Successful SMTP delivery, authenticated hosted admin/client workflows, invitation acceptance and recovery navigation remain unverified. The full disposable-project integration suite was not run against this backend, which the operator intends to use later for real data.

The account is on Vercel Hobby, which permits personal/non-commercial use. Commercial hosting, production Supabase isolation, Auth callbacks, SMTP and real integration checks remain release requirements. `vercel.json` now disables automatic deployments from `main` so routine source/documentation pushes do not launch an unfinished Production release; other branches can still create previews. The updated config matched the published schema with the same documented meta-schema validation limitation, and `git diff --check` passed. No client-ready Production release is claimed.

## Short testing URL (9 October 2026)

At the operator's request, assigned **[https://devcare-rho.vercel.app/login](https://devcare-rho.vercel.app/login)** to the existing verified Preview deployment. Vercel rejected `devcare.vercel.app` as already in use. A deployment API check confirmed that the short alias points to the same READY Preview deployment; no Production promotion or new frontend build was performed. Vercel Authentication now covers All Deployments to preserve sign-in protection on the short domain; an unauthenticated request redirects to Vercel sign-in.

Reviewed and applied a minimal Supabase Auth diff containing only `auth.site_url` and `auth.additional_redirect_urls`. The new Site URL and exact short-domain invitation/reset callbacks match the remote config, previous hosted callbacks remain listed, and available SMTP properties are unchanged. Public Auth settings still report signup disabled. Updated Edge `SITE_URL`, exact allowed origins and ignored operator `DEVCARE_SITE_URL` to support the short address; the prior hosted origin and local development origins remain in the Edge allowlist.

Repeated actual hosted verification on the short address: all six auth/nested routes returned SPA HTML with security headers; the entry JavaScript loaded with the correct testing backend and without the inspected private operator/Vercel credentials; Chromium checks passed at 1440×1000, 390×844 and 320×740 with no page exceptions or horizontal overflow, including auth-page navigation and nested-route reload. Both Edge Functions returned 204 for short-origin preflight, 401 for unauthenticated POST and 403 for an untrusted origin. These checks used a private automation bypass without logging it. No invitations, recovery emails, account changes or test database records were created. Actual SMTP delivery and authenticated admin/client workflow checks remain outstanding. Typecheck, lint, unit tests and build were not repeated for this hosting/settings/documentation-only change; their earlier results remain historical.

## Email login provider correction (9 October 2026)

The operator reported `Email logins are disabled`. Public hosted Auth settings confirmed `disable_signup: true` but `external.email: false`. The earlier invitation-only configuration had incorrectly set both signup flags false: Supabase's email-specific `enable_signup` flag disables the email provider itself, including existing-user logins. Corrected committed `supabase/config.toml` to global `[auth].enable_signup = false` and `[auth.email].enable_signup = true`, with comments and deployment/convention documentation explaining the distinction.

Reviewed a selective remote config diff and applied only `auth.email.enable_signup = true`. Post-update diff matched the intended configuration, and all undeclared remote Auth properties matched their previous values, including available SMTP properties and callback settings. Public `/auth/v1/settings` then returned `disable_signup: true` and `external.email: true`. A password-grant request with a random nonexistent identity returned HTTP 400 / `invalid_credentials`, confirming that email login reaches credential validation instead of rejecting the provider. No real account password was attempted or changed, and no email was sent. Successful login with the operator's actual password remains for the operator to confirm.

`git diff --check` passed. No frontend source changed, so no new frontend deployment, typecheck, lint, unit-test or build run was needed or performed for this configuration/documentation correction. Prior checks above are historical results; the new verification here is against the actual hosted Auth service.

## Supplied DevCare branding (9 October 2026)

Inspected both supplied PNGs before editing: the full green code/chat symbol and DevCare wordmark is 2172×724 RGBA; the compact green chat/code icon is 1254×1254 RGBA. Both have transparency. SHA-256 checks confirmed the originals remain unchanged (`529b4770d6038a7cd44cddf6dccea5dec7c1d0e5a2957a60fc709edda8af4859` and `449e750d8d9435133ee66d6ec7a69b8dead35aeb3a002cfc571c3cc4196d7412`, respectively). No mail bot asset, email template, provider profile or backend setting is part of this change.

Added reusable full/icon branding, full logos on all auth screens and the expanded desktop sidebar, compact branding in mobile header/navigation and a keyboard-accessible desktop collapse control. Dark panels use light logo containers. Explicit image dimensions and contain sizing preserve proportions; full-logo links do not repeat the wordmark as text. Added the requested default browser title and meaningful route titles. There was no existing favicon or web app manifest; added versioned favicon links without PWA/service-worker behavior.

Pillow 12.2.0 generated deterministic transparent 16/32px PNG favicons, a 180px Apple touch icon, and an ICO whose six frames were verified at 16/32/48/64/128/256px. `python scripts/generate-branding.py --check` passed after generation. Filename revision `449e750d` derives from the compact source hash; the generator updates the head references without rewriting the originals.

Typecheck and production build passed. Lint initially included ignored/generated browser caches and earlier verification helpers; adding `.verification/**` to its artifact exclusions fixed that, and lint passed. `npm test` passed all 32 Vitest and 17 operator tests (49 total). All 16 Playwright checks passed across desktop and Pixel 7 emulation, including existing workflows/accessibility checks and new auth-logo/favicon, route-refresh, title, collapsed-sidebar and mobile-navigation checks. Browser workflow API data is explicitly simulated in the test suite, not in the application.

Inspected screenshots of login/recovery/invitation/reset screens, expanded/collapsed desktop sidebar, mobile header and mobile drawer for sizing, transparency and light/dark contrast. Additional Chromium checks against the actual production build on local Vite preview passed at 1440/390/320px: all four auth pages, reloads and nested unauthenticated ticket redirects; correct full-logo proportions; all six branding asset bytes matched disk; PNG favicons decoded at 16/32/180px with transparent corners; six ICO frames and the default HTML title matched. No page exceptions or horizontal overflow occurred. No real sign-in, emails, test database mutation, database test suite or hosted SMTP workflow was performed for this branding change. Deployment verification is recorded below when completed.
