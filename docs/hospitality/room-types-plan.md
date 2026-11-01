# RT — hotel room types (built 02/11/2026)

Built on the design closed before 2h (D24, `stage-1-plan.md` A4 "Hotel room types (RT)").
Third in the owner's 02/11 priority list.

## Model

- **`unit_categories`:** a room type inside a property. `units.category_id` is optional, so
  zimmers, villas and apartments carry on exactly as before.
- **Rules enforced by the database:**
  - only a regular unit or room can have a type; a whole-property unit cannot;
  - a room and its type share the same property (composite foreign key).
- **A booking always holds one physical room** (`bookings.unit_id`):
  - the exclusion constraint keeps protecting every room;
  - "whole property" logic, the board, emails and reports work unchanged;
  - no existing database function was modified.
- **Moving a booking to another room:** the existing "שינוי הזמנה" (2i, `modify_booking`
  with another unit), with a revision check and history. The price stays unless the owner
  sets a new total.
- **Price** stays at room level, so all existing rate rules keep working. "מחיר ותפוסה
  לכל החדרים" applies one price, minimum nights and occupancy to every room of a type, which
  keeps a type uniform.
  - **Decision:** the open question "type-level or room-level price" (stage-1-plan, open
    question 7) is resolved as room-level plus apply-to-all. Nothing in the quote engine
    changes; a type-scoped rate rule can be added later without a data change.

## Selling by type (public site)

- **The listing:**
  - a type replaces its rooms, at the position of its first room, so the owner's order
    is kept;
  - the card shows the type name, "N חדרים מהסוג", the largest capacity, "from" (the lowest
    room price) and the lowest minimum nights;
  - a room without a type is listed alone, as before.
- **Type page `/stay/rooms/<slug>`:**
  - it is the unit page with the type's name and description and the photos of all its
    rooms;
  - availability by type: a night is busy only when no room of the type is free;
  - booking goes to `/stay/book?type=<slug>`.
- **Booking page:**
  - the picker lists types and standalone units;
  - with a type, the quote is `quote_type`: the first room free for all the nights, with
    the previously quoted room first so the terms do not jump;
  - the request is `request_booking_type`. Inside the inventory lock it picks a free room
    of the type whose terms match the accepted `policy_hash`, then runs the normal
    `request_booking` in the same transaction;
  - two guests can never get the same room.
- **Verified in SQL:** three requests for the same type and dates got room 101, then room
  102; the third was refused with "התאריכים המבוקשים כבר לא פנויים".
- **Verified in the browser:** "חדר דלקס" was requested from the site; request #1003 was
  booked to room 201.

## Management

- **"סוגי חדרים"** (`/manage/room-types`, linked from "יחידות ומתחמים"):
  - per property: types (name, description, rooms);
  - add, edit, delete (only without rooms);
  - assign each room to a type (or none);
  - "מחיר ותפוסה לכל החדרים".
- **Calendar board:** rooms of a type are grouped under a "<type> · N חדרים" header.
  Without types the board is unchanged.

## Demo

`scripts/preview/hospitality-demo.mjs`: "מלון הנמל" gets two types:

- "חדר זוגי סטנדרט" — rooms 101 and 102, ₪600;
- "חדר דלקס" — rooms 201 and 202, ₪900.

## Not in this round

- Type-scoped rate rules and promotions.
- A "room move" quick action on the board (drag a booking to another room — 3b follow-up).
- Type photos of their own: the type uses its rooms' photos.
- Choosing a specific room as a guest.
- E2E coverage of the type flow, including a race of two parallel requests through the API.
