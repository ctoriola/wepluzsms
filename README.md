# Wepluz School Management System

Multi-school management platform by MANDEXA. **Firebase** (Auth + Firestore) for data and sign-in, **Vercel** for hosting the web app and the server API.

Planning documents and guides: [`docs/`](docs/). Step-by-step deployment: [`docs/Firebase_Vercel_Deployment_Guide.pdf`](docs/Firebase_Vercel_Deployment_Guide.pdf).

## No migrations to paste

Firestore has no tables to create. Everything is installed for you:

- **`/setup` page**: open it once after deploying, enter your setup token, click **Install demo** (or **Install** for real schools). It publishes the security rules and creates the demo data or your platform admin account.
- **Every Vercel deploy** re-publishes `firestore.rules` automatically (`scripts/sync-rules.mjs`), so the security rules always match the code.
- Platform admins can also re-publish the rules any time from **Platform > Schools > Publish rules**.

## Deploy (summary; full steps in the PDF guide)

1. Create a Firebase project. Turn on **Email/Password** sign-in. Create a **Firestore** database.
2. Add a **Web app** in Firebase and copy its config values.
3. Generate a **service account key** (Project settings > Service accounts).
4. Import this GitHub repo into **Vercel**. Add the environment variables from `.env.example`.
5. Deploy, then open `https://your-app.vercel.app/setup` and install.

Free tiers are enough to run the demo and a pilot: Firebase **Spark** plan (no card) and Vercel **Hobby**. Vercel's Hobby plan is for non-commercial use, so move to Vercel Pro before charging schools.

## How it is built

```
api/rpc.ts            the one Vercel Function: POST /api/rpc { action, payload }
server/
  core.ts             Firebase Admin, auth check, roles, audit log, input checks
  actions/            setup, public (branding, SMS codes), people, academics
  seed.ts             demo schools and accounts
  template.ts         Nigerian class and subject starter template
firestore.rules       who can READ what (all writes go through the server)
src/                  React web app (Vite + TypeScript + Tailwind)
tests/server/         80 tests against the Firebase emulators (rules + every action)
scripts/sync-rules.mjs  publishes the rules on each Vercel build
```

- **Reads**: the browser reads Firestore directly. `firestore.rules` lets people see only their own school, and only what their role allows (e.g. teacher assignments are staff-only, the audit log is proprietor/principal only).
- **Writes**: every change goes through `/api/rpc`, which checks the person's role and the school rules (unique names, term dates inside the session, no overlapping terms, cannot delete things in use, one teacher per subject per class, last proprietor protected, and more), then writes with an audit log entry.
- **One function**: all actions share one Vercel Function, keeping well under the Hobby plan's limit of 12.
- **Logos** are resized in the browser and stored in Firestore, because Firebase Storage now needs the paid Blaze plan.
- **Parent SMS login** uses Termii: the server sends a 6-digit code and signs the parent in with a Firebase custom token. This works on the free Spark plan (Firebase's own phone sign-in needs Blaze). Until Termii keys are set, the app says so and parents can use email.

## Design system

Mint backdrop, white rounded app frame, curved teal sidebar, soft grey cards, Outfit font.

| Token | Value | Use |
|---|---|---|
| `brand` | #2E7D69 teal | sidebar, buttons, icon chips, links, line charts |
| `accent` | #F5C448 sunflower | logo mark, progress bars, bar charts, avatar chip |
| `mint` | #DDF3ED | page backdrop |
| `surface` | #F4F6F8 | cards (`.card`) |
| `ink` | #171D26 | text |
| `school` | the school's own colour | school logo fallback only |

Colours live as CSS variables in `src/index.css` and as Tailwind names in `tailwind.config.js`. Shared pieces are in `src/components/ui.tsx` (`Button`, `Badge`, `CardTitle`, `IconChip`, `Modal`) and `src/components/charts.tsx` (`LineChart`, `BarChart`: no chart library, hover tooltips, and a table for screen readers). The dashboard adapts by role: leadership sees school-wide numbers and charts, teachers see their classes and register, parents see their children.

## Updating an existing site

Some releases need a one-off data update (for example WS2 adds teacher class lists that the security rules use). After Vercel deploys a new version, sign in as a platform admin and open **Platform > Schools**. If a banner says a new version was deployed, click **Run data updates**. It is safe to run more than once.

## Who sees which students

- Proprietor, principal, school admin and bursar: every student.
- Teachers: only students in arms where they are the form tutor or teach a subject this session.
- Parents: only their own children (once the school gives them a parent login).
- Medical details: leadership and the child's own parents only. Teachers see a "medical alert" flag.

## Roles

proprietor, principal, school_admin, bursar, teacher, parent. One person can hold several roles and belong to several schools. MANDEXA platform admins (a Firebase custom claim set by `/setup`) can see and create every school.

## Status

| Workstream | What | Status |
|---|---|---|
| WS0 | Schools, sign-in (staff email, parent SMS code), roles, invites, school profile and logo, audit log, one-click setup | Done |
| WS1 | Sessions and terms, current term, classes and arms, form tutors, subjects grid, teacher assignments, Nigerian template, teacher "My classes" | Done |
| WS2 | Student records: profiles, photos, medical (private), guardians and parent logins, admission numbers, change class, withdraw/reinstate, Excel/CSV import, end-of-session promotion, parent "My children" | Done |
| WS3 | Attendance: phone-friendly daily register (works offline), form tutor today / admin any day, holidays, day overview, student attendance tab for staff and parents, absences queued for parent alerts | Done |
| UI | Wepluz design system: new app shell with page and student search, role-based dashboard with attendance trend and class sizes, new sign-in page | Done |
| WS4 | Results and report cards | Next |

## Local development

Requires Node 20+ and Java 11+ (for the Firebase emulators).

```bash
npm install
```
```bash
npm run emulators
```
In a second terminal, with `VITE_USE_EMULATORS=true`, `VITE_DEMO_MODE=true` and any `SETUP_TOKEN` in `.env.local`:
```bash
npm run dev
```
Open http://localhost:8080/setup, install the demo, then sign in with a demo button.

## Tests

```bash
npm test
```
```bash
npm run test:server
```
The second command starts throwaway Firebase emulators and runs the 80 rules and API tests: tenant isolation, every role's permissions, all school rules, audit entries, and the SMS login flow.
