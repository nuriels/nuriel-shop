# Hospitality Stage 2b — Business settings and team (detailed plan)

Status: **approved (D-2b-1 … D-2b-6). 2b.1 (database) implemented — awaiting review; 2b.2+ not started.**

### 2b.1 — as implemented (differences from the plan)
- The "updated in the meantime" check uses a new `settings.revision` counter instead of
  `updated_at` (the stored timestamp is shown with second precision; a counter cannot
  collide).
- `audit_log` also carries the standard RESTRICTIVE isolation and backend policies (no
  permissive policy, no grants), so the schema-wide RLS coverage rule holds unchanged.
- `team_add_manager` checks seats and the subscription before answering
  `needs_account`, so no account is created for someone who cannot be added.
- Email-code sign-in for an added manager (new and existing account) is verified at the
  database level (`issue_login_code` / `consume_login_code` → `same_store`); the full
  browser flow is tested in 2b.3.
Branch: `hospitality/stage-2` (after 2a, `3e246f2`). Overview: `stage-2-plan.md` §3 "2b".

## 1. Scope

**In 2b**
- **Business settings screen** (`/manage/settings`): business name, phone, WhatsApp, email,
  address; check-in / check-out times; booking rules (approval window, reminder point,
  open requests per contact, weekend nights); owner notification recipients; guest-data
  retention.
- **Team screen** (`/manage/team`, owner only): owner and managers, seats used / limit,
  add a manager by email, remove a manager, recent team and settings activity.
- Backend closing the gaps below (migration 8), an automated migration-order check,
  navigation links for both screens, the "business details" checklist step linking to
  the settings screen.

**Not in 2b**: cancellation policies (2f), units (2c), plan changes (platform admin,
Stage 11), invitation emails (2k — outbox worker), ownership transfer, staff roles other
than owner / manager, currency / timezone / online-payment settings (fixed: ILS,
Asia/Jerusalem, request mode — Stage 8 for payments).

## 2. Gaps found before implementation (verified in code and on the local stack)

| # | Gap | Effect | Fix (migration 8) |
|---|---|---|---|
| S1 | Staff update `hospitality.settings` **directly** (column grants to `authenticated`), so every field is writable by a manager, including notification recipients and guest-data retention | owner-only settings cannot be enforced; no audit; no concurrency check | revoke direct `UPDATE`; all writes through `update_settings()` with a per-field permission check |
| S2 | `currency`, `timezone`, `payment_hold_minutes` and `booking_mode = 'instant'` are writable although nothing supports them yet (instant mode holds dates for a payment that cannot happen before Stage 8) | a manager could break pricing dates or create bookings that always expire | not editable in 2b; `update_settings()` refuses them (platform admin / later stages only) |
| S3 | Database constraint errors are English (`violates check constraint`) and are hidden as "הפעולה נכשלה" | owners get no useful message | `update_settings()` validates every field first with a Hebrew message; the same rules run in the browser |
| S4 | Two staff saving at once: last write wins silently | lost changes | optimistic check: the save sends the `updated_at` it loaded; changed → "ההגדרות עודכנו בינתיים — מרעננים" |
| T1 | No API to add / remove a manager; creating an account for a new email needs the service role | no team screen possible | `team_add_manager()` (runs as the owner, so every existing `user_roles` guard applies) + a platform adapter that creates the auth account only after the owner check passed |
| T2 | **Ecommerce RLS on `user_roles` applies to Hospitality sites** (verified on a disposable database: a manager unblocked a blocked manager and changed another manager's display name and email): any admin may `UPDATE` admin rows. The existing owner guard blocks adding / removing / blocking managers, but a **manager can unblock a blocked manager** and **edit other managers' rows** (email, display name, username) through the API | a manager can undo the owner's block or disturb another manager's login | Hospitality-only trigger on `user_roles` (fires only for Hospitality sites): a non-owner may change only their own username / display name. Ecommerce stores are not touched (the same gap exists there — reported, not changed) |
| T3 | No record of team / settings changes | no accountability | append-only `hospitality.audit_log`, written only by the functions, readable by the owner |
| T4 | Adding an account that is an Ecommerce **customer** of another store fails with a message that reveals that membership | account enumeration | generic message: "אי אפשר לצרף את החשבון הזה כמנהל. פנו לתמיכה." |
| M1 | Migration order is a convention only | a later timestamp mistake would run migrations out of order | automated check in CI (§7) |

## 3. Permissions (enforced in the database; the UI only hides what is not allowed)

| Action | Owner | Manager | Notes |
|---|---|---|---|
| View settings | ✓ | ✓ | `settings` |
| Edit business details, arrival times, booking rules | ✓ | ✓ | `settings` |
| Edit owner notification recipients | ✓ | ✗ | new owner-only permission `settings.owner` (D-2b-1) |
| Edit guest-data retention | ✓ | ✗ | `guests.privacy` (owner-only since 2a) |
| Currency, timezone, payment hold, instant booking | ✗ | ✗ | fixed in 2b (platform admin / Stage 8) |
| View team, seats, activity | ✓ | ✗ | `staff.managers` (D-2b-2) |
| Add / remove a manager | ✓ | ✗ | `staff.managers` + existing owner guard + 2a seat trigger |
| Remove / block the owner | ✗ | ✗ | existing protected-owner guards |
| Change own username / display name | ✓ | ✓ | existing self policy; nothing else on another admin's row (T2) |
| Platform admin | ✓ (all) | — | exempt from seats; acts through the platform panel as today |

Refused for everyone else: guests, Ecommerce customers / staff / owners on a Hospitality
site, owners or managers of another Hospitality site, anonymous; and for everybody when
the database or management flag is off.

## 4. Migration 8 — `20261101160000_hosp_settings_team.sql` (+ rollback)

Timestamp after migration 7 (`20261101150000`); rollback
`supabase/rollbacks/20261101160000_hosp_settings_team.down.sql`; added first to
`rollback-check.sh`.

| Object | Purpose |
|---|---|
| `REVOKE UPDATE ON hospitality.settings FROM authenticated` | S1 — only the function writes (staff keep `SELECT`) |
| `hospitality.permissions()` / `can()` + `settings.owner` | D-2b-1 — owner-only notification recipients |
| `hospitality.settings_view()` | values + `updated_at` + the list of fields this user may edit |
| `hospitality.update_settings(_changes jsonb, _expected_updated_at timestamptz)` | per-field allow-list and permission, Hebrew validation (S3), refuses S2 fields, optimistic check (S4), one audit row with the changed field names |
| `hospitality.audit_log` (+ append-only trigger, RLS: owner reads own site; no direct writes) | T3 — `team.manager_added`, `team.manager_removed`, `settings.updated` (field names, not values) |
| `hospitality.team_members()` | owner only: owner + managers (name, email, role, blocked, added at, last sign-in), seats used / limit |
| `hospitality.team_add_manager(_email, _display_name)` | owner only; existing account → `user_roles` admin row (seat trigger, owner guard, membership guard, product-role rule all apply); no account → returns `needs_account` (no row written); already a member → idempotent answer; T4 generic message |
| `hospitality.team_remove_manager(_user_id)` | owner only; the protected owner cannot be removed (existing guard); audit row |
| `hospitality.team_activity(_limit)` | owner only; latest audit rows |
| trigger `hospitality_admin_row_guard` on `public.user_roles` | T2 — Hospitality sites only; Ecommerce rows return immediately |

Ecommerce objects changed: **none** (the new trigger returns at its first line for
non-Hospitality sites; `user_roles` policies and Ecommerce guards untouched).

## 5. Server functions and adapters

- `src/engines/hospitality/api/settings.functions.ts` — `hospitalitySettings`,
  `hospitalityUpdateSettings` (validated input → `update_settings` with the user's token).
- `src/engines/hospitality/api/team.functions.ts` — `hospitalityTeam`,
  `hospitalityAddManager`, `hospitalityRemoveManager`, `hospitalityTeamActivity`.
  Add manager: RPC as the owner → if `needs_account`, the platform adapter creates the
  account (email confirmed, as the existing email-code sign-up does) → RPC again. Rate
  limit per site (20 additions / hour) with the existing in-memory limiter.
- `src/platform/auth/accounts.server.ts` — new adapter: `ensureAccount(email)` around the
  existing service-role auth admin client; added to the closed adapter allow-list (ESLint
  + architecture test). It never signs in, never writes `user_roles`.
- `src/engines/hospitality/validation/settings.ts` — the same field rules as the database,
  used by the forms and the server functions.
- Every management function checks `managementEnabled(site)` first (as 2a).

## 6. Screens (Hebrew RTL, mobile-first)

- **Settings** (`manage.settings.tsx` → `management/settings/`): one page, sections as
  cards — פרטי העסק · שעות הגעה ועזיבה · כללי הזמנה (with a plain explanation of each
  rule) · התראות לבעל העסק (owner) · שמירת פרטי אורחים (owner); fields a manager cannot
  edit are shown read-only with "רק בעל העסק יכול לשנות"; sticky save bar on phones;
  "ההגדרות נשמרו" toast; conflict message refreshes the form.
- **Team** (`manage.team.tsx` → `management/team/`): seats card ("2 מתוך 3 מנהלים"),
  member list (owner badge, blocked badge), "הוספת מנהל" sheet (email + name), remove with
  confirmation, at the limit the button is disabled with the reason; after adding, the
  sheet shows the address to share (`https://<site>/manage`) with copy and WhatsApp share
  — no email is sent in 2b (D-2b-3); recent activity list.
- Navigation: "הגדרות העסק" and "צוות ניהול" become links (team only for the owner);
  checklist step "פרטי העסק" links to settings.

## 7. Migration-order check (tracked requirement 2)

`tests/architecture/migrations.test.ts` (Vitest, runs in CI):
- migration timestamps are unique and the file list is in timestamp order;
- every migration after the Stage 1 baseline (`20261101090000…`) has a rollback file
  with the same name, and no rollback exists without its migration;
- `scripts/db-tests/rollback-check.sh` lists every such migration, newest rolled back
  first and re-applied in order;
- the newest migration's timestamp is later than migration 7.

## 8. Order of sub-steps and acceptance criteria

| Step | Content | Accepted when |
|---|---|---|
| **2b.1** Database | migration 8 + rollback; SQL tests; concurrency scenarios; rollback check; migration-order test | SQL ×3, rollback (8 → 1, re-apply), concurrency ×3 green; every row of §3 tested for owner / manager / outsiders; Ecommerce tests unchanged |
| **2b.2** Settings | settings functions, validation, settings screen, nav link | owner and manager save what they may (desktop + phone); manager sees owner fields read-only and a direct API write is refused; conflict message on parallel edit; axe clean |
| **2b.3** Team | accounts adapter, team functions, team screen | owner adds a manager (new and existing account), the new manager signs in with an email code and sees the dashboard; removal ends access on the next request; seat limit message; manager cannot open the team screen nor use the functions nor change `user_roles` directly; axe clean |
| **2b.4** Regression & docs | full E2E, typecheck, build, production start-up, lint baseline, docs, CI | everything green; whole-repo lint still the 28 known errors; report |

Each step is committed on its own on `hospitality/stage-2`.

## 9. Tests

**SQL (`hospitality-settings-team.test.sql`)**
- settings: manager / owner field matrix; S2 fields refused for everyone; Hebrew messages
  for each invalid value; optimistic check (stale `updated_at` refused); direct `UPDATE`
  refused for owner and manager; audit row with field names only.
- team: owner adds an existing account / gets `needs_account` for a new email; idempotent
  re-add; seat limit (2a rule) through the function; inactive subscription; the owner
  cannot be removed; removal ends `can()` for that user at once; manager / guest /
  Ecommerce owner / other-site owner / anonymous refused for every team function; generic
  message for an Ecommerce customer of another store (T4).
- T2 guard: a manager cannot unblock, rename, re-email or change the username of another
  manager through direct `UPDATE`; may change own username; the owner may do all through
  the existing paths; **an Ecommerce store's `user_roles` behave exactly as before**
  (store admin edits a store manager row — unchanged).
- audit: append-only (no `UPDATE` / `DELETE`, even by the owner or service role through the
  API); owner reads own site only.

**Concurrency** — two owners' sessions adding different managers for the last seat → one;
the same email added twice in parallel → one row; two settings saves with the same
`updated_at` → one succeeds, one gets the conflict message.

**Vitest** — settings validation (mirrors the database), permission-aware form model,
migration-order test, architecture (new adapter on the allow-list, route adapters thin).

**E2E (`manage-settings-team.spec.ts`, desktop + `@mobile`, axe)** — the flows in §8;
direct API attempts by a manager (server function and PostgREST); the login of a newly
added manager by email code (code from the local mock); no Google anywhere.

**Ecommerce separation**
- settings / team functions on a store → 404 (dispatcher) and nothing written;
- store `site_settings`, `email_settings`, `user_roles` of stores unchanged (hash compare
  before / after the Hospitality tests);
- a store owner added as a Hospitality manager keeps the store role and store admin
  access; removing them from the Hospitality site leaves the store untouched;
- the store staff screen (`/admin/settings/staff`) and existing staff / seat SQL tests
  pass unchanged;
- no Ecommerce customer role is created for a new Hospitality manager account.

## 10. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D-2b-1 | Notification recipients owner-only (new permission `settings.owner`)? | **yes** — they decide who receives every booking email |
| D-2b-2 | Team list hidden from managers (not even read-only)? | **yes** — owner only |
| D-2b-3 | No invitation email in 2b; the owner shares the address; automatic invitation in 2k through the outbox | **yes** |
| D-2b-4 | Instant booking, currency, timezone, payment hold not editable until their stage | **yes** |
| D-2b-5 | Append-only `hospitality.audit_log` for team and settings changes | **yes** |
| D-2b-6 | New managers sign in with an email code (no password set by the owner) | **yes** |

## 11. Risks

- `user_roles` is shared: the new trigger checks the site type first and returns for
  stores; covered by the unchanged Ecommerce staff / seat tests and a hash comparison.
- Accounts created for a mistyped email stay unused (no role, no access); removing the
  manager row does not delete the account.
- The T2 gap also exists for Ecommerce stores; fixing it there is an Ecommerce change and
  is only reported here.
