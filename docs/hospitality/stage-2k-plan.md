# Hospitality Stage 2k — Emails and dashboard (as implemented)

Status: **implemented on 02/11/2026** on `hospitality/stage-2` (owner's instruction: build the
product; tests at the end on the owner's server).

## Emails actually leave
- **Worker** (`src/engines/hospitality/outbox/worker.server.ts`), started once when the server
  boots (`Engine.startWorkers` → `src/app/engines.ts` → `src/server.ts`), **only when
  `HOSPITALITY_ENGINE=on`**. Every 30 s and right after every staff action that queues emails:
  1. `expire_holds` — requests not approved in time expire (dates freed, emails queued);
  2. the outbox — `claim_notifications` → Hebrew RTL email in the business's name through the
     existing Nuriel email service (platform adapter `src/platform/email/send.server.ts` around
     `src/lib/email.server` — Resend; sender name = business, reply-to = the business's email for
     guest emails, `Idempotency-Key = hosp-<notification id>`) → `mark_notification`; failures retry
     with growing delays (database), "נכשל" after 5; a failed email never undoes an action;
  3. once a day `apply_retention` (each business's guest retention setting).
- **Templates** (`outbox/templates.ts`): 7 guest emails (request received, confirmed, declined,
  expired, cancelled, cancellation received / declined) and 7 owner emails (new request, new
  booking, approval reminder, request expired, cancellation requested, cancelled by guest,
  request withdrawn, with a link to the booking page). The guest's self-service link is not sent
  yet — the guest pages come with the public site (Stage 4).
- **"מיילים"** (`/manage/emails`): failed · waiting · sent (masked recipient, booking link,
  attempts); "לשלוח שוב" for a failed email (logged).
- Production needs `RESEND_API_KEY` (already used by the stores); without it emails are marked
  failed with the reason and can be re-sent once it is set.

## Dashboard
- **"היום בעסק"**: arriving / leaving today, staying, pending approvals, cancellation requests,
  free units tonight, occupancy 7 / 30 days, this month's revenue, failed emails — with links.
- The bookings card (2h) lists the pending requests with the time left.

## Database — migration 18 `20261102120000_hosp_emails_dashboard.sql`
`staff_emails`, `requeue_notification`, `dashboard` (+ `_occupancy`) — `bookings` permission,
management area on. Rollback restores the exact migration-17 schema (`rollback-check.sh` M18).

## Not yet
Resending an email with a new guest link (with the guest pages, Stage 4); per-business email
branding (logo, colours — with the site themes); SMS / WhatsApp (Stage 13).
