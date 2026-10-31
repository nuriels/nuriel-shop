# Hospitality Stage 2c — Properties and units (detailed plan)

Status: **approved (D-2c-1 … D-2c-6). 2c.1 (database, `0efc471`) approved; 2c.2 (screens) implemented — awaiting review; 2c.3 and 2c.4 not started.**

### 2c.2 — as implemented
- `/manage/units` ("יחידות" in the navigation, owner and managers): without a property —
  an empty state that explains the three steps and asks "מה אתם משכירים?" (six choices:
  צימר בודד, מתחם צימרים, דירות נופש, וילה / בית שלם, מלון בוטיק, משהו אחר), then one
  short form; with properties — a list grouped by property (type, address, draft badge,
  units with type, guests, rooms, inactive badge, and what is still missing to take bookings:
  price, photos), the plan's unit limit, "הוספת יחידה" / "הוספת מתחם".
- Create and edit of properties and units in sheets (bottom on phones), only through the
  server functions (`api/catalog.functions.ts` → the migration 10 functions): Hebrew
  messages next to the field and from the server, "updated in the meantime" merge (as in
  settings), a question before closing with unsaved changes. Brought forward from 2c.3 at
  the approval: editing the unit's details in a sheet. Still in 2c.3: a full unit page,
  "the whole property" switch and members, reorder, activate / deactivate, archive / delete
  (owner).
- First run: one server function creates the place and its units in order; if a unit is
  refused (e.g. the plan limit) it stops and says how many were added and why.
- `kind` is set once at creation (a "room" type → `room`, otherwise `unit`) and never
  changed by the screen; the booking engine treats both the same.
- Recent activity (team screen) now names catalog changes in Hebrew.
- Small fix found while reviewing screenshots: the sheet header's close button overlapped the
  title (also in the 2b.3 "add manager" sheet) — fixed in both.

### 2c.1 — as implemented (differences from the plan)
- C5 was already half-covered by the Stage 1 trigger `unit_members_occupancy_guard`
  (members frozen while the whole property has future occupancy); `whole_property_set`
  relies on it and adds the inventory lock.
- Found by the new concurrency scenarios and fixed before commit: (a) a deadlock between
  changing "the whole property" and a block being written for it (row lock vs. the block's
  foreign-key check) → rows that are only updated use `FOR NO KEY UPDATE`, deletes use
  `NOWAIT` with a Hebrew "in use right now" answer; (b) reorder with a list that misses a
  unit added meanwhile could give two units the same place → unlisted items are placed
  after the listed ones.
- Archive also switches the property's units off (frees plan places); bringing a property
  back from the archive (owner) leaves its units off until switched on.
- Seven Stage 1 SQL assertions were updated, none removed: 13 permissions; direct unit
  writes now expect "permission denied", and the RLS checks they carried moved to tables
  staff still write directly (amenities, beds). Concurrency scenario 20 (the plan-limit
  trigger) now writes as the server; scenario 27 covers the function.
Branch: `hospitality/stage-2` (after R-1). Overview: `stage-2-plan.md` §3 "2c".
Migration: **10** (`20261101180000_hosp_catalog`) — 9 went to R-1.

## 0. Summary

The owner (and managers) describe **what they rent**: one or more *properties* (מתחם /
נכס) and the *units* in them (צימר, סוויטה, חדר, דירה, וילה…), with type, name,
description and capacity — and whether a multi-unit property can also be rented **as a
whole**. Prices (2f), beds and amenities (2d), photos (2e) and availability (2g) come later
and plug into the same records.

The database model already exists since Stage 1c (`properties`, `units`, `unit_members`,
unit limit, booking engine on physical units). 2c **does not rewrite it**: it adds two
descriptive columns, a revision counter, owner-only deletion, and moves every write behind
database functions (like settings in 2b), so permissions, plan limits, audit and Hebrew
messages are enforced in one place.

## 1. One model for every kind of business

```
site (tenant)
 └─ property  (1..n)   property_type: zimmer | zimmer_complex | vacation_apartments | villa |
 │                      boutique_hotel | guest_house | other        ← description only
 │                      status: draft | active | archived
 ├─ unit  kind = unit | room            ← a physical place that is booked (occupancy, EXCLUDE)
 │        unit_type: zimmer | suite | room | apartment | villa | cabin | studio | other
 │        name, description, capacity, base_occupancy, bedrooms, bathrooms, child age
 └─ unit  kind = whole_property         ← "the whole property" as one booking
          unit_members → the physical units it takes (existing engine: books all of them)
```

| Business | How it is stored (no special case in code) |
|---|---|
| Single zimmer / cabin | 1 property (`zimmer`) + 1 unit. The UI hides the property layer while there is only one property with one unit |
| Zimmer complex | 1 property (`zimmer_complex`) + N units; optional "whole property" unit for groups |
| Villa / house rented only as one | 1 property (`villa`) + 1 unit (`villa`, bedrooms N). Rooms are described in 2d (beds per room), not booked separately |
| Vacation apartments (also in different places) | N properties (each with its address) or 1 property + N `apartment` units |
| Boutique hotel | 1 property (`boutique_hotel`) + N units of kind `room`. Each room is a physical unit, so the existing no-double-booking rule holds per room |
| Complex rented per unit **and** as a whole | N units + 1 `whole_property` unit with members (already supported by the booking engine) |

**Why this stays flexible without a rewrite**
- `property_type` / `unit_type` are **labels** (wording, icons, defaults in the UI, website
  filters later); no rule depends on them. New types = a CHECK change, not a new structure.
- Booking always happens on physical units (existing EXCLUDE constraint). A whole-property
  booking occupies its members. Nothing in 2c changes the booking engine.
- **Hotel "room types"** (sell "Deluxe double ×6" and assign a room later) is the one
  future need that adds something: a `unit_categories` table and a nullable
  `units.category_id` (additive migration, existing rows untouched). Not in 2c —
  recommended for the hotel stage (decision D-2c-5).

## 2. Gaps found in the current database (verified)

| # | Gap | Effect | Fix in migration 10 |
|---|---|---|---|
| C1 | Staff write `properties`, `units`, `unit_members` **directly** (RLS `FOR ALL` with `catalog`) | a manager can delete; no audit; technical errors (FK, CHECK) reach the user; slugs must be typed by hand | revoke direct `INSERT/UPDATE/DELETE`; DEFINER functions only (§4); `SELECT` stays |
| C2 | No property / unit **type** | cannot tell a zimmer from a hotel room or an apartment | `properties.property_type`, `units.unit_type` |
| C3 | No protection against **lost edits** (two people edit the same unit) | the last save silently wins | `revision` on properties and units (as in settings) |
| C4 | Deleting a unit with bookings fails with a foreign-key error | confusing; tempts to delete data | delete only if never booked / blocked; otherwise "deactivate" with a Hebrew explanation |
| C5 | Whole-property members can change while that unit has future bookings | existing bookings keep the old occupancy, new quotes use the new members — inconsistent | refuse member changes while the whole-property unit has active future bookings |
| C6 | Reorder = N separate updates (G11) | drag-to-order races | `catalog_reorder(kind, ids[])` in one transaction |
| C7 | Slug must be unique per site and match a pattern | owners should not see slugs | generated from the name (Hebrew allowed), unique suffix; editing slugs comes with the website (Stage 4) |

## 3. Permissions

| Action | Owner | Manager | Others (store owner, guest, other site, anonymous) |
|---|---|---|---|
| See properties and units (incl. inactive) | ✓ | ✓ | ✗ |
| Create property / unit, edit details, type, capacity | ✓ | ✓ | ✗ |
| Activate / deactivate a unit, set property draft / active | ✓ | ✓ | ✗ |
| Reorder, "rent the whole property" and its members | ✓ | ✓ | ✗ |
| **Archive a property** (hides it and its units) | ✓ | ✗ | ✗ |
| **Delete permanently** (property / unit never booked) | ✓ | ✗ | ✗ |

Proposed new owner-only permission `catalog.owner` (13 permissions; a manager lacks
`staff.managers`, `billing.manage`, `guests.privacy`, `settings.owner`, `catalog.owner`) —
decision D-2c-2. Platform admins act as the owner (existing rule). The plan limit
(`max_units`) and an inactive subscription are enforced by the existing trigger; the UI only
explains.

## 4. Database — migration 10 `hosp_catalog` (+ rollback)

**Columns**
- `properties.property_type text NOT NULL DEFAULT 'other'` (CHECK list above),
  `properties.revision integer NOT NULL DEFAULT 1`.
- `units.unit_type text NOT NULL DEFAULT 'other'` (CHECK list above; `kind = 'room'`
  defaults to `room`), `units.revision integer NOT NULL DEFAULT 1`.

**Functions** (SECURITY DEFINER, `_manage_tenant('catalog')`, management flag, Hebrew
messages, every change → `audit_log`)
| Function | Notes |
|---|---|
| `catalog_view()` | properties with their units (ordered), unit usage / limit, per unit: bookable-now flags (active, has price, has photo) for the UI hints |
| `property_create(data)` / `property_update(id, changes, expected_revision)` | name, type, description, address, status `draft/active`; slug generated |
| `property_archive(id)` | `catalog.owner`; refused while it has future active bookings |
| `property_delete(id)` | `catalog.owner`; only with no units ever booked |
| `unit_create(property_id, data)` | name, unit_type, kind (`unit`/`room`), description, capacity, base occupancy, bedrooms, bathrooms, child age; unit limit via the existing trigger; slug generated |
| `unit_update(id, changes, expected_revision)` | same fields; `HS409` "updated in the meantime" |
| `unit_set_active(id, active)` | deactivate keeps bookings; activate checks the limit (existing trigger) |
| `unit_delete(id)` | `catalog.owner`; only if no bookings / blocks / occupancy ever |
| `whole_property_set(property_id, enabled, member_ids[])` | creates / updates the `whole_property` unit; members must be active physical units of that property (existing trigger); refused while it has future bookings (C5) |
| `catalog_reorder(kind, ids[])` | properties or the units of one property; all ids must belong to the site |

Locks: every function takes the site's catalog lock; functions that affect booking
structure (member changes, delete, deactivate) also take the existing per-site **inventory
lock** (`hosp-inventory:<site>`, taken by every booking), so they serialize with booking
requests.

Existing rule kept: the public booking engine accepts only an **active unit in an active
property** — so a property in "טיוטה" is invisible to guests, and the UI says so.

**Grants:** revoke `INSERT, UPDATE, DELETE` on `properties`, `units`, `unit_members` from
`authenticated` (SELECT + RLS unchanged). Beds / amenities stay as they are until 2d.

**Rollback** `20261101180000_hosp_catalog.down.sql`: refuses while any property / unit has a
non-default type (data would be lost); restores the direct grants and the 12 permissions;
drops the functions and the new columns.

## 5. Server functions and screens

- `api/catalog.functions.ts` → `manageRpc` (user's token, management flag), input
  validation mirroring the database (`validation/catalog.ts`), "updated in the meantime"
  returned as an answer (like settings).
- Routes (thin adapters): `manage.units.tsx` (list), `manage.units.new.tsx`,
  `manage.units.$unitId.tsx` (unit), `manage.properties.$propertyId.tsx` (property).

**First run (no property yet) — "מה אתם משכירים?"**
Five large choices with icons: צימר בודד · מתחם צימרים · דירות נופש · וילה / בית שלם ·
מלון בוטיק (+ "אחר"). The choice sets `property_type`, suggests the unit type and asks
only for: business-place name, then the first unit(s) (name, type, guests). Single zimmer /
villa: one screen creates both property and unit.

**Units list (`/manage/units`)**
- Desktop: properties as sections, units as rows (type icon, name, guests, status,
  "missing" chips: מחיר · תמונות — link to their stage when it exists); actions on the row;
  drag to reorder **and** up/down buttons (keyboard / screen reader).
- Phone: cards, one column, primary action "הוספת יחידה" fixed above the bottom
  navigation; reorder with up/down buttons; forms in a bottom sheet / full page.
- Limit: "3 מתוך 5 יחידות בחבילה"; at the limit the add button is disabled with the
  reason (server refuses anyway).
- Inactive units in a collapsed "לא פעילות" group; archived properties hidden behind a
  filter (owner).

**Unit page** — sections as cards: פרטים (name, type, description), אורחים (capacity,
included guests, child age), חדרים (bedrooms, bathrooms); later sections (מיטות ומתקנים 2d,
תמונות 2e, מחירים 2f) appear as disabled cards "בקרוב" or are hidden — decision D-2c-4.
Sticky save bar, unsaved-changes prompt, conflict merge — same components as settings.

**Property page** — name, type, description, address, status (טיוטה / פעיל), "השכרת
המתחם כולו" switch → choose which units it includes (only when the property has ≥ 2 units).

Hebrew RTL, mobile-first, axe clean, Hebrew errors next to the field and from the server.

## 6. Dashboard and setup checklist

- Checklist step **"יחידת אירוח ראשונה"** → links to `/manage/units` (today: no link);
  done when an active physical unit exists (existing rule). Step "מחירים" stays until 2f
  but its hint names the unit(s) without a price.
- Dashboard card **"היחידות שלכם"**: active units / plan limit, properties count, units
  still in draft or inactive, quick action "הוספת יחידה"; for a single-unit business the
  card shows the unit itself.
- Plan notice: at the unit limit the dashboard says so (existing plan notice extended).
- Navigation: "יחידות" becomes a link (owner and manager).

## 7. Security, isolation and Ecommerce

- All writes only through the functions; direct PostgREST `INSERT/UPDATE/DELETE` refused for
  everyone (tested). Reads stay under the existing RESTRICTIVE tenant + backend policies.
- Site isolation: every function uses the request's site; ids of another site → "not
  found" (no existence leak); forged `x-tenant-id` → nothing.
- Store isolation: catalog functions 404 on a store (engine guard); no Ecommerce table or
  function changes; Ecommerce data hash unchanged in every test file.
- Audit: create / update (field from → to) / activate / deactivate / archive / delete /
  members / reorder — owner sees them in "פעילות אחרונה" (2b.3 screen).
- No personal data involved.

## 8. Tests

| Layer | What |
|---|---|
| SQL (`hospitality-catalog.test.sql`) | every function × owner / manager / store owner / guest / anonymous / other site; owner-only actions; plan limit and inactive subscription; revision conflict; delete vs booked unit; members rules (C5); reorder ownership; audit rows; direct DML refused; Ecommerce hash |
| Concurrency (`run.sh` 27–32) | two creates at the last unit slot → one; two edits from the same revision → one saved, one conflict; delete a unit vs a booking request for it → never an orphan; whole-property member change vs a booking of a member; reorder vs create; two creates with the same name → unique slugs |
| Rollback | M10 first: refusal with typed rows, restore, re-apply, whole-schema comparison |
| Unit (Vitest) | validation, type labels and defaults per business type, list grouping, hints |
| E2E `manage-units.spec.ts` | first-run for each business type (single zimmer, complex, apartments, villa, boutique hotel); add / edit / deactivate / reorder; whole-property with members; manager creates and edits but cannot archive / delete (UI + direct calls); limit (button + server); conflict in two browsers; phone flows; axe; store 404 + hash; flag off |
| Integration | `manage-integration.spec.ts` matrix extended with the catalog functions; existing booking E2E still books a unit created through the new screens |
| Existing tests | Stage 1 SQL / API tests that write units directly as the owner are moved to the functions (as done for settings in 2b) — no assertion removed |

## 9. Sub-steps and acceptance

| Step | Content | Accepted when |
|---|---|---|
| **2c.1** Database | migration 10 + rollback, SQL, concurrency, rollback check | SQL ×3, concurrency, rollback + whole-schema identical; Ecommerce unchanged |
| **2c.2** List + first run | server functions, `/manage/units`, first-run choices, property page | each business type can be set up on desktop and phone; axe clean |
| **2c.3** Unit page + whole property + reorder | unit editing, conflict merge, members, reorder | owner / manager rules hold in UI and direct calls |
| **2c.4** Dashboard, checklist, regression, docs | dashboard card, checklist link, full regression, docs | everything green; report |

Each step committed separately; stop after each for approval.

## 10. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D-2c-1 | Move catalog writes behind functions and revoke direct writes (as settings in 2b) | **yes** |
| D-2c-2 | New owner-only permission `catalog.owner` for archive / permanent delete | **yes** (manager: everything else) |
| D-2c-3 | Property and unit type lists as in §1 | **yes** (labels only; can grow later) |
| D-2c-4 | Show future sections (beds, photos, prices) on the unit page as "בקרוב", or hide them | **hide** until their stage — fewer dead ends for non-technical owners |
| D-2c-5 | Hotel room types (`unit_categories`, book by type) | **not in 2c**; additive later, no rewrite |
| D-2c-6 | Base price on the unit form in 2c or only in 2f | **2f** (pricing screen with rules); the checklist keeps pointing to it |
