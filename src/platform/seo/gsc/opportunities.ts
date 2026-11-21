// NURIEL AI SEO ENGINE — opportunities from real Search Console numbers only (never estimated volumes).
// Rules are deliberately simple and explainable to a business owner:
//   • high impressions, low CTR on page one → the title / description in the result is not convincing;
//   • "striking distance" (average position ~8–20) with real impressions → a page worth improving;
//   • a drop: clicks this period vs the previous one, only when the previous one had enough clicks to matter;
//   • a query the business ranks for that is not on its keyword list yet → worth adding.
import type { GscRow } from "./csv";

export type OpportunityKind = "low_ctr" | "striking_distance" | "drop" | "new_query";

export interface Opportunity {
  kind: OpportunityKind;
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  previousClicks?: number;
  message: string;
}

export const OPPORTUNITY_RULES = {
  lowCtr: { minImpressions: 100, maxPosition: 10, maxCtr: 0.02 },
  striking: { minImpressions: 30, minPosition: 8, maxPosition: 20 },
  drop: { minPreviousClicks: 20, minDropRatio: 0.3 },
  newQuery: { minImpressions: 20 },
} as const;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pos = (n: number) => n.toFixed(1);

export function findOpportunities(
  current: GscRow[],
  options: { previous?: GscRow[]; knownKeywords?: string[]; limit?: number } = {},
): Opportunity[] {
  const out: Opportunity[] = [];
  const R = OPPORTUNITY_RULES;
  for (const r of current) {
    if (r.impressions >= R.lowCtr.minImpressions && r.position > 0 && r.position <= R.lowCtr.maxPosition && r.ctr <= R.lowCtr.maxCtr)
      out.push({
        kind: "low_ctr",
        ...r,
        message: `${r.impressions.toLocaleString("he-IL")} חשיפות בעמוד הראשון (מיקום ${pos(r.position)}) אבל רק ${pct(r.ctr)} לוחצים — כדאי לשפר את הכותרת והתיאור`,
      });
    else if (r.impressions >= R.striking.minImpressions && r.position >= R.striking.minPosition && r.position <= R.striking.maxPosition)
      out.push({
        kind: "striking_distance",
        ...r,
        message: `מיקום ממוצע ${pos(r.position)} עם ${r.impressions.toLocaleString("he-IL")} חשיפות — קרוב לעמוד הראשון; שיפור התוכן בעמוד יכול לעזור`,
      });
  }
  if (options.previous) {
    const prev = new Map(options.previous.map((r) => [r.key, r]));
    for (const r of current) {
      const p = prev.get(r.key);
      if (!p || p.clicks < R.drop.minPreviousClicks) continue;
      const drop = (p.clicks - r.clicks) / p.clicks;
      if (drop >= R.drop.minDropRatio)
        out.push({
          kind: "drop",
          ...r,
          previousClicks: p.clicks,
          message: `ירידה בקליקים: ${p.clicks} → ${r.clicks} (${Math.round(drop * 100)}%) לעומת התקופה הקודמת`,
        });
    }
    for (const p of options.previous) {
      if (p.clicks >= R.drop.minPreviousClicks && !current.some((r) => r.key === p.key))
        out.push({
          kind: "drop",
          key: p.key,
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
          previousClicks: p.clicks,
          message: `נעלם מהתוצאות: היו ${p.clicks} קליקים בתקופה הקודמת`,
        });
    }
  }
  if (options.knownKeywords) {
    const known = options.knownKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
    for (const r of current) {
      const q = r.key.trim().toLowerCase();
      if (r.impressions >= R.newQuery.minImpressions && !known.some((k) => q === k || q.includes(k) || k.includes(q)))
        out.push({
          kind: "new_query",
          ...r,
          message: `גוגל כבר מציג את האתר לחיפוש הזה (${r.impressions.toLocaleString("he-IL")} חשיפות) — כדאי להוסיף אותו לביטויי החיפוש של העסק`,
        });
    }
  }
  const weight: Record<OpportunityKind, number> = { drop: 0, low_ctr: 1, striking_distance: 2, new_query: 3 };
  return out
    .sort((a, b) => weight[a.kind] - weight[b.kind] || b.impressions - a.impressions)
    .slice(0, options.limit ?? 50);
}

/** totals for a period (impressions-weighted average position, like Search Console) */
export function totals(rows: GscRow[]): { clicks: number; impressions: number; ctr: number; position: number } {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const weighted = rows.reduce((s, r) => s + r.position * r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : 0,
  };
}
