import { createFileRoute } from "@tanstack/react-router";

/**
 * חלק 24: ‎/pwa/apple-touch-icon.png · ‎/pwa/icon-192.png · ‎/pwa/icon-512.png ·
 * ‎/pwa/icon-maskable-512.png · ‎/pwa/og-image.png — מהלוגו של החנות לפי הדומיין.
 * אין לוגו / לא חנות → 404.
 */
const NAMES = new Set([
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "og-image.png",
]);

export const Route = createFileRoute("/pwa/$icon")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!NAMES.has(params.icon)) return new Response("Not found", { status: 404 });
        try {
          const { storeIcon } = await import("@/lib/store-icons.server");
          const png = await storeIcon(params.icon as Parameters<typeof storeIcon>[0]);
          if (!png) return new Response("Not found", { status: 404 });
          return new Response(new Uint8Array(png), {
            headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
          });
        } catch (error) {
          console.error("[store-icons] failed", error);
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
