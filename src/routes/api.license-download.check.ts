import { createFileRoute } from "@tanstack/react-router";

/**
 * מודול הרישיונות: בדיקת קישור הורדה (בלי לצרוך הורדה) — לעמוד /license-download.
 * ה-Token מגיע בגוף הבקשה (POST), לא בכתובת — כך הוא לא נרשם ביומני השרת.
 * התשובה: מצב הקישור, שם הקובץ, גודל, הורדות שנותרו ותוקף. אף פעם לא נתיב פנימי או מזהים.
 * החנות נקבעת לפי ה-host; קישור של חנות אחרת = "לא נמצא". הגבלת קצב לפי IP.
 */
export const Route = createFileRoute("/api/license-download/check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Robots-Tag": "noindex, nofollow",
            },
          });
        const [{ allowAction }, { clientIp }, { DOWNLOAD_TOKEN_FORMAT }] = await Promise.all([
          import("@/lib/rate-limit.server"),
          import("@/platform/security/client-ip"),
          import("@/lib/licenses"),
        ]);
        if (!allowAction(`license-check:${clientIp(request.headers)}`, 60, 10 * 60 * 1000)) {
          return json({ state: "rate_limited" }, 429);
        }
        let token = "";
        try {
          const body = (await request.json()) as { token?: unknown };
          token = typeof body?.token === "string" ? body.token : "";
        } catch {
          token = "";
        }
        if (!DOWNLOAD_TOKEN_FORMAT.test(token)) return json({ state: "not_found" });

        const S = await import("@/lib/licenses.server");
        try {
          await S.licenseStore();
        } catch {
          return json({ state: "not_found" });
        }
        const { hashDownloadToken } = await import("@/lib/license-crypto.server");
        const db = await S.licenseDb();
        const { data, error } = await db.rpc("license_link_peek", {
          _token_hash: hashDownloadToken(token),
        });
        if (error) {
          console.error("[license-download] peek failed", error.message);
          return json({ state: "error" }, 500);
        }
        const peek = (data ?? {}) as {
          state?: string;
          product?: string;
          file_name?: string;
          size_bytes?: number;
          remaining?: number;
          max_downloads?: number;
          expires_at?: string;
        };
        const branding = await S.licenseBranding().catch(() => null);
        return json({
          state: peek.state ?? "not_found",
          product: peek.product ?? null,
          fileName: peek.file_name ?? null,
          sizeBytes: peek.size_bytes ?? null,
          remaining: peek.remaining ?? null,
          maxDownloads: peek.max_downloads ?? null,
          expiresAt: peek.expires_at ?? null,
          store: branding
            ? {
                name: branding.businessName,
                phone: branding.phone,
                email: branding.email,
                logoUrl: branding.logoUrl,
              }
            : null,
        });
      },
    },
  },
});
