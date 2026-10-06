import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  EXPIRED_PAGE,
  FORBIDDEN_PAGE,
  renderBlockedPageHtml,
  SUSPENDED_ALLOWED_PATHS,
  SUSPENDED_PAGE,
} from "./lib/blocked-pages";
import {
  isPlatformRequest,
  isUnknownStoreHost,
  maybeCurrentTenant,
  requestHost,
  resolveTenant,
  runWithTenant,
  storeLockReason,
} from "./integrations/supabase/tenant.server";

// SSR: לקוח ה-Supabase המשותף (client.ts) שולח את החנות של הבקשה הנוכחית
(globalThis as typeof globalThis & { __requestTenantId?: () => string | null }).__requestTenantId =
  () => maybeCurrentTenant()?.id ?? null;

// קבצים סטטיים (assets, favicon...) לא צריכים זיהוי חנות — כך גם ה-healthcheck
// לא תלוי במסד. חוץ מ-robots.txt / sitemap.xml / zap.xml (חלק 14): הם נוצרים
// לכל חנות מהמסד (src/lib/feeds.server.ts).
const STATIC_PATH = /^\/assets\/|\.[a-z0-9]{2,5}$/i;
const FEED_PATHS = new Set(["/robots.txt", "/sitemap.xml", "/zap.xml"]);
// חלק 24: האייקונים ותמונת השיתוף (/pwa/…) נוצרים לפי החנות — לא קובץ סטטי בלי חנות
const STORE_ASSET_PATH = /^\/pwa\//;
// חלק 16: לכאן Hyp מחזיר את הלקוח אחרי התשלום (מוגדר במסוף כדף הצלחה וכישלון).
// מטופל לפני נעילת החנות — חידוש מנוי של חנות שפג תוקפה חייב לעבור.
const HYP_RETURN_PATH = "/payments/hyp/return";
// חלק 16ב: הודעת שרת-לשרת מ-Hyp אחרי תשלום (Webhook / IPN) — מוגדרת במסוף.
// גם היא לפני נעילת החנות, ובלי SSR (תשובת טקסט קצרה ל-Hyp).
const HYP_WEBHOOK_PATH = "/api/webhooks/hyp";

// הזמנות שלא שולמו תוך 30 דקות מבוטלות (המלאי חוזר) — בדיקה כל 5 דקות
void import("./server/services/payments").then((m) => m.startPaymentExpiryJob());

const STORE_NOT_FOUND_HTML = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" /><title>החנות לא נמצאה</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>body{font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem;background:#fafafa;color:#111}</style>
</head><body><div><h1>החנות לא נמצאה</h1><p>הכתובת הזו לא משויכת לאף חנות במערכת.</p></div></body></html>`;

const blocked = (html: string) =>
  new Response(html, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * חסימות לפי חנות, לפני שהאפליקציה בכלל נטענת (טעינה ראשונה של עמוד).
 * בניווט פנימי בדפדפן אותה לוגיקה רצה ב-beforeLoad של ה-root route.
 */
function storeGate(pathname: string): Response | null {
  if (isPlatformRequest()) return null;
  // פאנל הפלטפורמה לא קיים בדומיין של חנות — גם אם מקלידים את הכתובת ידנית
  if (/^\/platform(\/|$)/.test(pathname)) {
    return blocked(renderBlockedPageHtml(FORBIDDEN_PAGE, [{ href: "/", label: "לדף הבית" }]));
  }
  // חנות מוקפאת / שהמנוי שלה פג (חלק 13): הלקוחות רואים נעילה; פאנל הניהול
  // של החנות, ההתחברות ופונקציות השרת (שהפאנל צריך) ממשיכים לעבוד — ובפאנל
  // עצמו, כשהמנוי פג, פתוחים רק "המנוי שלי" ו"תמיכה ועזרה"
  const lock = storeLockReason();
  if (lock && !SUSPENDED_ALLOWED_PATHS.test(pathname) && !pathname.startsWith("/_serverFn")) {
    return blocked(
      renderBlockedPageHtml(lock === "expired" ? EXPIRED_PAGE : SUSPENDED_PAGE, [
        { href: lock === "expired" ? "/admin?tab=billing" : "/admin", label: "כניסה לפאנל הניהול" },
      ]),
    );
  }
  return null;
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

async function handle(request: Request, env: unknown, ctx: unknown): Promise<Response> {
  const handler = await getServerEntry();
  const response = await handler.fetch(request, env, ctx);
  return await normalizeCatastrophicSsrResponse(response);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const host = requestHost(request);
      const pathname = new URL(request.url).pathname;
      if (
        STATIC_PATH.test(pathname) &&
        !FEED_PATHS.has(pathname) &&
        !STORE_ASSET_PATH.test(pathname)
      ) {
        return await runWithTenant(host, null, () => handle(request, env, ctx));
      }
      const tenant = await resolveTenant(host);
      if (!tenant || isUnknownStoreHost(host, tenant)) {
        return new Response(STORE_NOT_FOUND_HTML, {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === HYP_RETURN_PATH) {
        const { handleHypReturn } = await import("./server/services/payments");
        const { requestOrigin } = await import("./lib/feeds.server");
        return await runWithTenant(host, tenant, () =>
          handleHypReturn(request, requestOrigin(request)),
        );
      }
      if (pathname === HYP_WEBHOOK_PATH) {
        const { handleHypWebhook } = await import("./server/services/payments");
        return await runWithTenant(host, tenant, () => handleHypWebhook(request));
      }
      if (FEED_PATHS.has(pathname)) {
        const { renderFeed } = await import("./lib/feeds.server");
        return await runWithTenant(host, tenant, () => renderFeed(pathname, request));
      }
      return await runWithTenant(
        host,
        tenant,
        () => storeGate(pathname) ?? handle(request, env, ctx),
      );
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
