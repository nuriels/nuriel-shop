# Hospitality Stage 2f — Prices, rate rules and cancellation policies (as implemented)

Status: **implemented under the overnight continuous approval of 01/11/2026 (local development on
`hospitality/stage-2` only) — awaiting review.** Scope: `stage-2-plan.md` §3 "2f" and the owner's
list (base price, weekend prices, seasons and holidays, minimum nights, guest surcharges, a clear
cancellation policy, a price summary, prices calculated on the server only).

**Deviation from the plan (recorded):** the plan said "no migration expected". Since migration 10
staff can no longer write unit prices directly, so management functions were needed: an
**additive migration 13** (functions only — no new table or column; the existing policy version
history of Stage 1e is reused). The pricing and policy engine itself (Stage 1) is unchanged.

## 1. What the owner gets

**`/manage/pricing` ("מחירים")**
- **Base price per unit:** price per night, extra per adult and per child beyond the guests included
  in the price, minimum nights, the unit's cancellation policy (or the business default). One save
  per unit, with "updated in the meantime".
- **Rate rules:** weekend (the business's weekend nights from the settings), season and holiday
  (dates), weekdays; for all units, a property, or one unit; a fixed price per night, a percent or an
  amount change; days of the week; minimum nights; priority; a special cancellation policy for a
  season / holiday; switch on / off; edit; delete. Precedence (unchanged engine): holiday > unit
  season > season > weekend > weekday > base; unit > property > all.
- **Price preview ("תצוגת מחיר"):** unit, dates, adults, children → the **server's** quote night by
  night (rate, guest extras, which rule), total, minimum-nights note, availability, the policy that
  would apply. Works while public bookings are closed. This is the price summary the manual booking
  screen (2i) will reuse.

**`/manage/policies` ("מדיניות ביטול")**
- The business's policies with the default marked, a plain-Hebrew summary of each.
- Editor: templates (גמיש / רגיל / קפדני), free cancellation days, fee tiers (days before + fee:
  none / percent of total / percent of deposit / fixed / deposit / full), no-show fee, deposit
  (shown to the guest as a term — payment collection is Stage 8), text for the guest.
- **Live example from the server:** "אם האורח מבטל N ימים לפני ההגעה — משלם X ומקבל בחזרה Y" for a
  ₪1,000 booking, computed by `policy_preview` = the booking engine's own `policy_schedule`.
- Every save creates a new version (existing bookings keep the snapshot they accepted);
  **history of versions** (read-only); set as default; archive (units / rules using it fall back to
  the default).
- House rules are **not** here (2d, property level — D21).

The setup checklist steps "מחירים" and "מדיניות ביטול" link to these screens; the navigation has
both items (by permission: `pricing`, `policies`).

## 2. Database — migration 13 `20261101210000_hosp_pricing.sql`

| Area | Change |
|---|---|
| Writes | staff lose direct INSERT / UPDATE / DELETE on `rate_rules` and `policies` (SELECT + RLS kept) |
| Functions | `pricing_view`, `unit_prices_set` (revision), `rate_rule_save`, `rate_rule_delete`, `policy_save` (expected version → `HS409`; validation by the existing trigger + Hebrew checks), `policy_set_default`, `policy_archive`, `policy_history` (existing `policy_versions`), `policy_preview` (the engine's schedule for unsaved rules), `price_preview` (staff quote, `pricing` permission) — DEFINER, management flag, action log |
| Rollback | `supabase/rollbacks/20261101210000_hosp_pricing.down.sql` — no new data, restores the exact migration-12 schema (schema comparison) |

## 3. Tests

| Level | What |
|---|---|
| SQL | `scripts/db-tests/hospitality-pricing.test.sql` — 48: privileges; unit prices (manager, the quote uses them at once incl. guest extras and minimum nights, stale revision, negative, 3 decimals, floor > ceiling, minimum 0, another site's policy, unknown field); rules (weekend vs weekday nights, unit season +20% with its minimum enforced for guests, holiday with its own policy, every validation, switching off, delete, log); policies (create, version + history, stale version, tier order, deposit, house rules refused, unit policy in the quote, live example = `policy_schedule`, default switch, default cannot be archived, archive clears rules); staff preview = quote; outsiders; direct writes refused; isolation; Ecommerce unchanged. Stage 1 schema / billing tests updated (direct writes now refused) |
| Rollback | M13 in `rollback-check.sh` — exact migration-12 schema; re-apply 1 → 13 |
| Vitest | `tests/unit/hospitality-pricing.test.ts` — 16: input checks like the database, partial rule updates, texts, templates valid, summary, refund calculator over a server-shaped schedule, preview input |
| E2E | `e2e/tests/manage-pricing.spec.ts` — checklist link; base price; weekend rule; unit season with percent and minimum; server price summary (weekend night + extra adult, minimum note); policies (template, live example 5 / 10 days, save, edit → version 2, history, default); direct calls refused; phone; axe; Ecommerce unchanged |

## 4. Not in 2f / open

- Promotions and coupons UI — Stage 7 (D-5; the engine supports them).
- Price floor / ceiling are stored and enforced by the engine but not shown in the screen (advanced;
  can be exposed later).
- Bulk edit of many units at once, calendar-based price editing — with the calendar (3b).
- Payment collection of the deposit — Stage 8.
