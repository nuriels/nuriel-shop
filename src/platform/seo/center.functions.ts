// NURIEL AI SEO ENGINE — the SEO center's server functions (both engines + the platform panel). Inputs are
// checked here and again in the database; the business is always the one of the request's address.
import { createServerFn } from "@tanstack/react-start";
import type { SeoSettingsPatch } from "./types";

const server = () => import("./center.server");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const getSeoCenter = createServerFn({ method: "POST" }).handler(async () =>
  (await server()).seoCenter(),
);

export const saveSeoSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>): SeoSettingsPatch => {
    const out: SeoSettingsPatch = {};
    for (const k of ["alt", "meta", "keywords", "weekly_audit"] as const)
      if (typeof input?.[k] === "boolean") out[k] = input[k] as boolean;
    if (!Object.keys(out).length) throw new Error("אין שינויים לשמירה");
    return out;
  })
  .handler(async ({ data }) => (await server()).saveSeoSettings(data));

export const requestSeoRunFn = createServerFn({ method: "POST" })
  .inputValidator((input: { kind?: unknown }) => {
    if (input?.kind !== "audit" && input?.kind !== "initial") throw new Error("בקשה לא תקינה");
    return { kind: input.kind as "audit" | "initial" };
  })
  .handler(async ({ data }) => (await server()).requestSeoRun(data.kind));

export const setKeywordIdeaFn = createServerFn({ method: "POST" })
  .inputValidator((input: { id?: unknown; status?: unknown }) => {
    if (typeof input?.id !== "string" || !UUID.test(input.id)) throw new Error("בקשה לא תקינה");
    if (input.status !== "new" && input.status !== "adopted" && input.status !== "dismissed")
      throw new Error("בקשה לא תקינה");
    return { id: input.id, status: input.status as "new" | "adopted" | "dismissed" };
  })
  .handler(async ({ data }) => (await server()).setKeywordIdea(data.id, data.status));

export const importGscCsvFn = createServerFn({ method: "POST" })
  .inputValidator((input: { csv?: unknown; start?: unknown; end?: unknown }) => {
    if (typeof input?.csv !== "string" || !input.csv.trim()) throw new Error("לא נבחר קובץ");
    if (input.csv.length > 3_000_000) throw new Error("הקובץ גדול מדי (עד 3MB)");
    if (
      typeof input.start !== "string" ||
      !DATE.test(input.start) ||
      typeof input.end !== "string" ||
      !DATE.test(input.end)
    )
      throw new Error("בחרו את טווח התאריכים של הדוח");
    return { csv: input.csv, start: input.start, end: input.end };
  })
  .handler(async ({ data }) => (await server()).importGscCsv(data));

export const disconnectGscFn = createServerFn({ method: "POST" }).handler(async () =>
  (await server()).disconnectGsc(),
);

export const gscConnectLinkFn = createServerFn({ method: "POST" }).handler(async () =>
  (await server()).gscConnectLink(),
);

// ------------------------------------------------------------------ the platform panel

export const getPlatformSeoOverview = createServerFn({ method: "POST" }).handler(async () =>
  (await server()).platformSeoOverview(),
);

export const platformSeoRequestFn = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId?: unknown; kind?: unknown }) => {
    if (typeof input?.tenantId !== "string" || !UUID.test(input.tenantId))
      throw new Error("בקשה לא תקינה");
    if (input.kind !== "audit" && input.kind !== "initial" && input.kind !== "gsc_sync")
      throw new Error("בקשה לא תקינה");
    return { tenantId: input.tenantId, kind: input.kind as "audit" | "initial" | "gsc_sync" };
  })
  .handler(async ({ data }) => (await server()).platformSeoRequest(data.tenantId, data.kind));

export const platformGscConnectLinkFn = createServerFn({ method: "POST" }).handler(async () =>
  (await server()).platformGscConnectLink(),
);
