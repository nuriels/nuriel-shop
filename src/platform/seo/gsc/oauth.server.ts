/**
 * NURIEL AI SEO ENGINE — connecting Google Search Console, by the business owner's own consent.
 *
 * Google needs ONE registered redirect URI, so the flow runs through the platform host
 * (GSC_OAUTH_REDIRECT_HOST, else PLATFORM_ADMIN_HOST):
 *   1. the owner, on the business's own address, asks to connect → the server checks the owner in the database
 *      (seo_gsc_can_connect) and signs a short ticket {business, user, return address, nonce, 10 minutes};
 *   2. /api/seo/gsc/start on the platform host verifies the ticket, binds it to THIS browser (an HttpOnly cookie
 *      with the nonce) and sends the owner to Google with the narrowest scope (webmasters.readonly);
 *   3. /api/seo/gsc/callback verifies the ticket again + the cookie (an OAuth flow started by someone else
 *      cannot be completed in this browser), exchanges the code, finds the property that covers the
 *      business's address, stores the refresh token ENCRYPTED, queues a first sync, and returns the owner to
 *      the SEO center of their business.
 * Nothing is posted to Google, nothing is changed in the owner's Google account. Without the two env values
 * the screen shows "not configured" and these routes answer 503.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serverSecret } from "@/platform/ai/secrets.server";
import { siteAddressesOf, sitesBaseDomain } from "@/platform/tenancy/current-site.server";
import { seoServiceRpc } from "../db.server";
import {
  authorizeUrl,
  encryptRefreshToken,
  exchangeCode,
  GscError,
  gscConfig,
  listSites,
  matchProperty,
} from "./api.server";

export interface GscTicket {
  /** the business, or "platform" — the platform's own domain property (platform admin) */
  t: string;
  /** the user who asked (owner / platform admin) */
  u: string;
  /** where to return (computed by the server from the business's own address — never from the browser) */
  r: string;
  n: string;
  exp: number;
}

const TICKET_MS = 10 * 60 * 1000;
const COOKIE = "nuriel_gsc";
const ticketKey = () =>
  createHmac("sha256", `${serverSecret()}|nuriel-seo-gsc-ticket|v1`).update("key").digest();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signTicket(p: { t: string; u: string; r: string }, now = Date.now()): string {
  const body: GscTicket = { ...p, n: randomBytes(16).toString("base64url"), exp: now + TICKET_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", ticketKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyTicket(
  ticket: string | null | undefined,
  now = Date.now(),
): GscTicket | null {
  if (!ticket || ticket.length > 2000) return null;
  const [payload, sig, extra] = ticket.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", ticketKey()).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let body: GscTicket;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GscTicket;
  } catch {
    return null;
  }
  if (
    typeof body?.t !== "string" ||
    (body.t !== "platform" && !UUID.test(body.t)) ||
    typeof body.u !== "string" ||
    !UUID.test(body.u) ||
    typeof body.r !== "string" ||
    !/^https:\/\/[^/\s]+\/[^\s]*$/.test(body.r) ||
    typeof body.n !== "string" ||
    typeof body.exp !== "number" ||
    body.exp < now
  )
    return null;
  return body;
}

/** where the "connect" button sends the owner (the ticket is the only thing in the URL) */
export function startUrl(ticket: string): string | null {
  const cfg = gscConfig();
  if (!cfg) return null;
  const host = new URL(cfg.redirectUri).origin;
  return `${host}/api/seo/gsc/start?t=${encodeURIComponent(ticket)}`;
}

function cookieOf(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

const redirect = (to: string, cookie?: string) => {
  const headers = new Headers({
    location: to,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
};

const page = (status: number, text: string) =>
  new Response(
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Search Console</title></head><body style="font-family:system-ui;padding:2rem"><p>${text}</p></body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );

const back = (t: GscTicket, result: string) => {
  const url = new URL(t.r);
  url.searchParams.set("gsc", result);
  return redirect(
    url.toString(),
    `${COOKIE}=; Path=/api/seo/gsc; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
};

async function businessOrigin(tenantId: string): Promise<string | null> {
  const b = await seoServiceRpc<{
    slug: string;
    domain: string | null;
    custom_domain: string | null;
    custom_domain_status: string | null;
  } | null>("seo_tenant_basics", { _tenant: tenantId });
  if (!b) return null;
  if (b.domain) return `https://${b.domain}`;
  const a = await siteAddressesOf({
    slug: b.slug,
    custom_domain: b.custom_domain,
    custom_domain_status: b.custom_domain_status,
  });
  return a.publicOrigin;
}

/** /api/seo/gsc/start and /api/seo/gsc/callback — null for any other path */
export async function handleGscRoute(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/seo/gsc/start" && url.pathname !== "/api/seo/gsc/callback")
    return null;
  if (request.method !== "GET") return page(405, "בקשה לא תקינה.");
  const cfg = gscConfig();
  if (!cfg) return page(503, "החיבור ל-Search Console עוד לא הוגדר בפלטפורמה.");
  // only on the registered host — the cookie must be set where the callback reads it
  if (url.host !== new URL(cfg.redirectUri).host) return page(400, "כתובת לא תקינה.");

  if (url.pathname === "/api/seo/gsc/start") {
    const t = verifyTicket(url.searchParams.get("t"));
    if (!t) return page(400, 'הקישור פג תוקף. חזרו למסך ה-SEO ולחצו שוב על "חיבור".');
    return redirect(
      authorizeUrl(cfg, url.searchParams.get("t")!),
      `${COOKIE}=${encodeURIComponent(t.n)}; Path=/api/seo/gsc; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    );
  }

  const state = url.searchParams.get("state");
  const t = verifyTicket(state);
  if (!t) return page(400, "החיבור פג תוקף. חזרו למסך ה-SEO ונסו שוב.");
  if (cookieOf(request, COOKIE) !== t.n)
    return page(400, "החיבור התחיל בדפדפן אחר. חזרו למסך ה-SEO ונסו שוב מכאן.");
  if (url.searchParams.get("error")) return back(t, "denied");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2000) return back(t, "error");
  try {
    const tok = await exchangeCode(cfg, code);
    const sites = await listSites(tok.accessToken);
    let property: string | null;
    if (t.t === "platform") {
      const base = await sitesBaseDomain();
      property = base
        ? (sites.find((s) => s.siteUrl === `sc-domain:${base}`)?.siteUrl ?? null)
        : null;
    } else {
      const origin = await businessOrigin(t.t);
      property = origin ? matchProperty(origin, sites) : null;
    }
    if (!property) return back(t, "no_property");
    await seoServiceRpc("seo_gsc_connection_save", {
      _tenant: t.t === "platform" ? null : t.t,
      _property: property,
      _token: encryptRefreshToken(tok.refreshToken),
      _actor: t.u,
    });
    if (t.t !== "platform")
      await seoServiceRpc("seo_jobs_enqueue", {
        _tenant: t.t,
        _kind: "gsc_sync",
        _entity_type: null,
      });
    return back(t, "connected");
  } catch (e) {
    console.error("[seo] gsc callback", e instanceof GscError ? e.code : "error");
    return back(t, e instanceof GscError && e.code === "forbidden" ? "no_scope" : "error");
  }
}
