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
