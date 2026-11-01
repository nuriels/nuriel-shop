// האתר הציבורי של העסק (Stage 4) — לכל גולש (בלי חשבון). העסק לפי הכתובת (x-tenant-id →
// request_tenant במסד), אף פעם לא לפי הקלט.
//   • 4a: נתוני האתר (רק כשהאתר פתוח — hospitality_frontend_enabled) ולילות תפוסים;
//   • 4b: הצעת מחיר, בקשת הזמנה (רק כשההזמנות פתוחות — hospitality_booking_enabled + מנוי),
//     ההזמנה שלי בקישור המאובטח, הצעת ביטול ובקשת ביטול.
// המחיר, הזמינות והמדיניות — רק מהמסד (quote / request_booking); מניעת הזמנה כפולה — במסד
// (EXCLUDE); הגבלת קצב לכל כתובת IP מעל המגבלות של המסד (עד 2 בקשות פתוחות לאותם פרטי קשר).
import { createServerFn } from "@tanstack/react-start";
import type {
  BookingRequestResult,
  CancellationQuote,
  GuestBookingView,
  Quote,
} from "../types/domain";
import type {
  GuestArrival,
  PublicAvailability,
  PublicMedia,
  PublicSite,
  RawPublicMedia,
  RawPublicSite,
  SiteGuestBooking,
} from "../types/website";
import {
  InputError,
  isoDate,
  parseGuestBookingRef,
  parseQuote,
  parseRequestBooking,
  parseRequestCancellation,
  uuid,
} from "../validation/input";

const TOO_MANY = "יותר מדי בקשות מהכתובת הזו — נסו שוב בעוד כמה דקות";

/** הגבלת קצב לפי IP (בזיכרון השרת; מעל המגבלות של המסד) */
async function throttle(action: string, limit: number, windowMs: number): Promise<void> {
  const { allowAction, requestIp } = await import("@/platform/security/rate-limit.server");
  if (!allowAction(`hosp-site:${action}:${await requestIp()}`, limit, windowMs))
    throw new InputError(TOO_MANY);
}

const MAX_RANGE_DAYS = 120;

function mediaUrls(publicUrl: (p: string | null | undefined) => string | null) {
  return ({ path, variants, ...rest }: RawPublicMedia): PublicMedia => {
    const v = variants ?? {};
    return {
      ...rest,
      url: publicUrl(path),
      thumb_url: publicUrl(v["480"] ?? v["thumb"] ?? (rest.kind === "image" ? path : null)),
      srcset:
        rest.kind === "image" && v["480"] && v["960"]
          ? `${publicUrl(v["480"])} 480w, ${publicUrl(v["960"])} 960w, ${publicUrl(path)} ${rest.width ?? 1600}w`
          : null,
    };
  };
}

export const hospitalityPublicSite = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSite> => {
    const [{ callRpc }, { publicUrl }] = await Promise.all([
      import("../server/rpc.server"),
      import("../server/media.server"),
    ]);
    const raw = await callRpc<RawPublicSite>("public_site", {});
    const urls = mediaUrls(publicUrl);
    return {
      ...raw,
      gallery: raw.gallery.map(urls),
      properties: raw.properties.map((p) => ({ ...p, media: p.media.map(urls) })),
      units: raw.units.map((u) => ({
        ...u,
        base_price: Number(u.base_price),
        media: u.media.map(urls),
      })),
    };
  },
);

export const hospitalityPublicAvailability = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const unitId = uuid(input?.["unitId"], "היחידה");
    const from = isoDate(input?.["from"]);
    const to = isoDate(input?.["to"]);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days <= 0 || days > MAX_RANGE_DAYS) throw new InputError("טווח התאריכים לא תקין");
    return { unitId, from, to };
  })
  .handler(async ({ data }): Promise<PublicAvailability> => {
    const { callRpc } = await import("../server/rpc.server");
    return callRpc<PublicAvailability>("public_availability", {
      _unit_id: data.unitId,
      _from: data.from,
      _to: data.to,
    });
  });

// ---------- 4b: הזמנה מהאתר ----------

const MINUTE = 60_000;

export const hospitalitySiteQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseQuote(input))
  .handler(async ({ data }): Promise<Quote> => {
    await throttle("quote", 120, 10 * MINUTE);
    const { callRpc } = await import("../server/rpc.server");
    return callRpc<Quote>("quote", {
      _unit_id: data.unitId,
      _check_in: data.checkIn,
      _check_out: data.checkOut,
      _adults: data.adults,
      _children: data.children,
      _promo_code: data.promoCode,
    });
  });

export const hospitalitySiteRequestBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseRequestBooking(input))
  .handler(async ({ data }): Promise<BookingRequestResult> => {
    await throttle("request", 6, 60 * MINUTE);
    const [{ callRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const result = await callRpc<BookingRequestResult>("request_booking", {
      _unit_id: data.unitId,
      _check_in: data.checkIn,
      _check_out: data.checkOut,
      _full_name: data.fullName,
      _email: data.email,
      _phone: data.phone,
      _idempotency_key: data.idempotencyKey,
      _policy_accepted: true,
      _policy_hash: data.policyHash,
      _adults: data.adults,
      _children: data.children,
      _special_requests: data.specialRequests,
      _promo_code: data.promoCode,
      _marketing_consent: data.marketingConsent,
      _language: data.language,
    });
    // מייל לאורח (עם קישור ניהול ההזמנה) ולעסק — מיד, בלי לחכות לסבב של ה-worker
    kickOutbox();
    return result;
  });

/** ההזמנה לפי הקישור המאובטח (טוקן בלבד — לא מזהה), ומידע ההגעה כשהוא זמין */
export const hospitalitySiteBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const ref = parseGuestBookingRef(input);
    if (!ref.token) throw new InputError("ההזמנה לא נמצאה");
    return { token: ref.token };
  })
  .handler(async ({ data }): Promise<SiteGuestBooking> => {
    await throttle("booking", 60, 10 * MINUTE);
    const { callRpc } = await import("../server/rpc.server");
    const booking = await callRpc<GuestBookingView>("get_booking_by_token", { _token: data.token });
    let arrival: GuestArrival | null = null;
    try {
      arrival = await callRpc<GuestArrival>("guest_arrival_info", { _token: data.token });
    } catch {
      arrival = null;
    }
    return { booking, arrival };
  });

export const hospitalitySiteCancellationQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const ref = parseGuestBookingRef(input);
    if (!ref.token) throw new InputError("ההזמנה לא נמצאה");
    return { token: ref.token };
  })
  .handler(async ({ data }): Promise<CancellationQuote> => {
    await throttle("cancel-quote", 30, 10 * MINUTE);
    const { callRpc } = await import("../server/rpc.server");
    return callRpc<CancellationQuote>("cancellation_quote", {
      _token: data.token,
      _booking_id: null,
    });
  });

export const hospitalitySiteRequestCancellation = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const parsed = parseRequestCancellation(input);
    if (!parsed.token) throw new InputError("ההזמנה לא נמצאה");
    return { token: parsed.token, reason: parsed.reason };
  })
  .handler(async ({ data }): Promise<GuestBookingView> => {
    await throttle("cancel", 6, 60 * MINUTE);
    const [{ callRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const view = await callRpc<GuestBookingView>("request_cancellation", {
      _token: data.token,
      _booking_id: null,
      _reason: data.reason,
    });
    kickOutbox();
    return view;
  });
