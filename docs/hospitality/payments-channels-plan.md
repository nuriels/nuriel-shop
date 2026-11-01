# Payments and channel sync — infrastructure (built 02/11/2026)

The owner approved "preparing the infrastructure for payments and channel sync according to
the plan" (priority 4). This builds the provider-independent parts of Stage 8 and Stage 12.

## Payments (Stage 8, part 1)

### Built

- **Ledger (`payments`, migration 23):**
  - kinds: deposit, balance, full, refund, other;
  - methods: cash, bank transfer, Bit, card (by phone), check, provider, other;
  - each row records amount, date, note and, for a provider, the provider and its
    reference;
  - rows are never edited: a wrong entry is voided with a reason and stays in the history;
  - every entry and void is written to the booking history and the action log.
- **`bookings.amount_paid`** = payments − refunds, so the existing cancellation maths
  (`refund_due` / `charge_due`, in place since Stage 1) uses what was actually paid.
- **Booking page → "תשלומים":** total, paid, balance due, refund due (cancelled / declined /
  expired / no-show), the ledger, "רישום תשלום או החזר", "ביטול רישום". A refund above what
  was paid is refused.
- **Provider plumbing:**
  - `payment_provider_record` (server only) records a provider payment idempotently by
    provider reference, ready for a webhook;
  - a provider payment can only be reversed through the provider.
- **Verified in the browser:** ₪500 transfer recorded → balance ₪1,150; voided → ₪1,650,
  shown in the history.

### Not built — decisions needed (OD-16)

- **Online card payment from the site (Grow, per the Stage 8 plan).** The open business
  question is the merchant model: does each business have its own Grow terminal (money goes
  straight to the business), or does the platform collect and pass money on (marketplace,
  with fees, licensing and VAT implications)? This is a material business decision.
- Once decided, the plan is:
  - the neutral Grow client behind `src/platform/payments/grow` (an adapter, no Ecommerce
    change);
  - a Hospitality webhook route calling `payment_provider_record`;
  - payment links at booking or after approval, with the deposit from the policy snapshot;
  - refunds through the provider.

## Channel sync — iCal (Stage 12, infrastructure)

### Built

- **Export:**
  - each unit gets a secret link `https://<site>/ical/<token>`;
  - the token has 160 random bits, can be rotated, and stops working immediately once
    replaced;
  - the feed contains busy nights only (bookings, pending requests, blocks) — never names,
    phones or emails;
  - only this business's units are served (the token is checked against the site's
    tenant);
  - rate-limited per token;
  - no file extension, because the server treats `.xyz` paths as static files.
- **Import:**
  - external calendar links per unit (Airbnb, Booking.com, Vrbo, Google, other; https
    only; up to 5 per unit);
  - downloads go only through the platform's SSRF-protected downloader (the one 2e uses
    for photo imports);
  - parsing is RFC 5545 for dates and UIDs, including folded lines and missing `DTEND`;
    nothing personal is kept;
  - each event becomes a block held by the same exclusion constraint as every booking;
  - an event overlapping one of our bookings or blocks is not written: it is listed as a
    "התנגשות" on the screen;
  - a changed event moves only its own block; a vanished event releases only its own
    block; our bookings are never changed automatically;
  - removing a calendar releases its blocks; the calendar is archived, so the history
    stays.
- **Schedule:**
  - the existing worker syncs due calendars every 30 minutes (checked every 5 minutes, up
    to 10 per round, a 10-minute lease against double runs);
  - after errors it backs off from 30 minutes up to 6 hours;
  - "סנכרן עכשיו" is available on the screen.
- **Screen "ערוצי הזמנה" (`/manage/channels`, `bookings` permission):**
  - export link with copy and rotate;
  - calendars with status, last error, event count and conflicts;
  - add and remove;
  - a note on the residual risk (iCal is not real-time).
- **Verified:**
  - SQL: an event written, an overlapping one listed as a conflict, a past one ignored,
    removal releases, an error backs off;
  - HTTP: the feed returns `text/calendar` with busy nights only; a wrong token, or the
    same token on another business, returns 404;
  - browser: a blocked address (127.0.0.1) was refused by the downloader and shown as a
    sync error.

### Not built yet

- An email to the owner on a new conflict. The conflicts show on the screen; a dashboard
  card and the 2k email template come next.
- A channel badge on the board (imported blocks show as blocks with the reason
  "סנכרון: Airbnb").
- A live test against real Airbnb / Booking.com calendars (this environment has no outbound
  access to them). Parser tests use their published formats.
- Channel managers / real-time APIs (beyond iCal) — Stage 12 follow-up if needed.
