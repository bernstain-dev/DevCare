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

Apply all versioned migrations in order. Do not paste only the schema or bypass RLS policies. On a disposable local stack use `npx --yes supabase@2.120.0 db reset`; **never reset production**. Migrations create twelve RLS-protected public tables, private operator audit/archive tables and a private `ticket-attachments` bucket. SQL sequence generation is concurrency-safe; gaps are expected after rolled-back transactions. UUIDs remain primary keys. Existing installations must apply the new forward-only `202610110001_scoped_administrators.sql` migration and complete the explicit assignments below; earlier applied migrations remain unchanged.

In Supabase Authentication settings:

- Disable **Allow new users to sign up**, and keep the **Email provider enabled**. Invitations and operator-created accounts use Auth Admin API. In CLI config, use `[auth].enable_signup = false` together with `[auth.email].enable_signup = true`: the email-specific flag enables the provider, including existing-user logins, despite its name. Verify public `/auth/v1/settings` reports both `disable_signup: true` and `external.email: true`. See [Supabase's provider/signup clarification](https://github.com/supabase/supabase/issues/40582).
- Set minimum password length to **12**, and enable appropriate password protections available to your project.
- Set **Site URL** to your canonical frontend origin, e.g. `https://support.example.com` (no path/trailing slash).
- Add **exact** redirect URLs for `https://support.example.com/accept-invitation` and `https://support.example.com/reset-password`.
- In the development project add `http://127.0.0.1:5173/accept-invitation` and `http://127.0.0.1:5173/reset-password` for the default `npm run dev` address. If using `localhost`, add its two exact callback URLs too. Use the same origin in your browser, Site URL, `DEVCARE_SITE_URL` and Edge Function `SITE_URL`. Do not add development or broad wildcard preview callbacks to production.
- For a Cloudflare preview, use a fixed preview branch URL and add its two exact callback URLs to the **preview Supabase project**.

Apply the HTML from `supabase/templates/invitation.html` and `supabase/templates/recovery.html` to Supabase's Invite User and Reset Password email templates. They send recipients to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}`. The browser verifies the one-time token with the matching `invite`/`recovery` type and removes it from the address bar. The app also supports Supabase's default implicit session redirect links. Never place invitation tokens in analytics, logs or issue reports. Referrer Policy prevents sending the query to a different origin.

## 3. Configure custom SMTP before launch

In Supabase Auth → Email → SMTP, configure a provider you control:

- Sender name/address and verified sending domain.
- SMTP host, port, username and password (Supabase server settings only).
- SPF, DKIM and DMARC as required by the provider.
- Appropriate email rate limits for client invitations/recovery.

Disable link tracking/rewrite and review mail scanner behavior for one-time links. Send actual invitation and recovery emails to an external mailbox, open them on desktop and phone, set/change the password, then log out and back in. Verify the exact destination origin and route. A successful API response alone does not verify delivery. Supabase's restricted default mail service is insufficient for production client onboarding.

### Getting started without a domain: Gmail SMTP

For initial low-volume setup, you can use a Gmail account you control if Google makes App Passwords available for it. Enable 2-Step Verification, open [Google App Passwords](https://myaccount.google.com/apppasswords), and create a dedicated App Password named `DevCare SMTP`. Work/school accounts and some protected accounts may not offer this feature; consult [Google's App Password requirements](https://support.google.com/accounts/answer/185833?hl=en).

Enable custom SMTP in Supabase → Authentication → Email → SMTP Settings:

| Setting      | Value                             |
| ------------ | --------------------------------- |
| Sender email | Your Gmail address                |
| Sender name  | `DevCare`                         |
| Host         | `smtp.gmail.com`                  |
| Port         | `465`                             |
| Username     | The same full Gmail address       |
| Password     | The dedicated Google App Password |

These settings use [Gmail's TLS SMTP service](https://developers.google.com/workspace/gmail/imap/imap-smtp?hl=en). Enter the App Password only in Supabase SMTP settings, never in Vite variables, source code, commands or support messages. Save the settings, check Auth rate limits, and retry **Manage Users → Invite User** for the existing client account. Gmail and Supabase quotas still apply. Verify actual delivery and callback/password setup before inviting real clients; move to a transactional email provider with an authenticated sending domain as your sending needs grow. Services such as [Resend SMTP](https://resend.com/docs/send-with-smtp) require a verified domain for sending to external clients.

## 4. Deploy Edge Functions and configure origins

The platform injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` for server use. Set the application-specific secrets with your authenticated CLI:

```powershell
npx --yes supabase@2.120.0 secrets set SITE_URL=https://support.example.com ALLOWED_ORIGINS=https://support.example.com
npx --yes supabase@2.120.0 functions deploy admin-users --no-verify-jwt
npx --yes supabase@2.120.0 functions deploy files --no-verify-jwt
```

`ALLOWED_ORIGINS` accepts an exact comma-separated list, without trailing slashes. Use a development project/origin for localhost and previews. `SITE_URL` determines invitation callbacks and cannot be supplied by the browser. The functions manually verify every bearer token with `auth.getUser`, check current profile activity and RLS/RPC access, and only then create an elevated client. `admin-users` checks the caller's assigned client for ordinary invitations; administrator invitation/conversion requires an explicit active platform operator and an operator RPC. `files` checks ticket/attachment scope for uploads/downloads and assigned client scope for cleanup. Cleanup across accounts requires an explicit platform operator. Disabling gateway JWT verification is intentional for publishable-key compatibility; it does **not** make these endpoints anonymous.

Do not send server keys in Vite variables, browser requests, GitHub source or logs. If you set CLI secrets from a file, use an ignored backend-only file. SMTP passwords belong in Supabase SMTP settings, not frontend configuration.

## 5. Create the first admin securely

Only an operator with the Supabase service-role key or trusted SQL editor access can bootstrap the admin. Auth metadata never grants a role.

1. Complete migrations, SMTP, templates, callbacks and function deployment first.
2. Copy `.env.admin.example` to ignored `.env.admin` on your trusted computer. Set the backend URL/service-role key, your email as `DEVCARE_ADMIN_EMAIL`, and canonical origin as `DEVCARE_SITE_URL`.
3. Run `npm run bootstrap:admin`.
4. Open the invitation email at `/accept-invitation` and set a unique password of at least 12 characters. Complete the explicit client assignment below before verifying your developer dashboard. Bootstrap grants no client data access by itself.
5. Remove the local operator env file when finished. Protect the service key in your secret manager; rotate it if exposed.

Rerunning bootstrap for the same active admin sends no email and does not change assignments. It refuses to create another admin or reactivate a disabled admin. If an invitation was created but role promotion failed, rerun after fixing the problem; the script finds the existing profile. For an existing invited account without a valid link, use password recovery after confirming the account's email ownership.

### Invitation or admin login troubleshooting

- `VITE_SUPABASE_URL` must be `https://YOUR_PROJECT_REF.supabase.co`, **not** `https://supabase.com/dashboard/project/...`. It must match the project in `.env.admin`. Find the API URL and publishable key in the project's Connect dialog. Only the publishable/legacy anon key belongs in Vite variables; never add `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- `DEVCARE_SITE_URL` is the frontend **origin**, such as `http://127.0.0.1:5173`, without `/login`. Restart `npm run dev` after editing `.env.local`.
- In the hosted Supabase dashboard, Authentication → URL Configuration, set the Site URL and add the exact `/accept-invitation` and `/reset-password` URLs for that origin. Editing local `supabase/config.toml` does not change hosted Auth settings.
- If bootstrap reports an existing active admin, sign in with that email. If you have not set a password or the invitation has expired/already been used, open `/forgot-password`, request a fresh email, open its link on the same computer running Vite, and set a password of at least 12 characters. Localhost/127.0.0.1 links opened on a phone point to the phone, not your development computer.
- If no email arrives, check spam, SMTP delivery logs, sender verification and Auth email limits. An accepted invite API call does not prove delivery. Follow the SMTP and email-template configuration above. Never paste invitation/reset URLs into support messages; they contain login credentials.
- `email_address_not_authorized` means the built-in Supabase mail service refuses external recipients: it sends only to the Supabase organization's team members. Configure custom SMTP for client invitations; waiting for the hourly limit does not remove this restriction. Do not add clients to your Supabase organization as a workaround.
- The invitation function distinguishes recipient restrictions, rate limits, existing Auth accounts, invalid email addresses and Auth provider failures. It records only the operation name and an allowlisted error code/status, never raw SMTP errors, addresses or tokens. Use Supabase Authentication logs to investigate provider failures. Existing confirmed client users are assigned without email; failed invitations preserve the client business record and entered form values.

### Email rate limits and existing-admin password recovery

Supabase's built-in email provider allows only **two Auth emails per hour per project**, shared by email-sending endpoints. Password recovery also has a per-user cooldown. Stop requesting more emails when rate limited; wait for the sending quota to become available or configure custom SMTP. Check Authentication → Rate Limits after configuring SMTP; raising the built-in provider's limit is not supported. See [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

For an **existing active admin with a confirmed email**, a trusted operator can set a password without sending a recovery email:

```powershell
npm run recover:admin
```

Run this from the repository in your own interactive terminal with the ignored `.env.admin` configured as above. Enter your chosen password twice at the hidden prompts, then sign in normally with `DEVCARE_ADMIN_EMAIL`. No characters appear while typing. Do not put the password in chat, command arguments, environment variables or files. This command uses the server-only Auth Admin API; it checks the existing profile's admin role/activity and the matching confirmed Auth user before accepting the password. It cannot create accounts, confirm email addresses, grant roles or enable disabled users. It refuses piped/noninteractive input and does not print passwords, keys, Auth responses or recovery links. Protect/remove `.env.admin` afterward. Custom SMTP remains required before client onboarding.

Operator recovery requires identifying the existing verified Auth/profile account and using the explicit assignment flow below. Changing `profiles.role` alone grants no client access. Disabled accounts require a deliberate trusted operator review before reactivation. There are no hardcoded production credentials.

### Scoped administrator cutover and existing-account conversion

`profiles.role = 'admin'` now identifies a role only. Client data access requires an active `admin_client_memberships` row, an active profile and an active client on every request. The migration assigns nobody automatically. Existing records, ticket history and Auth identities remain intact. Only a server-side service-role operator or a separately enrolled platform operator can convert administrators or change their assignments. Ordinary administrators cannot assign themselves to an existing account, promote users, manage another administrator, or use client memberships to bypass their scope.

Before releasing, back up database and private Storage, review this migration on a disposable project, and keep the portal in maintenance. Deploy the updated Edge Functions during that window before applying the migration: they fail closed until their scoped RPCs exist, which prevents the previous global cleanup/invitation implementation from running after cutover. Apply pending migrations with `db push`, never reset or replay edited historical migrations. Complete assignments and verify the new frontend/functions together before reopening. Do not roll back to the old global authorization functions.

The unapplied cutover also accepts a compatible operator-created `admin_client_memberships` table and existing `can_admin_client(uuid)` function. It validates required UUID/boolean columns, primary/foreign keys and absence of pre-existing policies, preserves membership rows, adds the missing timestamp and replaces the helper with the reviewed scoped implementation. An incompatible structure fails inside the transaction for operator review. A timestamp added to a legacy row records its adoption by this release, not an inferred historical creation date. Run `npm run test:database` both normally and with `DEVCARE_TEST_PARTIAL_ADMIN_SCHEMA=1` to verify the fresh and partial-schema paths in isolated temporary databases; do not run these fixture scripts against production.

1. Identify both existing Auth/profile accounts in the trusted Supabase dashboard or SQL editor. The following is a read-only lookup; replace placeholders locally and keep results out of commits and logs. Confirm the UUID, email ownership, profile activity and accepted invitation state. Do not invite the friend again or create a second account.

   ```sql
   select u.id, u.email, u.email_confirmed_at, u.invited_at, p.role, p.active
   from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) in (lower('OWNER_EMAIL_PLACEHOLDER'), lower('FRIEND_EMAIL_PLACEHOLDER'));
   -- Alternatively identify an already known account by its UUID:
   select u.id, u.email, p.role, p.active
   from auth.users u join public.profiles p on p.id = u.id
   where u.id = 'EXISTING_AUTH_USER_UUID_PLACEHOLDER'::uuid;
   ```

2. Identify the friend's personal business and your own business by reviewing existing records. Do not infer ownership from creation order, contact email, or the previous global admin role. Existing client memberships help review the friend's account, but multiple results require an explicit operator decision.

   ```sql
   select c.id, c.name, c.active, m.active as membership_active
   from public.client_memberships m join public.clients c on c.id = m.client_id
   where m.user_id = 'FRIEND_AUTH_USER_UUID_PLACEHOLDER'::uuid;
   select id, name, active from public.clients order by created_at;
   ```

3. Configure the ignored `.env.admin` on a trusted operator computer with its backend URL/service-role key. Set the existing first administrator and reviewed own client explicitly:

   ```dotenv
   DEVCARE_OPERATOR_ACTION=configure
   DEVCARE_TARGET_USER_ID=OWNER_AUTH_USER_UUID_PLACEHOLDER
   DEVCARE_TARGET_CLIENT_ID=OWNER_CLIENT_UUID_PLACEHOLDER
   ```

   ```powershell
   node --env-file=.env.admin scripts/scoped-admin.mjs
   ```

   `DEVCARE_TARGET_EMAIL=EXISTING_EMAIL_PLACEHOLDER` can replace `DEVCARE_TARGET_USER_ID` for an existing account lookup; prefer the verified UUID. When both are supplied, they must identify the same account. The script verifies the existing Auth/profile match and performs no Auth creation, invitation, password or confirmation changes.

4. Run the same command after changing only the secure target configuration to the existing friend account and its reviewed personal business:

   ```dotenv
   DEVCARE_OPERATOR_ACTION=configure
   DEVCARE_TARGET_USER_ID=FRIEND_AUTH_USER_UUID_PLACEHOLDER
   DEVCARE_TARGET_CLIENT_ID=FRIEND_PERSONAL_CLIENT_UUID_PLACEHOLDER
   ```

   The atomic `configure_administrator` RPC preserves that Auth user and invitation/password state, changes the existing profile to `admin`, archives its previous client membership rows in `private.retired_client_memberships`, removes only those archived rows from the active client membership table, and creates exactly one active administrator assignment. Other administrator assignments for that target become inactive. Rerunning the same conversion is safe. The friend's target must differ from the owner's client. Do not enroll either business administrator as a platform operator.

5. Review both results with trusted, read-only queries, then test each account using its own normal login and publishable key:

   ```sql
   select p.id, p.role, p.active, m.client_id, m.active as assignment_active
   from public.profiles p left join public.admin_client_memberships m on m.user_id = p.id
   where p.id in ('OWNER_AUTH_USER_UUID_PLACEHOLDER'::uuid, 'FRIEND_AUTH_USER_UUID_PLACEHOLDER'::uuid);
   select user_id, client_id, active from public.client_memberships
   where user_id = 'FRIEND_AUTH_USER_UUID_PLACEHOLDER'::uuid;
   select id, email, email_confirmed_at, invited_at from auth.users
   where id = 'FRIEND_AUTH_USER_UUID_PLACEHOLDER'::uuid;
   ```

   Each administrator should see only the explicitly assigned business, projects, tickets, replies, events, files, notifications and internal notes. Direct foreign UUID reads return no rows; foreign status/priority/reply/note/upload/download attempts fail. Verify the friend's original password still works and no duplicate Auth account exists. With a trusted operator, temporarily remove an assignment and verify a previously issued session immediately loses database and file access; restore only its reviewed business. Also verify disabled profiles/clients and ordinary client-user memberships on disposable fixtures. Existing historical notifications for another business remain stored but become invisible.

6. Inventory accounts without an administrator and assign them only after an ownership review:

   ```sql
   select c.id, c.name, c.active from public.clients c
   where not exists (
     select 1 from public.admin_client_memberships m join public.profiles p on p.id = m.user_id
     where m.client_id = c.id and m.active and p.active and p.role = 'admin'
   );
   ```

   Use `DEVCARE_OPERATOR_ACTION=assign` or `remove` with explicit existing administrator and client UUIDs, then run the operator command. These actions change assignment activity without promoting users or deleting history. An administrator with no active assignment cannot create a business; the trusted operator can create/review one and assign it first. An ordinary administrator who creates a new business receives only that new business's assignment. Disabling a business removes ordinary administrator access immediately; its restoration requires a trusted platform operator.

### Optional platform operator and administrator management UI

The server-side operator script is sufficient for the two business administrators. If browser management is needed, invite and verify a **separate operational account** using trusted Auth administration. Leave it unassigned to client/business accounts. In the ignored operator configuration set `DEVCARE_OPERATOR_ACTION=grant-operator` and its explicit `DEVCARE_TARGET_USER_ID`; run the same script. This service-role-only action records an explicit `platform_operators` entry. Existing administrators are never enrolled implicitly.

That account alone sees **Administrators** in navigation. It can invite a new administrator with an explicit business, convert an existing client profile by UUID, assign/remove administrator memberships, and disable/enable administrators. Administrator invitation reuses an existing matching Auth account when present. Accepted accounts receive no new invitation. Ordinary **Manage Users** invitations remain client-only and require ownership of the selected business; an existing user assigned outside the caller's scope cannot be claimed.

Platform operators can read account/profile/assignment metadata needed for these controls; they do not receive global ticket, message, attachment, notification or internal-note access. Treat their ability to manage grants as privileged. Grant/revoke the operator designation only through the server-side script (`revoke-operator`), never browser input. Revocation also works for a disabled operator profile. Protect/remove `.env.admin` afterward; service-role credentials never belong in `VITE_` variables. Assignment/conversion changes are recorded in `private.admin_access_events`.

`npm run test:database` checks the actual SQL in a temporary PostgreSQL cluster, including old-migration data preservation and conversion identity. `npm run test:integration` additionally checks real Supabase Auth, Storage and Edge Functions and requires a configured disposable `.env.test`. Do not run it against the live client project. Release still requires passing integration/security checks, correct backend/frontend environments, configured SMTP/callbacks and hosted smoke testing.

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

## 7a. Vercel deployment

Vercel can host the same frontend while PostgreSQL, Auth, Storage and Edge Functions stay in Supabase. The user requested this additional hosting option. `vercel.json` sets the Vite preset, `npm ci`, `npm run build`, `dist`, SPA rewrites and security headers. Vercel does not interpret Cloudflare's `_redirects` or `_headers` files. Node 24 is selected by `package.json`; set Node **24.x** in Vercel's Build and Deployment settings too.

Check the account's plan before a commercial launch: [Vercel Hobby permits only non-commercial personal use](https://vercel.com/docs/plans/hobby). A portal used for freelance client support needs a plan that permits commercial use. No plan purchase or upgrade is automated by this repository.

### GitHub import

1. Commit and push the current reviewed source, including `vercel.json`, `.vercelignore`, `package-lock.json` and the latest application fixes. Importing GitHub deploys the pushed commit, not uncommitted local work. Do not commit `.env*` credentials or `.vercel/` state.
2. In Vercel → Add New → Project, import `bernstain-dev/DevCare` using your authenticated GitHub/Vercel accounts.
3. Use framework **Vite**, root directory **repository root**, install command **`npm ci`**, build command **`npm run build`**, output directory **`dist`**, Node **24.x**.
4. Set only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as frontend build variables. Copy the values for the correct Supabase environment; do not use the Supabase dashboard URL. Do not import `.env.admin` or add service-role/SMTP credentials to Vercel.
5. Use separate preview and production Supabase projects and set each variable's Vercel environment scope accordingly. Vite values are embedded during build; changing them requires a redeploy. Keep real client data out of previews.
6. Deploy and copy the actual assigned HTTPS URL. Do not assume that `devcare.vercel.app` is available or that an arbitrary preview URL is permanent.

The reopened portal uses a manually verified Production deployment. The repository sets `git.deploymentEnabled.main: true` in `vercel.json` to enable automatic deployments from `main`; the earlier maintenance commit disabled these builds. Use Production frontend variables for Production builds and a separate backend for previews. Backend migrations and Edge deployments are separate from Vercel Git builds; review them before releasing dependent frontend changes.

### CLI preview

Authenticate in your own terminal; do not paste tokens into chat or shell arguments:

```powershell
npx --yes vercel@63.1.0 login
npx --yes vercel@63.1.0 link
```

Select the intended account/team and project. `.vercel/` local state is gitignored. `.vercelignore` also excludes local environment files, operator scripts, caches and generated output from CLI source uploads. Configure **Preview** variables for an isolated Supabase test project through the Vercel dashboard, then deploy a preview:

```powershell
npx --yes vercel@63.1.0 deploy --target preview
```

Always specify `--target preview`: Vercel can assign a project's first deployment to Production when the target is omitted, even without `--prod`. Confirm the deployment result says Preview. Do not use `--prod` until the launch checks and production configuration below are complete. Git pushes to the configured production branch can also deploy Production automatically; while preparing the release, disable Git deployments in the Vercel project or use a dedicated release branch as the production branch. Vercel deployment protection may require a Vercel login before a visitor can reach the app; review it deliberately for testers. Clients should eventually receive the canonical public production portal URL and authenticate inside DevCare.

If the default npm cache drive is full, keep both cache and CLI state in ignored workspace folders: `npm exec --cache .verification/npm-cache --yes --package vercel@63.1.0 -- vercel login --global-config .verification/vercel-user`. Use the same `--global-config .verification/vercel-user` option for subsequent `whoami`, `link` and `deploy` commands. This does not delete or change unrelated files. The CLI state contains credentials: keep it ignored and excluded from source uploads.

### Maintenance announcement and mode

`public/maintenance.json` controls frontend availability. The repository and the live Production deployment use `mode: "off"`, reopening the portal after the update. Change its `mode` and deploy the reviewed source for future maintenance windows:

- `announcement`: show the configured `title` and `message` above every portal screen while allowing normal access. Tell users when the update begins and to save their work; use Asia/Manila for any displayed schedule.
- `maintenance`: replace every route, including sign-in, recovery, invitations and signed-in workspaces, with the maintenance notice. New visits do not initialize Supabase Auth or load the workspace.
- `off`: restore the portal at the original URL and remove the announcement.

Keep `title` and `message` as nonempty strings. No end time is promised by default. The availability check requests `/maintenance.json` without browser caching; the hosting header also sets `Cache-Control: no-store` ([Vercel cache headers](https://vercel.com/docs/caching/cache-control-headers)). Tabs running this version check every minute and when focused. The **Check again** button retries immediately. Missing, invalid or unreachable status shows an unavailable screen until a successful check. The maintenance query has its own cache so authentication cache resets cannot discard the availability status.

After a browser observes `maintenance`, it can show one **Update complete** notice when the matching release becomes `off` and the portal bundle has loaded. Ordinary visits/refreshes without that maintenance visit show nothing. The notice uses a short CSS animation, a polite accessible message, a dismiss button and a ten-second timeout; reduced-motion preferences show the same message without animation. It never blocks navigation or changes authentication.

Use `VITE_APP_RELEASE_ID` at build time, or update `DEFAULT_UPDATE_RELEASE_ID` in `src/lib/updateComplete.ts`. The current fallback is `2026-10-11.1`; use a new stable identifier for each maintenance release (1–80 letters/digits/dots/underscores/hyphens, beginning with a letter or digit). Set `public/maintenance.json`'s `release_id` to that same **target** identifier when entering maintenance, and keep it when switching to `off`. This lets the old maintenance page record the upcoming release, while preventing an old cached bundle from celebrating an update it has not loaded. A stale tab must reload the matching build before it can show the notice; availability routing itself remains unchanged. A version change alone does not trigger the notice.

Only public release identifiers are stored: `devcare:update-pending` records the observed maintenance release; `devcare:update-complete:<release-id>` stores that release ID immediately before the committed notice is painted. Refreshes, repeat maintenance checks and duplicate React renders cannot replay a recorded release. The pending marker is removed after a successful claim. If browser storage is unavailable or cannot persist the shown marker, the notice is skipped and the portal continues normally. There are no database writes, cookies or server-side completion records. Clearing browser storage can permit a future maintenance visit to show the notice again.

This is a frontend gate, not a database or API write lock. Existing tabs on older frontend versions must reload to receive it, and requests already sent can finish. Unsaved form input is lost when a running workspace enters maintenance, so deploy the announcement before a planned window. Existing stored sessions are retained; recovery/invitation links can expire during a long window. Coordinate any incompatible backend migration separately and enforce a server-side write freeze if the update requires one.

With the updated `main: true` configuration, pushes to `main` build Production automatically. The short alias is manually managed and should be verified after promotion. For an isolated Preview, deploy explicitly with `--target preview`, verify it and move only the intended test alias. Production promotion still requires the launch checks.

For a maintenance-only window, the public domain may temporarily point to a verified Preview deployment with `mode: "maintenance"`, retaining the prior Production deployment for rollback. Keep Preview variables isolated; do not open this Preview portal on a production domain by changing it to `off` or `announcement`. To resume client access, restore the previous verified Production deployment or release an updated Production build with its correct backend and required launch checks.

### Current short testing address

The testing portal uses **https://devcare-rho.vercel.app**. `devcare.vercel.app` was unavailable. The short address is a manually assigned alias of the verified Preview deployment, not a Production promotion. Vercel Authentication is enabled for **All Deployments** so this short domain preserves the preview's sign-in requirement. Supabase Auth Site URL, exact invitation/reset callbacks, Edge Function `SITE_URL`/`ALLOWED_ORIGINS`, and ignored operator `DEVCARE_SITE_URL` use this short origin. The previous hosted callbacks/origin remain allowed for existing test links.

Live hosting inspection on 11 October 2026 superseded this earlier preview-only state: **https://devcare.tech**, **https://devcare-rho.vercel.app**, and the project's default domain point to READY Production deployment `dpl_GCbRkzqjd27TcyaUKae1GbTs2Z41` (`devcare-pq8j5q8lq-fangonbernstain566-collabs-projects.vercel.app`), and Vercel SSO protection is no longer enabled. This inspection did not verify or change Supabase callbacks, SMTP, migrations, or backend credentials. See the latest maintenance entry in `VERIFICATION.md` for subsequent alias changes.

The maintenance rollout subsequently moved these three aliases to verified deployment `dpl_DfsdKCzPYNfbgk1mdSxZMnLK2qmg` (`devcare-ppm4nwvh1-fangonbernstain566-collabs-projects.vercel.app`), built from maintenance source commit `daedb5c` with an explicit Preview target. `https://devcare.tech` now serves the public maintenance notice. No Production promotion or backend release occurred. Keep this Preview in `maintenance` on the public domain. To end the window by restoring the retained Production deployment, reassign each alias with:

```powershell
npx --yes vercel@63.1.0 alias set devcare-pq8j5q8lq-fangonbernstain566-collabs-projects.vercel.app devcare.tech --scope fangonbernstain566-collabs-projects
npx --yes vercel@63.1.0 alias set devcare-pq8j5q8lq-fangonbernstain566-collabs-projects.vercel.app devcare-rho.vercel.app --scope fangonbernstain566-collabs-projects
npx --yes vercel@63.1.0 alias set devcare-pq8j5q8lq-fangonbernstain566-collabs-projects.vercel.app devcare-fangonbernstain566-collabs-projects.vercel.app --scope fangonbernstain566-collabs-projects
```

If the backend changed during maintenance, restore frontend access only after checking compatibility with that backend. To keep this new maintenance capability in the reopened portal, instead build and release the updated source with `mode: "off"` using the intended environment and its release checks.

The subsequent maintenance frontend rollout manually published the user's pushed commit `7cfd11f` as READY Preview deployment `dpl_6VFE3fUUNAw7UcVk7gggURV9ytYc` (`devcare-1879xiyc2-fangonbernstain566-collabs-projects.vercel.app`). These same three aliases now point to that newer build. Maintenance remains active with release ID `2026-10-11.1`. A push did not build automatically because `git.deploymentEnabled.main` is still `false`; this manual rollout did not change that release policy or apply pending backend changes. See the latest [verification entry](VERIFICATION.md) for the remote build and hosted checks.

The later reopening supersedes those maintenance alias assignments: all three public aliases now use READY Production deployment `dpl_6Ga7wbncHtttacTStrPJ8zbnNGUi` (`devcare-5kpn4xoo2-fangonbernstain566-collabs-projects.vercel.app`) with maintenance off and the same completion release identifier. Before promotion, the scoped forward migration, updated Edge Functions, reviewed owner/new-business and friend/existing-business assignments, canonical Auth callbacks and Edge origins were applied. Original Auth rows, identities, business records, unaffected client memberships, ticket history and private file bytes were verified unchanged; converted memberships were archived. An encrypted operator backup remains outside source uploads in ignored local verification storage. See [VERIFICATION.md](VERIFICATION.md) for exact checks and unperformed integration/SMTP checks. Older frontend versions may be incompatible with the new private-file response, so do not restore a pre-cutover frontend or global authorization implementation. Reload an old open tab to obtain the reopened build.

After verifying a future Preview deployment, move the short testing address to it explicitly:

```powershell
npx --yes vercel@63.1.0 alias set YOUR_VERIFIED_PREVIEW.vercel.app devcare-rho.vercel.app --scope fangonbernstain566-collabs-projects
```

Do not replace the canonical Supabase callback origin with each generated deployment URL. Changing the alias leaves existing browser sessions tied to their original origin; sign in again at the short address when switching. A real client release still requires the production backend and launch checks below; configure public access to its canonical domain deliberately after those checks pass.

### Connect hosted invitations, recovery and files

After deployment, use the **actual** canonical HTTPS origin in the following settings. `https://YOUR_PORTAL.vercel.app` below is a placeholder, not a claimed deployment:

1. In the matching Supabase project → Authentication → URL Configuration, set **Site URL** to `https://YOUR_PORTAL.vercel.app` and allow exactly `https://YOUR_PORTAL.vercel.app/accept-invitation` and `https://YOUR_PORTAL.vercel.app/reset-password`.
2. Set Edge Function `SITE_URL` and `ALLOWED_ORIGINS` to that origin:

```powershell
npx --yes supabase@2.120.0 secrets set SITE_URL=https://YOUR_PORTAL.vercel.app ALLOWED_ORIGINS=https://YOUR_PORTAL.vercel.app
```

3. Retain both deployed Supabase functions (`admin-users` and `files`). The origin secret update applies to both. If supporting other origins, explicitly include their exact origins in `ALLOWED_ORIGINS` only for the appropriate environment; do not use a wildcard. The single `SITE_URL` controls the invitation destination.
4. Update ignored operator `DEVCARE_SITE_URL` for future bootstrap operations. Do not overwrite an existing admin or resend invitations until the hosted origin and SMTP setup are verified. Previously sent emails keep their old destination; issue a fresh invitation/reset when appropriate.
5. Confirm custom SMTP is saved and test actual invitation delivery, password setup and recovery on another device. A `.vercel.app` address hosts the frontend; it does not provide an email-sending domain or fix SMTP delivery by itself.
6. Verify direct loads and refreshes at `/login`, `/accept-invitation`, `/reset-password`, `/projects/:id` and `/tickets/:id`, browser security headers, role isolation, private attachments and disabled-user enforcement on the hosted origin. Do not run the destructive/disposable integration suite against the real client project.

After these checks and all release requirements pass, promote the verified deployment through Vercel or deploy the reviewed source with `npx --yes vercel@63.1.0 deploy --prod`, using production-scoped frontend variables. A frontend rollback does not roll back Supabase migrations, Auth settings, secrets or stored data. Maintain the same backup and migration rollback precautions documented below. See [Vercel's Vite SPA guide](https://vercel.com/docs/frameworks/frontend/vite) and [deployment environments](https://vercel.com/docs/deployments/environments).

## 8. Private files and maintenance

PNG, JPEG, WebP and PDF only; 5 MiB each; maximum three per original ticket or public reply. The frontend checks names/types/size, the Edge Function validates extension and file signature, PostgreSQL reserves slots under a ticket row lock, and the private bucket limits types/bytes. File-signature checks establish format, not malware scanning; PDFs are forced to download and never rendered in the portal. Only authors may attach files to their own report/reply. Internal notes have no attachment surface. No Storage policies give browser users direct bucket access.

Downloads return authenticated file bytes through the Edge Function, with a second live attachment-scope check before returning bytes and `Cache-Control: no-store`. The frontend creates a temporary local Blob URL and revokes it after download; new reusable Storage bearer links are never issued. Profile, membership and business revocation apply to subsequent downloads using existing sessions. Already downloaded bytes cannot be recalled. Previously issued signed links from the old function remain usable until their old expiration; allow their previous 60-second lifetime to pass during the cutover window. The bucket remains private, with no browser write policies.

If one file fails, the report/reply remains saved and only unsuccessful files are offered for retry. Failed reservations are removed after storage cleanup succeeds. Cleanup atomically claims rows as `deleting` before touching Storage; it preserves finalized files and retains failed removals for retry. After a crash or lost response, use Profile & Settings → **Clean Abandoned Uploads** daily; it processes pending reservations older than 24 hours and retries incomplete removals, up to 100 at a time. Repeat until no batch remains. Ordinary administrators must select their assigned account and send `{ "action": "cleanup", "client_id": "ASSIGNED_CLIENT_UUID_PLACEHOLDER" }`; every claimed row is scoped. Only an explicit active platform operator may omit `client_id` to clean across accounts, using that operator's authenticated bearer token. Do not use an unprotected cron secret or service key in the browser. A failure to finalize cannot expose a pending file.

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
