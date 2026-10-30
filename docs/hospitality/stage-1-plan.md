# Nuriel Hospitality — product plan and Stage 1 (backend foundation)

Status: **proposal, awaiting approval.** Nothing in this document is implemented.
Branch: `hospitality/stage-1` (based on `hospitality/stage-0`). No merge to `main`,
no production deployment, no production credentials, no migrations yet.

Part A describes the full product and the development stages. Part B is the detailed,
implementation-ready plan for **Stage 1 only**. Later stages get their own detailed plan
and approval before they start.

Design inputs: the existing repository (source of truth), the Stage 0 test baseline,
and domain concepts learned from Kamra PMS (AGPL-3.0 — concepts only, no code or text
copied).

---

# Part A — Product vision and roadmap

## A1. Vision

Nuriel Hospitality is a complete SaaS for accommodation businesses (zimmers, multi-unit
compounds, vacation units, boutique hotels). Every business gets:

- an independent, premium website (own subdomain, optional own domain);
- a business-management system: units, calendar and availability, bookings, guests,
  pricing and promotions, payments, reviews, reports;
- marketing tools (SEO, analytics, coupons);
- a visual, section-based website editor;
- an in-product help centre based on the real screens.

Target user: a business owner with no technical knowledge. Every screen must be usable
without training; the help centre fills the gaps.

Four separate things (never mixed in code or data):

| | What it is | Where it lives |
|---|---|---|
| 1. Business & booking engine | units, prices, availability, bookings, guests, payments | `hospitality` DB schema + `src/engines/hospitality/{units,bookings,…}` |
| 2. Theme library | layouts/styles that render business data + site content | `src/engines/hospitality/website/themes/` (code) |
| 3. Website editor | edits the site document (content + theme tokens), draft/publish | `src/engines/hospitality/website-editor/` + `site_versions` |
| 4. Showcase site (Nofei Dorit) | a **real tenant** of the platform with demo data, built with 1–3 | seed data, not code |

## A2. Non-negotiable architecture constraints

- Two independent engines: Ecommerce and Hospitality. No import of one engine's business
  logic into the other. Shared infrastructure only through `src/platform/` contracts and
  adapters. All new Hospitality code under `src/engines/hospitality/`. No mass refactor of
  Ecommerce. Hospitality must stay extractable to its own repository and deployment.
- Every requirement below was checked against this rule; conflicts are listed in A6.

## A3. Requirements → stages

| # | Requirement | Stage |
|---|---|---|
| 1 | Data model, isolation, flags, booking core, manual bookings (backend) | **1** |
| 2 | Owner management: settings, properties, units, media (images + video), pricing, blocks, bookings, manual booking UI, guests, dashboard, booking emails | 2 |
| 3 | Calendar / availability board (day, week, month) | 3 |
| 4 | Public website engine: themes, sections, SSR site, booking flow, demo media, Nuriel footer, Nofei Dorit showcase tenant | 4 |
| 5 | Visual editor (click-to-edit, media, sections, colours, fonts, draft/publish, versions, preview) | 5 |
| 6 | Guest accounts (Google / email code), "my bookings"; site address at creation; custom domains; Nuriel landing-page option (behind flag) | 6 |
| 7 | SEO & marketing: per-page meta, sitemap, robots, OG, schema.org, GA / Meta Pixel with consent, coupons & promotions UI | 7 |
| 8 | Payments: full / deposit / on arrival via the shared Grow adapter | 8 |
| 9 | Reviews & reputation (verified reviews, owner testimonials, replies) | 9 |
| 10 | Help centre (guides from real screens, screenshots, in-screen tips) | 10 |
| 11 | Super-admin Hospitality section, Hospitality plans activation, reports | 11 |

Every stage: own tests + full Ecommerce regression (Stage 0 suite) + report + approval.

## A4. Stages in detail

Notation: tables are in schema `hospitality` unless prefixed `public.`.

### Stage 1 — Backend foundation (detailed in Part B)
- **Builds:** product type on tenants, product-neutral feature flags, Ecommerce write
  guard, Hospitality schema (core tables), booking engine RPCs (quote, request, manual
  booking, approve/decline, modify, cancel, check-in/out, hold expiry), owner server
  functions (no UI), platform engine dispatcher, architecture tests.
- **Tables:** 19 (B6).
- **Screens:** none.
- **Reuses:** tenants, auth, user_roles, current_tenant_id, platform admin, flags
  pattern, storage, rate limiting, test infrastructure.
- **Independent:** all business logic, schema, migrations, tests.
- **Tests:** SQL (RLS, guards, state machine, pricing, concurrency), Vitest (architecture,
  dispatcher), E2E gate tests + Ecommerce regression.
- **Depends on:** nothing.

### Stage 2 — Owner management system
- **Builds:** owner area on the Hospitality host (`/manage/*`, not the Ecommerce `/admin`):
  dashboard; business settings (name, contact, WhatsApp, check-in/out, booking mode,
  approval deadline); properties & units (beds, amenities, base price, min nights,
  active/inactive, whole-property membership); media library (upload images and short
  videos from computer or phone, cover, order, alt text, demo flag); pricing
  (weekday/weekend, seasons, holidays, min nights); blocks; bookings list & detail;
  **"הוספת הזמנה"** (manual booking); booking modification/cancellation; guests (CRM:
  history, notes, export/anonymise); booking emails (owner + guest).
- **Dashboard widgets** (all derived by queries, no extra tables): pending approvals with
  deadline, today's arrivals/departures, occupancy (today/7/30 days), free units,
  month revenue (from bookings), recent bookings, recent guests, pending actions
  (approvals, expiring holds, unpaid deposits).
- **Tables:** uses Stage 1 tables (no new ones). Emails logged in shared
  `public.notification_logs` / email log.
- **Server functions:** `settings.*`, `properties.*`, `units.*`, `media.*`
  (signed upload, finalise, reorder), `pricing.*`, `blocks.*`, `bookings.*`
  (list, detail, createManual, modify, approve, decline, cancel, checkIn, checkOut),
  `guests.*`, `dashboard.summary`.
- **Reuses:** image optimiser (`src/lib/image.ts` via platform media adapter), storage,
  email transport (`email.server.ts` via platform notifications adapter, per-tenant
  sender `email_settings`), shadcn UI primitives, rate limiting, CSRF.
- **Independent:** all screens, emails templates, services.
- **Tests:** component tests for forms, E2E owner flows, email content tests (mock
  Resend), permission tests (owner/manager only).
- **Depends on:** 1.

### Stage 3 — Calendar & availability board
- **Builds:** professional board: units as rows, dates as columns; day/week/month;
  bookings as blocks spanning nights; colours by status (pending approval, confirmed,
  checked-in/staying, cancelled — shown faded/hidden by filter, blocked); click → booking
  drawer; drag-free creation (select a range → "הוספת הזמנה" / "חסימה"); filters by unit /
  property / status; arrivals & departures markers; month navigation; whole-property rows
  show member occupancy.
- **Data:** one RPC `calendar(from, to, unit_ids?)` returning units, bookings, blocks,
  occupancy rows and arrivals/departures in one round trip; all writes go through the
  booking engine RPCs, so the board can never diverge from the DB.
- **"Real time":** the production stack has **no Supabase Realtime container** (7
  containers: db, kong, auth, rest, storage, meta, studio). The board refetches on focus,
  on an interval (e.g. 30 s) and after every own action; conflicts are impossible because
  every write is validated by the exclusion constraint. Adding Realtime later is an
  infrastructure decision (A7).
- **Tables:** none new.
- **Tests:** RPC tests (range edges, half-open ranges, whole-property fan-out), visual
  E2E of the board, performance (50 units × 90 days).
- **Depends on:** 1, 2.

### Stage 4 — Public website engine (themes) and booking flow
- **Builds:** SSR public site on the Hospitality host; **theme library** (Luxury, Nature,
  Modern, Romantic — each a different layout, not only colours); **section registry**
  (hero with image/video, availability & booking bar, about, units, unit page, gallery,
  videos, amenities, experiences, prices & promotions, reviews/testimonials, location &
  map, FAQ, contact, WhatsApp); public booking flow (A5); built-in footer
  **"כל הזכויות שמורות לנוריאל מחשבים"** linking to `https://nuriel-app2.nuri1.fit`
  (rendered by every theme, not editable by the owner); **demo media pack**;
  **Nofei Dorit showcase tenant** seeded with demo data.
- **Site content model:** one versioned **site document** (JSON validated by Zod schemas
  from the section registry): pages → ordered sections (type, hidden flag, content,
  media references by id), theme key + tokens (colours, approved fonts, button/card/
  gallery styles), header/footer settings, per-page SEO. Business data (units, prices,
  availability, reviews) is **never copied** into the document; sections reference it.
- **Tables:** `site_versions` (one mutable draft per tenant + immutable published
  versions). The public site renders the latest published version (one indexed read).
- **Demo media pack:** curated photos (zimmers, rooms, interiors, pools, views, compounds)
  under a licence that allows commercial use (e.g. Unsplash / Pexels licence), stored in a
  platform storage bucket with a **licence manifest in code** (source, author, licence).
  Media rows created from the pack carry `is_demo = true`; the site shows a "תמונה
  להמחשה" tag until replaced. (Stock sites are blocked from the development sandbox; the
  pack is assembled with your approval of the images and licences.)
- **Server functions / RPCs:** `site.getPublished` (SSR), public `quote`, public
  `requestBooking`, `units.publicList`, `availability.publicMonth` (free/busy only).
- **Reuses:** SSR + head management (TanStack Start), `brand-theme.ts` contrast checks via
  a platform theme adapter, legal-page templates (shared), cookie consent component via a
  platform adapter, captcha (`captcha.server.ts`) and rate limiting for public booking.
- **Independent:** themes, sections, booking UI, public RPCs.
- **Tests:** schema validation of documents, SSR snapshot per theme, Lighthouse budget,
  RTL/mobile visual tests, public booking E2E incl. double-booking race.
- **Depends on:** 1, 2 (units, media).

### Stage 5 — Visual editor ("עיצוב האתר שלי")
- **Builds:** live preview of the real site (same renderer) in an iframe with desktop /
  mobile toggle; click a text → inline edit; click an image/video → replace from library
  or upload (computer/phone); logo; colours (palette + contrast guard), approved fonts;
  section panel: add / remove / hide / reorder (drag), per-section style options;
  buttons & links editor (internal pages, booking, WhatsApp, phone, external);
  **autosave to draft** (optimistic revision check), **publish**, version history,
  restore; theme switch without losing content.
- **Tables:** `site_versions` (Stage 4). No new tables.
- **Server functions:** `site.getDraft`, `site.saveDraft(revision, patch)`,
  `site.publish`, `site.listVersions`, `site.restore`, `site.switchTheme`.
- **Reuses:** media library (Stage 2), image upload pipeline; design ideas from the
  existing Ecommerce `HomeDesignPanel` / branding settings — **re-implemented**, not
  imported (the Ecommerce panel edits Ecommerce tables). Generic helpers (contrast, image
  resize) are moved behind `src/platform/theme` / `src/platform/media` adapters first.
- **Finding:** Ecommerce has branding, banners and a CMS for text pages, but **no theme
  library or section editor**; there is nothing to share beyond generic helpers.
- **Tests:** editor E2E (edit → autosave → preview → publish → public site), concurrent
  editing (revision conflict), restore, accessibility of the editor.
- **Depends on:** 4.

### Stage 6 — Guest accounts, addresses, domains, onboarding
- **Guest login:** Supabase Auth (shared): Google and email code (existing
  `login-code.functions.ts`), through a Hospitality guest login screen. A guest is **not**
  a `public.user_roles` member; the per-tenant guest record links to `auth.users` via
  `guests.user_id`. One auth account can book at many businesses; each business only sees
  its own `guests` row. "My bookings" lists bookings of the current site only.
- **Three identity classes kept apart:** platform admins (`platform_admins`); business
  owners/managers (`public.user_roles` role `admin` on a Hospitality tenant); guests
  (`auth.users` + `hospitality.guests`, no membership).
- **Finding (must fix in Stage 1 design):** `public.current_tenant_id()` returns NULL for
  a logged-in user who is a member of *another* tenant and visits this site (e.g. an
  Ecommerce staff member booking a zimmer). Guest-facing Hospitality RPCs therefore use
  `hospitality.request_tenant()` (the validated `x-tenant-id` of the site, must be a
  Hospitality tenant) and filter by `auth.uid()`, never `current_tenant_id()`. Staff
  RPCs keep `current_tenant_id()`.
- **Google redirect:** today the redirect goes to the current origin; every Hospitality
  subdomain/custom domain must be allowed in GoTrue's redirect allow-list
  (`ADDITIONAL_REDIRECT_URLS`, wildcard `https://*.nuri1.fit/**`). To be verified on the
  production config before Stage 6 (no change now).
- **Duplicate accounts:** the existing `email_has_other_account` hook already prevents
  two auth accounts for one email — reused unchanged.
- **Site address:** reuse `tenants.slug` (UNIQUE), `platform_slug_problem`,
  `platform_reserved_slugs`, `checkStoreSlug`: availability check before save, reserved
  names, and the UNIQUE constraint makes concurrent claims safe (one insert wins).
  Routing via `tenant_for_host()` (unchanged).
- **Custom domains:** reuse `custom-domain.functions.ts`, DNS verification, `tenant_ssl`
  and the certificate agent — already product-neutral; exposed in the Hospitality
  settings through a platform domains adapter.
- **Nuriel landing page:** later, `PlatformLanding` / `PortalOnboarding` get a choice
  "חנות אינטרנטית / אתר צימרים ואירוח" behind `hospitality_onboarding_enabled`;
  provisioning goes through the engine registry (`engine.provision()`), so the platform
  onboarding never imports Hospitality code. **Not changed now.**
- **Tables:** none new (`guests.user_id` exists from Stage 1).
- **Depends on:** 4.

### Stage 7 — SEO & marketing
- **Builds:** per-page title/description (in the site document), friendly URLs
  (`/units/<slug>`, `/<page-slug>`), per-site `sitemap.xml` and `robots.txt` from the
  Hospitality engine (Ecommerce feeds untouched), Open Graph per page/unit, schema.org
  (`LodgingBusiness` / `Hotel` for the business, `Accommodation` / `HotelRoom` for units,
  `AggregateRating` only from verified reviews — Google's current guidance re-checked
  before implementation), indexing toggle, Google Analytics / Meta Pixel ids, Google
  site verification; promotions & coupons UI; video/image SEO (alt, VideoObject).
- **Reuses:** shared `public.site_settings` columns already holding GA id, Pixel id,
  Google verification (product-neutral) via a platform marketing adapter;
  `TrackingConsent` cookie-consent behaviour (tracking only after consent) via a platform
  consent adapter; `structured-data.ts` helpers (`jsonLdText` escaping) moved behind a
  platform SEO adapter.
- **Tables:** none new (`promotions` from Stage 1).
- **Depends on:** 4 (5 for per-page SEO editing).

### Stage 8 — Payments
- **Builds:** payment modes per business/unit: full, deposit (%), on arrival, business
  terms text; payment links at booking or after approval; deposit/full capture; manual
  payment recording (cash, transfer, Bit); refunds recorded; payment status on bookings.
- **Finding:** `grow.server.ts` (credentials, `createGrowPaymentProcess`, webhook parsing
  & approval) is mostly product-neutral, but the webhook handler and
  `grow_payment_processes` are tied to Ecommerce `orders`. Plan: move the neutral Grow
  client behind `src/platform/payments/grow` (adapter, no Ecommerce change), give
  Hospitality its own `payments` table and its **own webhook route**; Ecommerce keeps its
  route and tables.
- **Tables:** `payments` (booking, kind deposit|balance|full|refund, method, amount,
  provider reference, status).
- **Depends on:** 1, 4 (public flow), 2 (owner screens). Requires separate approval.

### Stage 9 — Reviews & reputation
- **Builds:** post-stay review request (email after checkout), verified reviews linked to
  a checked-out booking, owner testimonials (clearly labelled), moderation (publish /
  hide / report), owner replies, rating summary for SEO.
- **Tables:** `reviews` (kind review|testimonial, booking_id for verified, rating,
  text, status, reply, report fields). One table (no separate reports table).
- **Depends on:** 1, 4, 7.

### Stage 10 — Help centre ("מרכז הדרכה")
- **Builds:** Hebrew guides inside the owner area (how to add a unit, upload photos/
  video, change logo, edit the site, add a manual booking, block dates, approve a
  booking, change weekend price, manage guests…), with screenshots and later videos;
  contextual "?" help on each screen and short first-use tips.
- **Guides from the code:** each guide is a file in
  `src/engines/hospitality/help/guides/` that references **screen ids and element ids**
  (`data-help="units.add"`) present in the UI. A test fails if a guide references a
  screen or element that no longer exists, so guides cannot describe unbuilt features.
  Screenshots are produced by Playwright "guide capture" scripts that run the real
  screens on the disposable test environment and annotate the referenced elements; they
  are regenerated when screens change.
- **Tables:** none (guides are versioned with the code; optional "tip dismissed" state
  in browser storage).
- **Depends on:** the screens it documents (2, 3, 5 …). Only built features get guides.

### Stage 11 — Super admin & Hospitality plans
- **Builds:** platform overview composed from engine admin providers; Hospitality
  section (sites, owners, units, bookings, subscriptions, revenue reports); Hospitality
  plans & limits activation (prices only after approval).
- **Tables:** `plans`, `subscriptions` (Stage 1).
- **Depends on:** 1, 8.

## A5. Booking process (end-to-end)

### Public request (default mode `request`)
1. Guest picks check-in/out, unit, guests → `quote` (server-side price, min nights,
   capacity, availability; expired holds treated as free).
2. Guest enters details (name, phone, email; marketing consent separate, unchecked) and
   submits → `request_booking` (captcha + rate limit per IP/email/phone; idempotency key).
3. In one transaction: price recomputed and locked per night; booking inserted with
   status **`pending_approval`** and `hold_expires_at = now() + approval window`
   (business setting, e.g. 24 h); occupancy rows inserted → the **dates are held** and the
   exclusion constraint guarantees no double booking, also under concurrent requests.
4. Emails (async after commit, logged): owner — full details + approve/decline link;
   guest — "הבקשה התקבלה וממתינה לאישור בעל העסק" (explicitly *not* a confirmation).
5. Owner approves → `confirmed` (or `pending_payment` when a deposit is required, Stage 8)
   → guest confirmation email. Owner declines → `declined`, dates released → guest email.
6. **Owner does not respond in time:** at `hold_expires_at` the request becomes
   `expired` (lazy expiry in every booking transaction + idempotent sweep), dates are
   released, guest and owner are notified. Optional setting: reminder to the owner at
   50 % of the window.
7. **Abandoned / spam protection:** captcha, rate limits, max open requests per
   email/phone per site, short approval window, owner can decline/block a contact.
8. Mode `instant` (setting): step 3 creates `confirmed` (or `pending_payment` with a
   payment hold) immediately.

### Manual booking ("הוספת הזמנה")
- Owner chooses unit (or whole property), dates, guest name + phone (+ email optional),
  price (calculated suggestion or **manual override**), notes, source
  (`phone` / `walk_in` / `owner` / `external` + free-text channel), status
  (`confirmed` or `pending_approval` with optional deadline), and whether to email the
  guest.
- Same RPC path as public bookings (`create_manual_booking`): same validation, same
  occupancy and exclusion constraint → appears immediately on the calendar and blocks
  dates according to its status; manual price stored as locked nights with
  `rule_applied = 'manual'`.

### Change and cancellation
- `modify_booking` (dates, unit, guests, price) runs in one transaction: old occupancy
  removed, new occupancy inserted → exclusion check; price recomputed or manual;
  event recorded with before/after.
- `cancel_booking` (owner or guest when allowed): fee from the policy snapshot; dates
  released; emails.
- Every action writes `booking_events` (actor, from/to status, changed fields, note).

### Statuses
```
pending_approval → confirmed | pending_payment | declined | cancelled | expired
pending_payment  → confirmed | cancelled | expired
confirmed        → checked_in | cancelled | no_show
checked_in       → checked_out
expired          → confirmed     (owner re-approves / late payment, only if dates free)
declined, cancelled, no_show, checked_out: terminal
```
Inventory-holding statuses: `pending_approval` and `pending_payment` (until
`hold_expires_at`), `confirmed`, `checked_in`.

> Change from the previous plan: requests now **hold dates** while awaiting approval (your
> requirement). The risks of holding (fake requests blocking dates) are handled by the
> approval window, captcha, rate limits and open-request caps above.

## A6. Consistency check — findings and conflicts

| Finding | Impact | Resolution |
|---|---|---|
| No Supabase Realtime in production | "real-time" calendar | refetch/polling + DB-validated writes (Stage 3); Realtime is an optional infra decision |
| `current_tenant_id()` returns NULL for members of other tenants | logged-in guests who are staff elsewhere | guest RPCs use `hospitality.request_tenant()` + `auth.uid()` (designed in Stage 1) |
| Grow webhook bound to Ecommerce orders | Hospitality payments | platform Grow client adapter + Hospitality's own table and webhook (Stage 8) |
| Ecommerce footer links to `nuriel-shop.co.il` | branding | Hospitality themes render their own footer with `https://nuriel-app2.nuri1.fit`; Ecommerce unchanged |
| Ecommerce has no theme/section editor | editor reuse | Hospitality editor is new; only generic helpers shared via platform adapters |
| Video upload size | videos | short clips uploaded (limit set by storage config — to verify on the server; banners use 15 MB today); long videos via YouTube/Vimeo embed section |
| Stock images not reachable from the sandbox | demo media pack | images selected and licence-checked with your approval, stored with a licence manifest |
| GA/Pixel/verification live in shared `site_settings` | marketing | reused via platform adapter (product-neutral columns only) |
| Google OAuth redirect per subdomain | guest login | verify GoTrue allow-list wildcard before Stage 6 |
| Generic helpers live in `src/lib` (image, email, rate-limit, structured-data, brand-theme, captcha) | engine independence | wrapped by `src/platform/*` adapters; Hospitality never imports `src/lib` |

No requirement conflicts with the separation principle once these adapters exist.

## A7. Open questions and decisions

1. Approval window default (e.g. 24 h) and whether it is per business only or also per
   unit; reminder to the owner.
2. Max open requests per guest contact (e.g. 2 per site).
3. Demo media: approve the image source(s) and licence (Unsplash/Pexels or purchased).
4. Realtime calendar: stay with refetch (recommended) or add the Realtime container later.
5. Video limits: allowed upload size, and whether to rely on YouTube/Vimeo embeds for
   long videos.
6. Guest self-service cancellation: allowed by default, or owner-only?
7. Footer text is fixed in every theme — confirm it must not be removable by any plan.
8. Payments (Stage 8) and Hospitality pricing (Stage 11) require separate approvals.

---

# Part B — Stage 1: backend foundation (implementation-ready)

## B0. Principles
1. Two independently separable engines; both depend only on the shared platform.
2. Ecommerce behaviour unchanged; every existing tenant is and stays `ecommerce`;
   no mass refactor.
3. Hospitality off by default at three layers: environment (`HOSPITALITY_ENGINE`),
   server (dispatcher + engine guard), database (RLS + RPC flag checks).
4. Correctness in PostgreSQL: RLS, `EXCLUDE` (no double booking), state-machine trigger,
   server-side pricing.
5. Additive migrations only; the only touch to an existing object is a `WHEN` condition
   on the existing tenant-seed trigger (function body unchanged).
6. Every new policy, trigger and RPC is tested; the Stage 0 suite stays green.

## B1. Engine architecture

```
                 ┌──────────────────────────────┐
                 │  Composition root (src/app)  │  the ONLY code that knows both engines
                 └──────┬─────────────────┬─────┘
          ┌─────────────▼──────┐   ┌──────▼──────────────┐
          │  Ecommerce engine  │   │  Hospitality engine │
          │ (existing code)    │   │ src/engines/hosp…   │
          └─────────┬──────────┘   └──────────┬──────────┘
                    └──────────┬───────────────┘  contracts / adapters only
                     ┌─────────▼──────────┐
                     │  Shared platform   │  no product business logic
                     │  src/platform/     │
                     └────────────────────┘
```
Allowed: `ecommerce → platform`, `hospitality → platform`, `app → *`.
Forbidden: `ecommerce ↔ hospitality`, `platform → engines`.
Enforced by ESLint `no-restricted-imports` overrides and a Vitest architecture test
(parses imports, incl. dynamic and relative).

**Engine contract** (`src/platform/engines/contract.ts`): `key`, `ownsServerFn(filename)`,
`enabledFor(tenant)`, `gate(request)`, `provision(input)` (used later by onboarding),
`admin?` (super-admin provider). `src/engines/hospitality/engine.ts` implements it;
`src/engines/ecommerce/engine.ts` is a thin descriptor over existing code.

**Existing couplings (documented, not refactored now):** tenant resolution embeds the
Ecommerce subscription; `storeGate` lock uses it; `tenants_seed_settings` seeds Ecommerce
rows; `site_settings` mixes generic and Ecommerce columns; generic helpers live in
`src/lib`. Hospitality never touches them directly — only through platform adapters.

## B2. Server functions and routing
- 44 server-function files (133 functions) share `/_serverFn/<sha256 id>`; TanStack Start
  passes `serverFnMeta.filename` to global function middleware (verified present in
  production builds).
- **Ownership:** Hospitality = `src/engines/hospitality/**`; Platform = `src/platform/**`
  + documented legacy shared files (auth, login codes, password, store switcher,
  support, handoff, custom domain, marketing consent, site forms, owner agreement,
  email settings, notifications, `platform*`, `portal`); Ecommerce = everything else
  (default = today's behaviour).
- **Dispatcher** (`src/platform/engines/engine-guard.ts`, global function middleware):
  allows a call if owner is platform, or owner = tenant's product and the engine is
  enabled; otherwise 404; unknown filename on non-Ecommerce tenant → 404. Ecommerce
  tenants: constant-time pass, no DB call.
- **Edge:** `storeGate` asks the registry for non-Ecommerce tenants only; Hospitality
  gate: pages 404 unless `hospitality_frontend_enabled`, `robots.txt` `Disallow: /`,
  Ecommerce feeds/API routes 404.
- Test: every `createServerFn` file has exactly one owner.

## B3. Database: dedicated `hospitality` schema (verified)
Production = official Supabase Docker stack (`kobi`, `kobi-rest` = PostgREST), migrations
applied with `psql`. Prototype tested on the local Supabase (same images), then removed:

| Check | Result |
|---|---|
| Not exposed (production today) | `PGRST106 Invalid schema` — unreachable until deliberately exposed |
| supabase-js | `.schema('hospitality').from()/.rpc()` with user JWT + `x-tenant-id` work |
| RLS | own rows only; cross-tenant read `[]`; cross-tenant insert `42501`; anon w/o grant `42501` |
| Cross-schema | FK to `public.tenants`, calls to `public.current_tenant_id()` work |
| Types | `gen types --schema hospitality` → Hospitality-only types |
| Backup | `pg_dump -n hospitality` self-contained (FKs to `public.tenants` only) |
| Rollback | `DROP SCHEMA … CASCADE`, Ecommerce untouched |
| **Critical** | an exposed but **missing** schema makes the whole API return **503** |

Rules: migrations first, then add `hospitality` to `PGRST_DB_SCHEMAS` and restart
`kobi-rest` (only at go-live, one line in `/root/kobi-supabase/docker/.env`); down
migrations never drop the schema itself; DEFINER functions use `SET search_path = ''`;
local/CI expose the schema in the generated (gitignored) config.

## B4. Ecommerce isolation
- **70 public tables** classified: Ecommerce (40) — abandoned_carts, cancellation_requests,
  cart_promotions, categories, coupon_email_sends, coupons, customer_carts,
  customer_emails, customer_invites, customer_profiles, global_products,
  grow_payment_processes, home_banner_slides, location_transfer_lines,
  location_transfers, order_courier_links, order_delivery_events, order_items,
  order_number_counters, orders, pages, pending_products, picking_events,
  price_tier_backup, product_categories, product_drafts, product_locations,
  product_relations, product_reviews, product_serials, product_stickers,
  product_variants, service_agreements, shared_carts, shipping_methods,
  stock_count_lines, stock_counts, tenant_addons, tenant_subscriptions,
  user_custom_prices; Shared platform (20) — tenants, user_roles, site_settings,
  email_settings, tenant_email_secrets, login_codes, password_reset_requests,
  password_reset_tokens, staff_notifications, contact_messages, support_tickets,
  support_messages, marketing_consents, marketing_consent_events, notification_logs,
  tenant_ssl, tenant_billing_profile, billing_history, upgrade_requests,
  tenant_grow_credentials; Platform admin (10) — platform_addons,
  platform_admin_handoffs, platform_admins, platform_agreement_acceptances,
  platform_agreement_versions, platform_audit_log, platform_documents,
  platform_email_log, platform_plans, platform_pricing_settings.
- 350 public functions (291 SECURITY DEFINER; 113 anon, 247 authenticated) — classified
  in `docs/architecture/db-classification.md` (step 1a) with a coverage test.
- 52 browser files call Supabase directly → DB-level protection required.
- **Protection:** edge gate; dispatcher; statement-level `AFTER INSERT` and
  `AFTER UPDATE OF tenant_id` guards on the 40 Ecommerce tables (reject non-Ecommerce
  tenants; covers PostgREST, DEFINER RPCs, service_role); product-role rule on
  `user_roles` (`platform_product_roles`); RESTRICTIVE storage policy for
  `product-images`; reverse check on Hospitality objects.
- **Measured overhead** (local, 3 runs): 5,000-row insert 1.66–2.02 s → 1.84–2.05 s;
  1,000 single inserts 0.49–0.65 s → 0.53–0.72 s — within noise. Normal updates: zero
  (guard only on `UPDATE OF tenant_id`). Re-measured on final triggers in 1b.

## B5. Feature flags (product-neutral platform capability)
`platform_feature_flags`, `tenant_feature_flags`, `platform_feature_enabled(key, tenant)`,
`platform_set_flag()` (platform admin, audited). Hospitality registers
`hospitality_backend_enabled`, `hospitality_frontend_enabled`,
`hospitality_onboarding_enabled`, `hospitality_themes_enabled`,
`hospitality_booking_enabled` (all false) and wraps them in `hospitality.flag(key)`.
Server reads flags with the tenant (15 s cache), never sends them to the browser.
Env kill-switch `HOSPITALITY_ENGINE` (unset in production).

## B6. Data model — complete and minimal

Final Hospitality model: **22 tables**. Stage 1 creates 19; Stages 4, 8 and 9 add one each.
All: `tenant_id` → `public.tenants`, composite `(tenant_id, id)` FKs, timestamps, RLS,
RESTRICTIVE `tenant_isolation` + `backend_enabled`, no `anon` grants (public access only
through DEFINER RPCs).

| # | Table | Purpose | Stage |
|---|---|---|---|
| 1 | `settings` | business profile & booking settings: name, contact phone/email, WhatsApp, address, check-in/out, booking mode (request/instant), approval window, payment hold minutes, weekend nights, currency, timezone, guest retention, notification recipients | 1 |
| 2 | `policies` | cancellation tiers, payment mode (full/deposit/on arrival), deposit %, house rules; snapshotted onto bookings | 1 |
| 3 | `properties` | a compound/site (name, slug, description, address, map coordinates, status) | 1 |
| 4 | `units` | rooms/zimmers/whole-property bundles: kind, name, slug, description, capacity, base occupancy, child age, bedrooms, bathrooms, base & extra-person prices, min nights, floor/ceiling, active, sort, SEO fields | 1 |
| 5 | `unit_members` | whole-property ↔ member units | 1 |
| 6 | `unit_beds` | beds and sleeping arrangements | 1 |
| 7 | `amenities` | the business's amenity catalogue | 1 |
| 8 | `unit_amenities` | amenity on a property or unit | 1 |
| 9 | `media` | images and videos (upload or YouTube/Vimeo embed): owner (site/property/unit), storage path or embed URL, alt, size, cover, sort, `is_demo`, licence reference | 1 |
| 10 | `rate_rules` | weekday / weekend / season / **holiday** rules: scope, date range, days mask, price or adjustment, min nights, priority | 1 |
| 11 | `promotions` | automatic discounts **and** coupon codes: scope, dates, percent/fixed, min nights, code (nullable), usage limit | 1 |
| 12 | `guests` | per-business guest record: name, email, phone, notes, `user_id` (optional auth link), erasure fields | 1 |
| 13 | `bookings` | number, unit, guest, dates, guests, status, hold/approval deadline, source + channel, idempotency key, totals, payment status, policy snapshot, promotion, notes, special requests | 1 |
| 14 | `booking_nights` | locked per-night rate and applied rule (incl. `manual`) | 1 |
| 15 | `booking_events` | append-only history: status changes, field changes (before/after), emails sent, actor | 1 |
| 16 | `blocks` | owner blocks with reason and release | 1 |
| 17 | `unit_occupancy` | internal: physical unit × night range for live bookings/blocks; `EXCLUDE` constraint | 1 |
| 18 | `plans` | Hospitality plans & limits (unpublished placeholders) | 1 |
| 19 | `subscriptions` | Hospitality subscription per tenant | 1 |
| 20 | `site_versions` | site document: one mutable draft per tenant + immutable published versions (content, sections, theme tokens, per-page SEO) | 4 |
| 21 | `payments` | deposits, balances, refunds, manual payments; provider reference | 8 |
| 22 | `reviews` | verified reviews and testimonials, moderation, replies, report fields | 9 |

**Deliberately not tables:**
- calendar → RPC over bookings/blocks/occupancy;
- manual bookings → `bookings.source`;
- dashboard, tasks and reports → queries;
- notifications → shared email transport + logs, with history in `booking_events`;
- help guides → files in code;
- holidays → `rate_rules` kind;
- coupons → `promotions.code`;
- review reports → fields on `reviews`;
- theme settings and site content → the site document.

**Changes from the previous Stage 1 list:**
- `holidays` folded into `rate_rules`.
- `review_reports` folded into `reviews`.
- `reviews` moved to Stage 9, because it needs completed stays.
- New in this model: `media` gains video and embed support, `guests.user_id` is added,
  and `bookings.source` and channel are added.
- The total stays at 19 tables in Stage 1.

## B7. Booking engine (Stage 1 scope)
- Statuses and transitions as in A5, enforced by a trigger.
- Occupancy fan-out for whole properties; `EXCLUDE USING gist (tenant_id =, unit_id =,
  nights &&)` on half-open `[check_in, check_out)`.
- Holds: `pending_approval` and `pending_payment` require `hold_expires_at` (DB clock).
  Lazy expiry inside `request_booking`, `create_manual_booking`, `approve`, `modify`,
  `confirm_payment` before inserting; reads treat expired holds as free; idempotent sweep
  `expire_holds()` (`FOR UPDATE SKIP LOCKED`, one event per booking).
- RPCs: `quote`, `request_booking` (public, idempotent, `request_tenant()`),
  `create_manual_booking`, `approve_booking`, `decline_booking`, `modify_booking`,
  `cancel_booking`, `mark_checked_in|checked_out|no_show`, `expire_holds`,
  `confirm_payment` (status only; no provider in Stage 1).
- Pricing per night: promotion > holiday > unit season > property season > weekend >
  weekday > base; occupancy extras; min nights = max of applicable rules; floor/ceiling.
- Privacy: `export_guest`, `anonymize_guest` (blocked with live/future bookings),
  `apply_retention` (only when a period is configured; NULL default); no ID documents.
- Emails are **not** sent in Stage 1 (Stage 2); RPCs record events that the email layer
  will consume.

## B8. Whole property — concurrency scenarios
(1) whole vs member same dates → one wins; (2) members A and B succeed, then whole fails;
(3) two overlapping whole bookings → one wins; (4) adjacent stays both succeed;
(5) expired hold on a member + new whole booking succeeds, late sweep no-op;
(6) two bookings racing an expired hold → one wins, one `expired` event;
(7) approving after the dates were taken → refused; (8) idempotent retry
(sequential + concurrent) → one booking; (9) block vs pending whole booking → one wins;
(10) price change after booking → locked nights unchanged;
(11) manual booking vs public request on the same dates → one wins;
(12) `modify_booking` into occupied dates → refused, original booking intact.
Runner: two `psql` sessions with explicit ordering (`scripts/db-tests/hospitality/concurrency/`).

## B9. RLS and permissions
- `public.current_site_type()` (platform).
- Staff: `hospitality.can(permission)` on `public.store_staff_role()`; owner/manager → all;
  Hospitality tenants accept only `admin` members.
- Guests: `hospitality.request_tenant()` + `auth.uid()` in guest RPCs (A6 finding).
- Bookings/nights/events/occupancy: staff SELECT only; writes only via RPCs.
- Storage `hosp-media`: public read, write `<tenant_id>/…` by staff with
  `can('media')` and backend flag.

## B10. Migrations (Stage 1)
| # | File | Owner | Contents |
|---|---|---|---|
| 1 | `20261101090000_platform_products_flags.sql` | platform | `tenants.site_type` (default `ecommerce`, immutable), `current_site_type()`, `platform_product_roles` + `user_roles` trigger, flags tables + functions, `platform_seed_tenant_shared()`, `WHEN (NEW.site_type='ecommerce')` on existing seed trigger |
| 2 | `20261101100000_ecommerce_engine_guard.sql` | ecommerce | Ecommerce roles registration, write guards on 40 tables, `product-images` storage guard |
| 3 | `20261101110000_hosp_schema.sql` | hospitality | schema + grants, flag keys, `flag()`, `can()`, `request_tenant()`, tables 1–11, RLS, `hosp-media` bucket, `admin_create_site()` |
| 4 | `20261101120000_hosp_booking.sql` | hospitality | `btree_gist`, tables 12–17, EXCLUDE, state machine, booking RPCs, expiry, privacy RPCs |
| 5 | `20261101130000_hosp_billing_admin.sql` | hospitality | tables 18–19, entitlements, unit limit, Hospitality admin stats functions |

Each with a rollback (never dropping the schema itself). Platform migrations do not
reference engines; Ecommerce does not reference Hospitality; Hospitality references
platform objects only. Timestamps renumbered if `main` gains later migrations.

## B11. Folder structure (target; Stage 1 creates only what it uses)

```
src/
  app/engines.ts                         composition root (registers engines)
  platform/
    engines/        contract.ts registry.ts engine-guard.ts shared-functions.ts
    tenancy/        site-type.ts
    feature-flags/  flags.server.ts
    permissions/    membership-role.server.ts
    notifications/  email.ts               (adapter → src/lib/email.server.ts)       [2]
    media/          upload.ts image.ts     (adapter → src/lib/image.ts, storage)      [2]
    theme/          contrast.ts            (adapter → src/lib/brand-theme.ts)         [4]
    seo/            jsonld.ts feeds.ts     (adapter → structured-data helpers)        [7]
    consent/        tracking-consent.tsx   (adapter → existing consent behaviour)     [7]
    payments/grow/  client.server.ts       (adapter → neutral parts of grow.server)   [8]
    domains/        slug.ts custom-domain.ts (adapters → existing functions)          [6]
    auth/ users/ tenant-membership/ billing/                       (later, as code moves)
  engines/
    ecommerce/engine.ts                  thin descriptor (no code moved)
    hospitality/
      engine.ts config.ts README.md      README = platform contract used
      types/ (database.ts generated, domain.ts)  validation/  contracts/
      properties/ units/ media/ pricing/ availability/ bookings/ guests/ promotions/
      billing/                                                         [1]
      management/   owner area screens & dashboard                    [2]
      calendar/     availability board                                 [3]
      website/      renderer, themes/{luxury,nature,modern,romantic}, sections/,
                    public booking flow, demo-media manifest           [4]
      website-editor/                                                  [5]
      guest-portal/ guest login & my bookings                          [6]
      seo/          sitemap, robots, schema.org for Hospitality        [7]
      payments/                                                        [8]
      reviews/                                                         [9]
      help/         guides/, capture scripts, in-screen tips           [10]
      admin/        super-admin provider                               [11]
      server/       *.functions.ts (owner, public, guest)
      tests/
scripts/db-tests/hospitality/            SQL + concurrency tests
supabase/migrations/*_platform_* | *_ecommerce_* | *_hosp_*
docs/hospitality/
```

Existing files changed in Stage 1 (minimal): `src/start.ts` (register dispatcher),
`src/server.ts` (registry gate for non-Ecommerce tenants),
`src/integrations/supabase/tenant.server.ts` (`siteType` + flags, defaults to
`ecommerce`), `eslint.config.js` (dependency rules), `vitest.config.ts` (engine tests),
`scripts/db-tests/run.sh` (Hospitality folder), `e2e/scripts/supabase-up.sh` (expose
schema locally), `e2e/scripts/seed.sql` (one Hospitality tenant, flags off).
Not changed: Ecommerce routes, components, business logic, landing page and onboarding,
shared `types.ts`, Dockerfile, deployment.

## B12. Tests (Stage 1)
- SQL: site_type default/immutability; product roles; flags; seed-trigger equivalence;
  Ecommerce write guards (generated per table, incl. `UPDATE OF tenant_id`); storage
  guard; RLS per Hospitality table (cross-tenant, anon, flag off, wrong product); state
  machine (every edge); quote rules incl. holidays and manual price; manual booking;
  modify; idempotency; rate lock; cancellation fee; hold/approval expiry (lazy + sweep);
  whole property; `request_tenant()` for guests who are members elsewhere; privacy;
  entitlements; admin functions gated; DB classification coverage; RLS coverage extended
  to the `hospitality` schema.
- Concurrency: the 12 scenarios in B8.
- Vitest: architecture rules, server-function ownership, dispatcher decision table,
  validators.
- E2E: existing 33 unchanged + gate tests (Ecommerce host unaffected; Hospitality host
  with flags off closed; flags on locally → owner functions work, cross-tenant denied).
- Benchmark: write guards re-measured (1b).

## B13. Risks and rollback (Stage 1)
| Risk | Mitigation | Rollback |
|---|---|---|
| Dispatcher misclassifies an Ecommerce function | Ecommerce default owner; full E2E + ownership test | remove middleware line |
| Write guards slow Ecommerce | statement-level, `UPDATE OF tenant_id` only, measured | rollback 2 |
| Seed trigger `WHEN` | body unchanged; equivalence test | rollback 1 |
| Exposed schema missing → API 503 | migrations before exposure; schema never dropped by rollbacks | remove from `PGRST_DB_SCHEMAS` first |
| Holding dates for requests (spam) | approval window, captcha, rate limits, open-request cap | setting: instant / shorter window |
| `btree_gist` unavailable | standard extension, checked first | migration 4 aborts transactionally |
| Server before migrations | `siteType` falls back to `ecommerce`, flags off | — |
| Parallel work on `main` | merge `main` into the branch (no rebase), rerun all tests | — |

Rollback order 5 → 1; Hospitality objects are new, so Ecommerce data cannot be affected.

## B14. Implementation sequence (report after each step)
1a migration 1 + platform tests + DB classification doc · 1b migration 2 + guard tests +
benchmark · 1c migration 3 + RLS tests · 1d migration 4 + booking/concurrency tests ·
1e migration 5 + tests · 1f platform engines (contract, registry, dispatcher),
Hospitality engine modules and owner/public server functions (no UI), tenant fields,
ESLint + architecture test, Vitest · 1g E2E gate tests, docs, full suite, CI,
completion report.
