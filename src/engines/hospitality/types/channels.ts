// סנכרון ערוצים (iCal) — מה שמסך "ערוצים" מקבל מהשרת (channels_view, מיגרציה 24)
export type ChannelKind = "airbnb" | "booking" | "vrbo" | "google" | "other";

export interface ChannelCalendar {
  id: string;
  channel: ChannelKind;
  url: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_status: "never" | "ok" | "error";
  last_error: string | null;
  events: number;
  /** אירועים שלא נכתבו כי הם חופפים הזמנה / חסימה אצלנו */
  conflicts: { uid: string; from: string; to: string }[];
  next_sync_at: string;
}

export interface ChannelUnit {
  unit_id: string;
  name: string;
  kind: string;
  is_active: boolean;
  /** הטוקן של קישור הייצוא (null — עוד לא נוצר) */
  feed_token: string | null;
  feed_created_at: string | null;
  calendars: ChannelCalendar[];
}
