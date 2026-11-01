# Hospitality Stage 3a — Calendar board I (as implemented)

Status: **implemented under the overnight continuous approval of 01/11/2026 (local development on
`hospitality/stage-2` only) — awaiting review.** Scope: `stage-2-plan.md` §3 "3a" (which absorbs
2g, availability blocks) and the owner's list (month / week views, all units, bookings and blocks
coloured by state, filter by unit / property, block / release dates, the whole property,
automatic refresh, desktop + phone, good performance with hundreds of units).

## 1. What the owner gets — `/manage/calendar` ("יומן")

- **Navigation:** "יומן" is the second item (after the dashboard) and in the phone's bottom bar;
  shown with the `bookings` permission (owner and managers).
- **Month and week board:** units in rows grouped by property (property heading rows), dates in
  columns; the unit column and the date header stay in place while scrolling; today marked;
  the business's weekend nights shaded; previous / "היום" / next.
- **Bars** for bookings and blocks across their nights, coloured by state **and** with text and a
  pattern (not by colour alone): ממתינה לאישור (light, dashed), מאושרת, שוהים עכשיו, עזבו,
  בוטלה (struck through; hidden by default — "להציג גם מבוטלות"), חסום (hatched, lock icon).
  A legend explains them. A stay that continues before / after the range is cut square.
- **The whole property:** its own row shows its bookings and blocks, and also its units'
  occupancy; each unit row shows the whole-property booking / block in a light dashed style
  ("דרך כל המתחם", also in the accessible name).
- **Filters:** property, unit (= one unit's calendar), unit type (when there is more than one),
  state; **search** by booking number or part of the guest's name → jump to the dates and open
  the summary.
- **Booking summary** (click a bar): guest name, unit, dates and nights, guests, state, total,
  source — read-only (actions come in 2h / 3b). **No contact details** on the board at all.
- **Blocks:**
  - from the board: click a free night, then the last night on the same row → the form opens
    with the unit and dates filled in (Escape cancels the selection);
  - from the "חסימת תאריכים" button (keyboard-friendly form: unit incl. "כל המתחם", first night,
    check-out day, optional reason);
  - click a block → details: change dates / reason, or **release** (confirmation); the dates are
    bookable again at once;
  - "חסימות קרובות" list under the board;
  - conflicts explained in Hebrew from the database ("יש הזמנה או חסימה בתאריכים האלה"); past
    dates and blocks over a year refused (same messages in the browser and the database).
- **One unit's calendar:** "יומן היחידה" on the unit page opens `/manage/calendar?unit=<id>` — that
  unit plus the whole property it belongs to (or, for a whole property, its units). On the phone
  this opens as the month grid.
- **Automatic refresh (D4):** a cheap change check (`calendar_stamp`) every 30 s while the page is
  visible, on returning to the tab and after each own action; the board downloads again only when
  something changed. A stale screen can never write a conflict (exclusion constraint).
- **Phone:** "סדר יום" (day by day for 14 days: arriving, leaving, staying, blocked) is the default;
  month / week available — the board scrolls inside its own box (the page never scrolls sideways).
- **Scale:** rows are virtualised (only the visible rows plus a margin are in the page); bars are
  computed once per load.

**Deviation from the plan (recorded):** range selection is "click first night, click last night"
on desktop as well (the plan said drag on desktop, tap + tap on the phone) — the same gesture
everywhere, simpler and accessible; drag can be added in 3b. The per-unit view is the board's unit
filter (and the link from the unit page) rather than a separate tab component.

## 2. Database — migration 14 `20261101220000_hosp_calendar.sql`

| Area | Change |
|---|---|
| Indexes | `bookings_calendar_idx (tenant_id, check_out, check_in)`, `blocks_calendar_idx (tenant_id, end_date) WHERE released_at IS NULL` |
| Writes | staff lose direct INSERT / UPDATE / DELETE on `blocks` (audit finding A-1); SELECT + RLS kept |
| Functions | `calendar(from, to, unit_ids?, include_cancelled?)` — ≤ 62 days, `bookings` permission, units / bookings / blocks / properties overlapping the range, whole-property members, weekend nights, currency, a change stamp; **guest name only** (no phone / email). `calendar_stamp(from, to)`. `block_create`, `block_update`, `block_release` (keeps history in `released_at`), `blocks_upcoming` — DEFINER, management flag, Hebrew messages, action log (`calendar.block_*`) |
| Bug fix | `_quote` ignored active blocks when no booking was being excluded (the EXCLUDE constraint still prevented any double booking, but a quote could show "available" for blocked dates and only fail at booking time). Fixed: `AND (o.booking_id IS NULL OR o.booking_id IS DISTINCT FROM _exclude_booking)` |
| Rollback | `supabase/rollbacks/20261101220000_hosp_calendar.down.sql` — restores the migration-11 `_quote`, re-grants the block writes; exact migration-13 schema (schema comparison in `rollback-check.sh`, M14) |

## 3. Tests

| Level | What |
|---|---|
| SQL | `scripts/db-tests/hospitality-calendar.test.sql` — 34: privileges (direct writes refused), range limits, half-open nights, whole-property fan-out in the response, member filter keeps the whole-property booking, cancelled hidden / shown, no contact data, stamp changes on every write, blocks × roles (owner, manager, outsider, anonymous), over a booking / another block / the whole property's member refused, update / release, the quote shows unavailable → available, action log, isolation, Ecommerce unchanged. Stage 1 booking / catalog files moved to `block_create` |
| Concurrency | `scripts/db-tests/hospitality/concurrency/run.sh` — now 41: case 9 (an owner block vs a whole-property request) and cases 29 / 30 use `block_create`; **new 33** (two staff block overlapping dates at once → exactly one), **new 34** (moving a block onto dates a guest requests at the same moment → exactly one holds them) |
| Rollback | M14 in `rollback-check.sh` — exact migration-13 schema; re-apply 1 → 14 |
| Performance | `scripts/db-tests/hospitality/perf/calendar-perf.sh` — 300 units in 10 properties, 5,100 bookings created through `create_manual_booking`; `calendar(today, today + 42)` for all units: **median 28.7 ms** (7 runs: 42.2 / 29.1 / 27.0 / 27.0 / 27.2 / 29.5 / 28.7), 2,084 bookings in the window, 669 KB payload; `calendar_stamp` 3.3 ms (target ≤ 300 ms) |
| Vitest | `tests/unit/hospitality-calendar.test.ts` — 16: month / week / agenda ranges across years, prev / next, labels, rows by property, clipping, whole-property "via" bars both ways, free nights, blocks, filters (property, unit, type, state), one unit's calendar, agenda per filter, search, 600 units × 3,000 bookings built < 500 ms, virtual window, input checks (same messages as the database) |
| E2E | `e2e/tests/manage-calendar.spec.ts` — board colours + accessible names, whole property both ways, filters, search → summary without contact data, axe; block by two clicks → the engine's quote unavailable → release → available, block over a booking refused with the database message, whole-property block holds its units; one unit's calendar from the unit page; **a 300-room hotel with ~1,500 stays: next month shown < 3 s (measured locally: 374 ms incl. the server call), < 60 rows in the page, scrolls to the last room**; auto refresh on focus after a change made elsewhere; direct calls by anonymous / another site's owner refused, no data from another site, no direct table writes; phone agenda (default), summary, week board without sideways scroll, axe; Ecommerce unchanged |

## 4. Not in 3a / open

- Day view, arrivals / departures as a list, actions on bookings (approve, check-in, move,
  cancel), manual booking from a selected range — **3b** (after 2h and 2i).
- Drag to select a range; drag to move a booking — 3b.
- Room types (RT) grouping of the rows — after the RT design (OD-01).
- Calendar-based price editing — with 3b.
- The public availability calendar on the site — Stage 4.
