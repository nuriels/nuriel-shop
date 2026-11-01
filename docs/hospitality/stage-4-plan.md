# Stage 4 — the business's public website and booking requests

Approved 01/11/2026 with five decisions:

1. **One theme, Luxury** — modern, clean, luxurious, professional; it fits zimmers, villas,
   vacation apartments and boutique hotels. The design system is flexible, so Nature /
   Modern / Romantic can be added later without rebuilding.
2. **Maps:** Waze and Google Maps links only. No embedded map, no API, no keys.
3. **Images:** placeholders, or demo images with a recorded licence. No copyrighted image
   without approval. Owners upload their own images in the management area (2e).
4. **Legal:** draft privacy policy and accessibility statement, editable later, marked
   "not approved for publication" until legal review.
5. **Room types:** deferred. The data stays flexible: a unit is a room that can later
   belong to a type (see `stage-1-plan.md`, RT design).

The goal: open a zimmer business, send the owner a link to the site, and receive real
booking requests from guests.

## 4a — the site (built)

### Address and gate

- **Address:** the business's own host (sub-domain or own domain).
  - The site lives under `/stay`.
  - `/` redirects (302) to `/stay` while the site is open.
  - Every store page stays 404 on a Hospitality host.
- **When it opens:** `HOSPITALITY_ENGINE=on`, plus the database flag, plus the business's
  `hospitality_frontend_enabled`.
  - These are checked in the edge gate (`edge/gate.ts`, `access.server.ts` `siteEnabled`).
  - They are checked again in the database (`_public_site_tenant`).
- **Closed site:** 404 "האתר עדיין לא פתוח".
- **Suspended site:** 403 "האתר מושעה".
- **`robots.txt`:**
  - closed: `Disallow: /`;
  - open: only `/stay` and `/stay/units/` are crawlable — the management area, the
    booking pages and the drafts are not.
- **Business isolation:** the business is chosen by the host (`x-tenant-id` →
  `request_tenant()`), never by input. A unit of another business answers "not found".

### Data (migration 19, read only, anonymous)

- `public_site()` returns everything the site shows, in one call (SSR, once per visit;
  in-site navigation reuses it for 5 minutes):
  - business details;
  - `booking_open` (bookings flag + active plan);
  - galleries;
  - default and per-unit cancellation policy;
  - properties: description, coordinates, parking, house rules, public guest info,
    amenities, photos;
  - active units: capacity, rooms, beds, amenities, photos, "from" price, minimum nights.
- `public_availability(unit, from, to)` returns busy nights only, never who or why, for at
  most 120 days.
- **Never exposed:** guests, private arrival info (codes, Wi-Fi), internal notes, staff
  emails, rate rules.
- **Prices:** the final price is always the server quote (4b). A unit without a base price
  shows "המחיר לפי התאריכים", never ₪0.

### Design system (`src/engines/hospitality/website/`)

- **`theme/themes.ts`** — theme registry. Each theme has tokens and layout choices
  (`hero`, `unitCards`, `overlayHeader`); themes have `tier: free | premium`.
  - Components use only the semantic tokens (`bg-background`, `text-primary`, …) and
    `--site-*` variables.
  - A new theme is a new entry, not new components.
  - Luxury palette: ivory, dark ink, champagne accents.
  - Fonts: Frank Ruhl Libre for headings, Heebo for text.
- **`copy/`** — per-locale text catalogue (D22). Hebrew now; another language is a new
  file, with no component change. Business content comes from the business.
- **Nuriel credit (D6)** — `src/platform/branding/NurielCredit.tsx`, placed by the layout
  outside the content: "כל הזכויות שמורות לנוריאל מחשבים" → `https://m.nuri1.fit` (since stage F1; was `https://nuriel-app2.nuri1.fit`).

### Pages

- **Home `/stay`**, in this order:
  - full-screen hero (owner photo, or a warm placeholder);
  - about + quick facts (check-in / out, units, guests, "from");
  - units;
  - gallery mosaic with a full-screen viewer (keyboard, swipe, YouTube / Vimeo);
  - amenities by group;
  - stay terms (times, house rules, cancellations, parking, guest info);
  - location (Waze / Google Maps);
  - contact (phone, WhatsApp, email).
- **Unit page `/stay/units/<slug>`**:
  - photos;
  - guests, rooms, beds by room;
  - description;
  - amenities (unit + shared);
  - terms with the unit's own policy;
  - map links;
  - side card: "from" price, minimum nights, adults-only / children age;
  - live availability calendar (free / busy);
  - other units.
- **Everywhere:**
  - sticky header (transparent over the hero), menu sheet on phones;
  - fixed phone / WhatsApp / units bar on phones;
  - footer with the credit;
  - skip link; lazy images with `srcset`; no horizontal scroll at 390 px;
  - a "תמונה להמחשה" tag on demo images.
- **SEO basics:**
  - title, description, `og:image`, robots `index` on public pages;
  - `LodgingBusiness` JSON-LD on the home page;
  - sitemaps and hreflang come in Stage 7.

### Route adapters

`src/routes/stay.tsx`, `stay.index.tsx`, `stay.units.$unitSlug.tsx`.

- Thin: one engine import each.
- Listed in the boundaries test, `eslint.config.js` and the CI lint line.

### Demo

`scripts/preview/hospitality-demo.mjs` opens the site and booking requests for "צימרי הגליל"
only. URL: `http://demo-zimmer.shop.localhost:3100/`.

## 4b — booking requests from the site (built)

### Pages

- **Booking page `/stay/book`** (also reachable as `?unit=&from=&to=&adults=&children=`):
  1. **Unit:** cards with photo, capacity and "from".
  2. **Dates:** calendar with busy nights. A busy night cannot be the arrival or inside the
     stay; it can be the departure day. The minimum nights is respected.
  3. **Guests:** steppers, limited by the unit's capacity, maximum adults / children and
     children's age.
  - **Summary (server quote):** nights grouped by price, discount, total, deposit, the
    exact cancellation schedule from the server snapshot (dates and times in the
    business's time zone), the owner's policy text and house rules, and "sending a request
    does not charge you".
  - **Guest form:** name, mobile, email, special requests; terms acceptance (required),
    marketing consent (optional); privacy link.
  - **Sending:** `request_booking` with the quote's `policy_hash`. If the terms changed in
    between, the database refuses and the page reloads the quote and asks again.
- **Request received** `/stay/booking-received#t=…`:
  - number, unit, dates, guests, total;
  - "the business answers within N hours" (or "confirmed" in instant mode);
  - a button to the booking page.
- **My booking** `/stay/my-booking#t=…`:
  - status, details, the answer deadline;
  - the cancellation terms saved with the booking;
  - **cancel / withdraw:**
    - the quote is shown first (fee, refund, "sent to the business" or "cancelled
      now");
    - the reason is optional;
  - **arrival info** (codes, Wi-Fi) only when confirmed, from 48 hours before arrival,
    until departure;
  - business contact.
- **Entry points:**
  - the hero's main button, a "להזמנה" button in the header, the phone menu and the phone
    action bar (only when bookings are open);
  - the unit page calendar: select dates, then "למחיר ולהזמנה".
- **Bookings closed:** when the bookings flag or the plan is off, the booking page shows
  "ההזמנות באתר עדיין לא פתוחות" with the phone and WhatsApp.

### Security and correctness

- **Price, availability and terms:** come only from the database at sending time:
  - `_quote` checks availability, minimum nights and capacity;
  - the `EXCLUDE` constraint makes a double booking impossible, even with two guests
    pressing at once;
  - `policy_hash` prevents agreeing to terms that changed.
- **Double sending:** one idempotency key per attempt. A double click, a network retry or
  a refresh returns the same request; a changed choice starts a new key.
- **Rate limits:**
  - per IP (in-memory): quotes 120 / 10 min, requests 6 / hour, booking views 60 / 10 min,
    cancellation quotes 30 / 10 min, cancellations 6 / hour;
  - on top of the database limit of 2 open requests per contact.
- **Secure link:**
  - the token (128 bits) exists only in the guest's email and in the URL fragment (`#t=`),
    which is not sent to the server with the page request, not logged and not passed in
    `Referer`;
  - the database stores only its hash; it expires 30 days after departure;
  - only bookings of this business are reachable;
  - a wrong token gets the same answer as a missing booking.
- **Guest privacy:** the guest pages show only that booking. Nothing about other guests,
  staff or internal notes.

### Emails (2k worker)

- The guest's first email ("request received" / "booking confirmed") now carries a
  "לצפייה וניהול ההזמנה" button: `<site>/stay/my-booking#t=<token>`.
- The worker drops the token from the outbox once sent (existing behaviour).
- The owner keeps the management-area link.

### Server functions

`api/website.functions.ts`: `hospitalitySiteQuote`, `hospitalitySiteRequestBooking`
(wakes the email worker), `hospitalitySiteBooking` (booking + arrival info),
`hospitalitySiteCancellationQuote`, `hospitalitySiteRequestCancellation`.

- They reuse the Stage 1 database functions: no new migration.
- The Stage 1 `server/public.functions.ts` stays as it is; the E2E tests address it by
  file.

### Legal drafts (built with 4b, linked from the form and the footer)

- `/stay/privacy` and `/stay/accessibility` are templates filled with the business's
  details: name, contact, accessibility amenities.
- Each carries the banner "טיוטה – טרם אושרה לפרסום (ממתינה לבדיקה משפטית)".
- They are not indexed.
- The text lives in `website/lib/legal.ts`. Owner editing comes later (settings / Stage 5).

### Verified locally (browser)

1. Home → "בדיקת זמינות והזמנה".
2. Unit, dates and guests → quote (₪1,560 for 2 nights, exact cancellation schedule).
3. Form: refused without accepting the terms; sent once accepted → request #1007.
4. Request received page → my booking.
5. Withdraw (no fee) → "בוטלה".
6. Emails sent:
   - to the guest, with the personal link;
   - to the business;
   - "request withdrawn" and "booking cancelled".

Done at 1440 px and 390 px, with no horizontal scroll and no console errors.

## 4c — switches and links (built)

### Platform panel ("ניהול Hospitality")

- **Platform-wide switches:**
  - "האתרים הציבוריים של העסקים" (`hospitality_frontend_enabled`);
  - "בקשות הזמנה מהאתרים" (`hospitality_booking_enabled`);
  - these sit next to the database and management-area switches.
- **On each business card:**
  - "האתר הציבורי פתוח לגולשים" — the business's website flag;
  - "מקבל בקשות הזמנה מהאתר" — the business's bookings flag; enabled only once its
    website is on;
  - a warning when the platform switch is still off, and when the plan is not active
    (requests are refused);
  - an "האתר" link to `<site>/stay`.
- **Behaviour:**
  - each switch is logged (`platform_set_flag`);
  - turning on a website also turns on the business's database flag.
- **Data:** read through migration 20 `admin_site_switches()` (platform admin only).

### Management area

- An "האתר שלי" link in the header (new tab) while the business's website is open.

### How a real zimmer business goes live (local or, later, on the secure server)

1. Platform panel → "ניהול Hospitality": the four platform switches on (database,
   management areas, websites, booking requests).
2. "פתיחת עסק": name, address (sub-domain), owner email, plan → the owner gets an account
   and the management link.
3. The owner fills in, in "ניהול העסק":
   - business details and contact;
   - the property and units;
   - photos, prices and the cancellation policy.

   The setup checklist leads the way.
4. On the business card: "האתר הציבורי פתוח לגולשים", then "מקבל בקשות הזמנה מהאתר".
5. Send the owner the site link (`https://<sub-domain>/`). Guests book, the owner
   approves in "הזמנות", and emails go out through the worker.

## Not in Stage 4 (planned later)

- Visual editor and site versions (Stage 5).
- Theme picker at creation and the other three themes.
- Embedded map.
- Captcha.
- Online payment.
- Languages beyond Hebrew.
- Sitemaps (Stage 7).
- Room types.
