import { createFileRoute } from "@tanstack/react-router";

/**
 * MAX/Hyp DEMO — where Hyp sends the shopper's browser after paying on a STORE's terminal (the success URL set per
 * terminal in Hyp's portal: https://<store>.<platform domain>/payments/return/max, no trailing slash).
 *
 * GET only; store hosts only — the platform host answers 404 before anything is read or recorded (the platform has
 * its own return route). A locked store still receives returns (SUSPENDED_ALLOWED_PATHS): the money may already be
 * taken. The query is taken exactly as received, recorded for the HOST's store, verified server-to-server with that
 * attempt's own terminal, settled by the DB, and the browser gets a 303 to a clean result page — no-store,
 * no-referrer, never a Hyp parameter in the address. Idempotent: a replay is never paid or e-mailed twice. The
 * route grants nothing (no CSRF token by design: Hyp's redirect is cross-site).
 */
export const Route = createFileRoute("/payments/return/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const headers = {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Robots-Tag": "noindex, nofollow",
        };
        const see303 = (location: string) =>
          new Response(null, { status: 303, headers: { ...headers, Location: location } });
        const { currentRequestHost, isPlatformRequest, maybeCurrentTenant } =
          await import("@/integrations/supabase/tenant.server");
        if (isPlatformRequest()) {
          return new Response("Not found", {
            status: 404,
            headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        const [{ allowAction, requestIp }, { UNKNOWN_RETURN_LOCATION }] = await Promise.all([
          import("@/lib/rate-limit.server"),
          import("@/platform/payments/server/tenant/return"),
        ]);
        if (!allowAction(`pay-return:t:${await requestIp()}`, 60, 10 * 60 * 1000)) {
          return see303(UNKNOWN_RETURN_LOCATION);
        }
        // the raw query, byte for byte (VERIFY needs it unchanged): everything after the first "?"
        const url = request.url;
        const mark = url.indexOf("?");
        const raw = mark < 0 ? "" : (url.slice(mark + 1).split("#")[0] ?? "");
        try {
          const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
          const outcome = await handleTenantReturn({
            provider: String(params.provider ?? ""),
            raw,
            hostTenantId: maybeCurrentTenant()?.id ?? null,
            host: currentRequestHost() ?? "",
          });
          if (outcome.refused) {
            return new Response("Not found", {
              status: 404,
              headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
            });
          }
          if (outcome.paid || outcome.review.length > 0) {
            const { actOnTenantOutcomes } = await import("@/lib/online-payments.server");
            // e-mails / the claimed reviews' bell + e-mail (X-17), without delaying the redirect
            void actOnTenantOutcomes({
              paid: outcome.paid ? [outcome.paid] : [],
              review: outcome.review,
            });
          }
          return see303(outcome.location);
        } catch {
          const { tenantLog } = await import("@/platform/payments/server/tenant/log");
          tenantLog.error("return_failed");
          return see303(UNKNOWN_RETURN_LOCATION);
        }
      },
    },
  },
});
