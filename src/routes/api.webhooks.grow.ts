import { createFileRoute } from "@tanstack/react-router";

/**
 * חלק 43: ההתראה של Grow לשרת (webhook) על תשלום שהושלם.
 *
 * הכתובת קבועה (שער הפלטפורמה) ואינה תלויה בחנות: התהליך מזוהה לפי processId,
 * ו-processToken שבהתראה חייב להתאים לגיבוב ששמרנו ביצירת התהליך (רק Grow
 * ואנחנו מכירים אותו). הסכום והסטטוס נבדקים, והסימון "שולם" אטומי וחד-פעמי
 * (grow_mark_paid). רק אחריו נשלח ApproveTransaction ומיילי ההזמנה.
 * 200 על התראה תקינה בפורמט (גם אם נדחתה) — לא חושפים למי ששולח מה נכשל; 500 רק על תקלה שלנו בסימון
 * התשלום, כדי ש-Grow ינסה שוב (ראו growWebhookStatus).
 */
export const Route = createFileRoute("/api/webhooks/grow")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
        if (!allowAction(`grow-webhook:${await requestIp()}`, 300, 10 * 60 * 1000)) {
          return new Response("too many", { status: 429 });
        }
        const { growWebhookStatus, processGrowWebhook } = await import("@/lib/grow-webhook.server");
        const outcome = await processGrowWebhook(request);
        const status = growWebhookStatus(outcome);
        if (status === 400) return new Response("bad request", { status });
        if (status === 500) return new Response("try again", { status });
        return new Response("ok", {
          status,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
