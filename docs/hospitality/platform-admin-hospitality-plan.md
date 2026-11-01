# "ניהול Hospitality" in the super-admin panel — architecture and plan

Status: **§4 (dashboard) and opening a business implemented on 02/11/2026** (`hospitality/stage-2`,
migration 15 `20261102090000_hosp_platform_open`) — the owner's instruction "a hospitality business
can be opened and run through the system". §3 (Staging links) not built (no Staging yet).

**As implemented — "ניהול Hospitality" (`/platform/hospitality`, platform host only):**
- **Engine switches** for the whole platform (`hospitality_backend_enabled`,
  `hospitality_management_enabled`) — without both no Hospitality site opens to its owner.
- **Open a business:** name, address (slug; preview `<slug>.<TENANT_BASE_DOMAIN>`), the owner's
  email (+ name), plan (trial = the automatic 14-day trial; another plan = active, optional end
  date). `admin_open_site` creates the site (Stage 1e `admin_create_site`), turns on the site's
  database and management flags (public site and guest bookings stay off) and sets the plan;
  `admin_set_owner` attaches the owner — the server opens a password-less account only when the
  database answers `needs_account` (as for managers, 2b.3); the owner signs in at
  `/manage` with an email code and sets everything up from the setup checklist. A ready message
  for the owner (management link + how to sign in) can be copied.
- **Sites list:** owner (or "שיוך בעלים"), plan and status, units used / limit, properties,
  pending / upcoming bookings, managers; per site: management on / off, change plan (extra units
  kept), management link.
- **Separation:** the screen is Hospitality code (`src/engines/hospitality/platform-admin/`,
  route adapter `src/routes/platform_.hospitality.tsx`); the Ecommerce panel only got a tab link.
  Its server functions (`api/platform-admin.functions.ts`) are the only Hospitality functions the
  engine guard lets run on the platform host — and never on a site (`Engine.platformAdminServerFn`).
  Every database function checks `is_platform_admin()` and writes `platform_audit_log`.
- **Not yet:** self sign-up from the landing page (Stage 6, OD-15); entering a site's management
  as the platform admin from this tab (the "כניסה" handoff in the stores tab works for Hospitality
  sites); owner transfer; deleting a site's files with the site.

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

## 6. Stage 11 scope added in round 7 (approved 31/10/2026 — roadmap D27)

Not part of the first step (§3) or the dashboard (§4); built in roadmap Stage 11, each part
with its own plan and approval. Original requirement: the Hospitality group of the
platform admin (spec #1 part 2, #23 part 5) — reviews, customers and an availability board.

| Area | What the platform admin gets | Separation and permissions |
|---|---|---|
| Reviews | a cross-site queue of reported reviews; hide / restore with a reason (Stage 9 data) | every action in the platform action log; owners keep moderating their own site |
| Customers (guests) | find a guest **within one chosen site**; contact masked by default; full details only when explicitly opened with a reason | each opening logged; no merging of guest records across sites (identity only through a verified auth account); export / anonymise stay owner rights per site unless decided otherwise |
| Global availability board | read-only board per chosen site (or a short list of sites), the same `calendar` read as the owner's board (3a) | `is_platform_admin()` on every call; one site id per call; changes only through the existing handoff into the site's own management |

Common rules: everything through Hospitality database functions that require a platform
admin (as in §2); no Ecommerce table or function; tests per role (platform admin, owner,
manager, other site, anonymous). Open: whether "customers" also means business owners
(register in `requirements-traceability.md`).
