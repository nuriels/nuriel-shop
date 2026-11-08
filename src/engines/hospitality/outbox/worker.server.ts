// תהליך הרקע של Hospitality (Stage 2k) — בשרת, רק כשמתג הסביבה דולק (HOSPITALITY_ENGINE=on).
// כל 30 שניות, ומיד אחרי פעולה של הצוות (kickOutbox):
//   1. expire_holds — בקשות שלא אושרו בזמן פגות (התאריכים מתפנים; המיילים על כך נכנסים לתור);
//   2. תור המיילים — claim_notifications → מייל בעברית בשם העסק (שירות המיילים של נוריאל,
//      Idempotency-Key = מזהה ההודעה) → mark_notification. כישלון: ניסיון חוזר במרווחים
//      הולכים וגדלים (במסד), ואחרי 5 — "נכשל". מייל שנכשל לא מבטל אף פעולה;
//   3. פעם ביום — apply_retention (מחיקת פרטי אורחים ישנים לפי ההגדרה של כל עסק);
//   4. כל 5 דקות — סנכרון יומנים חיצוניים (iCal) שהגיע זמנם (channels/import.server.ts);
//   5. כל 10 דקות — ניקוי מוני הגבלת הקצב שפג תוקפם (rate_sweep, מיגרציה 25);
//   6. כל 2 דקות (והסבב הראשון אחרי ההפעלה) — מדידת האורך של סרטונים שעוד לא נמדדו (מיגרציה 62:
//      סרטונים ישנים; סרטון הפתיח מוצג רק אחרי שנמדד ונמצא עד 15 שניות);
//   7. כל 2 דקות — חוזים שנחתמו ועוד לא הושלמו (מיגרציה 64): ה-PDF החתום לדלי הפרטי והעותק ללקוח,
//      כשמשהו נכשל מיד אחרי החתימה.
// הקריאות למסד במפתח השירות — אלה פונקציות שרק השרת רשאי להריץ.
import { createServerOnlyFn } from "@tanstack/react-start";
import { escapeHtml, sendBusinessEmail } from "@/platform/email/send.server";
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { siteOrigin } from "@/platform/tenancy/current-site.server";
import { HOSPITALITY_SCHEMA, hospitalitySwitchOn } from "../config";
import { renderBookingEmail, type EmailBusiness, type EmailPayload } from "./templates";

const TICK_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Notification {
  id: string;
  tenant_id: string;
  booking_id: string | null;
  event: string;
  recipient_kind: "guest" | "owner";
  recipient_email: string;
  payload: EmailPayload;
}

let started = false;
let running = false;
let again = false;
let lastRetention = 0;
// מיגרציה 43: תזכורת לפתיחת תאריכים — פעם ביום (המסד שולח לכל היותר מייל בשבוע לכל כתובת)
let lastOpenDates = 0;
let lastChannels = 0;
let lastSweep = 0;
const SWEEP_MS = 10 * 60 * 1000;
// ההורדה של יומנים חיצוניים (המוריד המוגן של הפלטפורמה) — בשרת בלבד; הקוד לא נכנס לבאנדל של הדפדפן
const runChannelSyncs = createServerOnlyFn(async () => {
  const { runDueChannelSyncs } = await import("../channels/import.server");
  await runDueChannelSyncs();
});
const CHANNELS_MS = 5 * 60 * 1000;
// מיגרציה 62: האורך של סרטונים ישנים — ההורדה והקריאה בשרת בלבד
let lastVideoCheck = 0;
const VIDEO_CHECK_MS = 2 * 60 * 1000;
const runVideoChecks = createServerOnlyFn(async () => {
  const { checkPendingVideos } = await import("../server/video-check.server");
  await checkPendingVideos();
});

// מיגרציה 64: השלמת חוזים חתומים (PDF + עותק במייל) — בשרת בלבד
let lastContracts = 0;
const CONTRACTS_MS = 2 * 60 * 1000;
const runContractWork = createServerOnlyFn(async () => {
  const { runContractPendingWork } = await import("../server/contracts.server");
  await runContractPendingWork();
});

export function startOutboxWorker(): void {
  if (started || !hospitalitySwitchOn()) return;
  started = true;
  setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), TICK_MS);
  (timer as { unref?: () => void }).unref?.();
}

/** אחרי פעולה של הצוות — לשלוח עכשיו, בלי לחכות לסבב הבא */
export function kickOutbox(): void {
  if (!started) return;
  void tick();
}

async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  schema = HOSPITALITY_SCHEMA,
): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "Content-Profile": schema, "Accept-Profile": schema },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function select<T>(table: string, query: string, schema: string): Promise<T[]> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${table}?${query}`, {
    headers: { ...serviceHeaders(), "Accept-Profile": schema },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status}`);
  return (await res.json()) as T[];
}

async function tick(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await rpc("expire_holds", { _limit: 200 });
      if (Date.now() - lastOpenDates > DAY_MS) {
        lastOpenDates = Date.now();
        // בנפרד: תקלה כאן לא עוצרת את שליחת המיילים ואת שאר הסבב
        await rpc("open_dates_remind", {}).catch((error: unknown) =>
          console.error(
            "[hospitality/worker] open_dates_remind",
            error instanceof Error ? error.message : error,
          ),
        );
      }
      await sendDue();
      if (Date.now() - lastRetention > DAY_MS) {
        lastRetention = Date.now();
        await rpc("apply_retention", {});
      }
      if (Date.now() - lastChannels > CHANNELS_MS) {
        lastChannels = Date.now();
        await runChannelSyncs();
      }
      if (Date.now() - lastSweep > SWEEP_MS) {
        lastSweep = Date.now();
        await rpc("rate_sweep", {});
      }
      if (Date.now() - lastVideoCheck > VIDEO_CHECK_MS) {
        lastVideoCheck = Date.now();
        // בנפרד: תקלה כאן לא עוצרת את שאר הסבב
        await runVideoChecks().catch((error: unknown) =>
          console.error(
            "[hospitality/worker] video check",
            error instanceof Error ? error.message : error,
          ),
        );
      }
      if (Date.now() - lastContracts > CONTRACTS_MS) {
        lastContracts = Date.now();
        await runContractWork().catch((error: unknown) =>
          console.error(
            "[hospitality/worker] contracts",
            error instanceof Error ? error.message : error,
          ),
        );
      }
    } while (again);
  } catch (error) {
    console.error("[hospitality/worker]", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

interface SiteContext {
  business: EmailBusiness;
  origin: string | null;
  replyTo: string | null;
}

async function siteContext(tenantId: string): Promise<SiteContext> {
  const [settings, tenants] = await Promise.all([
    select<{
      business_name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      address: string | null;
      check_in_time: string | null;
      check_out_time: string | null;
    }>(
      "settings",
      `tenant_id=eq.${tenantId}&select=business_name,contact_email,contact_phone,address,check_in_time,check_out_time`,
      HOSPITALITY_SCHEMA,
    ),
    select<{ slug: string; domain: string | null; name: string }>(
      "tenants",
      `id=eq.${tenantId}&select=slug,domain,name`,
      "public",
    ),
  ]);
  const s = settings[0];
  const t = tenants[0];
  const hhmm = (v: string | null | undefined) => (v ? v.slice(0, 5) : null);
  // מיגרציה 37: אילו אמצעי תשלום העסק מקבל (לנוסח המייל, בלי פרטים). לפני המיגרציה — טלפון, כמו היום
  let paymentMethods: string[] = ["phone"];
  try {
    const m = await rpc<string[] | null>("email_payment_methods", { _tenant_id: tenantId });
    if (Array.isArray(m)) paymentMethods = m;
  } catch {
    paymentMethods = ["phone"];
  }
  return {
    business: {
      name: s?.business_name?.trim() || t?.name || "העסק",
      phone: s?.contact_phone ?? null,
      email: s?.contact_email ?? null,
      address: s?.address ?? null,
      checkInTime: hhmm(s?.check_in_time),
      checkOutTime: hhmm(s?.check_out_time),
      paymentMethods,
    },
    origin: t ? await siteOrigin({ slug: t.slug, domain: t.domain }) : null,
    replyTo: s?.contact_email ?? null,
  };
}

/**
 * שלב א' 5 (מיגרציה 55): העברה בנקאית רק כשההגעה לפחות 7 ימים אחרי מועד ההזמנה — המייל לאורח מזכיר
 * רק את מה שזמין בהזמנה שלו (כמו עמוד ההזמנה). בשגיאה — בלי העברה (לא מציעים מה שאולי לא זמין).
 */
async function bookingPaymentMethods(bookingId: string, all: string[]): Promise<string[]> {
  try {
    const m = await rpc<string[] | null>("email_booking_payment_methods", {
      _booking_id: bookingId,
    });
    if (Array.isArray(m)) return m;
  } catch {
    // ממשיכים בלי העברה בנקאית
  }
  return all.filter((x) => x !== "bank");
}

async function sendDue(): Promise<void> {
  const sites = new Map<string, Promise<SiteContext>>();
  for (let round = 0; round < 10; round++) {
    const batch = await rpc<Notification[]>("claim_notifications", { _batch: BATCH });
    if (!batch?.length) return;
    for (const n of batch) {
      let ok = false;
      let error: string | null = null;
      let messageId: string | null = null;
      try {
        if (!sites.has(n.tenant_id)) sites.set(n.tenant_id, siteContext(n.tenant_id));
        const ctx = await sites.get(n.tenant_id)!;
        const business =
          n.recipient_kind === "guest" &&
          n.booking_id &&
          ctx.business.paymentMethods?.includes("bank")
            ? {
                ...ctx.business,
                paymentMethods: await bookingPaymentMethods(
                  n.booking_id,
                  ctx.business.paymentMethods,
                ),
              }
            : ctx.business;
        const email = renderBookingEmail(n.event, n.recipient_kind, n.payload, {
          business,
          // לעסק: ההזמנה; התנגשות ביומן חיצוני (D3) — מסך הערוצים; תזכורת לפתיחת תאריכים (43) —
          // היומן; תשובה מהתמיכה (E4) — הפנייה
          bookingUrl: !ctx.origin
            ? null
            : n.booking_id
              ? `${ctx.origin}/manage/bookings/${n.booking_id}`
              : n.event === "channel_conflict"
                ? `${ctx.origin}/manage/channels`
                : n.event === "open_dates_reminder"
                  ? `${ctx.origin}/manage/calendar?open=1`
                  : n.event === "support_reply" && UUID.test(String(n.payload["ticket_id"] ?? ""))
                    ? `${ctx.origin}/manage/support/${String(n.payload["ticket_id"])}`
                    : null,
          siteOrigin: ctx.origin,
          escape: escapeHtml,
        });
        if (!email) {
          error = `אירוע לא מוכר: ${n.event}`;
        } else {
          const r = await sendBusinessEmail({
            to: n.recipient_email,
            subject: email.subject,
            html: email.html,
            senderName: email.sender ?? ctx.business.name,
            // לאורח — המענה מגיע לעסק; לעסק — בלי כתובת מענה
            replyTo: n.recipient_kind === "guest" ? ctx.replyTo : null,
            idempotencyKey: `hosp-${n.id}`,
          });
          ok = r.sent;
          messageId = r.id;
          if (!r.sent) error = r.reason ?? "השליחה נכשלה";
        }
      } catch (e) {
        error = e instanceof Error ? e.message : "השליחה נכשלה";
      }
      await rpc("mark_notification", {
        _id: n.id,
        _ok: ok,
        _error: ok ? null : (error ?? "השליחה נכשלה").slice(0, 900),
        _provider_message_id: messageId,
      });
    }
    if (batch.length < BATCH) return;
  }
}
