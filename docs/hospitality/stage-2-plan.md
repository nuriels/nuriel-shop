# Nuriel Hospitality — Stage 2 plan: owner management system

Status: **breakdown approved; 2a (`3e246f2`) and 2b (`d119a02`, `24973aa`, `9d95676`, `6b279f4`) implemented and approved; R-1 fixed before 2c (migration 9); 2c approved (`stage-2c-plan.md`), 2c.1 (database, migration 10, `0efc471`) approved, 2c.2 (screens) implemented; P0 local preview kit (`238995e`) approved; 2c.3 (unit and property pages, whole property, order, activation, archive / delete, `e2de74d`) and 2c.4 (dashboard units card, setup link) implemented — awaiting review (`stage-2c-plan.md`). The overnight continuous approval of 01/11/2026 covers 2d → 2e → 2f → 3a in order; 2d (unit and property details, migration 11), 2e (photos and galleries, migration 12), 2f (prices and policies, migration 13) and 3a (calendar board I, migration 14) implemented — awaiting review (`stage-2d-plan.md`, `stage-2e-plan.md`, `stage-2f-plan.md`, `stage-3a-plan.md`). 02/11/2026 (owner: build the product to run a real business; tests at the end on the owner's server): P1 opening a business from the platform panel (migration 15, `platform-admin-hospitality-plan.md`), 2h + 2i bookings (migration 16, `stage-2h-2i-plan.md`), 3b day view and board actions, 2j guests and privacy (migration 17, `stage-2j-plan.md`), 2k emails and dashboard (migration 18, `stage-2k-plan.md`) — Stage 2 complete; RT design closed as in A4, its build awaits approval.** Open items: §7.
**Round 7 (31/10/2026, after the requirements audit — roadmap D19–D30):** approved order
2c.3 → 2c.4 → 2d → 2e → 2f → **3a** → 2h → 2i → **3b** → 2j → 2k; 2g merged into 3a; 2d and
2e scopes extended (§3); house rules at property level (2d). Every requirement and its
state: `requirements-traceability.md`.
Branch: `hospitality/stage-2`, created from `hospitality/stage-1` at `0f59e85` (Stage 1 unchanged).
Builds on Stage 1 (migrations 1–6, engine layer 1f). Product roadmap: `stage-1-plan.md` A4
"Stage 2"; engine rules: `architecture.md`.

---

## 0. Summary

Stage 2 turns the Stage 1 backend into a working management area for the business owner,
at `https://<site>/manage` on Hospitality sites only. It was split into **11 sub-stages**;
round 7 (D19) brought the calendar board (Stage 3) forward as **3a** and **3b** inside this
order and merged 2g into 3a. Each sub-stage is small, ships its own migration (if any),
server functions, screens and tests, extends the preview kit (§2.6), and passes the full
Ecommerce regression before it is reported.

| # | Sub-stage | Main output | Migration |
|---|---|---|---|
| **2a** ✓ | Foundation: access, shell, login, seat limit, security fixes | `/manage` opens on a Hospitality site; mobile/RTL shell; setup checklist | 7 ✓ |
| 2b ✓ | Business settings and team | business details, check-in/out, booking rules, notification emails; managers and seats | 8 ✓ (R-1: 9 ✓) |
| 2c | Properties and units (2c.1 ✓ 2c.2 ✓ 2c.3 ✓ 2c.4 ✓ — awaiting review) | create / edit / order / activate units; whole-property units; unit-limit UX | 10 ✓ |
| 2d ✓ (awaiting review) | **Unit and property details** (extended — D20, D21; `stage-2d-plan.md`) | beds per room; amenity catalogue + custom, private / shared; parking; bathrooms + separate toilets; max adults / children; map location; guest info (public + private arrival info); property-level house rules snapshotted per booking; action log for beds and amenities | 11 ✓ (`20261101190000_hosp_details`) — additive |
| 2e ✓ (awaiting review) | **Photos and galleries** (extended; `stage-2e-plan.md`) | upload (phone / computer), link import with a server copy, real content checks, SSRF protection, galleries (site / property / unit), cover / order / delete / replace, ALT, video, optimisation, storage usage | 12 ✓ (`20261101200000_hosp_media`) |
| 2f ✓ (awaiting review) | Pricing, rate rules and cancellation policies (`stage-2f-plan.md`) | base / weekend / seasons / holidays; price preview; policy editor with live example (house rules moved to 2d) | — |
| ~~2g~~ | ~~Availability blocks~~ — **merged into 3a** | — | — |
| **3a** | **Calendar board I** (D19) | month / week board of all units + per-unit view; bookings and blocks coloured by status; whole property; filters; automatic refresh; block / release from the board; built for many units | expected 13 |
| (RT) | Hotel room types — **design closed before 2h**; implementation stage decided then (recommended here) | room type → physical rooms; a specific room per booking; room move | if approved |
| 2h | Bookings — view and decide | list, search, detail, approve / decline, check-in / out | expected 14 |
| 2i | Bookings — change, cancel, manual booking | modify, cancel, cancellation requests, "הוספת הזמנה" | — |
| **3b** | **Calendar board II** (D19) | day view; arrivals / departures; actions from the board; manual booking by selecting a date range; performance tests | — (or small) |
| 2j | Guests and privacy | guest list (masked), guest card, notes, export / anonymise | expected 15 |
| 2k | Emails: outbox worker, status, retry, dashboard widgets | emails actually leave through the Nuriel email API (locally mocked); retry / resend; full dashboard | expected 16 |

**Approved order (D29, 31/10/2026):** 2c.3 → 2c.4 → 2d → 2e → 2f → 3a → 2h → 2i → 3b → 2j →
2k. Gates: **before 2d** its detailed plan must contain every approved field and behaviour
(§3 "2d"); **before 2h** the hotel room types design is closed (roadmap "Hotel room types
(RT)"). Migration numbers are expectations — each sub-stage takes the next free number
with a later timestamp (tracked requirement 2).

**Dependencies (why this order works):**
| Sub-stage | Needs | Reason |
|---|---|---|
| 2c.3 | 2c.1, 2c.2 | functions and list exist; adds the unit and property pages |
| 2c.4 | 2c.3 | dashboard card and checklist link point to those pages |
| 2d | 2c.3 | its sections live on the unit and property pages; its detailed plan holds every D20 / D21 item |
| 2e | 2c.3 (2d recommended) | galleries hang on the site, the property and each unit |
| 2f | 2c | prices and policies per unit |
| 3a | 2c (placed after 2f — D29) | rows are the units; reads bookings already created by the engine; blocks move to functions here |
| RT gate | 3a | room-types design closed (and, if approved, built) before the booking screens |
| 2h | RT gate | list / card / actions show the room type and the assigned room |
| 2i | 2h | modify / cancel / manual booking from the booking card |
| 3b | 3a, 2h, 2i | the board's actions and manual booking by range reuse their functions and forms |
| 2j | 2h | the guest card links to the guest's bookings |
| 2k | 2h, 2i | emails and dashboard widgets for real booking events |

---

## 1. Backend gaps found before implementation

Verified in the code and migrations of this branch. "Fix in" names the sub-stage.

| # | Gap | Why it blocks the UI | Fix | Fix in |
|---|---|---|---|---|
| G1 | **Manager (admin-seat) limit uses the Ecommerce rule.** `public.user_roles_admin_seat_guard` → `public.tenant_admin_limit()` reads `tenant_subscriptions`; Hospitality sites have no such row, so the limit is always the Ecommerce trial value **3**, whatever the Hospitality plan. | Owners would see wrong limits; a Hospitality plan cannot sell more or fewer managers. | Hospitality-owned seat rule (§1.1). | 2a |
| G2 | **The management area cannot be reached.** The Hospitality edge gate answers 404 for every page; the owner handoff (`/admin-handoff`) lands on `/admin` (Ecommerce). | No screen can load. | Edge gate opens `/manage/**` and `/admin-handoff` when the engine is enabled for the site; `/admin` → 302 `/manage` on Hospitality sites only. | 2a |
| G3 | **Root layout is Ecommerce-shaped.** `src/routes/__root.tsx` wraps every page in the cart, Sabbath gate, promo popup and tracking layers, fed by Ecommerce `site_settings` (`getSiteSeo`). | Ecommerce behaviour (popups, Sabbath lock, pixels) would leak into the owner area. | Root renders a neutral shell for Hospitality sites (§1.2). Ecommerce path unchanged. | 2a |
| G4 | **Hospitality UI cannot use the shared UI kit or browser session** without breaking the boundary rules (`src/components/ui`, `cn`, the browser Supabase session live in "Ecommerce" code). | Every screen needs them. | Platform adapters re-export them (no copies, no moves) and are added to the allow-list (§1.3). | 2a |
| G5 | **Guest manage-link tokens are readable by staff.** Guest emails store the raw `manage_token` in `notifications.payload`, and staff have direct `SELECT` on `notifications`. | An outbox / email-status screen would expose a token that lets anyone act as the guest. | Revoke direct `SELECT`; safe RPC without the payload; remove the token from the payload once the email is sent or dead. | 2a |
| G6 | **No management context call.** Permissions, flags, plan, unit and manager usage need 4–6 calls. | Slow shell; inconsistent gating. | `hospitality.management_context()` — one call. | 2a |
| G7 | **No outbox worker.** Stage 1 only queues emails. | No email is ever delivered. | In-process worker (pattern of `payment-expiry`), started only when `HOSPITALITY_ENGINE=on`; kick after each action; `requeue` / `resend` RPCs. | 2k |
| G8 | **Booking list / detail need joins and search** (guest name / phone / number) — awkward and leaky through plain table reads. | Booking screens. | `staff_bookings(filter, cursor)` with masked contact; `staff_booking_detail(id)` with nights, history, safe email status. | 2h |
| G9 | **Guest notes cannot be saved** (staff have `SELECT` only on `guests`). | Guest card. | `update_guest_notes` (notes, name and phone correction; email is identity — not editable). | 2j |
| G10 | **Atomic media operations missing**: set cover (partial unique index — two updates race), reorder many items. | Media screen. | `set_media_cover`, `reorder_media`. | 2e |
| G11 | **Reorder of properties / units** is N separate updates. | Drag-to-order. | `reorder_catalog(kind, ids[])`. | 2c |
| G12 | **Storage policies depend on `x-tenant-id` reaching Postgres from the Storage API** — only simulated in SQL tests so far. | Uploads may be refused (or worse, mis-scoped). | Verify on the real local stack first thing in 2e; fallback: server checks `can('media')` with the user's token and issues a signed upload URL for `<tenant>/<uuid>.<ext>`. | 2e |
| G13 | **Suspended Hospitality site** is redirected by the root to `/locked` (an Ecommerce page, 404 on Hospitality hosts). | Owner of a suspended site sees a blank 404. | Hospitality shell shows its own "האתר מושעה" screen; DB already blocks writes as designed. | 2a |
| G14 | **Dashboard numbers** (arrivals, occupancy, revenue in the site's timezone) need one server-side calculation. | Dashboard. | `hospitality.dashboard(_on date)`. | 2k (checklist version in 2a) |
| G15 | `promotions.used_count` can be changed directly by staff (RLS `UPDATE`). | Not used by Stage 2 screens. | Protect the column when the promotions UI is built (Stage 7). Documented only. | Stage 7 |

### 1.1 Hospitality manager-seat rule (G1) — proposal
- `hospitality.plans.max_managers integer NULL` (NULL = unlimited) and
  `hospitality.subscriptions.extra_managers integer DEFAULT 0 (0–100)`.
- **Proposed values (decision D-1):** trial 3 · basic 2 · pro 5 · enterprise unlimited.
  The owner counts as one seat (same meaning as Ecommerce).
- New trigger `hospitality_admin_seat_guard` on `public.user_roles` (Hospitality sites
  only): a new `admin` row, or a change to `admin`, beyond the limit is refused in the
  database (also through the service role); platform admins exempt; same per-site lock
  key as Ecommerce (`admin_seats:<tenant>`), so parallel additions cannot exceed it;
  existing managers are never removed by a downgrade; an inactive subscription blocks
  adding managers (same as units).
- The Ecommerce guard gets **one early return for non-Ecommerce sites**. The Ecommerce
  path itself is not changed; the existing Ecommerce seat tests must stay green unchanged.
- `entitlements()` returns `max_managers` and `managers_used`; platform admin sets
  `extra_managers` through the existing `admin_set_subscription`.

### 1.2 Root layout (G3) — the only Ecommerce-file edits in Stage 2
| File | Change | Ecommerce effect |
|---|---|---|
| `src/lib/platform.functions.ts` `getHostMode` | + `siteType` field (from the cached platform lookup) | none (new field) |
| `src/routes/__root.tsx` | ~10 lines: when `siteType === 'hospitality'`, render the neutral shell from the composition root instead of the cart / Sabbath / promo / tracking layers, and skip the `/locked` redirect | none (branch never taken on Ecommerce sites; E2E proves it) |
| `public.user_roles_admin_seat_guard` (SQL) | one early return for non-Ecommerce sites | none |

`__root.tsx` becomes an **entry file** in the boundary rules (may import the composition
root, never an engine directly). No other existing file, route, component or rule changes.

### 1.3 How Hospitality screens reach shared code (G4)
| Need | Adapter (new, platform) | Wraps (unchanged) |
|---|---|---|
| UI primitives | `src/platform/ui/*` (re-exports) | `src/components/ui/*`, `cn`, `use-mobile` |
| Browser session | `src/platform/auth/browser-session.ts` | `src/integrations/supabase/client` (`getSession`, `onAuthStateChange`, `signOut`, `setSession`) |
| Owner login | `src/platform/auth/login.ts` | existing shared server functions: password (`auth.functions`), email code (`login-code.functions`) |
| Images | `src/platform/media/image.ts` | `src/lib/image.ts` compression |
| Email sending | `src/platform/notifications/email.server.ts` | `sendEmail` / `renderEmailHtml` / `escapeHtml` with `platformSender` (never `logFor`, never Ecommerce `site_settings`) |
| Site address | `src/platform/tenancy/site-origin.server.ts` | `originForTenant` |

The architecture test and ESLint allow-list list exactly these files.

---

## 2. Cross-cutting rules for every sub-stage

### 2.1 Architecture
- Screens live in `src/engines/hospitality/management/**`; server functions in
  `src/engines/hospitality/server/manage/*.functions.ts`.
- Route files `src/routes/manage*.tsx` are **thin route adapters** (path, title, lazy
  component). The boundary rules treat them as Hospitality code: they may import only
  Hospitality and platform; no Ecommerce code may import them.
- Business rules stay in the database (RLS, triggers, RPCs). TypeScript validates input,
  calls the database with **the user's own token** (`apiClient`), and maps Hebrew
  database messages to the screen. The service role is used only by the outbox worker
  and, if needed, the media fallback (G12).
- No mass refactor. No Ecommerce route, component, server function or business rule is
  changed beyond §1.2.

### 2.2 Access (checked on every request, never only in the UI)
1. Edge gate: Hospitality site + `HOSPITALITY_ENGINE=on` + flag(s) on (decision D-2),
   otherwise 404.
2. Dispatcher: Hospitality server functions only on that site.
3. Database: `current_tenant_id()` + `hospitality.can(<permission>)` +
   `hospitality_backend_enabled`; seats, units and subscription state enforced by
   triggers.
4. Roles: **owner** (protected admin) — everything; **manager** — everything except team
   and plan (`staff.managers`, `billing.manage`) and, if approved, guest export /
   anonymise (decision D-3). Ecommerce customers, members of other sites and guests →
   no access.

### 2.3 Login (no Google)
- Entry: the existing portal / platform panel handoff (unchanged) → `/manage`.
- `/manage/login`: **email code and password only**, through the existing shared
  primitives. **No Google button** on any Hospitality screen while the OAuth finding is
  open (`docs/security/oauth-pkce-analysis.md`). An E2E test asserts its absence.
- The portal's own login screen is existing platform behaviour and is not changed
  (decision D-4 confirms this is acceptable).

### 2.4 Design (Hebrew, RTL, mobile-first, non-technical owners)
- `dir="rtl"` / `lang="he"` from the root; logical CSS (`ms-`/`me-`, `start`/`end`);
  dates `DD.MM.YYYY`, `₪` amounts, Israel timezone from settings.
- **Phone first:** bottom navigation (לוח בקרה · הזמנות · יחידות · עוד) under 768 px,
  side navigation on desktop; 44 px touch targets; forms one column; sticky save bar;
  sheets/drawers instead of wide dialogs.
- Plain Hebrew, no technical terms; every empty screen explains the next step; every
  destructive action asks for confirmation; Hebrew database messages shown as they are;
  loading skeletons; toast after each save.
- Visual style: the existing design tokens and Heebo font (shared kit), a calm
  Hospitality accent; no Ecommerce components.
- Freshness without Realtime (D4): refresh after own actions, on tab focus, and every
  60 s on dashboard / bookings; booking actions send the `revision` they saw.

### 2.5 Privacy
- Lists show the guest's name and **masked** contact (`050-•••-1234`, `d•••@gmail.com`);
  full contact only on the booking / guest card the owner opens.
- The dashboard shows first name + initial only.
- No guest data in URLs, logs, page titles or error reports; server functions return only
  the fields the screen needs.
- The email outbox screen masks recipients and never returns payloads or tokens (G5).

### 2.6 Testing (each sub-stage)
- **SQL** (`scripts/db-tests/hospitality-*.test.sql`): every new RPC / policy — allowed
  role, refused roles (manager where owner-only, Ecommerce member, other site, guest,
  anonymous), flag off, inactive subscription, input limits.
- **Concurrency** where a limit or lock is involved (seats in 2a; cover in 2e; blocks vs
  booking requests in 3a; room assignment in RT).
- **Vitest:** validation, formatting, masking, navigation model, architecture boundaries
  (route adapters, adapter allow-list).
- **E2E (Playwright, local Supabase):** desktop + `@mobile` project for each screen's main
  flow; RTL; no Google button; cross-site refusal; flags off → 404.
- **Regression:** full SQL ×3, rollback check (incl. the new migration), concurrency ×3,
  full Vitest, full E2E (Ecommerce unchanged), typecheck, build, strict lint of new code,
  whole-repo lint still 28 known errors, CI green.
- No new dev dependencies unless approved (component behaviour is covered by Playwright;
  optional `@axe-core/playwright` for accessibility — decision D-7).
- **Preview kit (since P0, `docs/hospitality/preview.md`):** every sub-stage extends the
  three demo sites **only through the real functions** (each user's own token, fictional
  `@demo.test` accounts, local-only guard), adds a recorded chapter to
  `e2e/preview/walkthrough.spec.ts` (desktop + phone, every step asserted, screenshots and
  MP4) and is part of the CI `hospitality-preview` artifact. Dates are relative to the run
  day, so the board always looks like a working business.

  | Sub-stage | Added to the preview |
  |---|---|
  | 2c.3 – 2c.4 | "כל המתחם" with its units, reordering, an inactive room, an archived property (owner), the dashboard units card |
  | 2d | beds per room (villa: 4 bedrooms with labels; hotel: double / twin), amenities private and shared + one custom, parking, location from a pasted link, guest info, house rules; a booking created afterwards keeps the rules snapshot |
  | 2e | images generated locally (marked demo; no stock photos until a licence source is approved) uploaded through the real path; a link import from a local image server; refused imports (private address, wrong type) shown |
  | 2f | weekend / season / holiday prices, three policy templates, price preview |
  | 3a | bookings in every state (pending, confirmed, staying now, cancelled) and blocks, created through the booking engine; a whole-property booking; month / week board on desktop and phone; block → release |
  | RT (if approved) | hotel room types with assigned rooms and a room move |
  | 2h – 2i | a guest request through the public booking function, approval on the phone, a manual booking, a modification, a cancellation request with the calculated fee |
  | 3b | day view, arrivals / departures, actions from the board, manual booking by range |
  | 2j – 2k | guest cards; emails in the local mail mock and on the email screen; dashboard numbers matching the demo data |

---

## 3. Sub-stages

### 2a — Foundation: access, shell, login, seat limit, security fixes  ★ recommended first
**Functionality**
- `/manage` opens on an enabled Hospitality site; `/admin` → `/manage` there.
- Shell: RTL, mobile bottom nav / desktop side nav, business name, plan banner (trial days
  left · inactive · near the unit limit), sign out; "אין הרשאה" and "האתר מושעה" screens.
- `/manage/login`: email code + password; no Google.
- Dashboard v1 = **setup checklist** (business details · first unit · photos · prices ·
  cancellation policy), from `management_context()`; full widgets in 2k.

**Database / API (migration 7 `hosp_management_foundation`)**
- Seat rule §1.1 (plans / subscriptions columns, Hospitality trigger, Ecommerce early
  return, `entitlements()` fields).
- G5: revoke `SELECT` on `notifications` from `authenticated`; scrub `manage_token` from
  the payload on `sent` / `dead`.
- `management_context()`: role, permission map, flags, entitlements (units + managers),
  site status, business name, timezone, checklist state.
- Optional flag `hospitality_management_enabled` (decision D-2).

**Files**
- `src/platform/ui/*`, `src/platform/auth/{browser-session,login}.ts`,
  `src/platform/tenancy/site-origin.server.ts`
- `src/engines/hospitality/management/shell/{ManageLayout,BottomNav,SideNav,PlanBanner,AccessDenied,Suspended}.tsx`,
  `management/login/ManageLogin.tsx`, `management/dashboard/SetupChecklist.tsx`,
  `management/lib/{format,mask,query-keys}.ts`
- `src/engines/hospitality/server/manage/context.functions.ts`
- `src/app/site-shell.tsx` (neutral shell, composition root)
- Routes: `src/routes/manage.tsx`, `manage.index.tsx`, `manage_.login.tsx`
- Edits: `__root.tsx`, `platform.functions.ts` (§1.2), engine edge gate, ESLint +
  architecture test (route adapters, adapter allow-list)
- `supabase/migrations/…_hosp_management_foundation.sql` + rollback; SQL test file

**Security checks:** owner / manager allowed; Ecommerce admin of another site, customer,
guest, anonymous refused at edge, dispatcher and database; seat limit in the database;
no token readable; no Google button.

**Tests / acceptance**
- SQL: seat limits per plan (+ extras), owner counted, platform admin exempt, downgrade
  keeps existing managers, inactive subscription blocks additions, Ecommerce seat rule
  unchanged (existing tests untouched and green), notifications not selectable, token
  scrubbed after send.
- Concurrency: two managers added in parallel at the last free seat → exactly one succeeds.
- E2E: handoff → `/manage` (desktop + mobile); login page has no Google button;
  manager sees no team / plan items; other-site owner refused; flags off → 404; Ecommerce
  store home, `/admin`, cart, Sabbath gate and popups unchanged.
- **Accepted when** the owner can enter, sees the shell and checklist on a phone and a
  desktop, all refusals hold, and the full regression is green.

### 2b — Business settings and team
**Functionality:** business name, phone, WhatsApp, email, address; check-in / check-out
times; booking mode and approval window (with plain-language explanation); max open
requests; weekend nights; owner notification emails (max 5); timezone fixed to Israel by
default. **Team** (owner only): managers list, seats used / limit, add a manager by email,
remove a manager; at the limit the button is disabled with an explanation.
**DB / API:** existing `settings` (RLS `UPDATE`, `settings_validate`). Team: server
function — owner check with the user's token (`can('staff.managers')`), then the existing
auth admin path to find or create the account and an `admin` row in `user_roles` (the seat
trigger decides). No invitation email until 2k (the new manager enters with an email
code).
**Files:** `management/settings/{BusinessForm,BookingRulesForm,NotificationEmails}.tsx`,
`management/team/{TeamList,AddManager}.tsx`, `server/manage/{settings,team}.functions.ts`,
`validation/settings.ts`, routes `manage.settings.tsx`, `manage.team.tsx`.
**Security:** settings — `settings` permission; team — owner only, protected owner cannot
be removed, a manager cannot add or remove anyone, seat limit enforced by the database.
**Tests / acceptance:** SQL for team rules; Vitest for validation; E2E save → reload shows
values (desktop + mobile); manager cannot open team; the limit message appears at the
limit. Accepted when settings persist and team rules hold.

**As implemented (2b):** see `stage-2b-plan.md` (sections "as implemented"). In short:
settings through `settings_view` / `update_settings` only (no direct writes; revision check;
the screen shows only what the user may edit); owner-only team screen; managers added by
the owner (new account: confirmed, no password, email-code sign-in; no invitation email);
append-only action log; migration 8 (`20261101160000_hosp_settings_team`).
Migration numbers below are provisional: each sub-stage takes the next free number
(2b used 8 and R-1 used 9, so the plan shifted by two from 2c on).

### 2c — Properties and units
**Functionality:** list of properties ("מתחם") and units; create / edit (name, description,
capacity, base occupancy, child age, bedrooms, bathrooms, base price, extra adult /
child price, minimum nights, price floor / ceiling, active / inactive, order);
"כל המתחם" units (choose member units); unit limit shown and enforced; deactivate instead
of delete when bookings exist (clear message).
**DB / API:** existing tables (RLS), unit-limit trigger, membership guards; migration 10:
`reorder_catalog(kind, ids[])` (G11).
**Files:** `management/catalog/{PropertyList,PropertyForm,UnitList,UnitForm,WholePropertyMembers}.tsx`,
`server/manage/catalog.functions.ts`, `validation/catalog.ts`, routes `manage.units.tsx`,
`manage.units.$unitId.tsx`.
**Security:** `catalog` permission; tenant isolation; unit limit and inactive subscription
enforced in the database (UI only explains).
**Tests / acceptance:** SQL for reorder; E2E create property → unit → edit → reorder →
deactivate; at the limit "הוספת יחידה" is disabled and a direct call is refused.

### 2d — Unit and property details (scope approved 31/10/2026 — D20, D21)
**Binding scope.** The 2d detailed plan (`stage-2d-plan.md`: exact migration, functions,
screens) is written and approved before 2d starts, and must contain **every item below**
(requirement ids in `requirements-traceability.md`). The screens build on the unit and
property pages delivered in 2c.3.

**Unit page**
1. **Beds per room** — rows of room label (optional: "חדר הורים", "חדר ילדים", "סלון"), bed
   type and quantity. Types (existing `unit_beds` check): זוגית (double), קווין (queen),
   קינג (king), יחיד (single), ספה נפתחת (sofa bed), קומותיים (bunk), עריסה (crib), מזרן
   (mattress). Order of rows; "ישנים עד N" shown; a warning (not a block) when the sleeping
   places are fewer than the maximum guests.
2. **Rooms** — bedrooms (exists), bathrooms ("חדרי רחצה", exists) and **separate toilets**
   ("שירותים נפרדים", new: 0–50, default 0).
3. **Guests** — total maximum (exists, `capacity`), guests included in the price (exists),
   child age (exists), **max adults** and **max children** (new, optional, each ≤ the
   total; empty = only the total applies). Enforced by the booking engine — quote,
   request, manual booking and modify — with Hebrew messages.
4. **Amenities in the unit (private)** — from the catalogue (item 11), each with an optional
   note (≤ 120 chars, e.g. "ג'קוזי מחומם").

**Property page**
5. **Amenities in the property (shared)** — same catalogue and notes; the site will show
   both groups ("ביחידה" / "במתחם"). Existing model: `unit_amenities` holds exactly one of
   unit / property.
6. **Parking** (structured, property level; replaces the "חניה" amenity preset): availability
   none / free / paid; type private / shared (required unless none); number of spaces
   (optional, 0–500); fee note (paid only, short text); guest instructions (≤ 1,000 chars,
   public — the screen warns not to write codes there; codes belong to item 9).
7. **Location on the map** — paste a map link (Google Maps / Waze / OpenStreetMap / `geo:`)
   or type coordinates; parsed in the browser and validated on the server; stored in the
   existing `latitude` / `longitude`; preview links "פתיחה ב-Google Maps / Waze". **No
   external map service and no server request to the link** (short links that need
   resolving get a "copy the coordinates" hint).
8. **Useful guest info (public)** — ≤ 4,000 chars: directions, the area, what to bring;
   shown on the site (Stage 4) and in the booking confirmation.
9. **Private arrival info (sensitive)** — entry code, gate code, Wi-Fi network and password,
   key / arrival instructions:
   - stored apart from public data, with its own access rules; never returned by public
     functions, sitemaps, SEO data or the booking snapshot; never in a URL;
   - staff with the catalogue or bookings permission can see and edit it;
   - an **authorised guest** (manage-my-booking link, later the signed-in guest who owns the
     booking) gets it only when the booking is confirmed or checked in, inside a time
     window before arrival (proposal: from 48 h before check-in until check-out — open
     decision). 2d delivers the storage, the guest access function and its tests; the guest
     screen comes with Stage 4 / 6;
   - changes are logged **without the values** ("קוד השער עודכן");
   - per-unit values (a door code per zimmer) — open decision (recommended in 2d).
10. **House rules (property level, separate from the cancellation policy — D21):**
    - smoking: forbidden / outside only / allowed;
    - pets: not allowed / on request / allowed — with a conditions text;
    - parties and events: not allowed / on request / allowed;
    - quiet hours: from–to (optional);
    - check-in / check-out times: shown from the business settings;
    - the owner's own rules: a list (up to 20 × 200 chars).
    - **Snapshot:** every new booking stores the rules that applied
      (`bookings.house_rules_snapshot`, new nullable column), written by `request_booking`
      and `create_manual_booking`; a modification keeps the original snapshot; shown on the
      booking card (2h) and to the guest (Stage 4 / 6).
    - Unit-level exceptions — later (open decision; the model leaves room for them).
    - `policies.house_rules` (Stage 1) is no longer edited or shown; the column stays.

**Amenity catalogue**
11. **Presets** (code, Hebrew, grouped), added to the site's catalogue on demand ("הוספה
    מהרשימה"):
    - בחדר: Wi-Fi, מיזוג, טלוויזיה;
    - מטבח: מטבחון, מקרר, מיקרוגל, מכונת קפה;
    - בחוץ: מרפסת, חצר, נוף, פינת מנגל;
    - בריכה וספא: בריכה, ג'קוזי;
    - שירותים: ארוחת בוקר (note: "כלולה" / "בתוספת תשלום");
    - נגישות: נגישות (with a details note).
12. **Custom amenities** — the owner's own name, a category, an icon from a fixed set.

**Writes and action log**
13. Beds, amenities and every new field are written **only through database functions**
    (as settings in 2b and the catalogue in 2c): direct staff writes to `unit_beds`,
    `amenities` and `unit_amenities` are revoked; every change goes to the action log
    (`audit_log`) with Hebrew labels; revision check where two people may edit the same
    record.

**DB / API — one additive migration** (next free number, expected 11), tested on the local
Postgres (SQL ×3, concurrency where relevant, rollback check including the new migration),
no production change:
- new columns (nullable or neutral defaults; existing rows unchanged): `units`:
  `separate_toilets`, `max_adults`, `max_children`; `properties`: parking fields, public
  guest info, house-rules fields (or a `property_house_rules` table — decided in the
  detailed plan); `bookings.house_rules_snapshot`;
- a separate table for private arrival info (property, optional unit) with its own RLS;
- functions: `property_create` / `property_update` accept location, parking, guest info and
  house rules; `unit_create` / `unit_update` accept toilets and the guest limits; new bed
  and amenity functions; booking engine: guest-limit checks and the house-rules snapshot;
  the guest access function for private arrival info;
- nothing dropped or renamed; rollback file; added to `rollback-check.sh`.

**Screens:** unit page sections "חדרים ומיטות", "אורחים", "מתקנים ביחידה"; property page
sections "מתקנים במתחם", "חניה", "מיקום", "מידע לאורחים", "מידע פרטי להגעה", "כללי המקום" —
phone first, sticky save bar, Hebrew errors next to the field.

**Tests / acceptance:**
- SQL: every function × owner / manager / other site / guest / anonymous; limits and
  validation; action-log rows (private values never logged); private arrival info never
  returned by public functions and returned to an authorised guest only in the allowed
  state and window; the house-rules snapshot on new bookings (and unchanged after a
  policy or rules edit); guest-limit checks in quote / request / manual booking / modify;
  direct writes refused.
- Vitest: presets valid against the database checks; map-link parser (Google Maps, Waze,
  OpenStreetMap, `geo:`, plain coordinates, invalid input); validation.
- E2E (desktop + phone): beds, amenities (private, shared, custom), parking, location from
  a pasted link, guest info, private info, house rules — reload shows the values; manager
  vs owner; axe; preview-kit chapter (§2.6).

### 2e — Photos and galleries (must include — owner requirements of 31/10/2026 + audit)
**Must include** (requirement ids in `requirements-traceability.md`; every item is in the
2e detailed plan and its tests):
1. **Upload** from the computer and from the phone (camera / gallery), compressed in the
   browser before upload.
2. **Link import:** paste an image link → the **server** downloads it and stores an
   **independent copy** in Supabase Storage (`hosp-media`); never hotlink — pages show only
   stored copies (details in the owner requirements below).
3. **Storage:** `hosp-media`, path always `<tenant>/<uuid>.<ext>`, RLS + the `media`
   permission; every image belongs to the site, a property or a unit.
4. **Galleries:** one for the site, one per property, one per unit (`media.owner_kind`).
5. **Cover** (one per gallery, atomic), **reorder** (atomic), **delete** (record and stored
   object), **replace** (the new file keeps the position, the cover flag and the ALT text;
   the old object is deleted).
6. **Real checks:** type by content (magic bytes), size, decode + re-encode (strips
   metadata, defeats polyglots); no SVG, no executables.
7. **Download security (SSRF):** as in the owner requirements below; reuse of
   `image-fetch.ts` through `src/platform/media/`.
8. **Optimisation:** resized variants for the site (several widths) in a modern format
   (e.g. WebP) and thumbnails for the management gallery; exact sizes, and whether the
   original is kept, decided in the detailed plan.
9. **ALT text** with a hint; **video** (≤ 50 MB, mp4 / webm / mov) and YouTube / Vimeo
   links; **demo badge** (`is_demo` with a licence reference — existing check).
10. **Storage usage per site:** stored bytes (incl. variants) measured and shown to the
    owner; a plan limit and its enforcement are an open decision (Stage 11 / plans).
**DB / API:** `media` table and `hosp-media` bucket; migration (expected 12):
`set_media_cover`, `reorder_media` (G10), replace / delete functions, the link-import
record. **First task: verify G12** on the real Storage API; if the header
does not reach Postgres, use the fallback (signed upload URL issued after a permission
check, path always `<tenant>/<uuid>.<ext>`).
**Files:** `src/platform/media/image.ts`, `src/platform/media/` link-import adapter,
`management/media/{MediaLibrary,UploadButton,LinkImport,MediaCard,AltTextSheet}.tsx`,
`server/manage/media.functions.ts`.
**Security:** `media` permission; path prefix = site id (policy); size and MIME limits
from the bucket; no executable or SVG uploads; delete only the site's own objects.
**Tests / acceptance:** SQL for cover / reorder / replace / delete; concurrency for
parallel "set cover"; SSRF suite (private / loopback / link-local / metadata addresses,
redirect to a private address, DNS rebinding, oversize, slow response, wrong type, polyglot,
SVG); E2E upload image (desktop + mobile), link import from a local test image server, set
cover, reorder, replace, delete — the file is gone from storage; upload to another site's
path refused; preview-kit chapter (§2.6).

**Owner requirements (approved 31/10/2026 — binding for 2e; 2e not started):**
- Upload from the computer (and phone camera / gallery).
- Paste a link to an image → the **server** downloads it and stores an **independent copy**
  in Supabase Storage (`hosp-media`). Never hotlink an external image — pages show only
  stored copies.
- Check the **real** file type (content / magic bytes, not the extension or the declared
  Content-Type), the size and the content: decode and re-encode (strips metadata,
  defeats polyglots); no SVG, no executables.
- SSRF protection for links: http / https only; DNS resolved by us and the connection made
  to the checked address (no DNS rebinding); private, loopback, link-local (cloud
  metadata), multicast and reserved IPv4 / IPv6 ranges and internal host names refused;
  every redirect re-checked (limited); time and size limits while streaming.
- Every image belongs to a tenant, a property and (optionally) a unit — path
  `<tenant>/<uuid>.<ext>`, RLS + the `media` permission.
- Delete, replace and reorder (and set cover).
- Reuse, don't copy: Ecommerce already has a downloader with these protections
  (`src/server/services/image-fetch.ts` — pinned lookup, private ranges, 4 re-checked
  redirects, size caps, sharp re-encode). 2e plans to expose it to the engine through a
  platform adapter (`src/platform/media/`) with its own tests, without changing Ecommerce
  behaviour.

### 2f — Pricing, rate rules and cancellation policies
**Functionality:** per unit: base price, weekend price, seasons (date ranges), holidays,
minimum nights per rule, priority explained in plain words; **price preview** for any
dates (uses the staff `quote`, works while public bookings are closed). Cancellation and
deposit **policy editor**: templates (גמיש / רגיל / קפדני), tiers, deposit, no-show,
default policy, per unit; live example "אם אורח מבטל ב-X — מקבל Y"; history of versions
(read-only).
**DB / API:** existing `rate_rules`, `policies` (+ validation and version triggers),
`quote`, `policy_schedule`. No migration expected.
**Files:** `management/pricing/{RatesEditor,SeasonForm,PricePreview}.tsx`,
`management/policies/{PolicyEditor,PolicyExample,PolicyHistory}.tsx`,
`server/manage/{pricing,policies}.functions.ts`, `validation/pricing.ts`.
**Note:** promotions and coupons UI stays in Stage 7 (roadmap) — decision D-5. House rules
are **not** part of the policy editor: they are managed at property level in 2d (D21); the
Stage 1 field `policies.house_rules` is not shown.
**Tests / acceptance:** Vitest for the example calculator vs `policy_schedule`; E2E create
season → preview shows the season price; edit a policy → a new version, existing
bookings keep their snapshot.

### ~~2g — Availability blocks~~ → merged into 3a (D19, 31/10/2026)
Everything 2g planned — block dates for a unit (reason optional), list upcoming blocks,
release a block, conflicts explained ("יש הזמנה בתאריכים האלה"), whole-property effects —
is part of **3a**, from the board and from a list. Its acceptance test stays: block → the
same dates are refused for a manual booking (2i reuses it) and the quote shows unavailable;
release → available again.

### 3a — Calendar board I (after 2f — D19)
**Goal:** the owner's central daily **work tool** — fast and convenient, not just a nice
view — for a single zimmer, a compound with many units and a hotel with many rooms.
Roadmap: `stage-1-plan.md` A4 Stage 3.

**Functionality**
- **Month and week views:** units as rows (grouped by property; by room type once RT
  exists), dates as columns; sticky unit column and date header; today marker; weekend
  shading (the business's weekend nights); previous / next / "היום".
- **Per-unit view:** one unit's month — on the board and as an "יומן" tab on the unit page.
- **Bookings as bars** across their nights; colours by status with a legend: ממתינה
  לאישור, מאושרת, שוהים עכשיו, חסום (hatched); cancelled hidden by default (filter);
  declined / expired not shown. Free / occupied / blocked readable at a glance (also
  without colour — pattern and text for accessibility).
- **Whole property:** its row shows the members' occupancy, and member rows show the
  whole-property booking (dimmed, "דרך כל המתחם").
- **Filters:** property, unit type, status; search by booking number or guest name
  (masked contact) → jump to the dates.
- **Click a booking** → summary panel (dates, unit, guests, status, total, source);
  read-only until 2h adds the actions. **Click a block** → details + release.
- **Block dates from the board:** select a range on a unit row (drag on desktop; tap start +
  tap end on the phone; keyboard alternative) → "חסימת תאריכים" (reason optional); conflicts
  explained in Hebrew; also from a list "חסימות קרובות".
- **Automatic refresh (D4):** every 30–60 s while the page is visible, on tab focus and
  after every own action; a cheap change check, so data is downloaded only when something
  changed; a stale screen can never write a conflict (exclusion constraint + revision).
- **Phone:** agenda by default (day by day: arrivals, departures, staying, blocks) plus the
  per-unit month grid; the full board scrolls horizontally with the unit column fixed.

**Scale and speed (designed in from the start)**
- One read call per visible range: `calendar(from, to, unit_ids?)` returns units, bookings,
  blocks and whole-property links overlapping the range — only what the cells need, no
  contact details.
- `calendar_stamp(from, to)` (or a version in the response) for the change check.
- Ranges bounded: week 7–14 days, month view ≤ 6 weeks; rows virtualised (only visible rows
  rendered); bars computed once per load.
- Indexes checked with EXPLAIN on realistic volumes (existing `bookings_unit_idx`,
  `unit_occupancy` GiST).
- **Acceptance targets** (local measurement; confirmed in the 3a detailed plan): 300 units ×
  42 days with ~5,000 bookings — database read ≤ 300 ms, first render ≤ 1 s, smooth
  scrolling; phone: 30 units smooth.

**Implemented** as migration 14 — `stage-3a-plan.md`. **DB / API** (as planned): `calendar`, `calendar_stamp`; `block_create`,
`block_update`, `block_release` (DEFINER, `bookings` permission, action log, Hebrew
messages); direct staff writes to `blocks` revoked (audit finding A-1, §7).
**Files:** `management/calendar/{Board,MonthGrid,WeekGrid,UnitCalendar,Agenda,BookingBar,BlockSheet,Legend,Filters}.tsx`,
`api/calendar.functions.ts`, route `manage.calendar.tsx` ("יומן" in the navigation).
**Tests / acceptance:** SQL (range edges, half-open nights, whole-property fan-out,
isolation, no contact data in board rows, block functions × roles, action log);
concurrency (block vs booking request on the same nights; two blocks at once); performance
script (seeded 300 units); E2E desktop + phone (month / week, per unit, filters, block →
quote unavailable → release); axe; preview-kit chapter (§2.6).
**Depends on:** 2c (units); placed after 2f by the approved order (D29).

### 2h — Bookings: view and decide
**Gate (D24, D29):** the hotel room types design (roadmap "Hotel room types (RT)") is
closed before 2h starts; if RT is implemented first, the list, card and actions show the
room type and the assigned room (with "room move").
**Functionality:** list with tabs (ממתינות לאישור · קרובות · שוהים עכשיו · עבר · בוטלו),
search by name / phone / booking number, approval countdown; booking card: dates, unit,
guests, price breakdown per night, policy snapshot, history timeline, email status (safe);
actions: approve, decline (reason), check-in, check-out, no-show.
**DB / API:** migration 12: `staff_bookings(filter, cursor)` (masked contact),
`staff_booking_detail(id)` (G8); existing `approve_booking`, `decline_booking`,
`set_stay_status` with `revision`.
**Files:** `management/bookings/{BookingList,BookingFilters,BookingCard,BookingTimeline,PriceBreakdown,ApproveDeclineBar}.tsx`,
`server/manage/bookings.functions.ts` (wraps the Stage 1f owner functions where they fit).
**Security:** `bookings` permission; revision check prevents stale decisions; list never
returns full contact.
**Tests / acceptance:** SQL for list / detail (isolation, masking, paging); E2E guest
request (API) → appears as pending → approve on mobile → status, history and queued
email visible; stale revision shows "ההזמנה עודכנה — מרעננים".

### 2i — Bookings: change, cancel, manual booking
**Functionality:** "הוספת הזמנה" (unit, dates, guests, guest details or existing guest,
price auto or manual, confirm now or as request, optional guest email); modify dates /
unit / guests / price (shows the difference); cancel by owner (with fee per policy or
override with reason); guest cancellation requests: see the calculated fee, approve
(reduce / waive with reason) or decline.
**DB / API:** existing `create_manual_booking`, `modify_booking`, `cancel_booking`,
`approve_cancellation`, `decline_cancellation`, `cancellation_quote`. No migration
expected.
**Files:** `management/bookings/{NewBookingForm,ModifySheet,CancelSheet,CancellationRequestCard}.tsx`.
**Tests / acceptance:** E2E manual booking (desktop + mobile) → on the list, dates held;
double booking refused with a clear message; modify; cancel with fee; approve a
cancellation with a reduced fee. Concurrency already covered by Stage 1 tests.
**Note:** the "הוספת הזמנה" form is built so that 3b can open it prefilled (unit and dates)
from a range selected on the board.

### 3b — Calendar board II (after 2h and 2i — D19)
**Functionality**
- **Day view:** all units for one day — arriving, leaving, staying, free, blocked.
- **Arrivals and departures:** markers on the board and lists for today / tomorrow, with
  check-in / check-out actions.
- **Actions from the board** through the 2h / 2i functions (each sends the `revision` it
  saw): approve / decline, check-in / check-out / no-show, cancel, open the full booking
  card; date or unit changes through the card's modify sheet (no drag-to-move).
- **Manual booking by selecting a date range** on a unit row → the 2i "הוספת הזמנה" form
  prefilled (unit, dates); availability and price rechecked by the engine.
- Room types (if RT is implemented): rows grouped by type; "room move" from the card.
**DB / API:** reuses 3a, 2h and 2i functions; a small migration only if the detailed plan
finds a gap.
**Tests / acceptance:** E2E desktop + phone (day view, arrivals / departures, approve from
the board, manual booking by range → appears at once, stale revision → "ההזמנה עודכנה —
מרעננים"); performance as in 3a plus action round-trips; full regression; preview-kit
chapter (§2.6).
**Depends on:** 3a, 2h, 2i (and RT if implemented before 2h).

### 2j — Guests and privacy
**Functionality:** guest list (name, masked contact, number of stays, last stay), search;
guest card: full contact, booking history, notes; export (JSON / printable) and
anonymise with strong confirmation (owner only if D-3 approved).
**DB / API:** migration 13: `update_guest_notes` (G9); if D-3 approved, a new owner-only
permission for export / anonymise in `hospitality.can()`; existing `export_guest`,
`anonymize_guest`.
**Files:** `management/guests/{GuestList,GuestCard,GuestNotes,PrivacyActions}.tsx`,
`server/manage/guests.functions.ts`.
**Tests / acceptance:** SQL (notes, permission split, isolation); E2E notes save; export
downloads only this guest; anonymise removes contact and keeps bookings; manager refused
when owner-only.

### 2k — Emails (outbox worker, status, retry) and dashboard widgets
**Functionality**
- Worker: claims queued emails (`claim_notifications`), renders Hebrew RTL templates per
  event (request received, confirmed, declined, expired, cancellation requested /
  approved / declined, owner new request / reminder…), sends through the **existing Nuriel
  email API** (`sendEmail` with `platformSender`: business name, reply-to = business
  email, `Idempotency-Key` = notification id), records the result (`mark_notification`),
  retries with backoff, marks dead after the limit. A failed email never undoes a booking.
- Runs in-process every 30 s and right after each owner action, **only when
  `HOSPITALITY_ENGINE=on`** (off in production until go-live approval).
- Screens: email status on the booking card; "מיילים" screen (failed / waiting / sent,
  masked recipients); **retry** (failed / dead → queued) and **resend** (new message; for
  a guest link a new token is issued and the old one stops working — the owner is told).
- Dashboard: pending approvals with deadlines, today's arrivals / departures, staying now,
  occupancy today / 7 / 30 days, free units tonight, this month's revenue, recent bookings,
  failed emails, cancellation requests.
**DB / API:** migration 14: `staff_emails(filter)`, `requeue_notification(id)`,
`resend_booking_email(booking_id, event)`, `dashboard(_on)`.
**Files:** `src/platform/notifications/email.server.ts`,
`src/engines/hospitality/emails/{templates/*.ts,render.server.ts}`,
`src/engines/hospitality/jobs/outbox-worker.server.ts`, started from the composition root
(`src/server.ts` +1 line, like `payment-expiry`); `management/emails/{EmailList,EmailStatus}.tsx`;
`management/dashboard/{Dashboard,widgets/*}.tsx`; `server/manage/{emails,dashboard}.functions.ts`.
**Security:** worker uses the service role only for claim / mark; templates escape all
values; recipients masked on screen; no payload or token ever returned to the browser;
resend rate-limited per booking.
**Tests / acceptance:** SQL (requeue / resend rules, dashboard numbers incl. timezone
edges); Vitest (template rendering, escaping, RTL markup); E2E with the existing local
Resend mock (`RESEND_API_URL`): an approval delivers exactly one email with the right
idempotency key; mock failure → retry → sent; dead → manual retry; dashboard numbers
match seeded data; no real email is sent anywhere.

---

## 4. Feature flags, plans and limits

| Control | Effect in Stage 2 |
|---|---|
| `HOSPITALITY_ENGINE` env | off in production → `/manage` and all Hospitality functions 404; on only in local / E2E |
| `hospitality_backend_enabled` (per site) | database and functions; off → 404 / no data |
| `hospitality_management_enabled` (new, per site — D-2) | owner area; lets the management area open while the public site stays closed |
| `hospitality_frontend_enabled` | public website — stays off (Stage 4) |
| Subscription inactive | banner; no new units / managers (database); bookings and owner actions continue |
| Unit limit / manager limit | enforced by the database; UI shows usage and disables the action |

Nothing is enabled globally; flags are set per site, and only in local / E2E data.

---

## 5. Decisions (approved)

| # | Decision |
|---|---|
| D-1 | Manager seats: trial 3 · basic 2 · pro 5 · enterprise unlimited; the owner counts; platform admins exempt; extra seats by the platform admin; enforced atomically in the database; a downgrade never removes managers, it only blocks additions until the limit is respected — **implemented in 2a (migration 7)** |
| D-2 | Separate per-site `hospitality_management_enabled`, independent of the public-website flag — **implemented in 2a** |
| D-3 | Guest export / anonymise owner-only (permission `guests.privacy`); contact data masked in lists and dashboards — **permission implemented in 2a**; masking applies to every list from 2h on |
| D-4 | Owner access through the existing portal / platform handoff, email code and password; no Google login for Hospitality. The OAuth remediation is postponed to the final security and deployment preparation stage and stays documented (`docs/security/oauth-pkce-analysis.md`) |
| D-5 | Promotions / coupons screens stay in Stage 7 |
| D-6 | The small Hospitality-only changes to existing code — approved (as delivered: `__root.tsx` +20/−1, `getHostMode` + `HostMode.siteType`, the seat-guard early return) |
| D-7 | `@axe-core/playwright` (dev only, `4.14.0`) with WCAG 2.1 AA checks — added in 2a |
| D-8 | Branch `hospitality/stage-2` from the completed `hospitality/stage-1` |

### 2a — what changed against the plan
- Client-callable server functions live in `src/engines/hospitality/api/` (TanStack import
  protection forbids client imports from `server/` folders); `server/` keeps server-only
  helpers and the Stage 1f functions, which get wrappers in `api/` when their screens arrive.
- The store-side "`/manage` does not exist" rule is a guard on the `/manage` routes
  (`ssr: "data-only"`, so the server answers 404 with the store's own page) instead of the
  root; the root only redirects on Hospitality sites.
- G5: removing the token after sending already existed (migration 4); 2a removed the staff
  read of the table and added `staff_email_status`.
- G12 (Storage and `x-tenant-id`) is already covered by `e2e/tests/hospitality-api.spec.ts`
  (upload to the site's folder through the real Storage API); 2e reuses it.
- The suspended-site screen is served by the engine's page gate (403) rather than inside the
  shell.
- Build fix found by the E2E start-up: Nitro could split TanStack Start's server runtime
  into two chunks that import each other (order depended on file hashes), and the built
  server then failed at start-up. `vite.config.ts` now keeps that runtime in one chunk
  (`_tanstack-start-runtime.mjs`). No Docker or deployment file changed.

### Tracked requirements (from the Stage 2a approval)
1. **Health check before Production:** the Docker / Coolify health check must be upgraded
   so it also proves the SSR handler is up, not only `/robots.txt` (runbook:
   `stage-1-plan.md` §A11 step 5). Not changed yet — deployment change, separate approval.
2. **Migration order:** every new migration gets a timestamp later than the previous one
   (after migration 7 `20261101150000`), with a rollback file, and is added to
   `rollback-check.sh` in reverse order. 2b adds an automated check (§7) so a wrong
   timestamp fails CI.

## 5a. Decisions needed (original proposal, kept for reference)

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Manager seats per Hospitality plan | trial 3 · basic 2 · pro 5 · enterprise unlimited; + `extra_managers` by platform admin |
| D-2 | Separate per-site flag for the management area | **yes** — `hospitality_management_enabled` |
| D-3 | Guest export / anonymise: owner only? | **yes** — owner only (managers see and serve guests, but cannot export or erase them) |
| D-4 | Owner entry: existing portal / platform handoff + `/manage/login` (email code, password); no Google on any Hospitality screen | **yes**; portal login unchanged |
| D-5 | Promotions / coupons UI | keep in Stage 7 as planned |
| D-6 | The three small edits to existing code in §1.2 | approve (needed for G1 and G3) |
| D-7 | Add `@axe-core/playwright` (dev only) for accessibility checks | optional; recommended |
| D-8 | Branch for Stage 2 | `hospitality/stage-2` from `hospitality/stage-1` (keeps Stage 1 reviewable as is) |

---

## 5b. Round 7 decisions (approved 31/10/2026 — after the requirements audit)

Full text in the roadmap (`stage-1-plan.md` A0, D19–D30); what they change here:

| Decision | Effect on this plan |
|---|---|
| D19 calendar 3a / 3b | 3a after 2f (absorbs 2g), 3b after 2h + 2i — §0, §3 |
| D20 2d scope | §3 "2d" items 1–13; one additive migration tested locally with rollback |
| D21 house rules, private arrival info | §3 "2d" items 9–10; 2f no longer touches house rules |
| D24 hotel room types | gate before 2h; optional sub-stage RT between 3a and 2h (§0) |
| D29 order | §0 |
| D30 traceability | every sub-stage report updates `requirements-traceability.md` |

## 6. Out of scope for Stage 2
Public website and guest booking UI (Stage 4 — with multi-language infrastructure, theme
choice at creation, Premium themes, house rules and private arrival info for authorised
guests); guest accounts and Google login (Stage 6, after the OAuth fix); promotions /
coupons UI and SEO incl. VacationRental (Stage 7); payments (Stage 8); platform-admin
reviews, customers and global board (Stage 11); iCal sync (Stage 12); WhatsApp messaging
(Stage 13); production enablement, server configuration, deployment, merge to `main`.
The calendar board is **no longer** out of scope: it is built as 3a / 3b inside this order
(D19).

## 7. Open items after Stage 2b (nothing may be lost)

Status at the end of 2b (`hospitality/stage-2`). "Where" names the stage that owns it.

**Required before Production (deployment preparation — separate approval)**
| # | Item | Where |
|---|---|---|
| P-1 | Docker / Coolify health check must prove the SSR handler (not only `/robots.txt`); the build fix keeps the runtime in one chunk, but the current check would pass a broken build | deployment preparation |
| P-2 | Google OAuth / PKCE finding (`docs/security/oauth-pkce-analysis.md`) — open, documented; no Google on Hospitality until fixed | final security stage |
| P-3 | Rate limits are in memory per server process (handoff, login code, password, account creation). With more than one instance they need a shared store | deployment preparation |
| P-4 | `HOSPITALITY_ENGINE`, `hospitality_backend_enabled`, `hospitality_management_enabled` stay off in Production until enablement is approved | enablement |
| P-5 | Merge of `hospitality/stage-1` and `hospitality/stage-2` to `main` — not done, needs approval | — |

**Deferred by decision**
| # | Item | Where |
|---|---|---|
| D-a | Invitation email to a new manager (today the owner shares the address; D-2b-3) — through the outbox worker | 2k |
| D-b | Instant booking, currency, timezone, payment hold are locked in settings (D-2b-4) | their own stage (booking mode with payments: Stage 8) |
| D-c | Promotions / coupons screens; protect `promotions.used_count` (G15) | Stage 7 |
| D-d | Google login for Hospitality owners / guests | after P-2 (Stage 6) |
| D-e | Owner-set password for managers — not offered (D-2b-6); managers may set one later through the existing account flow | — |

**Backend gaps still open (from §1)**
| # | Gap | Where |
|---|---|---|
| G7 | Outbox worker (emails are queued, not delivered) | 2k |
| G8 | Booking list / detail functions with masked contact | 2h |
| G9 | `update_guest_notes` | 2j |
| G10 | Atomic media cover / reorder | 2e |
| G11 | `reorder_catalog` | 2c |
| G12 | Storage `x-tenant-id` on the real stack — covered by `hospitality-api.spec.ts`; re-check in 2e | 2e |
| G14 | Dashboard numbers (`hospitality.dashboard`) — today only the setup checklist | 2k |

**Found in the 2b.4 regression**
| # | Item | Proposal | Where |
|---|---|---|---|
| R-1 | On Hospitality management pages the meta tags showed "החנות שלי" and the page state carried the Ecommerce plan object (root loader `getSiteSeo`) | **fixed before 2c**: root data and head by site type; business name from `site_identity()` (migration 9); host-mode lock by site status; SSR tests (`hospitality-head.spec.ts`) | done |

**Small follow-ups noticed in 2b (not blocking)**
| # | Item | Where |
|---|---|---|
| F-1 | A removed manager keeps a valid session token until it expires; every management request is refused at once (checked per request in the database), nothing else on the site is reachable | documented behaviour |
| F-2 | Action log has no retention / export yet (append-only; rows go with the site) | 2j (privacy) |
| F-3 | Checklist steps "units", "photos", "prices", "policy" have no link yet — their screens arrive in 2c–2f | units ✓ 2c.4 · photos ✓ 2e · prices and policy ✓ 2f |

**Found by the requirements audit (31/10/2026 — `requirements-traceability.md`)**
| # | Item | Where |
|---|---|---|
| A-1 | Blocks are written directly to the table by staff (RLS) — no action-log entry, technical messages possible | **Closed in 3a (migration 14):** `block_create` / `block_update` / `block_release` with the action log; direct writes revoked |
| A-2 | `policies.house_rules` superseded by property-level house rules (D21) | 2d (column kept, not edited) |
| A-3 | Property coordinates exist in the database but no function or screen accepts them | 2d (map link / coordinates); public map provider: Stage 4 |
| A-4 | Storage usage per site is not measured; no plan limit (original spec #1 part 12) | 2e measures; limit — open decision (Stage 11) |
| A-5 | Hotel room types had no stage (D-2c-5) | design gate before 2h (D24) |
| A-6 | Beds and amenities are written directly by staff (no action log) | 2d (functions + log) |
| R-2 | Ecommerce SQL test `analytics.test.sql` fails only during the first minute of a month (seen in CI #33, passed on re-run); not Hospitality | separate small fix of an Ecommerce test file — needs explicit approval |

