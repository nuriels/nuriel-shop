import { createFileRoute } from "@tanstack/react-router";

/**
 * MAX/Hyp DEMO (D5) — the PLATFORM return from Hyp's payment page (the success URL of NURIEL's terminal):
 * GET /platform/payments/return/$provider, on the platform host only (store hosts already answer 403 for
 * /platform/*, storeGate). The raw query goes to the platform orchestrator unchanged (no decoding); the answer is
 * always a 303 with no-store and no-referrer — to the store address the owner started from (saved on the attempt,
 * never a request parameter) — and nothing is rendered. Un-nested (`payments_`) so it never sits under the page.
 */
const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

const see303 = (location: string) =>
  new Response(null, { status: 303, headers: { Location: location, ...HEADERS } });

const notFound = () =>
  new Response("not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...HEADERS },
  });

/** everything after the first "?" (up to a "#"), byte-exact: never decoded or re-encoded */
function rawQueryOf(url: string): string {
  const start = url.indexOf("?");
  if (start < 0) return "";
  const hash = url.indexOf("#", start);
  return url.slice(start + 1, hash < 0 ? undefined : hash);
}

/** the request host without the port, lower case (for the unknown-return counter) */
function hostOf(request: Request): string {
  const raw = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  return (raw.split(",")[0] ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export const Route = createFileRoute("/platform_/payments_/return/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        // P-5: in the production pilot NURIEL's terminal is off — answered like a non-platform host, before
        // any DB call (nothing can have been opened there)
        const { platformPilotOff } = await import("@/platform/payments/server/platform/pilot");
        if (platformPilotOff()) return notFound();
        const { isPlatformHost } = await import("@/platform/tenancy/current-site.server");
        if (params.provider !== "max" || !(await isPlatformHost())) return notFound();
        const { allowAction, requestIp } = await import("@/platform/security/rate-limit.server");
        if (!allowAction(`pay-return:p:${await requestIp()}`, 60, 10 * 60_000)) return see303("/");
        try {
          const { handlePlatformReturn } =
            await import("@/platform/payments/server/platform/return");
          const out = await handlePlatformReturn({
            provider: params.provider,
            raw: rawQueryOf(request.url),
            host: hostOf(request),
          });
          return see303(out.location);
        } catch {
          const { platformLog } = await import("@/platform/payments/server/platform/log");
          platformLog.error("return_route", { reason: "internal" });
          return see303("/");
        }
      },
    },
  },
});
