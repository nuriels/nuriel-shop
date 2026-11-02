// האתר הציבורי של העסק (Stage 4) — לכל גולש (בלי חשבון). העסק לפי הכתובת (x-tenant-id →
// request_tenant במסד), אף פעם לא לפי הקלט.
//   • 4a: נתוני האתר (רק כשהאתר פתוח — hospitality_frontend_enabled) ולילות תפוסים;
//   • 4b: הצעת מחיר, בקשת הזמנה (רק כשההזמנות פתוחות — hospitality_booking_enabled + מנוי),
//     ההזמנה שלי בקישור המאובטח, הצעת ביטול ובקשת ביטול.
// המחיר, הזמינות והמדיניות — רק מהמסד (quote / request_booking); מניעת הזמנה כפולה — במסד
// (EXCLUDE). D1: הגבלת קצב משותפת לכל השרתים (מונה במסד — security/), ובקשת הזמנה רק אחרי
// אימות נגד בוטים (CAPTCHA — הוכחת עבודה) ושדה מלכודת; המסד מקבל בקשה רק מהשרת (מיגרציה 25).
import { createServerFn } from "@tanstack/react-start";
import type {
  BookingRequestResult,
  CancellationQuote,
  GroupRequestResult,
  GuestBookingView,
  Quote,
} from "../types/domain";
import type {
  GuestArrival,
  PublicAvailability,
  PublicRoomType,
  PublicSite,
  PublicTypeAvailability,
  RawPublicSite,
  SiteGuestBooking,
} from "../types/website";
import type { GuestPaymentInfo, PaymentMethodKey } from "../types/payment-instructions";
import type { LimitAction } from "../security/limits";
import { TRAP_FIELD } from "../security/messages";
import { parsePowSolution, type PowChallenge } from "../security/pow";
import { toPublicSite } from "../website/lib/site-map";
import {
  InputError,
  isoDate,
  parseGuestBookingRef,
  parseQuote,
  parseRequestBooking,
  parseRequestCancellation,
  parseRequestGroup,
  stay,
  uuid,
} from "../validation/input";

/** הגבלת קצב משותפת (מונה במסד) לפעולה של גולש — לפי כתובת / רשת / העסק */
async function throttle(action: LimitAction): Promise<void> {
  const [{ guardPublic }, { hospitalitySiteId }] = await Promise.all([
    import("../security/guard.server"),
    import("../server/rpc.server"),
  ]);
  await guardPublic(action, await hospitalitySiteId());
}

/** האימות נגד בוטים של בקשת הזמנה: הפתרון של האתגר ושדה המלכודת */
function botCheckInput(input: Record<string, unknown>) {
  const trap = input?.[TRAP_FIELD];
  return {
    captcha: parsePowSolution(input?.["captcha"]),
    trap: typeof trap === "string" ? trap.slice(0, 200) : "",
  };
}

const MAX_RANGE_DAYS = 120;

export const hospitalityPublicSite = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSite> => {
    await throttle("site");
    const [{ callRpc }, { publicUrl }] = await Promise.all([
      import("../server/rpc.server"),
      import("../server/media.server"),
    ]);
    const [raw, types, { currentSiteAddresses }, { canonicalOrigin, siteSeo }] = await Promise.all([
      callRpc<RawPublicSite>("public_site", {}),
      callRpc<PublicRoomType[]>("public_room_types", {}),
      import("@/platform/tenancy/current-site.server"),
      import("../website/seo"),
    ]);
    const site = toPublicSite(raw, publicUrl, types);
    // E5: הכתובת הקנונית — מרשומת האתר + הבחירה בגרסה המפורסמת
    return { ...site, origin: canonicalOrigin(await currentSiteAddresses(), siteSeo(site)) };
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
    await throttle("availability");
    const { callRpc } = await import("../server/rpc.server");
    return callRpc<PublicAvailability>("public_availability", {
      _unit_id: data.unitId,
      _from: data.from,
      _to: data.to,
    });
  });

// ---------- 4b: הזמנה מהאתר ----------

export const hospitalitySiteQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseQuote(input))
  .handler(async ({ data }): Promise<Quote> => {
    await throttle("quote");
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

/**
 * אתגר האימות נגד בוטים לטופס ההזמנה (הדפדפן פותר אותו ברקע בזמן שהאורח ממלא את הפרטים).
 * מוגבל לפי כתובת; כתובת שמבקשת הרבה אתגרים מקבלת אתגר כבד יותר.
 */
export const hospitalitySiteChallenge = createServerFn({ method: "POST" }).handler(
  async (): Promise<PowChallenge> => {
    const [{ guardChallenge }, { issuePow }, { hospitalitySiteId }] = await Promise.all([
      import("../security/guard.server"),
      import("../security/captcha.server"),
      import("../server/rpc.server"),
    ]);
    const siteId = await hospitalitySiteId();
    const { difficulty } = await guardChallenge(siteId);
    return issuePow(siteId, "request", { difficulty });
  },
);

/** הבדיקות לפני בקשת הזמנה (מלכודת, CAPTCHA, הגבלת קצב) — והפרטים של הגולש לתיעוד התנאים */
async function guardRequest(bot: ReturnType<typeof botCheckInput>) {
  const [{ guardBookingRequest }, { hospitalitySiteId }] = await Promise.all([
    import("../security/guard.server"),
    import("../server/rpc.server"),
  ]);
  return guardBookingRequest(await hospitalitySiteId(), bot);
}

export const hospitalitySiteRequestBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    ...parseRequestBooking(input),
    ...botCheckInput(input),
  }))
  .handler(async ({ data }): Promise<BookingRequestResult> => {
    const client = await guardRequest(data);
    const [{ callServerRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const result = await callServerRpc<BookingRequestResult>(
      "request_booking",
      {
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
      },
      client,
    );
    // מייל לאורח (עם קישור ניהול ההזמנה) ולעסק — מיד, בלי לחכות לסבב של ה-worker
    kickOutbox();
    return result;
  });

/** מיגרציה 44: יחידות שפנויות ופתוחות בתאריכים — להוספת חדר לאותה בקשה */
export const hospitalitySiteFreeUnits = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => stay(input?.["checkIn"], input?.["checkOut"]))
  .handler(async ({ data }): Promise<{ check_in: string; check_out: string; units: string[] }> => {
    await throttle("availability");
    const { callRpc } = await import("../server/rpc.server");
    return callRpc("public_free_units", { _check_in: data.checkIn, _check_out: data.checkOut });
  });

/**
 * מיגרציה 44: בקשה אחת לכמה חדרים — אותן בדיקות כמו לחדר אחד (מלכודת, CAPTCHA, הגבלת קצב), ואז
 * המסד: כל החדרים יחד או אף אחד, מייל אחד לאורח (קישור אישי לכל חדר) ומייל אחד לעסק
 */
export const hospitalitySiteRequestGroup = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    ...parseRequestGroup(input),
    ...botCheckInput(input),
  }))
  .handler(async ({ data }): Promise<GroupRequestResult> => {
    const client = await guardRequest(data);
    const [{ callServerRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const result = await callServerRpc<GroupRequestResult>(
      "request_booking_group",
      {
        _rooms: data.rooms.map((r) => ({
          unit_id: r.unitId,
          adults: r.adults,
          children: r.children,
          policy_hash: r.policyHash,
        })),
        _check_in: data.checkIn,
        _check_out: data.checkOut,
        _full_name: data.fullName,
        _email: data.email,
        _phone: data.phone,
        _idempotency_key: data.idempotencyKey,
        _policy_accepted: true,
        _special_requests: data.specialRequests,
        _marketing_consent: data.marketingConsent,
        _language: data.language,
      },
      client,
    );
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
    await throttle("booking");
    const { callRpc } = await import("../server/rpc.server");
    const booking = await callRpc<GuestBookingView>("get_booking_by_token", { _token: data.token });
    let arrival: GuestArrival | null = null;
    try {
      arrival = await callRpc<GuestArrival>("guest_arrival_info", { _token: data.token });
    } catch {
      arrival = null;
    }
    // מיגרציה 37: הוראות התשלום להזמנה הזו (רק אחרי אישור ועם יתרה — המסד מחליט)
    let payment: GuestPaymentInfo | null = null;
    try {
      payment = await callRpc<GuestPaymentInfo>("guest_payment_info", { _token: data.token });
    } catch {
      payment = null;
    }
    return { booking, arrival, payment };
  });

/** אילו אמצעי תשלום העסק מקבל (בלי פרטים) — לנוסח בטופס ההזמנה ואחרי השליחה */
export const hospitalitySitePaymentMethods = createServerFn({ method: "GET" }).handler(
  async (): Promise<PaymentMethodKey[]> => {
    await throttle("site");
    const { callRpc } = await import("../server/rpc.server");
    try {
      const r = await callRpc<{ methods: PaymentMethodKey[] }>("public_payment_methods", {});
      return Array.isArray(r?.methods) ? r.methods : ["phone"];
    } catch {
      // לפני מיגרציה 37 / המסד לא ענה — כמו היום: תשלום טלפוני
      return ["phone"];
    }
  },
);

export const hospitalitySiteCancellationQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const ref = parseGuestBookingRef(input);
    if (!ref.token) throw new InputError("ההזמנה לא נמצאה");
    return { token: ref.token };
  })
  .handler(async ({ data }): Promise<CancellationQuote> => {
    await throttle("cancelQuote");
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
    await throttle("cancel");
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

// ---------- RT: מכירה לפי סוג חדר (מלונות) ----------

function categoryInput(input: Record<string, unknown>) {
  const categoryId = uuid(input?.["categoryId"], "סוג החדר");
  const pref = input?.["preferredUnit"];
  return { categoryId, preferredUnit: pref ? uuid(pref, "החדר") : null };
}

export const hospitalityPublicTypeAvailability = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const categoryId = uuid(input?.["categoryId"], "סוג החדר");
    const from = isoDate(input?.["from"]);
    const to = isoDate(input?.["to"]);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days <= 0 || days > MAX_RANGE_DAYS) throw new InputError("טווח התאריכים לא תקין");
    return { categoryId, from, to };
  })
  .handler(async ({ data }): Promise<PublicTypeAvailability> => {
    await throttle("availability");
    const { callRpc } = await import("../server/rpc.server");
    return callRpc<PublicTypeAvailability>("public_type_availability", {
      _category_id: data.categoryId,
      _from: data.from,
      _to: data.to,
    });
  });

/** הצעת מחיר לסוג: החדר הראשון שפנוי לכל הלילות (unit_id בהצעה) */
export const hospitalitySiteQuoteType = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const c = categoryInput(input);
    return { ...parseQuote({ ...input, unitId: c.categoryId }), ...c };
  })
  .handler(async ({ data }): Promise<Quote & { category_id: string }> => {
    await throttle("quote");
    const { callRpc } = await import("../server/rpc.server");
    return callRpc<Quote & { category_id: string }>("quote_type", {
      _category_id: data.categoryId,
      _check_in: data.checkIn,
      _check_out: data.checkOut,
      _adults: data.adults,
      _children: data.children,
      _promo_code: data.promoCode,
      _preferred_unit: data.preferredUnit,
    });
  });

/** בקשת הזמנה לסוג: המסד בוחר חדר פנוי מהסוג באותה טרנזקציה (בלי מרוץ בין אורחים) */
export const hospitalitySiteRequestBookingType = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const c = categoryInput(input);
    return {
      ...parseRequestBooking({ ...input, unitId: c.categoryId }),
      ...c,
      ...botCheckInput(input),
    };
  })
  .handler(async ({ data }): Promise<BookingRequestResult> => {
    const client = await guardRequest(data);
    const [{ callServerRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const result = await callServerRpc<BookingRequestResult>(
      "request_booking_type",
      {
        _category_id: data.categoryId,
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
        _preferred_unit: data.preferredUnit,
      },
      client,
    );
    kickOutbox();
    return result;
  });
