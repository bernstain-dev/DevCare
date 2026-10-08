# DevCare — Client Support and Project Ticketing System

A working, invitation-only support portal for a freelance developer and their clients. React/TypeScript/Vite frontend, Supabase PostgreSQL/Auth/private Storage backend, and Cloudflare Pages hosting. No mock-data mode or bundled credentials. Without frontend configuration, the app displays setup instructions rather than pretending to be connected.

## Features

- Developer and client dashboards, project lists and details, client accounts and memberships, invitation management, and account disabling.
- Ticket submission with four request types, reproduction context, requested urgency separate from admin priority, database-generated references, searchable filters and pagination.
- Backend-enforced ticket transitions, resolution summaries, client confirmation/reopening, public replies, separate private notes, immutable authors and audit history.
- Private attachments, byte/type/count limits, authenticated upload/download, 60-second download links, partial-failure retry, and abandoned-upload cleanup.
- In-app notifications, profile editing, login/logout, invitation acceptance, password recovery, accessible responsive navigation, and Manila timestamp display.

## Local setup

Prerequisites: Node **24 LTS**, npm, and a configured Supabase project. For a local Supabase stack, install Docker Desktop and the Supabase CLI; Docker is not needed when using a separate hosted development project.

```powershell
npm ci
Copy-Item .env.example .env.local
# Edit .env.local with your development project's URL and publishable key.
npm run dev
```

Open `http://localhost:5173`. Complete the backend instructions in [DEPLOYMENT.md](DEPLOYMENT.md) first. For local Supabase:

```powershell
npx --yes supabase@2.120.0 start
npx --yes supabase@2.120.0 db reset
Copy-Item supabase/.env.example supabase/.env.local
npx --yes supabase@2.120.0 functions serve --env-file supabase/.env.local
```

Create the ignored `supabase/.env.local` containing only:

```dotenv
SITE_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

The CLI provides local backend credentials to Edge Functions. Use local URL/key values from `supabase status` in `.env.local`; never put service credentials there. The local email inbox is normally `http://127.0.0.1:54324` (confirm with `supabase status`). Public signup is disabled in `supabase/config.toml`.

## Verification commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:database
```

`test:database` requires PostgreSQL binaries. On this Windows workspace it defaults to `C:/Program Files/PostgreSQL/18/bin`; override `POSTGRES_BIN` on other systems. It starts and stops its own temporary, loopback-only database, applies all migrations, and checks real SQL/RLS/concurrency. It does not touch existing PostgreSQL services or databases. Its minimal Auth/Storage schemas are test contracts, so it cannot verify Supabase Auth or Storage HTTP behavior.

Browser tests use explicit API fixtures **only in the test suite** to exercise screens, mobile navigation, form validation, workflows, direct-route refresh and attachment retries. They do not establish hosted backend or SMTP success. Production code always connects to Supabase.

For the real Supabase API integration suite:

```powershell
Copy-Item .env.test.example .env.test
# Configure a disposable project, apply migrations, and deploy/serve Edge Functions.
npm run test:integration
```

This creates isolated test identities and history in the selected project. It checks real Auth invitation/recovery tokens, API isolation, privileged Edge authorization, Storage uploads/downloads, workflow and existing-JWT revocation. It intentionally preserves history; destroy/reset the disposable project afterward. Never point it at production. SMTP inbox delivery and hosted browser callbacks still require a release smoke test.

## Development seed

With a **disposable development** project configured in `.env.test`, run `npm run seed:dev`. It creates one development client, membership and project using Auth Admin API. It prints no passwords; set credentials through the local dashboard or password recovery. The script requires `DEVCARE_TEST_ALLOW_RESET=YES_DISPOSABLE_PROJECT`. Seeds are never run automatically by migrations, builds or deployment.

## Structure

| Path                                   | Responsibility                                       |
| -------------------------------------- | ---------------------------------------------------- |
| `src/auth`                             | Session, profile and disabled-user handling          |
| `src/pages`                            | Role-aware routed screens                            |
| `src/lib`                              | Supabase adapters, validation, types and queries     |
| `src/components`                       | Shared controls, navigation and ticket tables        |
| `supabase/migrations`                  | Schema, RLS, grants and transactional RPCs           |
| `supabase/functions`                   | Verified admin invitations and private files         |
| `scripts`                              | Secure bootstrap, development seed and backend tests |
| `tests/browser`                        | Desktop/mobile UI contract tests                     |
| `public/_redirects`, `public/_headers` | SPA fallback and response security                   |
| `.github/workflows/ci.yml`             | Verification on pushes and pull requests             |

Architecture/access rules are in [AGENTS.md](AGENTS.md). Launch configuration, bootstrap, backups and rollback are in [DEPLOYMENT.md](DEPLOYMENT.md). Actual verification outcomes are recorded in [VERIFICATION.md](VERIFICATION.md).
