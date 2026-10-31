# Nuriel Hospitality — Stage 2 plan: owner management system

Status: **breakdown approved; 2a implemented (awaiting review). 2b and later not started.**
Branch: `hospitality/stage-2`, created from `hospitality/stage-1` at `0f59e85` (Stage 1 unchanged).
Builds on Stage 1 (migrations 1–6, engine layer 1f). Product roadmap: `stage-1-plan.md` A4
"Stage 2"; engine rules: `architecture.md`.

---

## 0. Summary

Stage 2 turns the Stage 1 backend into a working management area for the business owner,
at `https://<site>/manage` on Hospitality sites only. It is split into **11 sub-stages**.
Each one is small, ships its own migration (if any), server functions, screens and tests,
and passes the full Ecommerce regression before it is reported.

| # | Sub-stage | Main output | Migration |
|---|---|---|---|
| **2a** | Foundation: access, shell, login, seat limit, security fixes | `/manage` opens on a Hospitality site; mobile/RTL shell; setup checklist | 7 |
| 2b | Business settings and team | business details, check-in/out, booking rules, notification emails; managers and seats | — (uses 7) |
| 2c | Properties and units | create / edit / order / activate units; whole-property units; unit-limit UX | 8 (small) |
| 2d | Unit details: beds and amenities | beds per room; amenity catalogue with Hebrew presets | — |
| 2e | Photos and media | upload (phone/computer), compress, cover, order, alt text, video, delete | 9 (small) |
| 2f | Pricing, rate rules and cancellation policies | base / weekend / seasons / holidays; price preview; policy editor with live example | — |
| 2g | Availability blocks | block / release dates per unit, conflicts explained | — |
| 2h | Bookings — view and decide | list, search, detail, approve / decline, check-in / out | 10 |
| 2i | Bookings — change, cancel, manual booking | modify, cancel, cancellation requests, "הוספת הזמנה" | — |
| 2j | Guests and privacy | guest list (masked), guest card, notes, export / anonymise | 11 (small) |
| 2k | Emails: outbox worker, status, retry, dashboard widgets | emails actually leave through the Nuriel email API (locally mocked); retry / resend; full dashboard | 12 |

**Recommended first sub-stage: 2a** (§3). Every other screen depends on it, and it fixes
the backend gaps listed in §1 before any UI relies on them.

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
- **Concurrency** where a limit or lock is involved (seats in 2a; cover in 2e).
- **Vitest:** validation, formatting, masking, navigation model, architecture boundaries
  (route adapters, adapter allow-list).
- **E2E (Playwright, local Supabase):** desktop + `@mobile` project for each screen's main
  flow; RTL; no Google button; cross-site refusal; flags off → 404.
- **Regression:** full SQL ×3, rollback check (incl. the new migration), concurrency ×3,
  full Vitest, full E2E (Ecommerce unchanged), typecheck, build, strict lint of new code,
  whole-repo lint still 28 known errors, CI green.
- No new dev dependencies unless approved (component behaviour is covered by Playwright;
  optional `@axe-core/playwright` for accessibility — decision D-7).

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

### 2c — Properties and units
**Functionality:** list of properties ("מתחם") and units; create / edit (name, description,
capacity, base occupancy, child age, bedrooms, bathrooms, base price, extra adult /
child price, minimum nights, price floor / ceiling, active / inactive, order);
"כל המתחם" units (choose member units); unit limit shown and enforced; deactivate instead
of delete when bookings exist (clear message).
**DB / API:** existing tables (RLS), unit-limit trigger, membership guards; migration 8:
`reorder_catalog(kind, ids[])` (G11).
**Files:** `management/catalog/{PropertyList,PropertyForm,UnitList,UnitForm,WholePropertyMembers}.tsx`,
`server/manage/catalog.functions.ts`, `validation/catalog.ts`, routes `manage.units.tsx`,
`manage.units.$unitId.tsx`.
**Security:** `catalog` permission; tenant isolation; unit limit and inactive subscription
enforced in the database (UI only explains).
**Tests / acceptance:** SQL for reorder; E2E create property → unit → edit → reorder →
deactivate; at the limit "הוספת יחידה" is disabled and a direct call is refused.

### 2d — Unit details: beds and amenities
**Functionality:** beds per room (type, quantity, room label); amenities per unit /
property from the site's catalogue; "הוסף מהרשימה" inserts Hebrew presets (Wi-Fi, ג'קוזי,
בריכה, מטבחון, חניה, מיזוג…) on demand; custom amenities.
**DB / API:** existing `unit_beds`, `amenities`, `unit_amenities` (RLS). Presets are code,
not a migration.
**Files:** `management/catalog/{BedsEditor,AmenitiesPicker}.tsx`, `catalog/amenity-presets.ts`,
server functions in `catalog.functions.ts`.
**Tests / acceptance:** Vitest (presets valid against DB checks); E2E add beds and
amenities, reload, remove.

### 2e — Photos and media
**Functionality:** upload images from phone camera / gallery or computer (compressed in the
browser before upload), short videos (≤ 50 MB, mp4 / webm / mov), YouTube / Vimeo links;
assign to site / property / unit; set cover; drag to order; alt text (with a hint); delete
(file and record); demo badge.
**DB / API:** `media` table and `hosp-media` bucket; migration 9: `set_media_cover`,
`reorder_media` (G10). **First task: verify G12** on the real Storage API; if the header
does not reach Postgres, use the fallback (signed upload URL issued after a permission
check, path always `<tenant>/<uuid>.<ext>`).
**Files:** `src/platform/media/image.ts`, `management/media/{MediaLibrary,UploadButton,MediaCard,AltTextSheet}.tsx`,
`server/manage/media.functions.ts`.
**Security:** `media` permission; path prefix = site id (policy); size and MIME limits
from the bucket; no executable or SVG uploads; delete only the site's own objects.
**Tests / acceptance:** SQL for cover / reorder; concurrency for parallel "set cover";
E2E upload image (desktop + mobile), set cover, reorder, delete — the file is gone from
storage; upload to another site's path refused.

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
**Note:** promotions and coupons UI stays in Stage 7 (roadmap) — decision D-5.
**Tests / acceptance:** Vitest for the example calculator vs `policy_schedule`; E2E create
season → preview shows the season price; edit a policy → a new version, existing
bookings keep their snapshot.

### 2g — Availability blocks
**Functionality:** block dates for a unit (reason optional), list upcoming blocks, release
a block; conflicts with bookings explained ("יש הזמנה בתאריכים האלה"); whole-property
units show member effects. (The full calendar board is Stage 3.)
**DB / API:** existing `blocks` (insert / release), exclusion constraint, triggers.
**Files:** `management/blocks/{BlockList,BlockForm}.tsx`, `server/manage/blocks.functions.ts`.
**Tests / acceptance:** E2E block → the same dates are refused for a manual booking (2i
test reuses it) and quote shows unavailable; release → available again.

### 2h — Bookings: view and decide
**Functionality:** list with tabs (ממתינות לאישור · קרובות · שוהים עכשיו · עבר · בוטלו),
search by name / phone / booking number, approval countdown; booking card: dates, unit,
guests, price breakdown per night, policy snapshot, history timeline, email status (safe);
actions: approve, decline (reason), check-in, check-out, no-show.
**DB / API:** migration 10: `staff_bookings(filter, cursor)` (masked contact),
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

### 2j — Guests and privacy
**Functionality:** guest list (name, masked contact, number of stays, last stay), search;
guest card: full contact, booking history, notes; export (JSON / printable) and
anonymise with strong confirmation (owner only if D-3 approved).
**DB / API:** migration 11: `update_guest_notes` (G9); if D-3 approved, a new owner-only
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
**DB / API:** migration 12: `staff_emails(filter)`, `requeue_notification(id)`,
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

## 6. Out of scope for Stage 2
Calendar board (Stage 3); public website and guest booking UI (Stage 4); guest accounts
and Google login (Stage 6, after the OAuth fix); promotions / coupons UI and SEO (Stage 7);
payments (Stage 8); production enablement, server configuration, deployment, merge to
`main`.
