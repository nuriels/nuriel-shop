/**
 * NURIEL AI SEO ENGINE — Ecommerce: proposals for the store, its categories and products.
 *  • templates (no AI) — free, for every store, from what the store already published (store-templates.ts);
 *  • NURIEL AI — the SAME pipeline as every store AI feature (product-duplicates-ai.server.ts): the caller, the
 *    store's own package (evaluateAccess), the shared quotas and monthly budget (ai_quota_take) before EVERY
 *    model call, the same key / model / router client and the same usage log. No package → no call, no charge;
 *  • everything enters as a PENDING proposal (public.store_seo_proposals_add, empty fields only) — nothing is
 *    written to the store without the owner's approval (or the owner's own auto switch, empty fields only).
 * Background runs (the platform SEO worker) use a fixed system "user" only for the per-user quota bucket.
 */
import { ECOMMERCE_GUIDE_CATALOG } from "@/lib/ai/ecommerce-guides";
import {
  BUDGET_REACHED,
  evaluateAccess,
  resolveCaller,
  type AiCaller,
} from "@/platform/ai/assistant.server";
import {
  denialMessage,
  describeAiError,
  estimateCostUsd,
  FORBIDDEN_MESSAGE,
  LIMITED_MESSAGE,
  NO_TOKENS,
  type TokenUsage,
} from "@/platform/ai/logic";
import {
  createAnthropicRouterClient,
  thinkingFor,
  type RouterClient,
  type RouterParams,
} from "@/platform/ai/router.server";
import { SafeError } from "@/platform/ai/safe-error";
import * as aiStore from "@/platform/ai/store.server";
import { seoServiceRpc } from "@/platform/seo/db.server";
import { registerSeoEngine, type SeoProposalsInput } from "@/platform/seo/engines";
import type { BusinessFacts } from "@/platform/seo/keywords";
import {
  buildStoreSeoMessage,
  buildStoreSeoPrompt,
  parseStoreSeoOutput,
  STORE_AI_BATCH,
  STORE_AI_MAX_CALLS,
  STORE_SEO_USAGE_MARK,
  storeAiRefs,
  storeSeoSchema,
  type StoreAiRef,
} from "./store-ai";
import {
  storeTemplateProposals,
  type StoreProposalItem,
  type StoreSnapshot,
} from "./store-templates";

export const STORE_SEO_SYSTEM_USER = "00000000-0000-4000-8000-00000000a1e1";

export type StoreSeoGenerateResult =
  | { status: "ok"; added: number; auto_applied: number; skipped: number; calls: number }
  | { status: "unavailable" | "limited" | "failed"; message: string };

const snapshot = (tenantId: string, limit: number) =>
  seoServiceRpc<StoreSnapshot>("store_seo_snapshot", {
    _tenant: tenantId,
    _only_missing: true,
    _limit: limit,
  });

async function addProposals(tenantId: string, items: StoreProposalItem[]) {
  if (!items.length) return { added: 0, auto_applied: 0, skipped: 0 };
  return seoServiceRpc<{ added: number; auto_applied: number; skipped: number }>(
    "store_seo_proposals_add",
    {
      _tenant: tenantId,
      _items: items.slice(0, 300),
      _only_empty: true,
    },
  );
}

function params(
  model: Parameters<typeof thinkingFor>[0],
  refs: StoreAiRef[],
  storeName: string,
): RouterParams {
  const thinking = thinkingFor(model);
  return {
    model,
    max_tokens: model === "claude-opus-5-5" ? 6000 : 3000,
    ...(thinking ? { thinking } : {}),
    system: [{ type: "text", text: buildStoreSeoPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildStoreSeoMessage(storeName, refs) }],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: storeSeoSchema(refs.map((r) => r.ref)) },
    },
  };
}

/** the AI part: one call per batch, each after its own quota check; a blocked call stops the run */
export async function runStoreAi(
  caller: AiCaller,
  snap: StoreSnapshot,
  opts: { maxCalls?: number; fingerprint: string },
  deps: { createClient?: (apiKey: string) => Promise<RouterClient> } = {},
): Promise<StoreSeoGenerateResult> {
  const ev = await evaluateAccess(caller, ECOMMERCE_GUIDE_CATALOG);
  if (ev.denial !== null || !ev.key)
    return {
      status: "unavailable",
      message: denialMessage(ev.denial ?? "assistant_off", ev.state),
    };
  const maxCalls = Math.min(opts.maxCalls ?? STORE_AI_MAX_CALLS, STORE_AI_MAX_CALLS);
  const refs = storeAiRefs(snap, STORE_AI_BATCH * maxCalls);
  if (!refs.length) return { status: "ok", added: 0, auto_applied: 0, skipped: 0, calls: 0 };
  const createClient = deps.createClient ?? createAnthropicRouterClient;
  let client: RouterClient | null = null;
  const total = { added: 0, auto_applied: 0, skipped: 0 };
  let calls = 0;
  let ok = 0;
  for (let i = 0; i < refs.length && calls < maxCalls; i += STORE_AI_BATCH) {
    const batch = refs.slice(i, i + STORE_AI_BATCH);
    let quota: aiStore.QuotaResult | "unchecked";
    try {
      quota = await aiStore.takeQuota({
        tenantId: caller.tenantId,
        userId: caller.userId,
        fingerprint: `${opts.fingerprint}:${batch[0]!.id}`,
        modelCall: true,
      });
    } catch {
      quota = "unchecked";
    }
    if (quota !== "ok") {
      if (quota === "budget" && ev.settings?.last_error !== BUDGET_REACHED)
        await aiStore.recordLastError(BUDGET_REACHED);
      if (ok === 0)
        return quota === "user" || quota === "tenant" || quota === "global" || quota === "repeated"
          ? { status: "limited", message: LIMITED_MESSAGE }
          : { status: "unavailable", message: "הצעות ה-AI לא זמינות כרגע. נסו שוב מאוחר יותר." };
      break;
    }
    client ??= await createClient(ev.key);
    calls += 1;
    let usage: TokenUsage = NO_TOKENS;
    let error: string | null = null;
    let items: StoreProposalItem[] = [];
    try {
      const call = await client.send(params(ev.model, batch, snap.store?.name ?? ""));
      usage = {
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        cacheWriteTokens: call.cacheWriteTokens ?? 0,
        cacheReadTokens: call.cacheReadTokens ?? 0,
      };
      if (call.stopReason === "refusal") items = [];
      else if (call.stopReason !== "end_turn" || call.text === null)
        error = describeAiError(
          new Error(`unexpected format (stop_reason ${String(call.stopReason)})`),
        );
      else items = parseStoreSeoOutput(JSON.parse(call.text), batch);
    } catch (e) {
      const u = (e as { usage?: TokenUsage } | null)?.usage;
      if (u && typeof u.inputTokens === "number") usage = u;
      error = describeAiError(e);
    }
    if (!error) {
      ok += 1;
      const r = await addProposals(caller.tenantId, items);
      total.added += r.added;
      total.auto_applied += r.auto_applied;
      total.skipped += r.skipped;
    }
    if (!error && ev.settings?.last_error) await aiStore.recordLastError(null);
    if (error) await aiStore.recordLastError(error);
    await aiStore.logUsage({
      tenantId: caller.tenantId,
      product: "ecommerce",
      mode: ev.testMode ? "test" : error ? "ai_error" : "ai",
      outcome: error ? "failed" : "guides",
      guides: [STORE_SEO_USAGE_MARK],
      question: null,
      model: ev.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      cacheReadTokens: usage.cacheReadTokens,
      costUsd: estimateCostUsd(ev.model, usage),
      error,
    });
  }
  if (calls > 0 && ok === 0)
    return {
      status: "failed",
      message: "לא הצלחתי להכין הצעות עם AI כרגע. נסו שוב בעוד כמה דקות.",
    };
  return { status: "ok", ...total, calls };
}

// ------------------------------------------------------------------ the platform worker (background)

const ENTITY: Record<string, StoreProposalItem["target_kind"]> = {
  product: "product",
  category: "category",
};

async function proposals(input: SeoProposalsInput): Promise<Record<string, unknown>> {
  const snap = await snapshot(input.tenantId, input.scope === "initial" ? 100 : 60);
  let items = storeTemplateProposals(snap);
  const only = input.scope === "entity" && input.entityType ? ENTITY[input.entityType] : undefined;
  if (only) items = items.filter((i) => i.target_kind === only);
  const template = await addProposals(input.tenantId, items);
  let ai: StoreSeoGenerateResult | null = null;
  if (input.ai) {
    const caller: AiCaller = {
      userId: STORE_SEO_SYSTEM_USER,
      tenantId: input.tenantId,
      role: "owner",
      platformAdmin: false,
    };
    // the snapshot again: the template proposals now cover some fields (they are skipped as "open")
    ai = await runStoreAi(caller, await snapshot(input.tenantId, 60), {
      maxCalls: input.scope === "initial" ? STORE_AI_MAX_CALLS : 1,
      fingerprint: `seo-store:${input.scope}`,
    });
  }
  return { template, ai };
}

async function facts(tenantId: string): Promise<BusinessFacts | null> {
  const snap = await seoServiceRpc<StoreSnapshot>("store_seo_snapshot", {
    _tenant: tenantId,
    _only_missing: false,
    _limit: 30,
  });
  const name = snap.store?.name?.trim();
  if (!name) return null;
  return {
    engine: "ecommerce",
    name,
    places: [],
    categories: snap.categories
      .filter((c) => c.products > 0)
      .sort((a, b) => b.products - a.products)
      .slice(0, 4)
      .map((c) => c.name),
    offerings: snap.products.slice(0, 12).map((p) => p.name),
    audiences: [],
  };
}

export function registerStoreSeo(): void {
  registerSeoEngine("ecommerce", { proposals, facts });
}

// ------------------------------------------------------------------ the store admin (on request)

/** "suggest": templates for every store; AI only with the store's NURIEL AI package — empty fields only */
export async function handleStoreSeoGenerate(
  kind: "template" | "ai",
  deps: { createClient?: (apiKey: string) => Promise<RouterClient> } = {},
): Promise<StoreSeoGenerateResult> {
  const caller = await resolveCaller("ecommerce", { bucket: "ai:seo-store-gate", perMinute: 6 });
  if (caller === "limited") return { status: "limited", message: LIMITED_MESSAGE };
  if (!caller) throw new SafeError(FORBIDDEN_MESSAGE);
  if (kind === "template") {
    const snap = await snapshot(caller.tenantId, 200);
    const r = await addProposals(caller.tenantId, storeTemplateProposals(snap));
    return { status: "ok", ...r, calls: 0 };
  }
  return runStoreAi(
    caller,
    await snapshot(caller.tenantId, 60),
    { fingerprint: "seo-store:request" },
    deps,
  );
}
