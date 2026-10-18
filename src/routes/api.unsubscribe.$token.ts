import { createFileRoute } from "@tanstack/react-router";

/**
 * חלק 40: "הסרה בלחיצה אחת" (RFC 8058) — Gmail / Outlook שולחים POST לכתובת
 * שבכותרת List-Unsubscribe כשהנמען לוחץ "בטל הרשמה". הטוקן — UUID אקראי
 * לכל כתובת בכל חנות; ההסרה רק בחנות של הבקשה (marketing_unsubscribe).
 */
export const Route = createFileRoute("/api/unsubscribe/$token")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const token = String(params.token ?? "").trim();
        const { UUID_FORMAT } = await import("@/lib/marketing-consent");
        if (!UUID_FORMAT.test(token)) return new Response("invalid", { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("marketing_unsubscribe", { _token: token });
        if (error) {
          console.error("[unsubscribe] one-click failed", error.message);
          return new Response("error", { status: 500 });
        }
        return new Response("ok", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
