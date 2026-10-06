import { createFileRoute } from "@tanstack/react-router";

/** חלק 27: שליחת תזכורות לסלים נטושים (מנהל החנות) — ראו src/lib/abandoned-carts.server.ts */
export const Route = createFileRoute("/api/admin/trigger-abandoned-carts")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ error: "יש לשלוח POST" }), {
          status: 405,
          headers: { Allow: "POST", "Content-Type": "application/json; charset=utf-8" },
        }),
      POST: async ({ request }) => {
        const { runAbandonedCartReminders } = await import("@/lib/abandoned-carts.server");
        return runAbandonedCartReminders(request);
      },
    },
  },
});
