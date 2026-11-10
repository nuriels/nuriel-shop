// מסמכי לקוחות (מיגרציה 64 + מסמכים עצמאיים) — צד שרת בלבד:
//   • הקישור לחתימה: 32 בתים אקראיים (base64url) — נוצר כאן, במסד רק ה-SHA-256 שלו. בדרך א' הוא יוצא
//     רק במייל ללקוח (לא חוזר לדפדפן של הצוות); בדרך ב' (הלקוח ממלא) הוא מוחזר לצוות פעם אחת, כדי
//     להעביר אותו ללקוח, ולא נשמר בשום מקום. כל שליחה / קישור — קישור חדש, והקודם מת;
//   • שליחה: קישור → מייל → התוצאה במסד. מייל שנכשל — החוזה לא מסומן "נשלח" (והקישור מבוטל);
//   • אחרי החתימה: PDF (contracts/pdf.server.ts) → הדלי הפרטי hosp-contracts (מפתח השירות) → טביעה
//     במסד (פעם אחת) → עותק ללקוח עם ה-PDF מצורף. תקלה באמצע לא מבטלת את החתימה — הבדיקה ברקע משלימה;
//   • צפייה / הורדה: קישור חתום ל-60 שניות, רק אחרי שהמסד אישר (הרשאת contracts / האזור האישי).
import { createHash, randomBytes } from "node:crypto";
import { escapeHtml, sendBusinessEmail } from "@/platform/email/send.server";
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { siteOrigin } from "@/platform/tenancy/current-site.server";
import { HOSPITALITY_SCHEMA } from "../config";
import { contractSignRequestEmail, contractSignedCopyEmail } from "../contracts/emails";
import { poolNotice } from "../contracts/pool-notice";
import { buildSignedContractPdf } from "../contracts/pdf.server";
import type { ContractSignature } from "../contracts/signature";
import type { ContractRow, ContractSendResult } from "../types/contracts";
import { HospitalityError } from "./rpc.server";

export const CONTRACTS_BUCKET = "hosp-contracts";
const SIGNED_SECONDS = 60;
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/;

export function newSignToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** קריאה למסד במפתח השירות, בשם העסק (x-tenant-id) — גם מתהליך הרקע, בלי בקשה */
async function rpcAs<T>(tenantId: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Profile": HOSPITALITY_SCHEMA,
      "Accept-Profile": HOSPITALITY_SCHEMA,
      "x-tenant-id": tenantId,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = "";
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? "";
    } catch {
      message = "";
    }
    throw new HospitalityError(message || "הפעולה נכשלה — נסו שוב", null);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function siteLink(tenantId: string): Promise<string | null> {
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/tenants?id=eq.${encodeURIComponent(tenantId)}&select=slug,domain`,
    { headers: { ...serviceHeaders(), "Accept-Profile": "public" } },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as { slug: string; domain: string | null }[];
  return rows[0] ? siteOrigin(rows[0]) : null;
}

const dayText = (iso: string) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(new Date(iso));

interface SendPrepared extends ContractRow {
  tenant_id: string;
  actor_id: string;
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
}

const signUrl = (origin: string, token: string) => `${origin}/stay/contract#t=${token}`;
/** "ההזמנות שלי" — שם המסמכים החתומים (כניסה עם קוד למייל) */
const areaUrl = (origin: string) => `${origin}/stay/account`;

/** שליחה (או שליחה חוזרת) של חוזה לחתימה: קישור חדש → מייל → התוצאה במסד */
export async function sendSignRequest(p: SendPrepared): Promise<ContractSendResult> {
  if (!p.signer_email)
    throw new HospitalityError("אין אימייל ללקוח — העתיקו את הקישור ושלחו אותו ללקוח בעצמכם", null);
  const origin = await siteLink(p.tenant_id);
  if (!origin)
    throw new HospitalityError("כתובת האתר של העסק לא ידועה — אי אפשר לשלוח קישור", null);
  const { token, hash } = newSignToken();
  const link = await rpcAs<{ expires_at: string }>(p.tenant_id, "contract_issue_link", {
    _tenant: p.tenant_id,
    _id: p.id,
    _token_hash: hash,
    _actor: p.actor_id,
  });
  const about =
    p.booking_type === "event"
      ? p.event_purpose
        ? `אירוע — ${p.event_purpose}`
        : "אירוע"
      : p.link_number
        ? `הזמנה מס' ${p.link_number}`
        : null;
  const { subject, html } = contractSignRequestEmail(
    {
      businessName: p.business_name,
      businessPhone: p.business_phone,
      businessEmail: p.business_email,
      escape: escapeHtml,
    },
    {
      signerName: p.signer_name,
      title: p.title,
      number: p.number,
      url: signUrl(origin, token),
      expiresOn: dayText(link.expires_at),
      about,
      poolNote: poolNotice(p.kind, p.pool),
      kind: p.kind,
      customerFills: p.fill_mode === "customer",
    },
  );
  let ok = false;
  let error: string | null = null;
  try {
    const r = await sendBusinessEmail({
      to: p.signer_email,
      subject,
      html,
      senderName: p.business_name,
      replyTo: p.business_email,
      idempotencyKey: `hosp-contract-${p.id}-${hash.slice(0, 16)}`,
    });
    ok = r.sent;
    error = r.sent
      ? null
      : r.skipped
        ? "שירות המיילים לא מוגדר בשרת"
        : (r.reason ?? "השליחה נכשלה");
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "השליחה נכשלה";
  }
  const contract = await rpcAs<ContractRow>(p.tenant_id, "contract_send_result", {
    _tenant: p.tenant_id,
    _id: p.id,
    _ok: ok,
    _error: error,
    _actor: p.actor_id,
  });
  return {
    contract,
    sent: ok,
    error: ok ? null : "שליחת המייל נכשלה — החוזה לא סומן כנשלח. בדקו את כתובת האימייל ונסו שוב.",
  };
}

/**
 * דרך ב' (הלקוח ממלא): קישור חדש לחתימה — מוחזר לצוות פעם אחת להעברה ללקוח (וואטסאפ / הודעה).
 * במסד: רק הטביעה שלו, ו"נוצר קישור" ביומן. קישור קודם מת
 */
export async function shareSignLink(p: {
  tenant_id: string;
  id: string;
  actor_id: string;
}): Promise<{ contract: ContractRow; url: string; expires_at: string }> {
  const origin = await siteLink(p.tenant_id);
  if (!origin)
    throw new HospitalityError("כתובת האתר של העסק לא ידועה — אי אפשר ליצור קישור", null);
  const { token, hash } = newSignToken();
  const link = await rpcAs<{ expires_at: string }>(p.tenant_id, "contract_issue_link", {
    _tenant: p.tenant_id,
    _id: p.id,
    _token_hash: hash,
    _actor: p.actor_id,
  });
  const contract = await rpcAs<ContractRow>(p.tenant_id, "contract_link_shared", {
    _tenant: p.tenant_id,
    _id: p.id,
    _actor: p.actor_id,
  });
  return { contract, url: signUrl(origin, token), expires_at: link.expires_at };
}

async function uploadPdf(tenantId: string, id: string, bytes: Uint8Array): Promise<string> {
  const path = `${tenantId}/${id}.pdf`;
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${CONTRACTS_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Type": "application/pdf",
      "x-upsert": "false",
      "cache-control": "private, max-age=0, no-store",
    },
    body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
  });
  // כבר קיים (ניסיון קודם שלא נרשם) — לא דורסים: הקובץ החתום לא משתנה
  if (!res.ok && res.status !== 409 && res.status !== 400) {
    console.error("[hospitality/contracts] upload failed", res.status);
    throw new HospitalityError("שמירת הקובץ החתום נכשלה", null);
  }
  return path;
}

async function downloadPdf(path: string): Promise<Uint8Array> {
  if (!PATH.test(path)) throw new HospitalityError("הקובץ לא נמצא", "P0002");
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${CONTRACTS_BUCKET}/${path}`, {
    headers: serviceHeaders(),
  });
  if (!res.ok) throw new HospitalityError("הקובץ לא זמין כרגע — נסו שוב", null);
  return new Uint8Array(await res.arrayBuffer());
}

/** קישור חתום וקצר לקובץ — רק אחרי שהמסד אישר שמותר */
export async function contractFileUrl(
  path: string,
  number: number,
  download: boolean,
): Promise<string> {
  if (!PATH.test(path)) throw new HospitalityError("הקובץ לא נמצא", "P0002");
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${CONTRACTS_BUCKET}/${path}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ expiresIn: SIGNED_SECONDS }),
  });
  const data = res.ok ? ((await res.json()) as { signedURL?: string }) : {};
  if (!data.signedURL) {
    console.error("[hospitality/contracts] sign url failed", res.status);
    throw new HospitalityError("הקובץ לא זמין כרגע — נסו שוב", null);
  }
  const url = new URL(`${supabaseUrl()}/storage/v1${data.signedURL}`);
  if (download) url.searchParams.set("download", `contract-${number}.pdf`);
  return url.toString();
}

interface ForPdf extends ContractRow {
  tenant_id: string;
  body: string;
  signature: ContractSignature;
  signer_ip: string | null;
  signer_user_agent: string | null;
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
  representative_name: string | null;
  representative_signature: string[] | null;
  signed_at_local: string;
  pdf_path: string | null;
}

async function sendCopy(c: ForPdf, bytes: Uint8Array, actorId: string | null): Promise<boolean> {
  const origin = await siteLink(c.tenant_id).catch(() => null);
  const { subject, html } = contractSignedCopyEmail(
    {
      businessName: c.business_name,
      businessPhone: c.business_phone,
      businessEmail: c.business_email,
      escape: escapeHtml,
    },
    {
      signerName: c.signer_name,
      title: c.title,
      number: c.number,
      signedOn: c.signed_at_local,
      kind: c.kind,
      areaUrl: origin ? areaUrl(origin) : null,
    },
  );
  let ok = false;
  let error: string | null = null;
  try {
    if (!c.signer_email) throw new Error("אין אימייל לחותם");
    const r = await sendBusinessEmail({
      to: c.signer_email,
      subject,
      html,
      senderName: c.business_name,
      replyTo: c.business_email,
      idempotencyKey: `hosp-contract-copy-${c.id}-${actorId ? Date.now() : "first"}`,
      attachments: [
        { filename: `contract-${c.number}.pdf`, content: Buffer.from(bytes).toString("base64") },
      ],
    });
    ok = r.sent;
    error = r.sent ? null : (r.reason ?? "השליחה נכשלה");
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "השליחה נכשלה";
  }
  await rpcAs(c.tenant_id, "contract_copy_result", {
    _tenant: c.tenant_id,
    _id: c.id,
    _ok: ok,
    _error: error,
    _actor: actorId,
  });
  return ok;
}

/**
 * אחרי החתימה (וגם בהשלמה ברקע): PDF → הדלי → טביעה במסד → עותק ללקוח. מחזיר את ה-PDF (למי שחתם עכשיו)
 */
export async function completeSignedContract(
  tenantId: string,
  contractId: string,
): Promise<{ pdf: Uint8Array | null; copySent: boolean }> {
  const c = await rpcAs<ForPdf>(tenantId, "contract_for_pdf", {
    _tenant: tenantId,
    _id: contractId,
  });
  let bytes: Uint8Array | null = null;
  if (c.pdf_path) {
    bytes = await downloadPdf(c.pdf_path);
  } else {
    bytes = await buildSignedContractPdf({
      number: c.number,
      title: c.title,
      kind: c.kind,
      fillMode: c.fill_mode,
      documentVersion: c.document_version,
      documentHash: c.document_hash,
      body: c.body,
      bodySha256: c.signed_body_sha256 ?? "",
      businessName: c.business_name,
      representativeName: c.representative_name,
      representativeSignature: c.representative_signature,
      signerName: c.signer_name ?? "",
      signerEmail: c.signer_email ?? "",
      signature: c.signature,
      signedAtLocal: c.signed_at_local,
      signerIp: c.signer_ip,
      signerUserAgent: c.signer_user_agent,
      poolNote: poolNotice(c.kind, c.pool),
    });
    const path = await uploadPdf(tenantId, contractId, bytes);
    await rpcAs(tenantId, "contract_pdf_stored", {
      _tenant: tenantId,
      _id: contractId,
      _path: path,
      _sha256: createHash("sha256").update(bytes).digest("hex"),
      _size: bytes.byteLength,
    });
  }
  const copySent = c.copy_sent_at ? true : await sendCopy(c, bytes, null);
  return { pdf: bytes, copySent };
}

/** הצוות: שליחת העותק החתום שוב */
export async function resendSignedCopy(p: {
  tenant_id: string;
  id: string;
  actor_id: string;
}): Promise<boolean> {
  const c = await rpcAs<ForPdf>(p.tenant_id, "contract_for_pdf", {
    _tenant: p.tenant_id,
    _id: p.id,
  });
  if (!c.pdf_path) throw new HospitalityError("אין עדיין קובץ חתום לחוזה הזה", null);
  return sendCopy(c, await downloadPdf(c.pdf_path), p.actor_id);
}

/** תהליך הרקע: חוזים חתומים שה-PDF או העותק שלהם לא הושלמו */
export async function runContractPendingWork(): Promise<number> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/contracts_pending_work`, {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Profile": HOSPITALITY_SCHEMA,
      "Accept-Profile": HOSPITALITY_SCHEMA,
    },
    body: JSON.stringify({ _limit: 5 }),
  });
  if (!res.ok) throw new Error(`contracts_pending_work: ${res.status}`);
  const pending = (await res.json()) as { tenant_id: string; id: string }[];
  let done = 0;
  for (const p of pending ?? []) {
    try {
      await completeSignedContract(p.tenant_id, p.id);
      done++;
    } catch (error) {
      console.error(
        "[hospitality/contracts] pending work",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return done;
}
