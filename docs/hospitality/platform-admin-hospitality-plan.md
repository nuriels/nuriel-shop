# "ניהול Hospitality" in the super-admin panel — architecture and plan

Status: **proposal — nothing implemented.** Built only after approval, as its own small step.

## 1. What exists today (verified in the code)

- The super-admin panel is the existing `/platform` area on the platform host
  (`PLATFORM_ADMIN_HOST`), Ecommerce-era code: `src/routes/platform*.tsx`,
  `src/components/platform/*` (`PlatformShell` with the tabs חנויות · תמיכה · חבילות · שדרוגים).
- Who is a super admin is decided **in the database**: `public.is_platform_admin()`;
  server functions check it before any action (`assertPlatformAdmin` in
  `src/lib/platform-files.functions.ts`); the panel shows its navigation only to platform
  admins. Store owners and Hospitality managers are not platform admins.
- Hospitality already has platform-admin database functions (Stage 1e, migration 5):
  `hospitality.admin_overview()`, `admin_site_stats()` (per site: plan, subscription status,
  active, units used / limit, bookings counts, flags), `admin_plans()`,
  `admin_set_subscription()`, `admin_create_site()` — all refuse non-platform-admins
  (`_require_platform_admin`).
- The existing handoff ("כניסה לחנות" from the panel → `/admin-handoff` → `/admin`) already
  lands in `/manage` on a Hospitality site (Stage 2a), so "enter a site's management" needs
  no new login mechanism.
- The engine contract (`src/platform/engines/contract.ts`) already reserves a
  "super-admin provider" for engines (comment: added when it has a use).

## 2. The rule that keeps the engines independent

```
/platform (existing panel, platform host)
   └─ PlatformShell tabs ← one new tab "ניהול Hospitality"
          └─ rendered from src/app (composition root) — the only code that knows both sides
                 └─ Hospitality engine: src/engines/hospitality/platform-admin/ (its own screen)
                        └─ api/platform-admin.functions.ts → hospitality.admin_* (database)
```

- The panel (Ecommerce-era code) gets **one tab link** and an outlet; it never imports the
  Hospitality engine directly — the composition root wires the engine's screen in, exactly
  like the site shell (`src/app/site-shell.tsx`). Boundary rules (ESLint + architecture
  test) keep enforcing this.
- The Hospitality screen talks only to Hospitality database functions that already require
  a platform admin; no Ecommerce table is read, no Ecommerce function is called.
- No new super-admin system, no new roles, no new login: the same `is_platform_admin`.

## 3. Step 1 (first delivery): three links

Tab **"ניהול Hospitality"** (route `/platform/hospitality`, platform host only), visible
only to platform admins:

| Link | Value |
|---|---|
| Staging — ממשק ניהול | `https://stg.nuri1.fit` |
| Staging — API | `https://api-stg.nuri1.fit` |
| אתרי אירוח לבדיקה | `https://<slug>.stg.nuri1.fit` — a small form: type a slug → open |

- The addresses come from **server configuration** (environment variables, e.g.
  `HOSPITALITY_STAGING_URL`, `HOSPITALITY_STAGING_API_URL`,
  `HOSPITALITY_STAGING_SITE_DOMAIN`), read by a server function that first checks
  `is_platform_admin()` with the caller's token — so the URLs are never in the browser
  bundle and an outsider calling the function gets "no permission". Not configured →
  the tab says "Staging לא הוגדר".
- Server-side enforcement in three places: the platform host gate (as today), the route
  guard (platform admin, otherwise the panel's existing "no access"), and the server
  function itself.
- Tests: platform admin sees the three links; store owner, Hospitality owner / manager and
  anonymous do not see the tab and get a refusal from the function directly; on a store
  host and on a Hospitality host `/platform/hospitality` does not exist; Ecommerce panel
  tabs unchanged (screenshot / text baseline); axe.

**Important — environments stay separate.** A link is only a link: the Production panel
does
not read the Staging database, and Staging does not read Production. Managing Staging's
sites happens in Staging's own panel (`https://stg.nuri1.fit/platform`) with a Staging
super-admin account. That is what keeps Staging fully isolated (database, keys, emails).

## 4. Later (full dashboard, same tab)

From the **same environment's** database, through the existing admin functions:
- list of Hospitality sites: name, address, plan, subscription status, trial end, units
  used / limit, active / suspended, flags (database, management, website, booking);
- per site: "כניסה לניהול" (existing handoff → `/manage`), change plan / extra units /
  extra managers (existing `admin_set_subscription`, `admin_set_extra_managers`),
  open / close flags (existing `platform_set_flag`);
- totals: `admin_overview()`.
No new database access paths are needed for this; only screens.

## 5. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| P-A1 | Where the tab lives | in the existing `PlatformShell` tabs, wired through `src/app` |
| P-A2 | Staging addresses | server environment variables, never hard-coded in the bundle |
| P-A3 | When | after 2c (or between 2c steps), as one small separately approved step |
| P-A4 | Staging management | in Staging's own `/platform` (separate database and accounts), not from Production |
