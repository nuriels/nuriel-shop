// עיצוב ערכים לאתר הציבורי (שפה ומטבע של העסק) — טהור, נבדק ביחידה.
import type { SiteCopy } from "../copy/he";
import type { PublicBed, PublicPolicy, PublicProperty, PublicUnit } from "../../types/website";

const LOCALE_TAG: Record<string, string> = { he: "he-IL" };

export function money(n: number, currency = "ILS", locale = "he"): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale] ?? locale, {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
}

/** "2026-11-05" → "5 בנובמבר 2026" */
export function longDate(iso: string, locale = "he"): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(LOCALE_TAG[locale] ?? locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "נובמבר 2026" */
export function monthTitle(year: number, month: number, locale = "he"): string {
  return new Date(Date.UTC(year, month, 1, 12)).toLocaleDateString(LOCALE_TAG[locale] ?? locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "1 קינג · 2 יחיד · עריסה" */
export function bedsText(beds: PublicBed[], t: SiteCopy): string {
  return beds
    .map((b) => {
      const label = t.beds[b.bed_type] ?? b.bed_type;
      return b.quantity > 1 ? `${b.quantity} ${label}` : label;
    })
    .join(" · ");
}

/** "עד 4 אורחים · 2 חדרי שינה · חדר רחצה" */
export function unitFacts(u: PublicUnit, t: SiteCopy): string[] {
  const out = [t.units.guests(u.capacity)];
  if (u.bedrooms) out.push(t.units.bedrooms(u.bedrooms));
  if (u.bathrooms) out.push(t.units.bathrooms(u.bathrooms));
  return out;
}

/** הטקסט של המדיניות לאורח: הטקסט של העסק אם כתב; אחרת — נבנה מהמדרגות */
export function policyLines(p: PublicPolicy | null, t: SiteCopy, currency = "ILS"): string[] {
  if (!p) return [];
  const tier = (fee: string, value?: number | null) =>
    fee === "percent_total"
      ? t.policy.percent(value ?? 0)
      : fee === "percent_deposit"
        ? t.policy.percentDeposit(value ?? 0)
        : fee === "fixed"
          ? money(value ?? 0, currency)
          : fee === "nights"
            ? t.policy.nights(value ?? 1)
            : fee === "deposit"
              ? t.policy.deposit
              : fee === "none"
                ? t.policy.none
                : t.policy.full;
  const lines = [
    p.free_cancel_days === null ? t.policy.noFree : t.policy.freeUntil(p.free_cancel_days),
  ];
  const tiers = p.fee_tiers ?? [];
  if (tiers.length === 0 && p.free_cancel_days !== null)
    lines.push(`${t.policy.after} — ${t.policy.full}`);
  tiers.forEach((x, i) =>
    lines.push(
      `${i === 0 ? t.policy.after : t.policy.fromDays(x.from_days)} — ${tier(x.fee, x.value)}`,
    ),
  );
  if (p.no_show_fee) lines.push(`${t.policy.noShow} — ${tier(p.no_show_fee, p.no_show_value)}`);
  return lines;
}

/** טלפון לקישור tel: / wa.me (ספרות בלבד; 05x → 9725x) */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
export function whatsappHref(phone: string, text?: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** קישורי ניווט — קואורדינטות אם יש, אחרת הכתובת (בלי מפתחות ובלי API) */
export function wazeHref(
  loc: { lat: number; lng: number } | null,
  address: string | null,
): string | null {
  if (loc) return `https://waze.com/ul?ll=${loc.lat},${loc.lng}&navigate=yes`;
  if (address) return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
  return null;
}
export function googleMapsHref(
  loc: { lat: number; lng: number } | null,
  address: string | null,
): string | null {
  if (loc) return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  if (address)
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return null;
}

/** היחידה לפי ה-slug מהכתובת (מקודד או לא) */
export function findUnit(units: PublicUnit[], slug: string | undefined): PublicUnit | undefined {
  if (!slug) return undefined;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // נשאר כמו שהוא
  }
  return units.find((u) => u.slug === slug || u.slug === decoded);
}

/** נתיב עמוד יחידה (slug בעברית — מקודד) */
export const unitPath = (slug: string) => `/stay/units/${encodeURIComponent(slug)}`;

/** המשפט הראשון של התיאור (עד 180 תווים) — לפתיח */
export function firstSentence(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  const s = m?.[1] ?? clean;
  return s.length > 180 ? `${s.slice(0, 177).trimEnd()}…` : s;
}

/** כללי המקום כשורות לאורח */
export function rulesLines(p: PublicProperty, t: SiteCopy): string[] {
  const r = p.rules;
  const out: string[] = [];
  if (r.smoking) out.push(t.terms.smoking[r.smoking] ?? r.smoking);
  if (r.pets)
    out.push(`${t.terms.pets[r.pets] ?? r.pets}${r.pets_note ? ` — ${r.pets_note}` : ""}`);
  if (r.events) out.push(t.terms.events[r.events] ?? r.events);
  if (r.quiet_from && r.quiet_to) out.push(t.terms.quiet(r.quiet_from, r.quiet_to));
  for (const line of (r.custom ?? []).map((x) => x.trim()).filter(Boolean)) out.push(line);
  return out;
}

/** "13.11.2026, 15:00" באזור הזמן של העסק */
export function dateTimeText(iso: string, timeZone = "Asia/Jerusalem", locale = "he"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(LOCALE_TAG[locale] ?? locale, {
    timeZone,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "ו׳ 20.11 – א׳ 22.11.2026" */
export function stayText(from: string, to: string, locale = "he"): string {
  const f = (iso: string, year: boolean) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(LOCALE_TAG[locale] ?? locale, {
      weekday: "short",
      day: "numeric",
      month: "numeric",
      ...(year ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  return `${f(from, false)} – ${f(to, true)}`;
}

/**
 * לוח הביטול לאורח — מהחישוב של השרת (ה-snapshot שבהצעה / בהזמנה), עם תאריכים ושעות
 * מדויקים: "ביטול ללא עלות עד …", "מ-… — דמי ביטול …", "אי-הגעה — …".
 */
export function scheduleLines(
  policy: {
    currency: string;
    timezone: string;
    schedule: {
      periods: { from: string | null; until: string | null; fee: number; kind: string }[];
      no_show_fee: number;
    };
  },
  t: SiteCopy,
): string[] {
  const tz = policy.timezone || "Asia/Jerusalem";
  const lines: string[] = [];
  for (const p of policy.schedule.periods ?? []) {
    const fee = Number(p.fee);
    if (fee <= 0) {
      lines.push(
        p.until ? t.book.freeUntil(dateTimeText(p.until, tz, t.locale)) : t.book.freeAlways,
      );
      continue;
    }
    lines.push(
      p.from
        ? t.book.feeFrom(dateTimeText(p.from, tz, t.locale), money(fee, policy.currency, t.locale))
        : `${t.terms.cancellation}: ${money(fee, policy.currency, t.locale)}`,
    );
  }
  const noShow = Number(policy.schedule.no_show_fee);
  if (noShow > 0) lines.push(t.book.noShow(money(noShow, policy.currency, t.locale)));
  return lines;
}
