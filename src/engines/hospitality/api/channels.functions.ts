// סנכרון ערוצים (iCal) — לצוות עם הרשאת bookings: קישורי הייצוא (יצירה / החלפה), יומנים
// חיצוניים לייבוא (הוספה / הסרה) ו"סנכרן עכשיו". ההורדה בשרת, דרך המוריד המוגן של הפלטפורמה.
import { createServerFn } from "@tanstack/react-start";
import type { ChannelKind, ChannelUnit } from "../types/channels";
import { InputError, uuid } from "../validation/input";

const CHANNELS: ChannelKind[] = ["airbnb", "booking", "vrbo", "google", "other"];

export const hospitalityChannels = createServerFn({ method: "GET" }).handler(
  async (): Promise<ChannelUnit[]> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ChannelUnit[]>("channels_view", {});
  },
);

export const hospitalityChannelFeedToken = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    unitId: uuid(input?.["unitId"], "היחידה"),
    rotate: input?.["rotate"] === true,
  }))
  .handler(async ({ data }): Promise<string> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<string>("channel_feed_token", { _unit_id: data.unitId, _rotate: data.rotate });
  });

export const hospitalityChannelCalendarAdd = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const channel = input?.["channel"] as ChannelKind;
    if (!CHANNELS.includes(channel)) throw new InputError("הערוץ לא מוכר");
    const url = String(input?.["url"] ?? "").trim();
    if (!/^https:\/\/\S{4,}$/.test(url) || url.length > 1000)
      throw new InputError("הקישור ליומן חייב להתחיל ב-https://");
    return { unitId: uuid(input?.["unitId"], "היחידה"), channel, url };
  })
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ id: string }>("channel_calendar_add", {
      _unit_id: data.unitId,
      _channel: data.channel,
      _url: data.url,
    });
  });

export const hospitalityChannelCalendarRemove = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({ id: uuid(input?.["id"], "היומן") }))
  .handler(async ({ data }): Promise<{ released: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ released: number }>("channel_calendar_remove", { _id: data.id });
  });

/** "סנכרן עכשיו": מורידים וקוראים את היומן כאן, והמסד מחיל (התנגשויות לא נכתבות) */
export const hospitalityChannelSyncNow = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({ id: uuid(input?.["id"], "היומן") }))
  .handler(
    async ({
      data,
    }): Promise<{
      status: string;
      events?: number;
      conflicts?: { uid: string; from: string; to: string }[];
    }> => {
      const [{ manageRpc, manageSession }, { fetchCalendar, CalendarFetchError }, { guardStaff }] =
        await Promise.all([
          import("../server/manage.server"),
          import("../channels/import.server"),
          import("../security/guard.server"),
        ]);
      const session = await manageSession();
      await guardStaff("channelSync", { userId: session.userId, siteId: session.siteId });
      // הקישור — רק מהיומנים של העסק (הרשאה במסד)
      const units = await manageRpc<ChannelUnit[]>("channels_view", {});
      const calendar = units.flatMap((u) => u.calendars).find((c) => c.id === data.id);
      if (!calendar) throw new InputError("היומן לא נמצא");
      let events: Awaited<ReturnType<typeof fetchCalendar>> = [];
      let error: string | null = null;
      try {
        events = await fetchCalendar(calendar.url);
      } catch (e) {
        error = e instanceof CalendarFetchError ? e.message : "הסנכרון נכשל";
      }
      return manageRpc("channel_sync_apply", {
        _calendar_id: data.id,
        _events: events,
        _error: error,
      });
    },
  );
