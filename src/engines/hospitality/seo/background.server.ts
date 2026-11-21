// מנוע ה-SEO של הפלטפורמה — החלק של Hospitality (נרשם כשתהליכי הרקע של המנוע עולים; הפלטפורמה לא מייבאת
// קוד של מנוע). הנתונים: אותם נתונים ציבוריים שהאתר מציג (public_site / public_room_types / public_packages),
// לפי העסק של המשימה. אתר שעוד לא פתוח לאורחים — אין הפקה. ההצעות: התבניות הקיימות (בחינם, לכל עסק) ו-NURIEL AI
// הקיים (רק לעסק עם חבילה, רק כשהפלטפורמה הפעילה הפקה ברקע) — לשדות ריקים בלבד, כהצעות ממתינות לאישור.
import { seoServiceRpc } from "@/platform/seo/db.server";
import { registerSeoEngine, type SeoProposalsInput } from "@/platform/seo/engines";
import type { BusinessFacts } from "@/platform/seo/keywords";
import { runBackgroundAi } from "../ai/seo-writer.server";
import { publicUrl } from "../server/media.server";
import type { PublicPackage } from "../types/packages";
import type { SeoProposalItem } from "../types/seo";
import type { PublicRoomType, PublicSite, RawPublicSite } from "../types/website";
import { siteCopy } from "../website/copy";
import { normalizeDesign, type SiteDesign } from "../website/design/schema";
import { toPublicSite } from "../website/lib/site-map";
import { rpc as publicRpc } from "../website/seo.server";
import { localityOf, templateProposals } from "../website/seo-templates";

const t = siteCopy("he");

async function loadPublic(tenantId: string): Promise<{ site: PublicSite; design: SiteDesign }> {
  const [raw, types, packages] = await Promise.all([
    publicRpc<RawPublicSite>(tenantId, "public_site"),
    publicRpc<PublicRoomType[]>(tenantId, "public_room_types").catch(() => [] as PublicRoomType[]),
    publicRpc<PublicPackage[]>(tenantId, "public_packages").catch(() => [] as PublicPackage[]),
  ]);
  // הביטויים של העסק נקראים מהמסמך לפני toPublicSite (שמסיר אותם)
  const design = normalizeDesign(raw.design?.document ?? null, raw.design?.theme);
  return { site: toPublicSite(raw, publicUrl, types, packages), design };
}

/** איזה יעדים כל סוג משימה מכסה (משימה "חדשים" של יחידות / חבילות / תמונות) */
const TARGETS: Record<string, SeoProposalItem["target_kind"][]> = {
  unit: ["unit"],
  package: ["package"],
  media: ["media"],
};

async function proposals(input: SeoProposalsInput): Promise<Record<string, unknown>> {
  let data: { site: PublicSite; design: SiteDesign };
  try {
    data = await loadPublic(input.tenantId);
  } catch {
    return { skipped: "site_not_open" };
  }
  const rpc = <T>(fn: string, args: Record<string, unknown>) =>
    seoServiceRpc<T>(fn, args, { schema: "hospitality", tenantId: input.tenantId });
  const run = await rpc<string | null>("seo_run_start", {
    _tenant: input.tenantId,
    _actor: null,
    _kind: "template",
    _scope: input.scope === "initial" ? "initial" : "auto",
  });
  let template: Record<string, unknown> = { status: "already" };
  if (run) {
    try {
      let items = templateProposals({ site: data.site, design: data.design });
      const only = input.scope === "entity" && input.entityType ? TARGETS[input.entityType] : null;
      if (only) items = items.filter((i) => only.includes(i.target_kind));
      const r = items.length
        ? await rpc<{ added: number; skipped: number; applied?: number }>("seo_proposals_add", {
            _tenant: input.tenantId,
            _run: run,
            _items: items,
            _only_empty: true,
          })
        : { added: 0, skipped: 0 };
      await rpc("seo_run_finish", { _tenant: input.tenantId, _run: run, _ok: true });
      template = { status: "ok", ...r };
    } catch (e) {
      await rpc("seo_run_finish", { _tenant: input.tenantId, _run: run, _ok: false }).catch(
        () => undefined,
      );
      throw e;
    }
  }
  const ai = input.ai
    ? await runBackgroundAi(input.tenantId, data, {
        scope: input.scope,
        entityType: input.entityType,
        rpc,
      })
    : null;
  return { template, ai };
}

async function facts(tenantId: string): Promise<BusinessFacts | null> {
  let site: PublicSite;
  try {
    site = (await loadPublic(tenantId)).site;
  } catch {
    return null;
  }
  const p = site.properties[0];
  const kind = (p?.property_type ? t.propertyTypes[p.property_type] : "") || "";
  const place = localityOf(site.business.address) ?? localityOf(p?.address);
  return {
    engine: "hospitality",
    name: site.business.name,
    places: place ? [place] : [],
    categories: kind ? [kind] : [],
    offerings: [...site.units.map((u) => u.name), ...(site.packages ?? []).map((k) => k.name)],
    audiences: [],
  };
}

export function registerHospitalitySeo(): void {
  registerSeoEngine("hospitality", { proposals, facts });
}
