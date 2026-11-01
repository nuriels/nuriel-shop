// אורחים ופרטיות (Stage 2j): רשימה, כרטיס, הערות; ייצוא ומחיקת פרטים — לבעלים בלבד
// (guests.privacy במסד), כל אחד נרשם ביומן הפעולות (מיגרציה 17).
import { createServerFn } from "@tanstack/react-start";
import type { GuestDetail, GuestExport, GuestList } from "../types/guests";
import { parseGuestId, parseGuestNotes, parseGuestsQuery } from "../validation/guests";

export const hospitalityGuests = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestsQuery(input))
  .handler(async ({ data }): Promise<GuestList> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<GuestList>("staff_guests", {
      _q: data.q,
      _limit: data.limit,
      _offset: data.offset,
    });
  });

export const hospitalityGuest = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestId(input))
  .handler(async ({ data }): Promise<GuestDetail> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<GuestDetail>("staff_guest_detail", { _id: data.id });
  });

export const hospitalitySaveGuestNotes = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestNotes(input))
  .handler(async ({ data }): Promise<{ id: string; notes: string | null; updated_at: string }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("update_guest_notes", { _id: data.id, _notes: data.notes });
  });

export const hospitalityExportGuest = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestId(input))
  .handler(async ({ data }): Promise<GuestExport> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<GuestExport>("export_guest_logged", { _guest_id: data.id });
  });

export const hospitalityAnonymizeGuest = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestId(input))
  .handler(async ({ data }): Promise<{ done: true }> => {
    const { manageRpc } = await import("../server/manage.server");
    await manageRpc<boolean>("anonymize_guest", { _guest_id: data.id });
    return { done: true };
  });
