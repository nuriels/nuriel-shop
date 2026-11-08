// מסמכי לקוחות — מפתחות, צבעי מצב, ופענוח הפרמטרים של הכתובת (?tab=send&event=… / ?booking=…)
import type { ContractStatus } from "../../types/contracts";
import { manageKeys } from "../lib/query-keys";

export const CONTRACTS_KEY = [...manageKeys.all, "contracts"] as const;
export const contractsForKey = (bookingId: string | null, eventId: string | null) =>
  [...CONTRACTS_KEY, "for", bookingId, eventId] as const;
export const contractKey = (id: string) => [...CONTRACTS_KEY, "detail", id] as const;
export const contractsViewKey = [...CONTRACTS_KEY, "view"] as const;
export const contractsListKey = (filters: Record<string, string | number | null>) =>
  [...CONTRACTS_KEY, "list", filters] as const;

export const CONTRACT_STATUS_TONE: Record<ContractStatus, string> = {
  draft: "bg-zinc-100 text-zinc-800",
  sent: "bg-amber-100 text-amber-950",
  viewed: "bg-amber-100 text-amber-950",
  signed: "bg-emerald-100 text-emerald-950",
  superseded: "bg-sky-100 text-sky-950",
  cancelled: "bg-zinc-200 text-zinc-700",
  expired: "bg-red-100 text-red-900",
};

export type ClientDocsTab = "send" | "archive" | "terms";
export interface ClientDocsSearch {
  tab?: ClientDocsTab;
  event?: string;
  booking?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseClientDocsSearch(raw: Record<string, unknown>): ClientDocsSearch {
  const out: ClientDocsSearch = {};
  if (raw["tab"] === "send" || raw["tab"] === "archive" || raw["tab"] === "terms")
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
