import { createFileRoute } from "@tanstack/react-router";

/**
 * מודול הרישיונות: הורדת תוכנת ההתקנה. POST מהעמוד /license-download (ה-Token בגוף הטופס —
 * לא בכתובת, לא ביומני השרת, וסורקי קישורים לא מפעילים הורדה).
 * הסדר: בדיקת הקישור → פתיחת הקובץ מהאחסון הפרטי → צריכת הורדה אטומית במסד (תוקף 7 ימים,
 * עד 3 הורדות, לא בוטל, אותה חנות) → הזרמת הקובץ. כך הורדה נספרת רק כשהקובץ באמת יוצא.
 * כל כשל מחזיר לעמוד עם סיבה (?e=…), בלי ה-Token.
 */
export const Route = createFileRoute("/api/license-download/file")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const L = await import("@/lib/licenses");
        const back = (state: string) =>
          new Response(null, {
            status: 303,
            headers: {
              Location: `${L.DOWNLOAD_PATH}?e=${encodeURIComponent(state)}`,
              "Cache-Control": "no-store",
            },
          });
        const [{ allowAction }, { clientIp }] = await Promise.all([
          import("@/lib/rate-limit.server"),
          import("@/platform/security/client-ip"),
        ]);
        if (!allowAction(`license-file:${clientIp(request.headers)}`, 20, 10 * 60 * 1000)) {
          return back("rate_limited");
        }
        let token = "";
        try {
          const form = await request.formData();
          const value = form.get("token");
          token = typeof value === "string" ? value : "";
        } catch {
          token = "";
        }
        if (!L.DOWNLOAD_TOKEN_FORMAT.test(token)) return back("not_found");

        const S = await import("@/lib/licenses.server");
        try {
          await S.licenseStore();
        } catch {
          return back("not_found");
        }
        const { hashDownloadToken } = await import("@/lib/license-crypto.server");
        const hash = hashDownloadToken(token);
        const db = await S.licenseDb();

        const peek = await db.rpc("license_link_peek", { _token_hash: hash });
        const p = (peek.data ?? {}) as {
          state?: string;
          storage_path?: string;
          file_name?: string;
        };
        if (peek.error) return back("error");
        if (p.state !== "valid" || !p.storage_path) {
          if (p.state === "expired" || p.state === "exhausted" || p.state === "revoked") {
            // קישור אמיתי שכבר לא בתוקף: הפונקציה במסד לא מורידה כלום (המצב סופי) — רק רושמת
            // ביומן "ניסיון הורדה שנחסם", כדי שהחנות תראה שהלקוח ניסה שוב
            await db.rpc("license_consume_download", { _token_hash: hash });
          }
          return back(p.state ?? "not_found");
        }

        const upstream = await S.storedObjectStream(p.storage_path);
        if (!upstream.ok || !upstream.body) {
          console.error("[license-download] storage read failed", upstream.status);
          return back("error");
        }
        const consumed = await db.rpc("license_consume_download", { _token_hash: hash });
        const c = (consumed.data ?? {}) as { ok?: boolean; state?: string };
        if (consumed.error || c.ok !== true) {
          await upstream.body.cancel().catch(() => {});
          return back(consumed.error ? "error" : (c.state ?? "not_found"));
        }

        const name = p.file_name || "installer.exe";
        const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
        const headers = new Headers({
          "Content-Type": "application/vnd.microsoft.portable-executable",
          "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "X-Robots-Tag": "noindex, nofollow",
        });
        const length = upstream.headers.get("content-length");
        if (length && /^\d+$/.test(length)) headers.set("Content-Length", length);
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
