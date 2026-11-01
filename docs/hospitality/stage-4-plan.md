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
  outside the content: "כל הזכויות שמורות לנוריאל מחשבים" → `https://nuriel-app2.nuri1.fit`.

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

## 4b — booking flow (next)

- Booking page `/stay/book`: unit, dates (calendar with busy nights), guests.
- Server quote showing the nights, the total and the cancellation policy with its hash.
- Guest form (name, phone, email, requests) with explicit acceptance of the terms.
- `request_booking` with an idempotency key. Double bookings are prevented in the
  database (EXCLUDE).
- A "request received" page.
- A guest page through the secure link (`/stay/my-booking#t=…`): view the booking, ask to
  cancel with the quote, and see arrival info inside its window.
- The link is added to the guest emails.
- Rate limit on public requests.

## 4c — legal drafts and switches (next)

- `/stay/privacy` and `/stay/accessibility`, editable templates, with the banner
  "טיוטה – טרם אושרה לפרסום (ממתינה לבדיקה משפטית)". Not indexed.
- Platform tab switches for the site and booking flags of a business.
- A "view my site" link in the management area.

## Not in Stage 4 (planned later)

- Visual editor and site versions (Stage 5).
- Theme picker at creation and the other three themes.
- Embedded map.
- Captcha.
- Online payment.
- Languages beyond Hebrew.
- Sitemaps (Stage 7).
- Room types.
