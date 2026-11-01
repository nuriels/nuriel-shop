// תהליך הרקע של Hospitality (Stage 2k) — בשרת, רק כשמתג הסביבה דולק (HOSPITALITY_ENGINE=on).
// כל 30 שניות, ומיד אחרי פעולה של הצוות (kickOutbox):
//   1. expire_holds — בקשות שלא אושרו בזמן פגות (התאריכים מתפנים; המיילים על כך נכנסים לתור);
//   2. תור המיילים — claim_notifications → מייל בעברית בשם העסק (שירות המיילים של נוריאל,
//      Idempotency-Key = מזהה ההודעה) → mark_notification. כישלון: ניסיון חוזר במרווחים
//      הולכים וגדלים (במסד), ואחרי 5 — "נכשל". מייל שנכשל לא מבטל אף פעולה;
//   3. פעם ביום — apply_retention (מחיקת פרטי אורחים ישנים לפי ההגדרה של כל עסק);
//   4. כל 5 דקות — סנכרון יומנים חיצוניים (iCal) שהגיע זמנם (channels/sync.server.ts).
// הקריאות למסד במפתח השירות — אלה פונקציות שרק השרת רשאי להריץ.
import { createServerOnlyFn } from "@tanstack/react-start";
import { escapeHtml, sendBusinessEmail } from "@/platform/email/send.server";
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { siteOrigin } from "@/platform/tenancy/current-site.server";
import { HOSPITALITY_SCHEMA, hospitalitySwitchOn } from "../config";
import { renderBookingEmail, type EmailBusiness, type EmailPayload } from "./templates";

const TICK_MS = 30_000;
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
let lastChannels = 0;
// ההורדה של יומנים חיצוניים (המוריד המוגן של הפלטפורמה) — בשרת בלבד; הקוד לא נכנס לבאנדל של הדפדפן
const runChannelSyncs = createServerOnlyFn(async () => {
  const { runDueChannelSyncs } = await import("../channels/import.server");
  await runDueChannelSyncs();
});
const CHANNELS_MS = 5 * 60 * 1000;

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
      await sendDue();
      if (Date.now() - lastRetention > DAY_MS) {
        lastRetention = Date.now();
        await rpc("apply_retention", {});
      }
      if (Date.now() - lastChannels > CHANNELS_MS) {
        lastChannels = Date.now();
        await runChannelSyncs();
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
  return {
    business: {
      name: s?.business_name?.trim() || t?.name || "העסק",
      phone: s?.contact_phone ?? null,
      email: s?.contact_email ?? null,
      address: s?.address ?? null,
      checkInTime: hhmm(s?.check_in_time),
      checkOutTime: hhmm(s?.check_out_time),
    },
    origin: t ? await siteOrigin({ slug: t.slug, domain: t.domain }) : null,
    replyTo: s?.contact_email ?? null,
  };
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
        const email = renderBookingEmail(n.event, n.recipient_kind, n.payload, {
          business: ctx.business,
          bookingUrl:
            ctx.origin && n.booking_id ? `${ctx.origin}/manage/bookings/${n.booking_id}` : null,
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
            senderName: ctx.business.name,
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
