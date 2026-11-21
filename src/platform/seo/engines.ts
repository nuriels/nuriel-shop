// NURIEL AI SEO ENGINE — what each engine plugs into the platform worker. The platform never imports engine code
// (tests/architecture/boundaries.test.ts): every engine registers its own handler when its workers start
// (Engine.startWorkers, through the composition root src/app/engines.ts).
import type { BusinessFacts } from "./keywords";

export type SeoEngineKey = "ecommerce" | "hospitality";

export interface SeoProposalsInput {
  tenantId: string;
  /** initial — the whole business once; entity — the new items of one type (units / packages / images / products …) */
  scope: "initial" | "entity";
  entityType: string | null;
  /** may this run call NURIEL AI (the business's own package and quotas; the platform switch SEO_BACKGROUND_AI) */
  ai: boolean;
}

export interface SeoEngineHandler {
  /** proposals for empty fields only — always PENDING (or the owner's own auto switch, empty fields only) */
  proposals(input: SeoProposalsInput): Promise<Record<string, unknown>>;
  /** the facts the keyword seeds are built from (only what the business really published) */
  facts(tenantId: string): Promise<BusinessFacts | null>;
}

const handlers = new Map<SeoEngineKey, SeoEngineHandler>();

export function registerSeoEngine(key: SeoEngineKey, handler: SeoEngineHandler): void {
  handlers.set(key, handler);
}

export function seoEngineFor(key: string): SeoEngineHandler | null {
  return handlers.get(key as SeoEngineKey) ?? null;
}
