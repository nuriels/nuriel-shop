# Hospitality Stage 2d — Unit and property details (detailed plan and as implemented)

Status: **implemented under the overnight continuous approval of 01/11/2026 (local development on
`hospitality/stage-2` only) — awaiting review.** Scope: `stage-2-plan.md` §3 "2d" (binding list of
13 items, D20, D21). Requirement ids: `requirements-traceability.md`.

The binding scope says this plan is written and approved before 2d starts. The owner's
overnight approval (01/11) covers 2d → 2e → 2f → 3a "using the approved planning docs"; this file
was therefore written at the start of 2d and implemented in the same run. Every choice that the
approved docs left open is listed in §6 as a **default taken**, not as a new business decision —
each can be changed by a small follow-up.

## 1. What the owner gets

**Unit page** (`/manage/units/$unitId`), one save bar for everything:

| Section | Fields |
|---|---|
| אורחים | maximum guests, included in the price, child age (2c) + **מקסימום מבוגרים**, **מקסימום ילדים** (optional; empty = only the total; children 0 = "not suitable for children") |
| חדרים ומיטות | bedrooms, bathrooms (2c) + **שירותים נפרדים** (0–50) + **beds per room**: rows of room (optional, suggestions "חדר הורים / חדר ילדים / סלון / גלריה"), bed type (זוגית, קווין, קינג, יחיד, ספה נפתחת, קומותיים, עריסה, מזרן) and quantity; arrows to reorder, remove, add; "ישנים עד N" (a crib is a baby's, not counted); a warning — not a block — when the sleeping places are fewer than the maximum guests |
| מתקנים ביחידה | the business's amenity catalogue grouped (בחדר · מטבח · בחוץ · בריכה וספא · שירותים · נגישות · אחר), a checkbox and an optional note (≤ 120) per amenity; **"הוספה מהרשימה"** — one tap adds a ready amenity to the catalogue and marks it; **"מתקן משלכם"** — name, group, icon from a fixed set; edit / remove own amenities |

"כל המתחם" units have no beds or amenities of their own (the database refuses them; the page says
where they are set).

**Property page** (`/manage/properties/$propertyId`), one save bar (as 2c.3) for:

| Section | Fields |
|---|---|
| מתקנים במתחם | shared amenities — same catalogue and notes |
| חניה | none / free / paid; private / shared (required for free / paid); spaces (optional, 0–500); price note (paid only); guest instructions (≤ 1,000, public — the screen warns not to write codes) |
| מיקום במפה | paste a Google Maps / Waze / OpenStreetMap / `geo:` link or type coordinates; parsed **in the browser** (no request to the link, no map service); short links (maps.app.goo.gl, goo.gl, waze.com/ul/h…) get a "copy the coordinates" hint; preview links "פתיחה ב-Google Maps / Waze"; remove |
| מידע לאורחים | public text ≤ 4,000 (directions, the area, what to bring) |
| כללי המקום | smoking (forbidden / outside / allowed); pets (no / on request / allowed + conditions); parties and events (no / on request / allowed); quiet hours from–to (both or none); check-in / check-out times shown from the business settings; own rules — up to 20 × 200 |

**Private arrival info** — a separate card on the property page, **outside** the page form (own
save, own revision; Enter in a code field never saves the page): entry code, gate code, Wi-Fi
name and password, arrival instructions — for the whole property and per unit (a door code per
zimmer). Codes are hidden (password fields) until "הצגת הקודים".

## 2. Database — migration 11 `20261101190000_hosp_details.sql` (additive)

| Area | Change |
|---|---|
| Columns | `units`: `separate_toilets` (0–50, default 0), `max_adults` (null or 1..capacity), `max_children` (null or 0..capacity). `properties`: `parking`, `parking_type`, `parking_spaces`, `parking_fee_note`, `parking_instructions`, `guest_info`, `rules_smoking`, `rules_pets`, `rules_pets_note`, `rules_events`, `quiet_from`, `quiet_to`, `rules_custom text[]` — one table constraint keeps them consistent. `amenities.preset_code` (unique per site). `bookings.house_rules_snapshot`. Existing rows unchanged; nothing dropped or renamed |
| Private table | `arrival_info` (property, optional unit; 5 values; revision). RLS on; **no privilege** for `anon`, `authenticated` or `service_role`, no PERMISSIVE policy — reachable only through the DEFINER functions below. Not read by any public function, SEO data or snapshot (SQL test checks every anon-executable function's source) |
| Writes | staff lose direct INSERT / UPDATE / DELETE on `unit_beds`, `amenities`, `unit_amenities` (SELECT + RLS kept) |
| Unit functions | `unit_create` / `unit_update` accept `separate_toilets`, `max_adults`, `max_children`, `beds` (whole list, ≤ 30 rows) and `amenities` (whole list, ≤ 80, from the site's catalogue, no duplicates) — one transaction, one revision, one action-log row (beds as count from / to; amenities as names added / removed / note changed) |
| Property functions | `property_create` / `property_update` accept `location {lat,lng}` / null, the parking fields (normalised like the screen: no parking → no type / spaces / price), `guest_info`, the house-rules fields and shared `amenities`. Free text and the location are logged only as "changed" |
| Catalogue | `amenity_presets()` (15 items, fixed), `amenity_add_preset(code)` (idempotent; links to an own amenity of the same name), `amenity_create`, `amenity_update` (own amenities only), `amenity_delete` (removes it everywhere and bumps the revision of every unit / property that had it → open editors get "updated in the meantime") |
| Arrival info | `arrival_info_view(property)` and `arrival_info_set(property, unit, values, revision)` — staff with `catalog` **or** `bookings`; archived property → owner only; all values empty → row removed; the action log stores **field names only** ("קוד השער עודכן"). `guest_arrival_info(token, booking_id)` — `anon` / `authenticated`: the manage-booking link (or the signed-in guest who owns the booking), status confirmed / cancel_requested / checked_in, from **48 h before check-in until check-out** (business time zone); otherwise `available: false` with a reason and no values; property values + the booked unit's (members' for "כל המתחם") |
| Booking engine | `_quote` checks `max_adults` / `max_children` ("ביחידה הזאת אפשר עד N מבוגרים", "…לא מתאימה לילדים") — every path goes through it: quote (site and staff), `request_booking`, `create_manual_booking`, `modify_booking`. Trigger `bookings_house_rules`: every new booking stores the property's rules + check-in / out times; an update (also modify / move) keeps the original |
| Catalog view | `catalog_view` adds the new fields, beds, amenity links, the catalogue, the presets and the check-in / out times — **never** the arrival info |
| Rollback | `supabase/rollbacks/20261101190000_hosp_details.down.sql` — refuses while any 2d data is saved; restores the exact migration-10 schema (`rollback-check.sh` compares a full schema dump with a fresh database built up to migration 10) |

## 3. Server functions and screens

- `src/engines/hospitality/api/catalog.functions.ts` — unchanged API; `validation/catalog.ts`
  accepts the 2d keys (same rules and Hebrew messages as the database).
- `src/engines/hospitality/api/details.functions.ts` — `hospitalityAddPresetAmenity`,
  `hospitalityCreateAmenity`, `hospitalityUpdateAmenity`, `hospitalityDeleteAmenity`,
  `hospitalityArrivalInfo`, `hospitalitySaveArrivalInfo` (HS409 → the latest values, not an
  error). Arguments are never logged (`rpc.server.ts` logs only technical error codes).
- `src/engines/hospitality/validation/details.ts` — beds, amenities, parking, house rules,
  arrival info, amenity catalogue, and `parseMapLocation()` (Google Maps `@lat,lng` /
  `!3d…!4d…` / `?q=`, Waze `ll=`, OpenStreetMap `mlat/mlon` / `#map=`, `geo:`, plain coordinates;
  short links → hint).
- `src/engines/hospitality/management/details/` — `BedsEditor`, `AmenityPicker` (+ own-amenity
  sheet), `AmenityIcon` (fixed icon set, same list as the database), `PropertySections`,
  `ArrivalInfoCard`, `labels`.
- The action log ("פעילות אחרונה") names the changed fields in Hebrew, never values.

## 4. Security and privacy

- Every write through DEFINER functions with `can()`; tenant isolation by `_manage_tenant`;
  amenities must belong to the same site; arrival info only for the property's own units.
- Private arrival info: separate table without grants; never in `catalog_view`, public functions,
  the policy snapshot or the house-rules snapshot; never in a URL; the staff query is not cached
  between pages (`gcTime: 0`); the guest gets values only in the window.
- Parking instructions and guest info are public: the screen says so and points codes to the
  private card.
- The map link is never fetched (no SSRF surface); only coordinates are stored.

## 5. Tests

| Level | What |
|---|---|
| SQL | `scripts/db-tests/hospitality-details.test.sql` — 96 assertions: structure and privileges; presets / icons / groups; catalogue (owner, manager, idempotent, own, edit, remove → revision bump); unit (beds, toilets, limits, amenities, no-op save, stale revision, every validation message, whole-property refusal); property (location, parking normalisation, paid needs a type, quiet hours, limits, removal, created with details); arrival info (staff, value-free log, stale revision, other property's unit, other site, guest, anonymous, store owner, direct table read refused, empty → removed); booking engine (limits in staff / site quote, site request, manual booking, modify; snapshot on manual and site bookings, unchanged after a rules change, after modify and even after a direct update); guest window (in window, too early, not confirmed, wrong link, other site, stranger, after cancellation); isolation; Ecommerce unchanged. Stage 1 / 2c / booking files updated (anon allow-list + `guest_arrival_info`; direct bed / amenity writes now refused; RLS checks moved to still-writable tables) |
| Rollback | `rollback-check.sh` — M11 first: refusal while 2d data exists, exact migration-10 schema after the rollback, direct writes back, re-apply; whole-schema comparison after 11 → 1 → 11 |
| Vitest | `tests/unit/hospitality-details.test.ts` — 33 tests: map links (12 formats, short links, invalid / out of range, preview links), presets / icons / groups / bed types read from the migration file and compared with the screen, beds (sleeps, messages), amenities, parking / quiet hours, server cleaning, arrival-info parsing, unit / property updates, form diffs (beds and amenities sent whole only when changed; parking normalisation; a pasted link with the same place is no change), action-log texts |
| E2E | `e2e/tests/manage-details.spec.ts` — unit page (beds with reorder / sleeps / warning, toilets, limits with the error next to the field, presets + own amenity, reload, axe, action log); property page as the manager (shared amenities, parking, short link hint, pasted link → preview links, guest info, house rules, check times, "no parking" clears, reload, axe); private arrival info (own save, hidden codes, per-unit code, no values in the log or in the catalog view); two browsers (beds vs amenities merged, nothing overwritten); direct calls (server rules, anonymous / other site refused on every 2d function, no existence leak); phone (beds, amenity, parking, axe, no sideways scroll); Ecommerce unchanged |

## 6. Defaults taken (open decisions — can be changed later)

| # | Question (traceability) | Default implemented | Why |
|---|---|---|---|
| 1 | House rules: columns or a separate table | columns on `properties` | one row per property, same revision and save as the page; room left for unit exceptions (OD-03) |
| 2 | OD-02: per-unit private values | **yes** (property row + one row per unit) | recommended in the approved plan |
| 3 | OD-02: the guest window | 48 h before check-in → check-out; statuses confirmed, cancel_requested (still a valid stay until the cancellation is approved), checked_in | the plan's proposal |
| 4 | OD-02: send codes by email / WhatsApp | **not** sent anywhere yet | 2k / Stage 13 |
| 5 | OD-03: unit-level rule exceptions; check-in / out per property | not now; times stay at business level and are shown | the plan's recommendation |
| 6 | Who sees arrival info | staff with `catalog` **or** `bookings` (front desk needs the codes) | the plan: "staff with the catalogue or bookings permission" |
| 7 | Amenity groups / icons | 7 fixed groups, 35 fixed icons (lucide), same list in screen and database | no free icon names; a test keeps both lists equal |
| 8 | Own-amenity limits | name ≤ 60, ≤ 200 per site; presets are not renameable | presets stay recognisable for the public site / filters |

## 7. Not in 2d (where it goes)

- The guest screen for the arrival info and the public display of beds, amenities, parking, guest
  info and house rules — Stage 4 / 6 (data and access functions are ready).
- House rules on the booking card — 2h (the snapshot is stored from now on).
- Sending arrival info by email — 2k (decision OD-02).
- Amenity search filters on the public site — Stage 4 / 7.
- `policies.house_rules` (Stage 1) stays in the table, is not edited or shown (D21).
