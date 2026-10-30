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

## A0. Approved product decisions (round 3)

| # | Decision | Where designed |
|---|---|---|
| D1 | Owner approval window **12 h** by default, editable in business settings; reminder at **50 %** of the window; on timeout → `expired`, dates released, guest notified, everything in history; DB clock only | A5, B7 |
| D2 | Max **2 open requests per contact per business** (configurable); enforced in the DB, race-safe | A5, B7 |
| D3 | Demo images only from sources allowing commercial use, with documented source and licence, marked "demo" until replaced | A4 Stage 4 |
| D4 | No Realtime infrastructure now: auto-refresh every 30–60 s, immediate refresh after own actions, refresh on tab focus, no duplicates/stale edits; Realtime later via a platform adapter | A4 Stage 3, B6 |
| D5 | Guests can **request** cancellation from the site; owner approves/declines under the snapshotted policy; dates released only on approval (or automatic cancellation if the policy allows it) | A5, B7 |
| D6 | Fixed Nuriel credit in every Hospitality site footer: "כל הזכויות שמורות לנוריאל מחשבים" → `https://nuriel-app2.nuri1.fit`; styling adapts, removal impossible | A4 Stage 4 |
| D7 | Reliable email on top of the existing Nuriel email infrastructure: outbox, status, retries, no duplicates, error log, visibility; an email failure never undoes a saved booking | A5, B6 |
| D8 | Manual bookings may be **confirmed immediately** (availability-checked, saved, dates held, on the calendar at once, optional guest email) | A5 |
| D9 | Booking **without an account**; later login with Google/email; past bookings linked only after **verified** identity | A4 Stage 6, B7 |
| D10 | Dedicated tests for concurrency, whole property, expiry, manual vs site, email failure/duplicates, cancellation, request flooding, guest without account, cross-business access | B12 |
| D11 | **Owner-defined cancellation & deposit policies** (free-cancellation window, deadline, non-refundable deposit, % or fixed fees, tiers, no-show, per unit / per booking type); shown and accepted before booking; snapshotted per booking; refund **calculated** now, paid out only in the payments stage | A8 |
| D12 | Automatic cancellation default: **`never`** (owner approves every cancellation; `within_free_window` / `always` are opt-in) | A8 |
| D13 | Free-cancellation deadline time: the business's **check-in time** (business timezone), not midnight | A8 |
| D14 | The fee is determined by the **time of the guest's cancellation request** (DB clock), not by the owner's response time | A8 |
| D15 | **Simplified opening of a business** (Ecommerce and Hospitality): automatic unique address, no domain choice or technical terms at sign-up, address change later in "כתובת האתר" with old-address redirect, celebratory first-entry screen, short setup checklist with progress | A9 |
| D16 | "Manage my booking" link valid until **30 days after check-out** | A5, B7 |
| D17 | **Reuse the existing Google login, email-code login and email API** — no new Auth system, Google provider, OTP mechanism or email system; Hospitality adds only guest-specific rules on top of the shared primitives | A10 |
| D18 | Final installation on the **existing Nuriel server and Supabase stack** following a step-by-step runbook (no new server or project) | A11 |

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
- **Tables:** 20 (B6), including the `notifications` outbox (filled and tested, not sent).
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
  history, notes, export/anonymise); booking emails (owner + guest) via the **outbox worker** (retries, idempotency, delivery status on the booking page, resend); cancellation-request handling (with the calculated fee and override); **cancellation & deposit policy editor** (templates, tiers, per unit / per rate rule, live example "if a guest cancels on date X → refund Y"); demo-image indicator.
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
- **Freshness without Realtime (D4):** the production stack has **no Supabase Realtime
  container** (7 containers: db, kong, auth, rest, storage, meta, studio), and none is
  added now. The board uses the existing TanStack Query:
  - auto-refresh every 30–60 s (configurable), paused while the tab is hidden;
  - immediate refresh on tab focus and after every own action (mutation invalidates the
    calendar query);
  - one query key per visible range, so there are no duplicate requests or rows;
  - **no stale edits:** every booking carries a `revision`, and modify / approve / cancel
    send the revision they saw. If it changed, the RPC refuses with "ההזמנה עודכנה —
    מרעננים", and the board refreshes;
  - every write is validated by the exclusion constraint, so a stale screen can never
    create a double booking.
  
  Future Realtime goes through `src/platform/realtime/` (subscribe-to-changes interface)
  and only replaces the polling trigger — the booking engine does not change.
- **Tables:** none new.
- **Tests:** RPC tests (range edges, half-open ranges, whole-property fan-out), visual
  E2E of the board, performance (50 units × 90 days).
- **Depends on:** 1, 2.

### Stage 4 — Public website engine (themes) and booking flow
- **Builds:** SSR public site on the Hospitality host; **theme library** (Luxury, Nature,
  Modern, Romantic — each a different layout, not only colours); **section registry**
  (hero with image/video, availability & booking bar, about, units, unit page, gallery,
  videos, amenities, experiences, prices & promotions, reviews/testimonials, location &
  map, FAQ, contact, WhatsApp); public booking flow (A5); **Nuriel credit (D6)**;
  **demo media pack (D3)**; **Nofei Dorit showcase tenant** seeded with demo data.
- **Nuriel credit (D6):** "כל הזכויות שמורות לנוריאל מחשבים" linking to
  `https://nuriel-app2.nuri1.fit`. It is a platform branding component
  (`src/platform/branding/credit`) that the Hospitality renderer places **outside** the
  editable sections, so the site document and the editor cannot remove it. Themes may
  style it (colour, alignment, size within limits) through tokens. A test renders every
  theme × page and fails if the credit or the active link is missing.
- **Site content model:** one versioned **site document** (JSON validated by Zod schemas
  from the section registry): pages → ordered sections (type, hidden flag, content,
  media references by id), theme key + tokens (colours, approved fonts, button/card/
  gallery styles), header/footer settings, per-page SEO. Business data (units, prices,
  availability, reviews) is **never copied** into the document; sections reference it.
- **Tables:** `site_versions` (one mutable draft per tenant + immutable published
  versions). The public site renders the latest published version (one indexed read).
- **Demo media pack (D3):**
  - **Content:** curated high-quality photos of zimmers, rooms and interiors, pools,
    views and compounds.
  - **Licences:** only from sources whose licence allows commercial use (e.g. the
    Unsplash / Pexels licences, or purchased stock). No image without a recorded
    licence.
  - **Licence manifest in code** (`website/demo-media/manifest.json`): file, source URL,
    author, licence name + URL, date retrieved, approved-by.
  - **Storage:** a platform storage bucket.
  - **Licence test:** a CI test fails if a demo file has no manifest entry or uses a
    licence outside the allow-list.
  - **Marking:** media rows copied from the pack carry `is_demo = true`. The site shows a
    small "תמונה להמחשה" tag, and the owner dashboard lists the demo images still in
    use.
  - **Approval:** images are selected with your approval. Stock sites are blocked from
    this development sandbox.
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
- **Booking without an account (D9):** the public flow (Stage 4) needs only name, phone
  and email. Each booking email contains a **"manage my booking" link** with a single-use,
  expiring token (only its hash is stored). It lets the guest view the booking and
  request cancellation without an account.
- **Guest login:** Supabase Auth (shared): Google and email code (existing
  `login-code.functions.ts`), through a Hospitality guest login screen. A guest is **not**
  a `public.user_roles` member; the per-tenant guest record links to `auth.users` via
  `guests.user_id`. One auth account can book at many businesses; each business only sees
  its own `guests` row. "My bookings" lists bookings of the current site only.
- **Linking past bookings only after verification (D9):** `claim_guest_bookings()` links
  this site's `guests` rows to the logged-in user only when the auth account's email is
  **verified** (Google identity or confirmed email-code login) and equals the guest's
  normalised email. A typed email alone never links anything. Phone numbers are not used
  for linking (no verified phone login exists). Every link is recorded in
  `booking_events`.
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
- **Site address (see A9):** automatic `stay-<digits>` address at creation, changeable later in "כתובת האתר" with a 301 redirect from the old address. It reuses `tenants.slug` (UNIQUE), `platform_slug_problem`,
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
- **Refunds from cancellation policies (D11):** `cancellation_outcome.refund_due`
  (calculated since Stage 1) becomes an actual refund through the provider, or a "refund
  manually" task for cash or transfer payments.
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

All times come from the **database clock** (`now()` inside the RPC); nothing the browser
sends is used for deadlines, prices or availability.

### Public request (default mode `request`)
1. **Quote:** the guest picks check-in/out, unit and guests → `quote`. The server checks
   price, minimum nights, capacity and availability, and treats expired holds as free.
2. **Submit:** the guest enters name, phone and email → `request_booking`. No account is
   needed. Marketing consent is separate and unchecked. The call is protected by captcha,
   a rate limit and an idempotency key.
3. **Save and hold (one transaction):**
   - an advisory lock is taken per normalised contact (email and phone);
   - the **open-request cap (D2)** is checked;
   - the price is recomputed and locked per night;
   - the booking is inserted as **`pending_approval`** with
     `hold_expires_at = now() + settings.approval_window` (**12 h** default, D1);
   - occupancy rows are inserted → the **dates are held**, and the exclusion constraint
     prevents double booking, also for concurrent requests;
   - the booking event is written;
   - the owner's "new request" email and the guest's "received, awaiting approval" email
     are **enqueued in the outbox in the same transaction (D7)**.
4. **Emails** are sent by the outbox worker after commit:
   - **owner:** full details plus approve/decline links;
   - **guest:** "הבקשה התקבלה וממתינה לאישור בעל העסק" — explicitly *not* a confirmation.
     It also contains the "manage my booking" link.
5. **Reminder (D1):** at 50 % of the window, the sweep enqueues one owner reminder. The
   dedupe key `booking:<id>:approval_reminder` makes sure it is sent only once.
6. **Owner decision:**
   - **approve:** → `confirmed` (or `pending_payment` when a deposit is required, Stage 8),
     and the guest gets a confirmation email;
   - **decline:** → `declined`, the dates are released, and the guest gets an email.
7. **Timeout (D1):** at `hold_expires_at` the booking becomes `expired`, through lazy
   expiry inside every booking transaction and through the idempotent sweep:
   - the dates are released in the same transaction;
   - the guest gets "the request expired" and the owner gets an FYI;
   - all of it is written to the booking history.
8. **Open-request cap (D2):**
   - "open" means `pending_approval` and `pending_payment`;
   - the cap is counted per business per normalised email **or** normalised phone;
   - default 2, `settings.max_open_requests`;
   - it is checked under a per-contact advisory transaction lock, so parallel requests
     from the same contact are serialised and cannot exceed the cap.
9. **Other spam protection:** captcha, rate limits per IP, the short approval window, and
   the owner can decline a request and block the contact.
10. **Mode `instant`** (setting): step 3 creates `confirmed` immediately (or
    `pending_payment` with a payment hold).

### Manual booking ("הוספת הזמנה", D8)
- **Input:** the owner chooses a unit (or whole property), dates, guest name and phone
  (email optional), price (calculated suggestion or **manual override**), notes and
  source (`phone` / `walk_in` / `owner` / `external` + free-text channel).
- **Status:** **`confirmed` (default)** or `pending_approval`. The approval workflow is
  not required for manual bookings.
- **Same engine:** `create_manual_booking` uses the same availability validation,
  occupancy and exclusion constraint as site bookings. The booking appears on the calendar
  immediately and holds the dates according to its status.
- **Manual price:** stored as locked nights with `rule_applied = 'manual'`.
- **Guest email:** sent only if the owner ticks "שלח אישור ללקוח" (enqueued in the
  outbox).

### Change and cancellation (D5)
- **Change:** `modify_booking` (dates, unit, guests, price, with the expected
  `revision`) runs in one transaction:
  - the old occupancy is removed and the new occupancy inserted, then checked against the
    exclusion constraint;
  - the price is recomputed or set manually;
  - an event with before/after values is written.
- **Guest cancellation request:**
  - The guest uses "manage my booking" (token link) or "my bookings" (logged in).
  - Before confirming, the guest sees the **policy snapshot taken at booking time** (tiers
    and computed fee).
  - `request_cancellation` → status `cancel_requested`. **The dates stay held.**
  - The owner is notified and approves → `cancelled`: dates released, fee recorded, guest
    email. Or declines → back to `confirmed`, with a guest email that includes the
    reason.
- **Automatic cancellation:** only if the snapshotted policy's automatic rule allows it
  (`within_free_window` or `always`, A8). Then `request_cancellation` goes straight to
  `cancelled` and releases the dates. The fee is always computed by
  `cancellation_quote` at the DB time of the request and frozen in
  `cancellation_outcome`.
- **Owner cancellation:** `cancel_booking` by the owner, with the fee taken from the
  snapshot.
- **History:** every action writes `booking_events` (actor, from/to status, changed
  fields, note).

### Statuses
```
pending_approval → confirmed | pending_payment | declined | cancelled | expired
pending_payment  → confirmed | cancelled | expired
confirmed        → checked_in | cancel_requested | cancelled | no_show
cancel_requested → cancelled | confirmed
checked_in       → checked_out
expired          → confirmed     (owner re-approves / late payment, only if dates free)
declined, cancelled, no_show, checked_out: terminal
```
**Inventory-holding statuses:**
- `pending_approval` and `pending_payment`, until `hold_expires_at`;
- `confirmed`;
- `cancel_requested`;
- `checked_in`.

### Notifications (D7)
| Event | Owner | Guest |
|---|---|---|
| new request | ✓ (with approve/decline links) | ✓ "received, awaiting approval" |
| approval reminder (50 %) | ✓ | — |
| approved / confirmed | — | ✓ confirmation |
| declined | — | ✓ |
| expired (no answer) | ✓ FYI | ✓ "request expired" |
| cancellation requested | ✓ | ✓ "received" |
| cancellation approved / declined | — | ✓ |
| cancelled by owner | — | ✓ |
| manual booking | — | ✓ only if the owner chose to send |

**Reliability:**
- **Outbox in the same transaction:** a row in `notifications` is written together with
  the booking change, so a committed booking always has its emails queued, and a rolled
  back change never sends anything.
- **Worker:** sends through the **existing** `email.server.ts` transport (tenant sender /
  Resend). It claims rows with `FOR UPDATE SKIP LOCKED`.
- **Statuses:** `queued → sending → sent | failed | dead`.
- **Retries:** exponential backoff (e.g. 1 m, 5 m, 30 m, 2 h, 12 h), then `dead` with the
  last error stored.
- **No duplicates:**
  - a unique `dedupe_key` per (booking, event, recipient) is enforced in the database;
  - the notification id is sent as Resend's `Idempotency-Key` header, so a retry after an
    unknown outcome does not send twice.
- **An email failure never touches the booking:** sending happens after commit, in a
  separate step.
- **Visibility:** the owner booking page shows each email and its status (sent / failed /
  retrying), and the owner can resend.

> Changes from the previous plan:
> - requests hold dates while awaiting approval (12 h default);
> - a new `cancel_requested` status;
> - manual bookings default to `confirmed`;
> - emails go through an outbox.

## A8. Cancellation and deposit policies (D11)

### Goal
Every business defines its own policy in a simple form. There is **no single built-in
policy**; the system only offers editable starting templates (e.g. "flexible",
"moderate", "strict").

Example (one possible policy, not a default rule):
- up to 3 days before arrival → full refund;
- less than 3 days → the deposit is not refunded;
- no-show → as the owner defines.

### What a policy contains
| Element | Options |
|---|---|
| Deposit | none / percent of total / fixed amount; due at booking or at approval (collected in Stage 8) |
| Free-cancellation deadline | N days before arrival, at a time of day (default: check-in time), in the business's timezone — or "no free cancellation" |
| Tiers after the deadline | ordered list, each "from N days before arrival": fee = none / percent of total / percent of deposit / fixed amount / **deposit forfeited** / full amount |
| No-show | fee = deposit forfeited / percent / fixed / full amount |
| Automatic cancellation | `never` (owner approves every request — default) / `within_free_window` (guest cancels instantly while the refund is full) / `always` (instant at any time, fee per tier) |
| Owner override | owner may waive or reduce a fee on a specific booking (reason required, logged) |
| Guest-facing text | optional free text shown under the generated summary |

Validation (server and DB):
- tiers are strictly ordered by days;
- percentages are 0–100;
- fixed amounts are ≥ 0;
- a fee can never exceed the booking total;
- exactly one default policy per business.

### Which policy applies (precedence)
1. **Manual booking:** the policy the owner picked in "הוספת הזמנה".
2. **Pricing rule:** a season or holiday rule with a policy that covers any night of the
   stay. If several qualify, the highest-priority rule wins. This covers booking types
   such as "holiday bookings are non-refundable".
3. **Unit policy** (`units.policy_id`).
4. **Business default policy.**

The resolved policy is shown in the quote, so the guest sees the policy that will apply
before sending.

### Shown to the guest before sending
- The quote returns a **concrete schedule** in plain Hebrew, computed for the chosen
  dates. Example: "ביטול עד יום ב׳ 9.11 בשעה 15:00 — החזר מלא של המקדמה (₪500). מ-9.11
  15:00 ועד ההגעה — המקדמה אינה מוחזרת. אי הגעה — חיוב מלא".
- An explicit checkbox "קראתי ואני מאשר/ת את תנאי הביטול" is required by the server; the
  request is rejected without it.
- **Acceptance record** on the booking (`policy_acceptance`):
  - accepted at (DB time);
  - channel (site / manage link / owner-on-phone);
  - hash of the exact snapshot shown;
  - language;
  - IP and user agent (kept for audit, erased by guest anonymisation).
- A `booking_events` entry is written for the acceptance.
- **Manual bookings:** the owner confirms "התנאים הוסברו ללקוח"; the channel is recorded
  as `owner_phone`.

### Snapshot at booking time
`bookings.policy_snapshot` stores:
- the policy id and version;
- every rule as it was;
- the deposit amount;
- the **absolute schedule**: each tier's start and end as `timestamptz`, computed from the
  dates, check-in time and timezone, with its fee and refund amounts.

Effects:
- **Later policy edits:** they create a new policy version and never touch existing
  bookings.
- **Date changes:** when an owner changes the dates (`modify_booking`), the **same
  rules** are re-applied to the new dates. The new schedule is snapshotted and the change
  is logged; the original rules are never replaced by the current policy.

### Cancellation flow
1. **The guest requests a cancellation** (manage link or "my bookings") →
   `cancellation_quote(booking)` computes the outcome at the current **DB time**: the
   tier, fee, amount paid and refund due. The guest sees the result before confirming.
2. **Automatic, or awaiting approval:**
   - if the policy's automatic rule allows it → the booking goes straight to `cancelled`;
   - otherwise → `cancel_requested` and the dates stay held.
   - The computation is frozen in `cancellation_outcome`: tier, fee, refund due,
     computed-at, and who requested.
3. **The owner sees** the request together with the calculation and the tier that
   applied, and can:
   - approve as calculated;
   - approve with a reduced or waived fee (a reason is required);
   - decline with a reason.
4. **Timing:** the fee is determined by the **time of the guest's request**, not by when
   the owner answers. A request made before the deadline keeps the full refund even if
   the owner approves later.
5. **No-show:** `mark_no_show` applies the no-show rule from the snapshot.
6. **History:** every step goes to `booking_events`. The guest and the owner get the
   emails listed in A5.

### Payments boundary
- **Stage 1 stores and calculates only:**
  - the deposit due (`deposit_amount`);
  - `amount_paid` (manual entry later; 0 until payments exist);
  - `cancellation_outcome.refund_due`.
- No refunds are executed and Grow is not changed.
- **Stage 8** turns `refund_due` into an actual refund through the provider (a `payments`
  row of kind `refund`), or into a "refund manually" task for cash or transfer payments.

### Is the existing model enough?
Mostly. **No new table is needed**, but these changes are:
- **`policies`:** changes from "one per business" to **several named policies per
  business** with `is_default`, `version`, deposit fields, tiers (JSON validated by schema
  and CHECKs), no-show rule, automatic-cancellation rule and guest text. Editing creates a
  new version: the old row is archived, never updated in place, so snapshots stay
  traceable.
- **`units.policy_id`** and **`rate_rules.policy_id`** (nullable) — for different units
  and booking types.
- **`bookings`:**
  - `policy_snapshot` (already planned) — now holding the absolute schedule;
  - new: `deposit_amount`, `amount_paid`, `policy_acceptance`, `cancellation_outcome`,
    `fee_override` (amount + reason + actor).
- The earlier `policies.guest_auto_cancel` is replaced by the automatic-cancellation rule
  above.

## A9. Simplified business opening (D15) — Ecommerce and Hospitality

### A9.1 Current Ecommerce flow (verified in code)
| Step | Today | Code |
|---|---|---|
| Entry | Nuriel landing page = the portal store `nuriel-app2` | `PlatformLanding`, `PortalOnboarding.tsx`, `PORTAL_STORE_SLUG` |
| Identity | email code (`issue_login_code` / `consume_login_code`) or Google → signed portal token | `requestPortalCode`, `verifyPortalCode`, `portalFromGoogle` |
| Name + **address** | the user types a store name **and an English address**; `checkPortalSlug` checks format / reserved / taken and suggests `name-2` | `checkPortalSlug`, `tenant_slug_problem`, `platform_reserved_slugs` |
| Creation | auth user created without a password (if new) → `portal_create_store` (tenant + owner `admin` row, protected) → seed trigger (settings, shipping, 14-day trial); user rolled back if the store fails; rate limit 5/h per IP; max stores per account | `createPortalStore`, `portal_create_store` |
| Uniqueness | `tenants.slug` UNIQUE + format CHECK → concurrent claims safe | migrations |
| HTTPS | **a certificate is issued per store host** by the server agent (HTTP-01; DNS `*.nuri1.fit` points to the server, but there is no wildcard certificate). The portal waits for it (`getPortalStoreStatus`) | `deploy/ssl/store-certs.sh`, `tenant_ssl` |
| First entry | one-time handoff code → `https://<slug>.nuri1.fit/admin-handoff#code=…` → logged in → `/admin` | `enterPortalStore`, `admin-handoff.tsx` |
| After entry | the admin panel opens directly; a notice asks to complete business details for the legal pages | `admin_.dashboard`, `AccountNotice` |
| Change address later | **not possible** (no rename function); only a custom domain (`/admin?tab=domain`) | `custom-domain.functions.ts` |
| Welcome / checklist | **none** | — |

Frictions:
- the user must invent an English address during sign-up;
- "address" and "domain" concepts appear too early;
- there is no guidance after the first entry.

### A9.2 Proposed flow
1. **Landing:** the user chooses "חנות אינטרנטית" or "אתר צימרים ואירוח". The
   Hospitality option stays hidden until `hospitality_onboarding_enabled`.
2. **Identity:** unchanged — email code or Google.
3. **Business details:** only the business name, plus the business type when relevant.
   **No address field, and no "domain" or "subdomain" wording.**
4. **Creation:** the server allocates the address automatically (A9.3), creates the
   tenant, the owner and the engine's starting configuration, and issues the
   certificate (existing agent). The waiting screen says "מכינים את האתר שלך…", not
   "SSL".
5. **First entry** through the existing handoff → **celebratory welcome screen** (A9.5).
6. **Setup checklist** in the dashboard with progress; everything else is completed
   later from the management area.
7. **"כתובת האתר"** settings: choose a nicer address any time (A9.4); custom domain stays
   where it is today.

### A9.3 Automatic address allocation (shared platform)
- **Format by product:**
  - Ecommerce: `shop-<5 digits>`;
  - Hospitality: `stay-<5 digits>`;
  - the prefix is supplied by the engine descriptor, the allocation logic is shared.
- **One DB function** `platform_allocate_slug(prefix)`, called inside tenant creation:
  - picks a random number and attempts the insert;
  - on a unique violation, retries with a new number (bounded attempts), widening to 6
    digits if 5 are crowded.
  - Concurrency safety comes from the existing UNIQUE constraint, not from a prior
    check, so parallel sign-ups can never get the same address.
- **Excluded:** reserved names (`platform_reserved_slugs`, `api-*`), existing slugs,
  and **addresses kept for redirects** (A9.4).
- **Available immediately:** routing via `tenant_for_host()`, no change. The address
  works as soon as the certificate agent has issued it, as today.
- **Optional later infra improvement (not part of this plan):** a wildcard certificate
  `*.nuri1.fit` (DNS-01) would make every new or changed address secure instantly and
  remove the waiting step.

### A9.4 Changing the address later ("כתובת האתר")
- **The screen:** shows the current address and a field for a new one, with a live check
  (format / reserved / taken) and **suggestions** when taken. Suggestions are based on the
  business name transliterated to English, plus variants such as `-zimmer`, `-galil` or
  numbers. Plain language only.
- **Atomic change:** `platform_change_slug(tenant, new_slug)` in one transaction:
  - the new address is checked and claimed through the UNIQUE constraint;
  - the old address is written to **`platform_slug_history`** (old slug, tenant, changed
    at, redirect until);
  - the change is logged in `platform_audit_log`.
  
  The **same tenant** is kept: no data moves and nothing is lost.
- **Redirect from the old address:**
  - `tenant_for_host()` does not resolve history entries to a tenant;
  - instead, the edge (`server.ts`) answers requests to an old address with a
    **301 redirect** to the same path on the new address;
  - this keeps links and SEO, and search engines transfer the ranking to the new
    address.
  - The old host must keep its certificate: the certificate agent's target list includes
    history entries until `redirect_until`. This is a small extension of the existing
    agent query, done in the same stage.
- **Reuse rules:**
  - an old address stays reserved for the redirect period (proposal: 12 months) and
    can't be taken by another business;
  - the same business can take it back at any time;
  - a business may change its address a limited number of times (proposal: 3 per 30
    days) to prevent abuse.
- **After the change:**
  - sitemap, canonical URLs and email links use the new address automatically (they are
    built from the tenant origin);
  - a custom domain, if connected, stays the primary address.

### A9.5 Welcome screen and setup checklist (shared component, engine-specific content)
- **Welcome screen** (first entry of the owner, once per owner per business):
  - "מזל טוב! העסק שלך נפתח בהצלחה 🎉";
  - "האתר שלך מוכן. עכשיו אפשר להתחיל להוסיף את התוכן שלך ולהתאים אותו לעסק.";
  - the business name and the allocated address (as a link, not called a "domain");
  - buttons "צפייה באתר" and "בואו נתחיל";
  - the first steps of the checklist;
  - it can be reopened from the help centre.
- **Setup checklist** (a dashboard card with a progress bar):
  - steps marked done automatically from real data;
  - "ready to publish" shown when the required steps are done;
  - optional steps can be dismissed.
- **Engine-specific steps** (supplied by each engine through the contract
  `engine.onboardingSteps(tenant)`):
  - **Ecommerce:** business details (needed for legal pages), first product, shipping
    methods, payments (Grow/Bit/offline), store design (logo/colours/banners), address.
  - **Hospitality:** business details & contact, first unit, photos, prices, availability
    / blocks, cancellation policy, booking mode, site design, address.
- **Storage:** one platform table **`platform_tenant_onboarding`** (tenant, user,
  welcome_seen_at, dismissed_steps). Step completion is **computed** from engine data,
  never stored, so it cannot go stale.

### A9.6 Shared vs engine-specific
| Shared platform (`src/platform/onboarding`, `src/platform/addresses`) | Ecommerce | Hospitality |
|---|---|---|
| identity (email code / Google), portal token, rate limits | starting configuration (existing seed: settings, shipping, trial) | starting configuration (`admin_create_site` / `engine.provision`: settings, default policy, plans) |
| tenant + owner creation, `platform_allocate_slug`, `platform_change_slug`, `platform_slug_history`, redirect at the edge, certificate targets | `shop-` prefix, onboarding steps provider (`src/engines/ecommerce/onboarding.ts`, new file reading existing data) | `stay-` prefix, onboarding steps provider (`src/engines/hospitality/onboarding/`) |
| welcome screen, checklist UI, `platform_tenant_onboarding` | store-design wording | site/units wording |

- The current flow keeps working until the new one is approved and enabled.
- **No mass refactor:** the portal functions are already platform code (B2 ownership).
  They gain an engine choice and lose the address field.
- `portal_create_store` keeps its behaviour for Ecommerce. Only the address input
  becomes server-allocated.

### A9.7 When to implement
| Part | Track / stage | Notes |
|---|---|---|
| Engine contract `prefix`, `provision`, `onboardingSteps` | Hospitality Stage 1f (contract only) | no behaviour change |
| **P1 — Ecommerce opening improvement**: automatic address in the portal, plain-language waiting screen, welcome screen, Ecommerce checklist | **separate platform/Ecommerce track after Stage 1**, own plan + approval | touches the portal (platform) and adds one Ecommerce adapter file; Ecommerce business logic untouched; full Stage 0 regression |
| **P2 — "כתובת האתר"** (change, suggestions, history, 301 redirect, certificate targets) | same track, after P1 | needs a small certificate-agent extension (server script) — infra change approved separately |
| Hospitality opening (landing option, `stay-` address, welcome + Hospitality checklist) | Hospitality Stage 6 (checklist steps grow with Stages 2–5) | behind `hospitality_onboarding_enabled` |
| Wildcard certificate (instant addresses) | optional infra decision | not required |

New platform tables (track P1/P2, **not** Stage 1):
- `platform_slug_history`;
- `platform_tenant_onboarding`.

Stage 1 is unchanged: still 20 tables in the `hospitality` schema plus the platform
objects already listed.

## A10. Authentication and email — existing infrastructure and reuse (D17)

### A10.1 What exists today (verified in code and deploy scripts)

**One auth server for all stores.**
- Self-hosted GoTrue in the `kobi` Supabase stack.
- The API is `https://api-kobi.nuri1.fit`; every store (subdomain or custom domain)
  talks to it.
- `auth.users` is global: one account per email, across all stores.

**Google login.**
| Piece | Where | What it does |
|---|---|---|
| Google provider | `deploy/setup-selfhost.sh` §3ב (compose override of the auth service) | `GOTRUE_EXTERNAL_GOOGLE_ENABLED`, `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`, callback `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI = ${API_URL}/auth/v1/callback`. **One Google OAuth client for all stores** — only the API callback is registered at Google. |
| Allowed return addresses | `setup-selfhost.sh`: `ADDITIONAL_REDIRECT_URLS = ${SITE_URL}/**,https://*.${TENANT_BASE_DOMAIN}/**` | the wildcard is what lets **every new store on `*.nuri1.fit` use Google automatically**, with no per-store configuration |
| Start | `src/components/GoogleSignInButton.tsx` | `supabase.auth.signInWithOAuth({ provider: "google", redirectTo: window.location.origin + "/login?google=1", queryParams: { prompt: "select_account" } })` — returns to **the same store address** |
| Return | `src/routes/login.tsx` (effect on `?google=1`) | supabase-js reads the session from the URL; `getSession()`; errors shown; navigate to `/` |
| No duplicate accounts | `supabase/migrations/20261005090000_google_login.sql` (`email_has_other_account` + identity hook) | GoTrue attaches Google to an existing account with the same email; a second account for the same email is blocked |
| Feature gate | `login.tsx`: `useSubscription().can("googleLogin")` | Google button shown per **Ecommerce plan / add-on** (`google_sso`) |
| First sign-in (Ecommerce rule) | `src/hooks/useAuthState.ts` (insert into `user_roles` role `customer`, `is_approved=false`) | a new Google user becomes a **pending Ecommerce customer** of that store |

**Email-code login (OTP).** File: `src/lib/login-code.functions.ts`.
| Piece | What it does |
|---|---|
| `requestLoginCode` (server fn) | rate limit 10 / 15 min per IP; 6-digit code; DB stores only an **HMAC of tenant + email + code** (`LOGIN_CODE_SECRET`, fallback service key) via RPC `issue_login_code` (table `login_codes`, tenant-scoped, 10 min, 30 s resend); email sent with `sendEmail` from the store sender (`storeSender`); same answer for unknown emails |
| `verifyLoginCode` (server fn) | rate limit 30 / 15 min; RPC `consume_login_code` (5 attempts); **Ecommerce rules**: an account that belongs to another store is refused, and an unknown email gets a new auth user (`auth.admin.createUser`, email confirmed) |
| Session | `src/lib/session.server.ts` `sessionForEmail()` — `generateLink` + `verifyOtp` with the public key → access + refresh tokens returned to the browser → `supabase.auth.setSession()` (`login.tsx` `applySession`) |

**Other existing pieces.**
| Piece | Where | Notes |
|---|---|---|
| Password login | `src/lib/auth.functions.ts` `loginWithIdentifier` | email/username + password for staff and customers |
| Portal login (business owners) | `src/lib/portal.functions.ts` (`requestPortalCode`, `verifyPortalCode`, `portalFromGoogle`) | same `issue_login_code` / `consume_login_code` primitives with a **different HMAC context**, plus a signed portal token |
| Handoff into a store | `enterPortalStore` → `/admin-handoff#code=…` (`src/routes/admin-handoff.tsx`, `handoff.functions.ts`, table `platform_admin_handoffs` kinds `platform_admin` / `store_owner`) | one-time 2-minute code; also used by the store switcher (`store-switcher.functions.ts`) |
| Session storage | `src/integrations/supabase/client.ts` (`persistSession`, `autoRefreshToken`) | **per origin** — logging in on one store does not log in on another |
| Session to server | `auth-attacher.ts` (global function middleware adds the bearer token); `auth-middleware.ts` `requireSupabaseAuth` | — |
| Tenant identification | browser: `getTenantId()` → RPC `tenant_for_host(window.location.hostname)`, sent as `x-tenant-id` on every Supabase request; server: `tenant.server.ts` per request; DB: `current_tenant_id()` | — |
| Multi-store accounts | `user_roles (tenant_id, user_id)` many-to-many for staff; customers limited to one store (`user_roles_membership_guard`) | — |

### A10.2 Findings that affect Hospitality
1. **Google return addresses:** every `*.nuri1.fit` address (incl. `stay-12345`) is
   already allowed, so **no configuration change** is needed for Hospitality
   subdomains.
   - **Custom domains are not in the allow-list.** This is the same limitation the
     Ecommerce stores have today.
   - Rather than adding every domain to GoTrue (that needs a restart for each one), the
     plan is: on a custom domain, start Google on the business's `*.nuri1.fit` address and
     return through the **existing one-time handoff** (a new handoff kind, `guest`).
   - This is planned for Stage 6 and needs no change now.
2. **Ecommerce rules must not run for Hospitality guests:**
   - `useAuthState` would insert an Ecommerce `customer` row, which the product-role
     rule would reject for a Hospitality tenant.
   - `verifyLoginCode` refuses members of other stores.
   
   Therefore Hospitality screens never use `useAuthState` or `verifyLoginCode`. They use
   the **same primitives** with guest rules (A10.3).
3. **Google button gate:** today it is driven by the Ecommerce subscription. For
   Hospitality it comes from the Hospitality entitlement.
4. **Email logging:** `sendEmail({ logFor })` writes to `customer_emails`, which is an
   Ecommerce table. Hospitality never passes `logFor`; its outbox is its log.
5. **Sessions are per site,** so a guest logged in on one business is not logged in on
   another. This is acceptable and also stronger isolation.

### A10.3 How Hospitality reuses it
**Business owners and managers** — exactly the existing mechanisms, no change:
- the portal (email code / Google);
- the handoff into the site;
- password / email code on the site;
- the store switcher for owners of several businesses (Ecommerce and Hospitality under
  one account, as separate tenants);
- membership `user_roles` role `admin`.

**Guests**, through a thin platform adapter `src/platform/auth/`:

| Adapter | Wraps (unchanged) |
|---|---|
| `email-code.server.ts` | `issue_login_code` / `consume_login_code` + the same HMAC secret + `sendEmail` + `sessionForEmail` |
| `google.ts` | `signInWithOAuth` with the same provider and callback |
| `session.ts` | supabase-js session (`setSession`, `getSession`) |

The guest login screens are Hospitality code (`guest-portal/`), with guest rules:
- **No membership:** a guest is never written to `user_roles`. An unknown email gets an
  auth user, created exactly as today.
- **Members of other stores can log in as guests:** a store member signing in here is
  allowed, because guest access is decided by `request_tenant()` + `auth.uid()`, not by
  membership.
- **Visibility:** each business sees only its own `hospitality.guests` and bookings (RLS
  + RPC filters).
- **Linking past bookings:** only through a verified email (Google identity or a
  consumed email code). This is the same proof the existing system relies on.

**Booking without an account:** name, phone and email plus the "manage my booking" token
(valid until 30 days after check-out, D16). No auth user is created unless the guest
chooses to log in.

**Permissions kept apart:**
| Identity | How it is recognised |
|---|---|
| Platform admins | `platform_admins` |
| Business owners and managers | `user_roles` on the Hospitality tenant, used by `hospitality.can()` |
| Guests | `auth.uid()` + `hospitality.guests.user_id`, with no staff rights anywhere |

**Changes to existing infrastructure:**
| Change | When | Effect on existing stores |
|---|---|---|
| None to GoTrue, the Google client, OTP tables, HMAC secret or email code | — | none |
| New adapters in `src/platform/auth/` call the existing RPCs and helpers | Stage 6 | none (new files) |
| Optional later: `login-code.functions.ts` can use the same adapter internally | separate approval | none if done (refactor only) |
| Handoff kind `guest` for Google on custom domains | Stage 6 | additive enum value |

### A10.4 Email API — reuse
- **Existing implementation:** `src/lib/email.server.ts`.
  - `sendEmail()` calls the **Resend REST API** (`resendApiUrl()` / `RESEND_API_URL`)
    with the platform key `RESEND_API_KEY`, or with the **business's own Resend key**
    (`transport` from `tenant_email_secrets`, Ecommerce part 17).
  - The sender comes from `storeSender()`: business name `<orders@nuri1.fit>` or the
    business's own verified address (`email-sender.ts`, `email_settings`).
  - It supports `headers` and returns `{ sent, id, reason }`. The function never throws
    for transport errors.
  - Templates use `renderEmailHtml()` / `escapeHtml()`.
- **Hospitality uses it as is** through `src/platform/notifications/email.ts`:
  - the outbox worker calls `sendEmail()` with `headers: { "Idempotency-Key":
    <notification id> }`, and stores the result (`id`, `reason`);
  - Hospitality templates (request, confirmation, decline, expiry, cancellation request /
    approval / decline, owner reminder, guest login code) are Hospitality files that
    render through the shared `renderEmailHtml`.
- **No new key, no new provider, no second email system.** The login-code email for
  guests is sent by the same `sendEmail` used by the existing login codes.

## A11. Future installation on the existing server — runbook outline (D18)

Prepared now, executed only after development, regression and your approval. Nothing is
changed on the server before that.

**0. Pre-flight**
- Full DB backup with the existing `deploy/backup-daily.sh`, plus a manual `pg_dump`.
- Note the current commit and image.
- Maintenance window agreed.
- `main` merged with the approved branches; CI green; Stage 0 regression green on the
  release commit.

**1. Database migrations** (`psql` into `kobi-db`, in timestamp order, as today):
1. platform → ecommerce guard → `hosp_*`.
2. Each migration is transactional. Stop on the first error and use rollback files in
   reverse order.
3. Verify:
   - the SQL checks (schema present, RLS on, flags all `false`, Ecommerce tenants
     `site_type = 'ecommerce'`);
   - the classification and coverage queries.

**2. Expose the schema to the API** — only after step 1 succeeded:
- `/root/kobi-supabase/docker/.env`: `PGRST_DB_SCHEMAS=public,storage,graphql_public,hospitality`;
- restart `kobi-rest`;
- verify an Ecommerce REST call returns 200 and `hospitality` returns permission errors
  for anon (not `PGRST106`).

**3. Supabase settings**
- **Auth:** no change (the Google provider and `*.nuri1.fit` redirect wildcard already
  exist).
- **Storage:** the `hosp-media` bucket is created by migration. Check the storage
  container's file-size limit against the approved video limit.
- **Realtime:** not needed.

**4. Application environment** (`docker-compose.override.yml` / `.env` of the app):
- `HOSPITALITY_ENGINE` **left unset (off)** for the first deployment.
- No other new variables: email (`RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`), login codes
  (`LOGIN_CODE_SECRET`), domains (`TENANT_BASE_DOMAIN`) and Grow are reused.

**5. Build and deploy** with the existing Dockerfile / Coolify flow (no Dockerfile
change). Health check `/robots.txt`.

**6. Smoke tests**
- **Ecommerce:** home, product, login (password / code / Google), cart → checkout
  (offline), admin, platform panel, `sitemap.xml`, `robots.txt`.
- **Logs:** no 5xx.

**7. Enable Hospitality gradually**
1. Set `HOSPITALITY_ENGINE=on` and redeploy.
2. Platform admin creates the Nofei Dorit showcase / a test business (`stay-…`).
3. Enable flags for that tenant only. The certificate agent issues its address as for
   any store.
4. Run the Hospitality smoke tests:
   - owner login;
   - unit;
   - request booking;
   - emails sent (outbox `sent`);
   - approval;
   - calendar;
   - cancellation request.
5. Only then enable `hospitality_onboarding_enabled` (landing-page option).

**8. Monitoring for 48 h**
- outbox `failed` / `dead` counts;
- 5xx;
- slow queries;
- certificate agent log.

**Rollback** (any step):
- **Application:** previous image / commit, or set `HOSPITALITY_ENGINE` off. This is
  enough for any app-level problem.
- **Flags:** set to `false` (instant, no deploy).
- **API exposure:** remove `hospitality` from `PGRST_DB_SCHEMAS` and restart
  `kobi-rest`. **Always before** dropping the schema.
- **Database:** rollback files 5 → 1. Hospitality objects are new, so Ecommerce data is
  untouched. The empty schema is kept unless exposure was removed first.
- **Last resort:** restore the step-0 backup.

The detailed runbook (exact commands, expected outputs, checklists) is delivered at the
end of development as `docs/hospitality/runbook-install.md`.

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

Resolved (A0):
- approval window: 12 h + reminder (D1);
- open-request cap: 2 (D2);
- demo media rules (D3);
- calendar refresh: polling (D4);
- guest cancellation: by request (D5);
- footer: fixed (D6);
- emails: outbox (D7);
- manual bookings: confirmed (D8);
- booking without an account (D9).

Still open:
1. Demo media: approve the concrete image source(s) and licence (Unsplash / Pexels /
   purchased) before Stage 4.
2. Video limits: allowed upload size (to verify the storage limit on the server), and
   whether long videos use YouTube/Vimeo embeds.
3. Approval window bounds the owner may choose (proposal: 1–48 h). Is the window
   per business only, or also per unit (proposal: per business)?
4. ~~Expiry of the "manage my booking" link~~ — decided: 30 days after check-out (D16).
5. Payments (Stage 8) and Hospitality pricing (Stage 11) require separate approvals.
6. Business opening (A9):
   - automatic address format (`shop-12345` / `stay-12345`);
   - redirect period for old addresses (proposal: 12 months);
   - address-change limit (proposal: 3 per 30 days);
   - whether to adopt a wildcard certificate later;
   - approval to start the separate track P1/P2 for Ecommerce after Stage 1.

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

Final Hospitality model: **23 tables**. Stage 1 creates 20; Stages 4, 8 and 9 add one each.
All: `tenant_id` → `public.tenants`, composite `(tenant_id, id)` FKs, timestamps, RLS,
RESTRICTIVE `tenant_isolation` + `backend_enabled`, no `anon` grants (public access only
through DEFINER RPCs).

| # | Table | Purpose | Stage |
|---|---|---|---|
| 1 | `settings` | business profile & booking settings: name, contact phone/email, WhatsApp, address, check-in/out, booking mode (request/instant), approval window, payment hold minutes, weekend nights, currency, timezone, guest retention, notification recipients | 1 |
| 2 | `policies` | **several named, versioned policies per business** (one default): deposit (none / % / fixed), free-cancellation deadline, fee tiers (% of total / % of deposit / fixed / deposit forfeited / full), no-show rule, automatic-cancellation rule, guest text, house rules; resolved per booking (manual choice → rate rule → unit → default) and snapshotted (A8) | 1 |
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
| 18 | `notifications` | email outbox + delivery log: booking, event, recipient, `dedupe_key` (unique), status, attempts, next attempt, last error, provider message id, sent at | 1 |
| 19 | `plans` | Hospitality plans & limits (unpublished placeholders) | 1 |
| 20 | `subscriptions` | Hospitality subscription per tenant | 1 |
| 21 | `site_versions` | site document: one mutable draft per tenant + immutable published versions (content, sections, theme tokens, per-page SEO) | 4 |
| 22 | `payments` | deposits, balances, refunds, manual payments; provider reference | 8 |
| 23 | `reviews` | verified reviews and testimonials, moderation, replies, report fields | 9 |

**Changes required by the round-3 decisions:**

New table:
- `notifications` (outbox, D7). The existing email layer sends synchronously and has no
  retry or outbox. The outbox is Hospitality-owned, so the engine stays extractable; it
  sends through the shared transport adapter.

New columns:
- `settings`:
  - `approval_window_minutes` — default 720 (12 h), bounded;
  - `approval_reminder_pct` — default 50;
  - `max_open_requests` — default 2.
- `policies`: becomes several named, versioned policies per business with an
  automatic-cancellation rule (`never` default / `within_free_window` / `always`) — see
  A8. `units.policy_id` and `rate_rules.policy_id` are added (nullable).
- `bookings` (A8): `deposit_amount`, `amount_paid`, `policy_acceptance`,
  `cancellation_outcome`, `fee_override`; `policy_snapshot` now holds the absolute
  schedule.
- `guests`: `email_normalized`, `phone_normalized` (for the cap and for verified
  linking); `user_id` is linked only through verified claim.
- `bookings`:
  - `revision` — optimistic concurrency for stale screens;
  - `manage_token_hash` + `manage_token_expires_at` — guest access without an account;
  - `cancellation_requested_at`, `cancellation_reason`;
  - status value `cancel_requested`.

Model changes not needed: the reminder (outbox dedupe key), "awaiting cancellation"
(status), contact flooding (advisory lock + count) and calendar freshness (`revision`)
all fit the existing model.

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
- Stage 1 now has 20 tables: the 19 above plus the `notifications` outbox (round 3).

## B7. Booking engine (Stage 1 scope)
- Statuses and transitions as in A5, enforced by a trigger.
- Occupancy fan-out for whole properties; `EXCLUDE USING gist (tenant_id =, unit_id =,
  nights &&)` on half-open `[check_in, check_out)`.
- Holds: `pending_approval` and `pending_payment` require `hold_expires_at` (DB clock).
  Lazy expiry inside `request_booking`, `create_manual_booking`, `approve`, `modify`,
  `confirm_payment` before inserting; reads treat expired holds as free; idempotent sweep
  `expire_holds()` (`FOR UPDATE SKIP LOCKED`, one event per booking).
- RPCs:
  - **public / guest:**
    - `quote` (includes the resolved policy and its concrete schedule);
    - `request_booking` (idempotent, `request_tenant()`, open-request cap under a
      per-contact advisory lock, **requires policy acceptance**, writes the snapshot and
      the acceptance record);
    - `cancellation_quote`, `request_cancellation`;
    - `get_booking_by_token`, `claim_guest_bookings` (verified email only),
      `my_bookings`;
  - **owner:**
    - `create_manual_booking` (default `confirmed`, owner picks the policy, records
      phone acceptance), `approve_booking`, `decline_booking`, `modify_booking`
      (revision check, schedule re-applied);
    - `cancel_booking`, `approve_cancellation` (optional fee override with reason),
      `decline_cancellation`;
    - `save_policy` (new version, validation), `set_default_policy`;
    `mark_checked_in|checked_out|no_show`;
  - **system:** `expire_holds` (also enqueues reminders), `confirm_payment` (status only;
    no provider in Stage 1);
  - **outbox:** `claim_notifications(batch)`, `mark_notification(id, result)`.
- Every state-changing RPC enqueues its notifications in the same transaction. The
  sending worker itself is Stage 2. In Stage 1 the outbox is filled and tested, but
  nothing is sent.
- Pricing per night: promotion > holiday > unit season > property season > weekend >
  weekday > base; occupancy extras; min nights = max of applicable rules; floor/ceiling.
- Privacy: `export_guest`, `anonymize_guest` (blocked with live/future bookings),
  `apply_retention` (only when a period is configured; NULL default); no ID documents.
- Emails are **not** sent in Stage 1; the outbox rows are created and tested, and the
  worker and templates come in Stage 2.

## B8. Whole property — concurrency scenarios
(1) whole vs member same dates → one wins; (2) members A and B succeed, then whole fails;
(3) two overlapping whole bookings → one wins; (4) adjacent stays both succeed;
(5) expired hold on a member + new whole booking succeeds, late sweep no-op;
(6) two bookings racing an expired hold → one wins, one `expired` event;
(7) approving after the dates were taken → refused; (8) idempotent retry
(sequential + concurrent) → one booking; (9) block vs pending whole booking → one wins;
(10) price change after booking → locked nights unchanged;
(11) manual booking vs public request on the same dates → one wins;
(12) `modify_booking` into occupied dates → refused, original booking intact;
(13) 5 parallel requests from the same contact with cap 2 → exactly 2 accepted;
(14) two owners/tabs modifying the same booking with the same revision → one succeeds,
the other gets "updated, refresh";
(15) cancellation approval racing a new booking for the same dates → the new booking
succeeds only after the cancellation commits;
(16) two workers claiming the same outbox rows → each notification is sent once.
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
| 4 | `20261101120000_hosp_booking.sql` | hospitality | `btree_gist`, tables 12–18 (incl. `notifications` outbox), EXCLUDE, state machine incl. `cancel_requested`, booking/guest/outbox RPCs, expiry + reminders, open-request cap, privacy RPCs |
| 5 | `20261101130000_hosp_billing_admin.sql` | hospitality | tables 19–20, entitlements, unit limit, Hospitality admin stats functions |

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
    addresses/      allocate.ts change.ts redirect.ts (auto address, "כתובת האתר")  [P2]
    onboarding/     welcome.tsx checklist.tsx (shared UI; steps from engines)     [P1]
    branding/       credit.tsx             (fixed Nuriel footer credit, D6)               [4]
    realtime/       subscribe.ts           (interface only; polling now, Realtime later)  [3]
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
- Concurrency: the 16 scenarios in B8.
- **Dedicated booking & security tests (D10):**

  | Scenario | Expected | Stage |
  |---|---|---|
  | two parallel bookings for the same unit/dates | exactly one succeeds, the other gets "no longer available" | 1 (SQL) + 4 (E2E) |
  | whole property vs a member unit (both orders, parallel) | one succeeds | 1 |
  | request expiry after 12 h (DB clock simulated) | `expired`, dates free, guest + owner notifications queued, events written | 1 |
  | reminder at 50 % of the window | exactly one reminder queued, even if the sweep runs repeatedly | 1 |
  | manual booking vs site request on the same dates | one wins; manual booking `confirmed` and on the calendar at once | 1 + 3 |
  | email failure after a saved booking | booking stays saved; notification `failed` → retried → `sent`/`dead`; error recorded | 1 (outbox) + 2 (worker, mocked Resend) |
  | duplicate send attempts (retry, double worker, double click) | one email per dedupe key; Resend idempotency header sent | 1 + 2 |
  | cancellation request → approval → availability returns | dates held while `cancel_requested`, free after approval; auto-cancel only when the policy allows | 1 |
  | many requests from one contact (sequential and parallel) | capped at `max_open_requests` | 1 |
  | guest without an account | booking via token link works; token expiry and wrong token rejected | 1 + 4 |
  | linking past bookings | only with a verified email; typed email alone links nothing | 1 + 6 |
  | logged-in guest tries another business's booking (by id, token or other site) | denied / not found | 1 + 6 |
  | staff member of another tenant books as a guest | works via `request_tenant()`, sees nothing else | 1 |
  | stale calendar edit (old revision) | refused, data unchanged | 1 + 3 |

- **Cancellation & deposit policy tests (D11):**

  | Scenario | Expected | Stage |
  |---|---|---|
  | policy validation (unordered tiers, % > 100, negative or > total fee, two defaults) | rejected by server and DB | 1 |
  | example policy "3 days → full refund, then deposit forfeited" | refund = deposit at deadline − 1 s; 0 at deadline + 1 s | 1 |
  | percent / fixed / deposit-forfeit / full-amount tiers and multi-tier schedules | correct fee and refund in every tier | 1 |
  | deadline at check-in time in Asia/Jerusalem, incl. DST change week | boundaries exact in local time | 1 |
  | precedence: manual choice → rate rule (holiday) → unit → default | the expected policy is snapshotted | 1 |
  | owner edits the policy after a booking | old booking keeps its snapshot and fee; new bookings use the new version | 1 |
  | request without policy acceptance | rejected; acceptance record and event written when accepted | 1 + 4 |
  | quote schedule shown to the guest equals the fee computed at cancellation | identical amounts (same function) | 1 + 4 |
  | automatic rule `never` / `within_free_window` / `always` | `cancel_requested` vs immediate `cancelled` as defined | 1 |
  | request before the deadline, owner approves after it | fee from the request time (full refund) | 1 |
  | owner fee override | allowed with reason, logged with actor | 1 |
  | `modify_booking` to new dates | same rules re-applied to new dates, change logged | 1 |
  | no-show | no-show rule from the snapshot applied | 1 |
  | refunds | only `refund_due` calculated; no provider call (Grow untouched) | 1 (8 executes) |
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

## B15. Verification requirements (round 4) — before and during implementation

### Google OAuth
- **Same-origin return only (verified in code):** every `redirectTo` is
  `window.location.origin` + a fixed path (`GoogleSignInButton.tsx`; callers pass only
  `/login?google=1`, `/?portal_google=1`, `/checkout`). No request parameter can choose
  the return address, so the application has no open redirect.
- **Server-side allow-list:** GoTrue accepts only `SITE_URL/**` and
  `https://*.nuri1.fit/**`. An external host falls back to `SITE_URL`.
  - Tested locally with the Google provider enabled using fake credentials: the
    `/authorize` state token must carry the allowed address for store subdomains and
    must **not** carry an external address.
- **Different store subdomains:** E2E checks that the Google button on
  `kobi.shop.localhost` and on `store-b.shop.localhost` each requests its own origin as
  the return address. The full Google round-trip can't run without real Google
  credentials. It stays a manual step in the installation runbook.
- **Security finding (existing behaviour, no change now):**
  - the allow-list trusts **every** `*.nuri1.fit` subdomain, including stores opened by
    anyone;
  - supabase-js uses the default **implicit** flow, where tokens arrive in the URL
    fragment.
  
  A crafted login link could therefore return a victim's tokens to another store's
  address, where third-party scripts allowed on stores (Meta Pixel / GA) could see the
  full URL before supabase-js clears it.
  
  Recommended hardening, as a separate approved change for both products:
  - switch the browser client to `flowType: 'pkce'` (the code is useless without the
    verifier stored on the original site);
  - or validate on return that the session was started on this host.
  
  The Google OAuth settings are **not** changed in this stage.

### Guests vs owners vs Ecommerce members (tested at RPC, RLS and server level — never UI-only)
| Test | Layer | Stage |
|---|---|---|
| A guest (auth user without a `user_roles` row) gets no `hospitality.can()` permission and cannot call owner RPCs | RLS + RPC | 1c/1d |
| A guest RPC uses `request_tenant()` + `auth.uid()`; another business's booking (by id, token or site) is not found | RPC | 1d |
| An Ecommerce member (admin/customer of store A) books as a guest at Hospitality B; no Ecommerce data of A is visible on B, and no Hospitality data of B is visible on A | RLS + RPC + E2E | 1d + 6 |
| A guest never gets a `user_roles` row (product-role rule: Hospitality accepts only `admin`) | DB trigger | 1a (rule) / 1c (Hospitality roles) |
| Server functions of one engine called on the other engine's host → 404 | dispatcher | 1f |
| Ecommerce RPCs cannot write rows for a Hospitality tenant | write guards | 1b |

### Ecommerce protection and regression
- Every platform change keeps the existing behaviour by default. In 1a:
  - `site_type` defaults to `ecommerce`;
  - the role rule is inactive for products without registered roles;
  - the seed trigger runs exactly as before for Ecommerce;
  - flags are off.
- **New regression tests added in 1a**, on top of the existing 33 E2E tests and the SQL
  suite:
  - **Store opening through the portal:** email code → name + address → store created
    with an owner `admin` row, seed rows and a trial subscription.
  - **Email-code login:** the code is read from the mocked email; login works; a new
    email creates a user plus a pending Ecommerce customer, exactly as today.
  - **Google login:** the start request uses the current store's origin; an external
    return address is rejected by the local GoTrue.
  - **Permissions:** customer vs owner vs another store's owner (existing tests, kept).
- No change in Stage 1a requires any production configuration.

### Testing and deployment
- **Local tests:**
  - every migration runs on the local SQL runner (twice, plus over existing data);
  - every migration also runs on the **separate local Supabase** (`e2e/scripts/supabase-up.sh`,
    the same images as production), followed by the full E2E suite.
- **Proof for Ecommerce:** after each step the full Stage 0 suite runs. Its result is in
  every step report.
- **Installation and rollback:** A11 and the runbook stay **documentation only** until
  you explicitly approve a deployment.
