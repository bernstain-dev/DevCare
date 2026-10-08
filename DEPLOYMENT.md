# Deployment and operations

## 1. Separate environments

Create separate Supabase projects for disposable tests/preview and production. Keep production client data out of preview builds, development seeds and CI fixtures. Use separate Cloudflare preview environment variables. Invite users only after real SMTP and callback URLs are configured. Ticket-update email is intentionally deferred; in-app updates are implemented.

Use Node 24 LTS and the committed `package-lock.json` (`npm ci`). The development environment was Node 24.15.0; deploy with an up-to-date Node 24 patch. Do not use unsupported Node releases.

## 2. Supabase database and Auth

Create a Supabase project and record its project reference. Use the official CLI with your own authenticated operator session:

```powershell
npx --yes supabase@2.120.0 login
npx --yes supabase@2.120.0 link --project-ref YOUR_PROJECT_REF
npx --yes supabase@2.120.0 db push
```

Apply all versioned migrations in order. Do not paste only the schema or bypass RLS policies. On a disposable local stack use `npx --yes supabase@2.120.0 db reset`; **never reset production**. Migrations create ten RLS-protected application tables and a private `ticket-attachments` bucket. SQL sequence generation is concurrency-safe; gaps are expected after rolled-back transactions. UUIDs remain primary keys.

In Supabase Authentication settings:

- Disable **Allow new users to sign up**. Email/password login remains enabled. Invitations and operator-created accounts use Auth Admin API.
- Set minimum password length to **12**, and enable appropriate password protections available to your project.
- Set **Site URL** to your canonical frontend origin, e.g. `https://support.example.com` (no path/trailing slash).
- Add **exact** redirect URLs for `https://support.example.com/accept-invitation` and `https://support.example.com/reset-password`.
- In the development project add `http://localhost:5173/accept-invitation` and `http://localhost:5173/reset-password`. Do not add development or broad wildcard preview callbacks to production.
- For a Cloudflare preview, use a fixed preview branch URL and add its two exact callback URLs to the **preview Supabase project**.

Apply the HTML from `supabase/templates/invitation.html` and `supabase/templates/recovery.html` to Supabase's Invite User and Reset Password email templates. They send recipients to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}`. The browser verifies the one-time token with the matching `invite`/`recovery` type and removes it from the address bar. The app also supports Supabase's default implicit session redirect links. Never place invitation tokens in analytics, logs or issue reports. Referrer Policy prevents sending the query to a different origin.

## 3. Configure custom SMTP before launch

In Supabase Auth → Email → SMTP, configure a provider you control:

- Sender name/address and verified sending domain.
- SMTP host, port, username and password (Supabase server settings only).
- SPF, DKIM and DMARC as required by the provider.
- Appropriate email rate limits for client invitations/recovery.

Disable link tracking/rewrite and review mail scanner behavior for one-time links. Send actual invitation and recovery emails to an external mailbox, open them on desktop and phone, set/change the password, then log out and back in. Verify the exact destination origin and route. A successful API response alone does not verify delivery. Supabase's restricted default mail service is insufficient for production client onboarding.

## 4. Deploy Edge Functions and configure origins

The platform injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` for server use. Set the application-specific secrets with your authenticated CLI:

```powershell
npx --yes supabase@2.120.0 secrets set SITE_URL=https://support.example.com ALLOWED_ORIGINS=https://support.example.com
npx --yes supabase@2.120.0 functions deploy admin-users --no-verify-jwt
npx --yes supabase@2.120.0 functions deploy files --no-verify-jwt
```

`ALLOWED_ORIGINS` accepts an exact comma-separated list, without trailing slashes. Use a development project/origin for localhost and previews. `SITE_URL` determines invitation callbacks and cannot be supplied by the browser. The functions manually verify every bearer token with `auth.getUser`, check current profile activity and RLS/RPC access, and only then create an elevated client. `admin-users` also checks active admin permission. `files` checks admin permission for cleanup and ticket/attachment access for upload/download. Disabling gateway JWT verification is intentional for publishable-key compatibility; it does **not** make these endpoints anonymous.

Do not send server keys in Vite variables, browser requests, GitHub source or logs. If you set CLI secrets from a file, use an ignored backend-only file. SMTP passwords belong in Supabase SMTP settings, not frontend configuration.

## 5. Create the first admin securely

Only an operator with the Supabase service-role key or trusted SQL editor access can bootstrap the admin. Auth metadata never grants a role.

1. Complete migrations, SMTP, templates, callbacks and function deployment first.
2. Copy `.env.admin.example` to ignored `.env.admin` on your trusted computer. Set the backend URL/service-role key, your email as `DEVCARE_ADMIN_EMAIL`, and canonical origin as `DEVCARE_SITE_URL`.
3. Run `npm run bootstrap:admin`.
4. Open the invitation email at `/accept-invitation`, set a unique password of at least 12 characters, and verify your developer dashboard.
5. Remove the local operator env file when finished. Protect the service key in your secret manager; rotate it if exposed.

The bootstrap script refuses when any admin already exists. If an invitation was created but role promotion failed, rerun after fixing the problem; the script finds the existing profile. For an existing invited account without a valid link, use password recovery after confirming the account's email ownership.

Operator recovery: first use the Supabase dashboard to invite/identify your verified Auth user, then execute the following in the **trusted SQL editor**, substituting that known Auth UUID. Never expose this operation as a public RPC:

```sql
begin;
update public.profiles set role = 'admin', active = true
where id = 'YOUR_VERIFIED_AUTH_USER_UUID';
commit;
```

Review existing administrators before promoting a replacement and revoke access for any compromised operator. The UI intentionally cannot create additional administrator roles or alter admin permissions. There are no hardcoded production credentials.

## 6. GitHub source control

The workspace is initialized as a Git repository; publish it to a private repository you control. Before committing, inspect ignored files and ensure no credentials entered tracked source:

```powershell
git status --short
git add .
git commit -m "Implement DevCare support portal"
git remote add origin https://github.com/YOUR_ACCOUNT/DevCare.git
git branch -M main
git push -u origin main
```

Do not rerun `remote add` if already configured. Commit the lockfile. Enable branch protection and require the Verify DevCare workflow before merging. CI verifies SQL in an isolated PostgreSQL cluster and browser behavior using test fixtures; it has no production secrets. Run the real integration suite separately against a disposable Supabase project before release. GitHub repository creation/push needs your authenticated account and was not fabricated locally.

## 7. Cloudflare Pages Git integration

In Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git:

| Setting               | Value                          |
| --------------------- | ------------------------------ |
| Repository            | Your DevCare GitHub repository |
| Production branch     | `main`                         |
| Framework             | Vite / React                   |
| Root                  | repository root                |
| Build command         | `npm run build`                |
| Output directory      | `dist`                         |
| Node version variable | `NODE_VERSION=24`              |

Set these **frontend** variables in both production and preview, using the appropriate separate Supabase project:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

The publishable key is intentionally public and relies on RLS. Do not add service-role keys or SMTP credentials to Pages variables. Vite inlines these variables at build time; changing them requires a new build. `wrangler.toml` declares the Pages output directory for optional CLI deployment (`npx wrangler pages deploy dist --project-name devcare` with an authenticated account and the correct build environment).

Cloudflare copies `public/_redirects` and `_headers` into `dist`. The explicit SPA rewrite `/* /index.html 200` supports direct navigation and refresh at `/tickets/:id`, `/projects/:id` and auth routes. There is no Pages Function that overrides this rule. Response headers restrict framing, script sources and connections. If using a custom Supabase API domain, update `connect-src` in `_headers` to that exact HTTPS/WSS origin; the shipped policy permits `*.supabase.co`. Do not loosen it to unrestricted connections.

Deploy a preview first. Verify login, invitation/recovery callbacks, client/admin routes, phone navigation, private files, notifications and refresh of a nested ticket URL on the **actual Pages origin**. Preview testing must use preview backend data. Deploy production only when CI, real integration checks, SMTP delivery, bootstrap and origin settings are complete. Review a failed build/deployment before retrying; a successful local build is not a deployed URL.

## 8. Private files and maintenance

PNG, JPEG, WebP and PDF only; 5 MiB each; maximum three per original ticket or public reply. The frontend checks names/types/size, the Edge Function validates extension and file signature, PostgreSQL reserves slots under a ticket row lock, and the private bucket limits types/bytes. File-signature checks establish format, not malware scanning; PDFs are forced to download and never rendered in the portal. Only authors may attach files to their own report/reply. Internal notes have no attachment surface. No Storage policies give browser users direct bucket access.

Signed links last **60 seconds**. Treat them as short-lived bearer links: anyone holding one may use it until it expires, including briefly after access revocation. New links/uploads and all database access immediately recheck current access. The portal stores object paths, never signed links.

If one file fails, the report/reply remains saved and only unsuccessful files are offered for retry. Failed reservations are removed after storage cleanup succeeds. Cleanup atomically claims rows as `deleting` before touching Storage; it preserves finalized files and retains failed removals for retry. After a crash or lost response, use Profile & Settings → **Clean Abandoned Uploads** daily; it processes pending reservations older than 24 hours and retries incomplete removals, up to 100 at a time. Repeat until no batch remains. The endpoint checks an active admin session. A scheduled operator can call `files` with `{ "action": "cleanup" }` and a valid admin bearer token; do not use an unprotected cron secret or service key in the browser. A failure to finalize cannot expose a pending file.

## 9. Database and attachment backup/restore

Supabase database backup/PITR availability depends on your plan; confirm it before onboarding clients. Database backups alone **do not contain Storage object bytes**. Maintain encrypted, access-controlled backups of both, and test restoration into a separate project.

Database:

1. Record the release Git SHA, migration versions, Supabase project/region, Auth configuration, bucket settings and function versions.
2. Use Supabase's documented backup/PITR procedure for the managed project. For portable logical exports, use the CLI with authenticated operator access:

   ```powershell
   npx --yes supabase@2.120.0 db dump --linked --file backup-schema.sql
   npx --yes supabase@2.120.0 db dump --linked --data-only --use-copy --file backup-data.sql
   npx --yes supabase@2.120.0 db dump --linked --role-only --file backup-roles.sql
   ```

3. Store exports outside the repository, encrypted. The CLI excludes managed schemas as documented; explicitly plan migration of Auth users/identities when restoring to another project. For a full managed restore, use Supabase's supported project backup workflow rather than importing a partial application dump over a live schema.
4. Restore into an isolated target using the provider/CLI instructions for that backup type. Apply schema, application data and grants in the documented order; ensure `auth.users` IDs exist before restoring profile foreign keys. Preserve UUIDs, reference sequence state, events and membership relationships. Do not run the Auth profile trigger twice over restored profiles.
5. Check the next reference sequence is above every restored numeric reference, verify RLS/grants, run the disposable integration suite on a cloned test dataset, and test both admin and client access. Never connect a restored staging system to production SMTP recipients until reviewed.

Storage:

1. Use Supabase's authenticated S3-compatible API or a trusted server-side Storage SDK to enumerate and download every object in `ticket-attachments`, preserving the exact path and content type.
2. Keep a manifest with object path, byte size, checksum and backup timestamp. Include ready objects referenced by `attachments`; back up at the same consistency point as database metadata or reconcile while writes are paused.
3. Restore the bucket as **private** with the same 5 MiB/MIME limits; upload bytes to the same paths using operator credentials.
4. Compare manifest checksums/lengths to restored files and reconcile missing/orphaned paths before reopening writes. Confirm a real client can download their own ready file and cannot download another account's file.

Back up server configuration via a secret manager; SQL dumps do not recover SMTP passwords, Edge secrets, signing keys, Pages variables, Auth URLs or deployment settings. Do not commit backups. Test restoration regularly and define acceptable recovery time/data loss for clients.

## 10. Rollback

Cloudflare Pages can roll frontend code back to a previously successful deployment. Edge Functions can be redeployed from a recorded Git SHA. Neither action reverses database migrations, ticket writes, sent invitation emails or object changes. Use backward-compatible migrations and coordinate frontend/RPC compatibility. For destructive database rollback, restore a reviewed backup/PITR point in a controlled maintenance window and reconcile attachment state and Auth configuration. This can lose later writes; do not promise a lossless instant rollback. Verify archived history and reference uniqueness after recovery.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [database backups](https://supabase.com/docs/guides/platform/backups), [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/).
