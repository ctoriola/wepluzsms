# Wepluz School Management System

Multi-school management platform by MANDEXA. Built on Supabase (database, auth, storage, Edge Functions) with a React web app.

Planning documents: [`docs/`](docs/) (feature blueprint and Phase 1 build tasks).

## Status: WS0 Foundations

| Task | What | Status |
|---|---|---|
| 0.01-0.03 | WhatsApp, Termii sender ID, Paystack applications | **You** - external accounts |
| 0.04-0.07 | Supabase projects, Lovable, n8n | **You** - see setup below |
| 0.08 | Secrets kept server-side only | Done (`.env.example` holds only public values) |
| 0.09 | `schools`, `school_settings` | Done |
| 0.10 | `profiles` synced from `auth.users` | Done |
| 0.11 | Roles + `school_memberships` (one person can hold several roles / schools) | Done |
| 0.12 | Access helper functions | Done |
| 0.13 | RLS on every table, column-level edit limits | Done |
| 0.14 | Tamper-proof audit log | Done |
| 0.15 | Staff login, forgot / set password | Done |
| 0.16 | Parent phone + SMS code login (Termii via Supabase Send SMS hook) | Done |
| 0.17 | App shell with role-based menu, mobile drawer, school switcher | Done |
| 0.18 | School profile settings + logo upload | Done |
| 0.19 | Staff & access: invite, change role, suspend, remove | Done |
| 0.20 | Development seed data (two schools, every role) | Done |

## Project layout

```
supabase/
  migrations/      database schema, security rules, audit log, storage (run in order)
  functions/
    invite-member/ invite a person to a school with a role
    send-sms-hook/ delivers login codes through Termii
  seed.sql         demo data - development only, never production
src/               React web app (Vite + TypeScript + Tailwind)
tests/
  db/              security tests: 63 checks across every role and tenant
  functions/       SMS hook test against a fake Termii server
docs/              planning PDFs
```

## How access works

- Every school is a tenant. Every table has row-level security, so a user can only ever read or change rows the database allows, whatever the app does.
- Access comes from `school_memberships` (person, school, role). A teacher can also be a parent; a proprietor can own several schools.
- Roles: proprietor, principal, school_admin, bursar, teacher, parent.
- Proprietors can manage every role. Principals and school admins can manage school_admin, bursar, teacher and parent. Nobody can change their own access, and a school always keeps at least one active proprietor.
- New memberships are created only by the `invite-member` Edge Function, after the database confirms the caller may grant that role.
- Changes to schools, settings and memberships are written to `audit_log`, which proprietors and principals can read and nobody can edit or delete.

## Setup (your part)

### 1. Supabase project
1. Create two projects at supabase.com: `wepluz-dev` and `wepluz-prod` (region closest to Nigeria, e.g. EU West / London).
2. Install the Supabase CLI, then in this folder:
   ```bash
   supabase login
   ```
   ```bash
   supabase link --project-ref YOUR_DEV_PROJECT_REF
   ```
   ```bash
   supabase db push
   ```
3. Development only: load demo data by pasting `supabase/seed.sql` into the SQL editor. All demo staff use the password `Password123!`.

### 2. Auth settings (Dashboard > Authentication)
1. **Sign In / Providers**: turn **off** "Allow new users to sign up". Only invited people can get in.
2. Enable the **Phone** provider.
3. **URL Configuration**: Site URL = your app URL. Add `https://YOUR_APP_URL/set-password` (and `http://localhost:8080/set-password` for dev) to Redirect URLs.
4. **Hooks > Send SMS hook**: choose HTTPS, URL `https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-sms-hook`, click generate secret and copy it.

### 3. Edge Functions
```bash
supabase secrets set SEND_SMS_HOOK_SECRET="v1,whsec_..." TERMII_API_KEY="..." TERMII_SENDER_ID="WEPLUZ" TERMII_BASE_URL="https://YOUR_TERMII_BASE_URL" APP_URL="https://YOUR_APP_URL"
```
```bash
supabase functions deploy send-sms-hook --no-verify-jwt
```
```bash
supabase functions deploy invite-member
```
`TERMII_CHANNEL` defaults to `dnd` so codes reach DND-registered Nigerian numbers; ask Termii to activate the DND route on your account.

### 4. First school (production bootstrap)
1. Dashboard > Authentication > Users > **Add user** with your own email and a strong password.
2. In the SQL editor, make yourself a platform admin and create the school:
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'you@mandexa.com';

   insert into public.schools (name, slug, short_code)
   values ('Pilot School Name', 'pilot-school', 'PLT');
   ```
3. Sign in to the app. As platform admin you see every school. Open **Staff & access** and invite the school's proprietor.

### 5. Run the web app
```bash
npm install
```
```bash
cp .env.example .env.local
```
Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings > API), then:
```bash
npm run dev
```
Hosting: any static host works (Netlify, Vercel, Cloudflare Pages). `public/_redirects` handles page routes on Netlify.

### 6. Lovable
Lovable links a project to a GitHub repository it manages. Check in Lovable whether it can import this repository. If it can't, the app still runs and can be extended without Lovable. Keep business rules in SQL and Edge Functions so screens stay easy to rebuild.

## Tests

```bash
npm test
```
```bash
npm run build
```
```bash
npm run test:db
```
`test:db` starts a throwaway PostgreSQL (16+), applies every migration and the seed, then runs the security tests. It needs PostgreSQL installed and must run as a non-root user.
```bash
npm run test:functions
```
`test:functions` needs Deno.
