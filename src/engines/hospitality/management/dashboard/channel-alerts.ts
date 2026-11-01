// מה מוצג בהתראות היומנים החיצוניים (D3) — טהור, נבדק ביחידה.
import type { ChannelKind, ChannelUnit } from "../../types/channels";

export interface ConflictAlert {
  calendarId: string;
  unit: string;
  channel: ChannelKind;
  uid: string;
  from: string;
  to: string;
}

export function channelAlerts(units: ChannelUnit[]): {
  conflicts: ConflictAlert[];
  failing: { unit: string; channel: ChannelKind }[];
} {
  const conflicts: ConflictAlert[] = [];
  const failing: { unit: string; channel: ChannelKind }[] = [];
  for (const u of units)
    for (const c of u.calendars) {
      if (!c.enabled) continue;
      for (const x of c.conflicts ?? [])
        conflicts.push({
          calendarId: c.id,
          unit: u.name,
          channel: c.channel,
          uid: x.uid,
          from: x.from,
          to: x.to,
        });
      if (c.last_status === "error") failing.push({ unit: u.name, channel: c.channel });
    }
  conflicts.sort((a, b) => a.from.localeCompare(b.from));
  return { conflicts, failing };
}
