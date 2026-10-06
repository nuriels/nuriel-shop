import { createFileRoute } from "@tanstack/react-router";

/** חלק 26: אנליטיקס למנהל החנות — ראו src/lib/analytics.server.ts */
export const Route = createFileRoute("/api/admin/analytics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { analyticsResponse } = await import("@/lib/analytics.server");
        return analyticsResponse(request);
      },
    },
  },
});
