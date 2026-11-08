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
import type { PackageQuote, PublicPackage } from "../types/packages";
import { parsePackageQuote, parseRequestPackage } from "../validation/packages";
import type { PublicDocument, PublicDocumentMeta } from "../types/documents";
import { parseAcceptedDocuments, parseDocumentKind } from "../validation/documents";
import type {
  GuestPaymentInfo,
  GuestPaymentMethod,
  PaymentMethodKey,
} from "../types/payment-instructions";
import {
  optionalPaymentMethod,
  parseProofUploadForm,
  parseSetPaymentMethod,
} from "../validation/proofs";
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
async function throttle(action: LimitAction): Promise<{ ip: string; userAgent: string }> {
  const [{ guardPublic }, { hospitalitySiteId }] = await Promise.all([
    import("../security/guard.server"),
    import("../server/rpc.server"),
  ]);
  return guardPublic(action, await hospitalitySiteId());
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

/**
 * מיגרציה 60: כשהטופס הציג מסמכים לאישור — הבקשה עוברת דרך העטיפה, שרושמת באותה טרנזקציה אילו גרסאות
 * האורח אישר (ודוחה גרסה ישנה). בלי מסמכים באתר — הבקשה הרגילה, כמו קודם.
 */
type Accepted = { kind: string; version: number }[];
const withDocuments = (fn: string, docs: Accepted) =>
  docs.length > 0 ? `${fn}_with_documents` : fn;
const documentsArg = (docs: Accepted) => (docs.length > 0 ? { _documents: docs } : {});

export const hospitalityPublicSite = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSite> => {
    await throttle("site");
    const [{ callRpc }, { publicUrl }] = await Promise.all([
      import("../server/rpc.server"),
      import("../server/media.server"),
    ]);
    const [
      raw,
      types,
      packages,
      documents,
      { currentSiteAddresses },
      { canonicalOrigin, siteSeo },
    ] = await Promise.all([
      callRpc<RawPublicSite>("public_site", {}),
      callRpc<PublicRoomType[]>("public_room_types", {}),
      // שלב א' 7 — בלי מיגרציה 59 (או כשהמסד לא ענה) האתר עובד כרגיל, בלי חבילות
      callRpc<PublicPackage[]>("public_packages", {}).catch(() => [] as PublicPackage[]),
      // מיגרציה 60 — המסמכים שמוצגים (לפוטר ולטופס ההזמנה); בלי המיגרציה — בלי מסמכים
      callRpc<PublicDocumentMeta[]>("public_site_documents", {}).catch(
        () => [] as PublicDocumentMeta[],
      ),
      import("@/platform/tenancy/current-site.server"),
      import("../website/seo"),
    ]);
    const site = toPublicSite(raw, publicUrl, types, packages);
    // E5: הכתובת הקנונית — מרשומת האתר + הבחירה בגרסה המפורסמת
    return {
      ...site,
      documents,
      origin: canonicalOrigin(await currentSiteAddresses(), siteSeo(site)),
    };
  },
);

/** מסמך אחד מהאתר (הגרסה שמוצגת) — לעמוד המסמך; לא פורסם / בלי מיגרציה 60 — null */
export const hospitalityPublicDocument = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseDocumentKind(input))
  .handler(async ({ data }): Promise<PublicDocument | null> => {
    await throttle("site");
    const { callRpc } = await import("../server/rpc.server");
    return callRpc<PublicDocument | null>("public_site_document", { _kind: data.kind }).catch(
      () => null,
    );
  });

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
    const client = await throttle("quote");
    // SEC-L4: דרך השרת (מפתח השירות) — המסד מקבל קוד קופון רק מכאן, אחרי הגבלת הקצב
    const { callServerRpc } = await import("../server/rpc.server");
    return callServerRpc<Quote>(
      "quote",
      {
        _unit_id: data.unitId,
        _check_in: data.checkIn,
        _check_out: data.checkOut,
        _adults: data.adults,
        _children: data.children,
        _promo_code: data.promoCode,
      },
      client,
    );
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

/**
 * שלב א' 5: אמצעי התשלום שהאורח בחר בטופס — נשמר אחרי שההזמנה נוצרה (כלל 7 הימים להעברה בנקאית נבדק
 * במסד). כשל כאן לא מפיל את ההזמנה — אפשר לבחור שוב בעמוד ההזמנה.
 */
async function applyPaymentChoice(
  tokens: (string | null | undefined)[],
  method: GuestPaymentMethod | null,
): Promise<void> {
  if (!method) return;
  const { callRpc } = await import("../server/rpc.server");
  for (const token of tokens) {
    if (!token) continue;
    try {
      await callRpc("guest_set_payment_method", {
        _token: token,
        _booking_id: null,
        _method: method,
      });
    } catch (error) {
      console.warn(
        "[hospitality] the payment method was not saved:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
}

/** האורח: לפי הקישור המאובטח (טוקן) — או חשבון מחובר שההזמנה שלו (bookingId) */
async function guestAccess(ref: { token: string | null; bookingId: string | null }) {
  if (ref.token) return { args: { _token: ref.token, _booking_id: null }, accessToken: null };
  const { requireSession } = await import("@/platform/auth/session.server");
  const session = await requireSession();
  return { args: { _token: null, _booking_id: ref.bookingId }, accessToken: session.accessToken };
}

export const hospitalitySiteRequestBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    ...parseRequestBooking(input),
    ...botCheckInput(input),
    paymentMethod: optionalPaymentMethod(input?.["paymentMethod"]),
    documents: parseAcceptedDocuments(input?.["documents"]),
  }))
  .handler(async ({ data }): Promise<BookingRequestResult> => {
    const client = await guardRequest(data);
    const [{ callServerRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const result = await callServerRpc<BookingRequestResult>(
      withDocuments("request_booking", data.documents),
      {
        ...documentsArg(data.documents),
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
    await applyPaymentChoice([result.manage_token], data.paymentMethod);
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
    paymentMethod: optionalPaymentMethod(input?.["paymentMethod"]),
    documents: parseAcceptedDocuments(input?.["documents"]),
  }))
  .handler(async ({ data }): Promise<GroupRequestResult> => {
    const client = await guardRequest(data);
    const [{ callServerRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const result = await callServerRpc<GroupRequestResult>(
      withDocuments("request_booking_group", data.documents),
      {
        ...documentsArg(data.documents),
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
    await applyPaymentChoice(
      (result.bookings ?? []).map((b) => b.manage_token),
      data.paymentMethod,
    );
    kickOutbox();
    return result;
  });

// ---------- שלב א' 7: חבילות (מיגרציה 59) ----------

/** הצעת מחיר לחבילה: מחיר החבילה ומספר הלילות שלה, התפוסה והתנאים של היחידה — רק מהמסד */
export const hospitalitySitePackageQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parsePackageQuote(input))
  .handler(async ({ data }): Promise<PackageQuote> => {
    const client = await throttle("quote");
    const { callServerRpc } = await import("../server/rpc.server");
    return callServerRpc<PackageQuote>(
      "package_quote",
      {
        _package_id: data.packageId,
        _check_in: data.checkIn,
        _adults: data.adults,
        _children: data.children,
      },
      client,
    );
  });

/**
 * בקשת הזמנה לחבילה — אותן בדיקות כמו לחדר אחד (מלכודת, CAPTCHA, הגבלת קצב), ואז המסד: הזמנה על
 * היחידה של החבילה (אותה תפוסה — בלי הזמנה כפולה), במחיר החבילה ובתנאים שהאורח אישר
 */
export const hospitalitySiteRequestPackage = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    ...parseRequestPackage(input),
    ...botCheckInput(input),
    paymentMethod: optionalPaymentMethod(input?.["paymentMethod"]),
    documents: parseAcceptedDocuments(input?.["documents"]),
  }))
  .handler(async ({ data }): Promise<BookingRequestResult> => {
    const client = await guardRequest(data);
    const [{ callServerRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const result = await callServerRpc<BookingRequestResult>(
      withDocuments("request_booking_package", data.documents),
      {
        ...documentsArg(data.documents),
        _package_id: data.packageId,
        _check_in: data.checkIn,
        _full_name: data.fullName,
        _email: data.email,
        _phone: data.phone,
        _idempotency_key: data.idempotencyKey,
        _policy_accepted: true,
        _policy_hash: data.policyHash,
        _adults: data.adults,
        _children: data.children,
        _special_requests: data.specialRequests,
        _marketing_consent: data.marketingConsent,
        _language: data.language,
      },
      client,
    );
    await applyPaymentChoice([result.manage_token], data.paymentMethod);
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

/**
 * אילו אמצעי תשלום העסק מקבל (בלי פרטים) — לנוסח בטופס ההזמנה ואחרי השליחה. שלב א' 5: עם תאריך
 * ההגעה — העברה בנקאית רק כשההגעה לפחות 7 ימים מהיום (המסד מחליט); בלי תאריך — בלי העברה.
 */
export const hospitalitySitePaymentMethods = createServerFn({ method: "GET" })
  .inputValidator((input?: Record<string, unknown>) => ({
    checkIn: input?.["checkIn"] ? isoDate(input["checkIn"], "תאריך ההגעה") : null,
  }))
  .handler(async ({ data }): Promise<PaymentMethodKey[]> => {
    await throttle("site");
    const { callRpc } = await import("../server/rpc.server");
    try {
      const r = await callRpc<{ methods: PaymentMethodKey[] }>(
        "public_payment_methods",
        data.checkIn ? { _check_in: data.checkIn } : {},
      );
      return Array.isArray(r?.methods) ? r.methods : ["phone"];
    } catch {
      // לפני מיגרציה 37 / המסד לא ענה — כמו היום: תשלום טלפוני
      return ["phone"];
    }
  });

/** שלב א' 5: האורח בוחר / משנה אמצעי תשלום (בעמוד ההזמנה) — כלל 7 הימים נבדק במסד */
export const hospitalitySiteSetPaymentMethod = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSetPaymentMethod(input))
  .handler(async ({ data }): Promise<GuestPaymentInfo> => {
    await throttle("booking");
    const { callRpc } = await import("../server/rpc.server");
    const access = await guestAccess(data);
    return callRpc<GuestPaymentInfo>(
      "guest_set_payment_method",
      { ...access.args, _method: data.method },
      { accessToken: access.accessToken },
    );
  });

/**
 * שלב א' 5: העלאת אישור העברה — הקובץ נבדק לפי התוכן (תמונה / PDF בלי תוכן פעיל, עד 5MB), המסד רושם
 * מקום לקובץ רק להזמנה של האורח (קישור מאובטח / חשבון מחובר), השרת מעלה לדלי הפרטי ומסמן "התקבל".
 * המצב נשמר בשרת — רענון, סגירת הדפדפן או חזרה מאוחרת מציגים אותו שוב.
 */
export const hospitalitySiteUploadProof = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => parseProofUploadForm(data))
  .handler(async ({ data }): Promise<GuestPaymentInfo> => {
    const client = await throttle("proofUpload");
    const [{ callRpc, callServerRpc }, proofs] = await Promise.all([
      import("../server/rpc.server"),
      import("../server/proofs.server"),
    ]);
    const access = await guestAccess(data);
    const prepared = await proofs.prepareProofFile(data.file);
    const slot = await callRpc<{ id: string; path: string }>(
      "guest_proof_slot",
      { ...access.args, _file_name: prepared.name, _mime: prepared.mime, _size: prepared.size },
      { accessToken: access.accessToken },
    );
    await proofs.uploadProof(slot.path, prepared);
    await callServerRpc<boolean>("guest_proof_ready", { _proof_id: slot.id }, client);
    return callRpc<GuestPaymentInfo>("guest_payment_info", access.args, {
      accessToken: access.accessToken,
    });
  });

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
    const client = await throttle("quote");
    // SEC-L4: דרך השרת (מפתח השירות) — המסד מקבל קוד קופון רק מכאן, אחרי הגבלת הקצב
    const { callServerRpc } = await import("../server/rpc.server");
    return callServerRpc<Quote & { category_id: string }>(
      "quote_type",
      {
        _category_id: data.categoryId,
        _check_in: data.checkIn,
        _check_out: data.checkOut,
        _adults: data.adults,
        _children: data.children,
        _promo_code: data.promoCode,
        _preferred_unit: data.preferredUnit,
      },
      client,
    );
  });

/** בקשת הזמנה לסוג: המסד בוחר חדר פנוי מהסוג באותה טרנזקציה (בלי מרוץ בין אורחים) */
export const hospitalitySiteRequestBookingType = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const c = categoryInput(input);
    return {
      ...parseRequestBooking({ ...input, unitId: c.categoryId }),
      ...c,
      ...botCheckInput(input),
      paymentMethod: optionalPaymentMethod(input?.["paymentMethod"]),
      documents: parseAcceptedDocuments(input?.["documents"]),
    };
  })
  .handler(async ({ data }): Promise<BookingRequestResult> => {
    const client = await guardRequest(data);
    const [{ callServerRpc }, { kickOutbox }] = await Promise.all([
      import("../server/rpc.server"),
      import("../outbox/worker.server"),
    ]);
    const result = await callServerRpc<BookingRequestResult>(
      withDocuments("request_booking_type", data.documents),
      {
        ...documentsArg(data.documents),
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
    await applyPaymentChoice([result.manage_token], data.paymentMethod);
    kickOutbox();
    return result;
  });
