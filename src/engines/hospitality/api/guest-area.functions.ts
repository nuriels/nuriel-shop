// שלב א' 2: "ההזמנות שלי" — האזור האישי של האורח באתר: כניסה בקוד חד-פעמי למייל, ההזמנות שלו באתר
// הזה, פרטי הזמנה, תשלום והעלאת אישור העברה.
//   • החיבור — טוקן אקראי (256 ביט) בעוגייה HttpOnly של האתר; במסד רק ה-SHA-256 שלו (מיגרציה 56).
//   • ההרשאה במסד: רק הזמנות באתר הזה שהאימייל שלהן הוא הכתובת שהוכחה בקוד. בלי שיוך לחשבונות המערכת.
//   • בקשת קוד — תשובה זהה תמיד; מייל נשלח רק כשיש באתר הזמנה עם הכתובת (בלי חשיפה מי הזמין).
import { createServerFn } from "@tanstack/react-start";
import type { GuestDocument } from "../types/contracts";
import type { GuestAreaBooking, GuestAreaDetail, GuestAreaList } from "../types/guest-area";
import type { GuestPaymentInfo } from "../types/payment-instructions";
import type { LimitAction } from "../security/limits";
import {
  maskGuestEmail,
  parseGuestAreaBooking,
  parseGuestAreaCode,
  parseGuestAreaEmail,
  parseGuestAreaMethod,
  parseGuestAreaUpload,
} from "../validation/guest-area";
import { uuid as uuidOf } from "../validation/input";

const COOKIE = "hosp_guest";
const MAX_AGE_SECONDS = 14 * 86_400;
/** קוד השגיאה של המסד כשהחיבור לא בתוקף (invalid_authorization_specification) */
const SIGNED_OUT_CODE = "28000";

async function throttle(action: LimitAction): Promise<{ ip: string; userAgent: string }> {
  const [{ guardPublic }, { hospitalitySiteId }] = await Promise.all([
    import("../security/guard.server"),
    import("../server/rpc.server"),
  ]);
  return guardPublic(action, await hospitalitySiteId());
}

async function sha256Hex(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

/** ה-hash של החיבור מהעוגייה (null — אין חיבור) */
async function sessionHash(): Promise<string | null> {
  const { getCookie } = await import("@tanstack/react-start/server");
  const token = getCookie(COOKIE);
  return token && /^[0-9a-f]{64}$/.test(token) ? sha256Hex(token) : null;
}

/** Secure בכל אתר אמיתי (HTTPS); בלי — רק בכתובות מקומיות (בדיקות) */
async function cookieSecure(): Promise<boolean> {
  const { getRequestHost } = await import("@tanstack/react-start/server");
  const host = (getRequestHost({ xForwardedHost: true }) ?? "").split(":")[0]!.toLowerCase();
  return !(host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1");
}

async function clearSession(): Promise<void> {
  const { deleteCookie } = await import("@tanstack/react-start/server");
  deleteCookie(COOKIE, { path: "/" });
}

/** קריאה לפונקציה של האזור עם החיבור; חיבור שפג / בוטל → "signed_out" (והעוגייה נמחקת) */
async function withSession<T>(
  action: LimitAction,
  run: (hash: string, client: { ip: string; userAgent: string }) => Promise<T>,
): Promise<T | { state: "signed_out" }> {
  const client = await throttle(action);
  const hash = await sessionHash();
  if (!hash) return { state: "signed_out" };
  try {
    return await run(hash, client);
  } catch (error) {
    const { HospitalityError } = await import("../server/rpc.server");
    if (error instanceof HospitalityError && error.code === SIGNED_OUT_CODE) {
      await clearSession();
      return { state: "signed_out" };
    }
    throw error;
  }
}

export const hospitalityGuestAreaRequestCode = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestAreaEmail(input))
  .handler(async ({ data }): Promise<{ sent: true; maskedEmail: string; minutes: number }> => {
    const client = await throttle("guestCode");
    const [
      { randomInt },
      { hmac },
      rpc,
      { escapeHtml, sendBusinessEmail },
      { guestCodeEmail, GUEST_CODE_MINUTES },
    ] = await Promise.all([
      import("node:crypto"),
      import("../security/secret.server"),
      import("../server/rpc.server"),
      import("@/platform/email/send.server"),
      import("../outbox/guest-code"),
    ]);
    const siteId = await rpc.hospitalitySiteId();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = await hmac("guest-area-code", `${siteId}:${data.email}:${code}`);
    const issued = await rpc.callServerRpc<{ send: boolean }>(
      "guest_code_issue",
      { _email: data.email, _code_hash: codeHash },
      client,
    );
    if (issued?.send) {
      let name = "האתר";
      try {
        name = (await rpc.callRpc<{ name?: string } | null>("site_identity", {}))?.name || name;
      } catch {
        // השם — רק לנוסח המייל
      }
      const { subject, html } = guestCodeEmail(code, name, escapeHtml);
      const sent = await sendBusinessEmail({
        to: data.email,
        subject,
        html,
        senderName: name,
        replyTo: null,
        idempotencyKey: `hosp-guest-code-${codeHash.slice(0, 24)}`,
      });
      // התשובה לגולש זהה גם כשהשליחה נכשלה — כדי שלא תגלה שיש באתר הזמנה עם הכתובת
      if (!sent.sent && !sent.skipped)
        console.error("[hospitality/guest-area] code email failed", sent.reason);
    }
    return { sent: true, maskedEmail: maskGuestEmail(data.email), minutes: GUEST_CODE_MINUTES };
  });

type ConsumeResult =
  { result: "ok" | "none" | "expired" | "locked" } | { result: "invalid"; left: number };

export const hospitalityGuestAreaVerifyCode = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestAreaCode(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const client = await throttle("guestVerify");
    const [{ randomBytes }, { hmac }, rpc, { InputError }, server] = await Promise.all([
      import("node:crypto"),
      import("../security/secret.server"),
      import("../server/rpc.server"),
      import("../validation/input"),
      import("@tanstack/react-start/server"),
    ]);
    const siteId = await rpc.hospitalitySiteId();
    const token = randomBytes(32).toString("hex");
    const r = await rpc.callServerRpc<ConsumeResult>(
      "guest_code_consume",
      {
        _email: data.email,
        _code_hash: await hmac("guest-area-code", `${siteId}:${data.email}:${data.code}`),
        _session_hash: await sha256Hex(token),
      },
      client,
    );
    switch (r.result) {
      case "ok":
        server.setCookie(COOKIE, token, {
          httpOnly: true,
          secure: await cookieSecure(),
          sameSite: "lax",
          path: "/",
          maxAge: MAX_AGE_SECONDS,
        });
        return { ok: true };
      case "none":
        throw new InputError("אין קוד פעיל לכתובת הזו. בקשו קוד חדש.");
      case "expired":
        throw new InputError("תוקף הקוד פג. בקשו קוד חדש.");
      case "locked":
        throw new InputError("יותר מדי ניסיונות שגויים — הקוד בוטל. בקשו קוד חדש.");
      case "invalid":
        throw new InputError(
          r.left === 1 ? "הקוד שגוי. נותר ניסיון אחד." : `הקוד שגוי. נותרו ${r.left} ניסיונות.`,
        );
    }
  });

export const hospitalityGuestAreaBookings = createServerFn({ method: "POST" }).handler(
  async (): Promise<GuestAreaList> =>
    withSession("booking", async (hash, client) => {
      const { callServerRpc } = await import("../server/rpc.server");
      const r = await callServerRpc<{ email: string; bookings: GuestAreaBooking[] | null }>(
        "guest_area_bookings",
        { _session_hash: hash },
        client,
      );
      return { state: "signed_in" as const, email: r.email, bookings: r.bookings ?? [] };
    }),
);

export const hospitalityGuestAreaBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestAreaBooking(input))
  .handler(async ({ data }): Promise<GuestAreaDetail> =>
    withSession("booking", async (hash, client) => {
      const { callServerRpc } = await import("../server/rpc.server");
      const r = await callServerRpc<
        Omit<Extract<GuestAreaDetail, { state: "signed_in" }>, "state">
      >("guest_area_booking", { _session_hash: hash, _booking_id: data.bookingId }, client);
      return { state: "signed_in" as const, ...r };
    }),
  );

export const hospitalityGuestAreaSetPaymentMethod = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestAreaMethod(input))
  .handler(async ({ data }): Promise<GuestPaymentInfo | { state: "signed_out" }> =>
    withSession("booking", async (hash, client) => {
      const { callServerRpc } = await import("../server/rpc.server");
      return callServerRpc<GuestPaymentInfo>(
        "guest_area_set_payment_method",
        { _session_hash: hash, _booking_id: data.bookingId, _method: data.method },
        client,
      );
    }),
  );

/** העלאת אישור העברה מהאזור האישי — אותה בדיקת קובץ ואותו דלי פרטי כמו בקישור האישי */
export const hospitalityGuestAreaUploadProof = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => parseGuestAreaUpload(data))
  .handler(async ({ data }): Promise<GuestPaymentInfo | { state: "signed_out" }> =>
    withSession("proofUpload", async (hash, client) => {
      const [{ callServerRpc }, proofs] = await Promise.all([
        import("../server/rpc.server"),
        import("../server/proofs.server"),
      ]);
      const prepared = await proofs.prepareProofFile(data.file);
      const slot = await callServerRpc<{ id: string; path: string }>(
        "guest_area_proof_slot",
        {
          _session_hash: hash,
          _booking_id: data.bookingId,
          _file_name: prepared.name,
          _mime: prepared.mime,
          _size: prepared.size,
        },
        client,
      );
      await proofs.uploadProof(slot.path, prepared);
      await callServerRpc<boolean>("guest_proof_ready", { _proof_id: slot.id }, client);
      const r = await callServerRpc<{ payment: GuestPaymentInfo }>(
        "guest_area_booking",
        { _session_hash: hash, _booking_id: data.bookingId },
        client,
      );
      return r.payment;
    }),
  );

export const hospitalityGuestAreaSignOut = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const client = await throttle("booking");
    const hash = await sessionHash();
    if (hash) {
      const { callServerRpc } = await import("../server/rpc.server");
      try {
        await callServerRpc<boolean>("guest_area_sign_out", { _session_hash: hash }, client);
      } catch (error) {
        console.error("[hospitality/guest-area] sign out failed", error);
      }
    }
    await clearSession();
    return { ok: true };
  },
);

// ---------- מיגרציה 64: "המסמכים שלי" — החוזים החתומים של הכתובת המחוברת, באתר הזה ----------

export const hospitalityGuestDocuments = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ state: "signed_in"; documents: GuestDocument[] } | { state: "signed_out" }> =>
    withSession("guestDocuments", async (hash, client) => {
      const { callServerRpc } = await import("../server/rpc.server");
      const documents = await callServerRpc<GuestDocument[] | null>(
        "guest_area_documents",
        { _session_hash: hash },
        client,
      );
      return { state: "signed_in" as const, documents: documents ?? [] };
    }),
);

/** הורדה: קישור חתום ל-60 שניות — רק למסמך של הכתובת המחוברת (נבדק ונרשם במסד) */
export const hospitalityGuestDocumentFile = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    id: uuidOf((input ?? {})["id"]),
  }))
  .handler(async ({ data }): Promise<{ state: "ok"; url: string } | { state: "signed_out" }> =>
    withSession("guestDocuments", async (hash, client) => {
      const [{ callServerRpc }, { contractFileUrl }] = await Promise.all([
        import("../server/rpc.server"),
        import("../server/contracts.server"),
      ]);
      const f = await callServerRpc<{ path: string; number: number }>(
        "guest_area_document_file",
        { _session_hash: hash, _id: data.id },
        client,
      );
      return { state: "ok" as const, url: await contractFileUrl(f.path, f.number, true) };
    }),
  );
