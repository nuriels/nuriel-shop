// NURIEL AI SEO ENGINE — Ecommerce: the server functions of the "SEO ו-Google" tab. The list / decide / restore
// run in the database AS THE SIGNED-IN USER (store_seo_proposals… check the store admin role again); the
// proposal texts are created only by the server (store-seo.server.ts).
import { createServerFn } from "@tanstack/react-start";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function staffRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const [{ sessionFromRequest }, { currentSite }, { apiClient }] = await Promise.all([
    import("@/platform/auth/session.server"),
    import("@/platform/tenancy/current-site.server"),
    import("@/platform/supabase/api-client.server"),
  ]);
  const s = await sessionFromRequest().catch(() => null);
  if (!s) throw new Error("נדרשת התחברות");
  const site = await currentSite();
  if (!site) throw new Error("החנות לא זוהתה");
  const { data, error } = await apiClient({
    schema: "public",
    siteId: site.id,
    accessToken: s.accessToken,
  }).rpc(fn, args);
  if (error) {
    const he = /[֐-׿]/.test(error.message ?? "");
    if (!he) console.error(`[seo] ${fn} failed`, error.code, error.message);
    throw new Error(he ? error.message : "הפעולה נכשלה — נסו שוב");
  }
  return data as T;
}

export interface StoreSeoProposal {
  id: string;
  target_kind: "store" | "product" | "category";
  target_id: string | null;
  field: "seo_title" | "seo_description" | "seo_keywords" | "brand" | "item_condition";
  proposed: string;
  base: string;
  reason: string | null;
  source: "template" | "ai" | "gsc";
  status: "pending" | "later" | "approved" | "rejected" | "superseded" | "stale" | "reverted";
  applied: string | null;
  created_at: string;
  decided_at: string | null;
  reverted_at: string | null;
  /** the value now ('' — empty; null — the item no longer exists) */
  current: string | null;
  label: string | null;
  path: string;
}

export interface StoreSeoView {
  store_name: string | null;
  proposals: StoreSeoProposal[];
}

export const getStoreSeoProposals = createServerFn({ method: "POST" }).handler(
  async (): Promise<StoreSeoView> => staffRpc<StoreSeoView>("store_seo_proposals"),
);

export const decideStoreSeoProposalFn = createServerFn({ method: "POST" })
  .inputValidator((input: { id?: unknown; action?: unknown; text?: unknown }) => {
    if (typeof input?.id !== "string" || !UUID.test(input.id)) throw new Error("בקשה לא תקינה");
    if (input.action !== "approve" && input.action !== "reject" && input.action !== "later")
      throw new Error("בקשה לא תקינה");
    const text = typeof input.text === "string" ? input.text.slice(0, 600) : null;
    return { id: input.id, action: input.action, text };
  })
  .handler(async ({ data }) =>
    staffRpc<{ id: string; status: string }>("store_seo_proposal_decide", {
      _id: data.id,
      _action: data.action,
      _text: data.text,
    }),
  );

export const revertStoreSeoProposalFn = createServerFn({ method: "POST" })
  .inputValidator((input: { id?: unknown }) => {
    if (typeof input?.id !== "string" || !UUID.test(input.id)) throw new Error("בקשה לא תקינה");
    return { id: input.id };
  })
  .handler(async ({ data }) =>
    staffRpc<{ id: string; status: string }>("store_seo_proposal_revert", { _id: data.id }),
  );

export const generateStoreSeoFn = createServerFn({ method: "POST" })
  .inputValidator((input: { kind?: unknown }) => {
    if (input?.kind !== "template" && input?.kind !== "ai") throw new Error("בקשה לא תקינה");
    return { kind: input.kind as "template" | "ai" };
  })
  .handler(async ({ data }) => {
    const { handleStoreSeoGenerate } = await import("./store-seo.server");
    return handleStoreSeoGenerate(data.kind);
  });
