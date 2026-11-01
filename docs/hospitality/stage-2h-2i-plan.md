# Hospitality Stages 2h + 2i — Bookings: view, decide, add, change, cancel (as implemented)

Status: **implemented on 02/11/2026** on `hospitality/stage-2` under the owner's instruction to build
the product so a real hospitality business can be opened and run through the system (no
comprehensive test round in this phase — final security / permission / function / performance
checks happen after installation on the owner's secured server).

**Room types gate (D24 / D29):** the RT design is the one already closed in `stage-1-plan.md` A4
"Hotel room types (RT)": a booking keeps `unit_id` = the physical room, so these screens need no
change when RT lands (they will show the room type next to the room). Building RT itself needs the
owner's approval and was **not** started.

## What the owner gets

- **"הזמנות"** (`/manage/bookings`, navigation + phone bottom bar): tabs ממתינות לטיפול (requests
  and guests' cancellation requests) · קרובות · שוהים עכשיו · עבר · בוטלו, with counts; search by
  booking number, name, phone or email; cards with unit, dates, guests, total, source and the
  time left to approve; "הצגת עוד". Contact details are masked in the list.
- **Booking page** (`/manage/bookings/$id`): stay, guest (full phone / email as links only with the
  `guests` permission), price night by night, payment state, the cancellation policy saved with
  the booking, history (who did what), emails and their state.
  - Actions by state: approve, decline with a reason (2h); guests arrived, didn't arrive, left (2h).
  - Change the booking: dates, unit, guests, a manual price, a note for the history (2i).
  - Cancel by the business: fee from the saved policy, or another amount with a reason (2i).
  - A guest's cancellation request: approve, optionally reducing or waiving the fee with a
    reason, or decline with an explanation for the guest (2i).
  - Every action sends the revision on screen; if the booking changed meanwhile the database
    refuses and the page reloads.
- **"הוספת הזמנה"** (`/manage/bookings/new`, also from the calendar with unit and dates — 3b): unit,
  dates, adults / children, the server's price preview (availability, minimum nights), guest
  name / phone / email (a returning guest is recognised), confirmed now or as a request, source
  and channel, manual price, cancellation policy (default or another) with "I explained the
  terms", optional email to the guest, internal note. Double booking is refused by the database.
- **Dashboard:** a bookings card (pending with time left, upcoming, staying now, "הוספת הזמנה").
- **Calendar:** the booking summary links to the booking page; a range selected on the board can
  become a booking instead of a block.

## Database — migration 16 `20261102100000_hosp_bookings_staff.sql`

Read functions only (the actions exist since Stage 1f): `staff_bookings(tab, q, limit, offset)`
and `staff_booking_detail(id)` — `bookings` permission, management area on; a pending request
past its approval window counts as expired even before the sweep runs. Rollback drops them
(exact migration-15 schema, `rollback-check.sh` M16).

## Not yet

Payment collection (Stage 8); guest list, notes, export / anonymise (2j); sending the queued
emails through the email service and their retry screen (2k); day view, arrivals / departures
lists and drag on the board (3b); hotel room types (RT, needs approval).
