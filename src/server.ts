import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  maybeCurrentTenant,
  requestHost,
  resolveTenant,
  runWithTenant,
} from "./integrations/supabase/tenant.server";

// SSR: לקוח ה-Supabase המשותף (client.ts) שולח את החנות של הבקשה הנוכחית
(globalThis as typeof globalThis & { __requestTenantId?: () => string | null }).__requestTenantId =
  () => maybeCurrentTenant()?.id ?? null;

// קבצים סטטיים (assets, robots.txt, favicon...) לא צריכים זיהוי חנות —
// כך גם ה-healthcheck לא תלוי במסד.
const STATIC_PATH = /^\/assets\/|\.[a-z0-9]{2,5}$/i;

const STORE_NOT_FOUND_HTML = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" /><title>החנות לא נמצאה</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>body{font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem;background:#fafafa;color:#111}</style>
</head><body><div><h1>החנות לא נמצאה</h1><p>הכתובת הזו לא משויכת לאף חנות במערכת.</p></div></body></html>`;

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
      if (STATIC_PATH.test(new URL(request.url).pathname)) {
        return await runWithTenant(host, null, () => handle(request, env, ctx));
      }
      const tenant = await resolveTenant(host);
      if (!tenant) {
        return new Response(STORE_NOT_FOUND_HTML, {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return await runWithTenant(host, tenant, () => handle(request, env, ctx));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
