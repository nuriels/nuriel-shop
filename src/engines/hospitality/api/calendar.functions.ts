// לוח היומן וחסימות (Stage 3a). קריאה אחת לטווח שעל המסך (calendar), בדיקת שינוי זולה
// (calendar_stamp) לרענון האוטומטי, וחסימות רק דרך פונקציות המסד (מיגרציה 14).
import { createServerFn } from "@tanstack/react-start";
import type { CalendarBlock, CalendarView } from "../types/calendar";
import { parseBlock, parseCalendarQuery } from "../validation/calendar";
import { InputError, uuid } from "../validation/input";

export const hospitalityCalendar = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCalendarQuery(input))
  .handler(async ({ data }): Promise<CalendarView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<CalendarView>("calendar", {
      _from: data.from,
      _to: data.to,
      _unit_ids: data.unitIds,
      _include_cancelled: data.includeCancelled,
    });
  });

export const hospitalityCalendarStamp = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCalendarQuery(input))
  .handler(async ({ data }): Promise<string> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<string>("calendar_stamp", { _from: data.from, _to: data.to });
  });

export const hospitalityCreateBlock = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const b = parseBlock(input);
    if (!b.unitId) throw new InputError("יש לבחור יחידה");
    return b;
  })
  .handler(async ({ data }): Promise<CalendarBlock> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<CalendarBlock>("block_create", {
      _unit_id: data.unitId,
      _from: data.from,
      _to: data.to,
      _reason: data.reason,
    });
  });

export const hospitalityUpdateBlock = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const b = parseBlock(input);
    if (!b.id) throw new InputError("החסימה לא נמצאה");
    return b;
  })
  .handler(async ({ data }): Promise<CalendarBlock> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<CalendarBlock>("block_update", {
      _id: data.id,
      _from: data.from,
      _to: data.to,
      _reason: data.reason,
    });
  });

export const hospitalityReleaseBlock = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({ id: uuid((input ?? {})["id"], "החסימה") }))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ id: string }>("block_release", { _id: data.id });
  });

export const hospitalityUpcomingBlocks = createServerFn({ method: "GET" }).handler(
  async (): Promise<CalendarBlock[]> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<CalendarBlock[]>("blocks_upcoming", {});
  },
);
