/**
 * חלק 42: חתימת בעל החנות על הסכם השירות של הפלטפורמה — עמוד ציבורי לפי טוקן.
 *
 * הטוקן (256 ביט) נשלח רק למייל הבעלים; במסד נשמר רק הגיבוב שלו. חד-פעמי,
 * פג אחרי 14 יום, ונשרף בחתימה. אין כאן שום דרך לראות או לחתום עבור חנות אחרת:
 * כל הנתונים נגזרים מהטוקן בלבד.
 */

import { createServerFn } from "@tanstack/react-start";

export type OwnerAgreementForm = {
  status: "pending" | "signed" | "superseded" | "expired";
  version: number;
  title: string;
  content: string;
  storeName: string;
  ownerEmail: string;
  signedAt: string | null;
  signerName: string | null;
};

function tokenOf(value: unknown): string {
  const token = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error("הקישור אינו תקין");
  return token;
}

export const loadOwnerAgreement = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => ({ token: tokenOf(input?.token) }))
  .handler(async ({ data }): Promise<OwnerAgreementForm | null> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    if (!allowAction(`owner-agreement-load:${await requestIp()}`, 60, 10 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
    }
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { hashPlatformToken } = await import("@/lib/platform-files.server");
    const { data: raw, error } = await supabaseAdminUnscoped.rpc("platform_agreement_form", {
      _token_hash: hashPlatformToken(data.token),
    });
    if (error) throw new Error("הקישור אינו תקין");
    if (!raw) return null;
    const row = raw as Record<string, unknown>;
    const status = String(row["status"] ?? "");
    if (!["pending", "signed", "superseded", "expired"].includes(status)) return null;
    return {
      status: status as OwnerAgreementForm["status"],
      version: Number(row["version"] ?? 0),
      title: String(row["title"] ?? ""),
      content: String(row["content"] ?? ""),
      storeName: String(row["store_name"] ?? ""),
      ownerEmail: String(row["owner_email"] ?? ""),
      signedAt: typeof row["signed_at"] === "string" ? row["signed_at"] : null,
      signerName: typeof row["signer_name"] === "string" ? row["signer_name"] : null,
    };
  });

export const signOwnerAgreement = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      token: string;
      signerName: string;
      accepted: boolean;
      signatureSvg?: string | null;
    }) => {
      const token = tokenOf(input?.token);
      const signerName = String(input?.signerName ?? "").trim();
      if (signerName.length < 2 || signerName.length > 120) {
        throw new Error("נא להזין שם מלא של החותם");
      }
      if (input?.accepted !== true) throw new Error("יש לאשר שקראת והסכמת לתנאי ההסכם");
      // אין לשמור SVG שהגיע מהדפדפן כמו שהוא (XSS מאוחסן): מחלצים רק נתוני
      // path (אותיות M/L/Z ומספרים) ובונים את ה-SVG מחדש בשרת. חתימה מצוירת
      // אופציונלית — השם המוקלד והאישור הם עיקר הראיה.
      const raw =
        typeof input?.signatureSvg === "string" ? input.signatureSvg.slice(0, 100_000) : "";
      const paths: string[] = [];
      for (const match of raw.matchAll(/d="([^"]{1,4000})"/g)) {
        const d = (match[1] ?? "").trim();
        if (/^[MLmlZz0-9.,\s-]+$/.test(d)) paths.push(d);
        if (paths.length >= 60) break;
      }
      return { token, signerName, paths };
    },
  )
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`owner-agreement-sign:${ip}`, 10, 10 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
    }
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { hashPlatformToken, recordPlatformAudit } = await import("@/lib/platform-files.server");

    let userAgent: string | null = null;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      userAgent = getRequest()?.headers.get("user-agent")?.slice(0, 500) ?? null;
    } catch {
      // אין הקשר בקשה
    }

    const svg =
      data.paths.length === 0
        ? null
        : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">' +
          data.paths
            .map(
              (d) =>
                `<path d="${d}" fill="none" stroke="#12211F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
            )
            .join("") +
          "</svg>";

    const tokenHash = hashPlatformToken(data.token);
    const { data: result, error } = await supabaseAdminUnscoped.rpc("platform_agreement_sign", {
      _token_hash: tokenHash,
      _signer_name: data.signerName,
      _signature_svg: svg as string,
      _ip: ip === "unknown" ? (null as unknown as string) : ip,
      _user_agent: userAgent as string,
    });
    if (error) throw new Error(error.message);
    const row = (result ?? {}) as { tenant_id?: string };
    if (row.tenant_id) {
      await recordPlatformAudit({
        tenantId: row.tenant_id,
        actor: null,
        action: "agreement_signed",
        details: { signerName: data.signerName, drawn: svg !== null },
      });
    }
    return { ok: true };
  });
