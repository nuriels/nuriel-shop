// מסמכי לקוחות — מפתחות, צבעי מצב, ופענוח הפרמטרים של הכתובת (?tab=send&event=… / ?booking=…)
import { useEffect, useState } from "react";
import {
  BOOKING_TYPE_LABEL,
  ORIGIN_LABEL,
  type ContractRow,
  type ContractStatus,
} from "../../types/contracts";
import { manageKeys } from "../lib/query-keys";

export const CONTRACTS_KEY = [...manageKeys.all, "contracts"] as const;
export const contractsForKey = (bookingId: string | null, eventId: string | null) =>
  [...CONTRACTS_KEY, "for", bookingId, eventId] as const;
export const contractKey = (id: string) => [...CONTRACTS_KEY, "detail", id] as const;
export const contractsViewKey = [...CONTRACTS_KEY, "view"] as const;
export const contractsListKey = (filters: Record<string, string | number | null>) =>
  [...CONTRACTS_KEY, "list", filters] as const;
export const signedListKey = (filters: Record<string, string | number | null>) =>
  [...CONTRACTS_KEY, "signed", filters] as const;
export const contractsUnseenKey = [...CONTRACTS_KEY, "unseen"] as const;

export const CONTRACT_STATUS_TONE: Record<ContractStatus, string> = {
  draft: "bg-zinc-100 text-zinc-800",
  sent: "bg-amber-100 text-amber-950",
  viewed: "bg-amber-100 text-amber-950",
  signed: "bg-emerald-100 text-emerald-950",
  superseded: "bg-sky-100 text-sky-950",
  cancelled: "bg-zinc-200 text-zinc-700",
  expired: "bg-red-100 text-red-900",
};

/** new — מסמך עצמאי; send — חוזה להזמנה / לאירוע; signed — המסמכים החתומים */
export type ClientDocsTab = "new" | "send" | "signed" | "archive" | "terms";
export interface ClientDocsSearch {
  tab?: ClientDocsTab;
  event?: string;
  booking?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseClientDocsSearch(raw: Record<string, unknown>): ClientDocsSearch {
  const out: ClientDocsSearch = {};
  if (
    raw["tab"] === "new" ||
    raw["tab"] === "send" ||
    raw["tab"] === "signed" ||
    raw["tab"] === "archive" ||
    raw["tab"] === "terms"
  )
    out.tab = raw["tab"];
  if (typeof raw["event"] === "string" && UUID.test(raw["event"]))
    out.event = raw["event"].toLowerCase();
  if (typeof raw["booking"] === "string" && UUID.test(raw["booking"]))
    out.booking = raw["booking"].toLowerCase();
  return out;
}

/** "18.11.2026" / "18.11–20.11.2026" */
export function serviceDateText(from: string | null, to: string | null): string {
  if (!from) return "—";
  const f = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${Number(d)}.${Number(m)}.${y}`;
  };
  return to && to !== from ? `${f(from)} – ${f(to)}` : f(from);
}

export const SELECT = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const serviceText = (c: ContractRow) =>
  c.kind === "policy"
    ? `גרסה ${c.document_version ?? "—"}`
    : `${serviceDateText(c.service_date, c.service_end)}${c.event_purpose ? ` · ${c.event_purpose}` : ""}`;
/** "אירוח #1004" / "אירוע #12" / "מסמך עצמאי" */
export const linkText = (c: ContractRow) =>
  c.origin === "standalone"
    ? ORIGIN_LABEL.standalone
    : `${c.booking_type ? BOOKING_TYPE_LABEL[c.booking_type] : ""}${c.link_number ? ` #${c.link_number}` : ""}`;
/** בדרך ב' — עד החתימה השם עוד לא ידוע */
export const signerText = (c: ContractRow) => c.signer_name ?? "הלקוח ימלא בחתימה";

/** 050-1234567 → 972501234567 (וואטסאפ); מספר לא ישראלי / חסר — בלי נמען (בוחרים בוואטסאפ) */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (/^0[2-9]\d{7,8}$/.test(d)) return `972${d.slice(1)}`;
  if (/^972[2-9]\d{7,8}$/.test(d)) return d;
  return null;
}

export function whatsappHref(url: string, title: string, phone: string | null | undefined): string {
  const text = `שלום, זה הקישור לקריאה ולחתימה על "${title}": ${url}\nהקישור אישי וחד-פעמי.`;
  const to = whatsappNumber(phone);
  return `https://wa.me/${to ?? ""}?text=${encodeURIComponent(text)}`;
}
