// מה שכרטיסי היחידות מראים מעבר לקטלוג — מהמסכים הקיימים, בלי שדות חדשים במסד: התמונה הראשית
// (גלריות), המחיר ללילה ובסוף השבוע (מחירים), הכתובת באתר (התצוגה המקדימה), והלילה (היומן).
// כל אחד רק עם ההרשאה שלו; בלי הרשאה / בטעינה — הכרטיס פשוט בלי הפרט הזה.
import { useQuery } from "@tanstack/react-query";
import { hospitalityCalendar } from "../../api/calendar.functions";
import { hospitalityGalleries } from "../../api/media.functions";
import { hospitalityPricing } from "../../api/pricing.functions";
import { hospitalitySitePreview } from "../../api/site-editor.functions";
import { addDays, calendarKey, dayOverview } from "../calendar/model";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import { weekendPrice } from "./unit-cards";

export type Tonight = "free" | "booked" | "blocked";

export interface UnitExtras {
  cover: Map<string, string>;
  price: Map<string, { base: number; weekend: number | null }>;
  slug: Map<string, string>;
  tonight: Map<string, Tonight>;
  currency: string;
  siteOpen: boolean;
}

/** התאריך של היום בישראל (YYYY-MM-DD) */
export const businessToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());

export function useUnitExtras(): UnitExtras {
  const ctx = useManagement();
  const p = ctx.permissions;
  const siteOpen = ctx.flags.frontend === true;
  const stale = { staleTime: 60_000, retry: false, refetchOnWindowFocus: false } as const;
  const galleries = useQuery({
    queryKey: [...manageKeys.all, "galleries"],
    queryFn: () => hospitalityGalleries(),
    enabled: p["media"] === true,
    ...stale,
  });
  const pricing = useQuery({
    queryKey: [...manageKeys.all, "pricing"],
    queryFn: () => hospitalityPricing(),
    enabled: p["pricing"] === true,
    ...stale,
  });
  const site = useQuery({
    queryKey: [...manageKeys.all, "unit-site-links"],
    queryFn: () => hospitalitySitePreview(),
    enabled: p["settings"] === true && siteOpen,
    ...stale,
  });
  const today = businessToday();
  const tomorrow = addDays(today, 1);
  const calendar = useQuery({
    queryKey: calendarKey(today, tomorrow, null, false),
    queryFn: () =>
      hospitalityCalendar({
        data: { from: today, to: tomorrow, unitIds: null, includeCancelled: false },
      }),
    enabled: p["bookings"] === true,
    ...stale,
  });

  const cover = new Map<string, string>();
  for (const prop of galleries.data?.properties ?? [])
    for (const u of prop.units) {
      const url = u.cover?.thumb_url ?? u.cover?.url;
      if (url) cover.set(u.id, url);
    }
  const price = new Map<string, { base: number; weekend: number | null }>();
  for (const u of pricing.data?.units ?? []) {
    if (!(u.base_price > 0)) continue;
    price.set(u.id, {
      base: Number(u.base_price),
      weekend: weekendPrice(u, Number(u.base_price), pricing.data?.rules ?? []),
    });
  }
  const slug = new Map((site.data?.units ?? []).map((u) => [u.id, u.slug] as const));
  const tonight = new Map<string, Tonight>();
  if (calendar.data)
    for (const d of dayOverview(calendar.data, today))
      tonight.set(
        d.unit.id,
        d.night === "booked" ? "booked" : d.night === "blocked" ? "blocked" : "free",
      );
  return {
    cover,
    price,
    slug,
    tonight,
    currency: pricing.data?.currency ?? "ILS",
    siteOpen,
  };
}
