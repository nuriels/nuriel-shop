# Hospitality Stage 2j — Guests and privacy (as implemented)

Status: **implemented on 02/11/2026** on `hospitality/stage-2` (owner's instruction: build the
product; tests at the end on the owner's server). D-3 (approved): export / anonymise owner only.

- **"אורחים"** (`/manage/guests`, `guests` permission): every guest of the business — name,
  masked phone / email, number of stays, next / last stay, a notes marker; search by name,
  phone or email; "הצגת עוד".
- **Guest card** (`/manage/guests/$id`): full contact (links), marketing consent, internal
  notes (saved; the action log records that they changed, not their content), all the guest's
  bookings (links to the booking pages). The booking page links to the guest card.
- **Privacy (owner only, `guests.privacy`):** export everything about the guest (JSON file) and
  delete the personal details (name, phone, email, notes) — bookings and amounts are kept;
  refused while the guest has an active or future booking. **Both are now written to the action
  log** (security plan PRIV-07); the unlogged `export_guest` can no longer be called directly.
- Activity feed: Hebrew texts for photos, prices, rules, policies, blocks and guest actions.

Database — migration 17 `20261102110000_hosp_guests.sql`: `staff_guests`, `staff_guest_detail`,
`update_guest_notes`, `export_guest_logged`; `anonymize_guest` redefined with a log entry;
`export_guest` no longer executable by `authenticated`. Rollback restores the exact migration-16
schema (`rollback-check.sh` M17).

Not yet: a retention schedule that runs `apply_retention` (with the 2k worker); editing a
guest's name / contact (they identify the guest across bookings — separate decision).
