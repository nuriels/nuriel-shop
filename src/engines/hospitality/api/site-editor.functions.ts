// עורך האתר (Stage 5b) — לצוות עם הרשאת settings (בעלים ומנהלים), אזור הניהול פעיל:
// טעינת הטיוטה והגרסאות, שמירה אוטומטית (revision), פרסום, שחזור, ותצוגה מקדימה (נתוני האתר
// + הטיוטה, גם כשהאתר סגור לגולשים). המסמך עובר normalizeDesign בשרת לפני השמירה — וגם בהצגה.
import { createServerFn } from "@tanstack/react-start";
import type { PublicPackage } from "../types/packages";
import type { PublicRoomType, PublicSite, RawPublicSite } from "../types/website";
import { InputError } from "../validation/input";
import { normalizeDesign } from "../website/design/schema";
import { toPublicSite } from "../website/lib/site-map";

export interface SiteEditorView {
  draft: {
    revision: number;
    theme: string;
    document: string;
    based_on: number | null;
    updated_at: string;
  } | null;
  published: { version: number; theme: string; document: string; published_at: string } | null;
  unpublished: boolean;
  site_open: boolean;
  /** מיגרציה 40: הפרסום הבא יפתח את האתר לגולשים (עסק שנפתח מהשער); חסר — מסד בלי 40 */
  opens_on_publish?: boolean;
  versions: { version: number; theme: string; note: string | null; published_at: string }[];
  /** E5: הכתובות של האתר — לבחירת הכתובת הקנונית ולתצוגה המקדימה של גוגל */
  addresses: { primary: string | null; subdomain: string | null };
  /** Google SEO שלב 4: המדידה (GA4) זמינה לאתר (המתג hospitality_analytics_enabled) — רק אז יש שדה למזהה */
  analytics_enabled: boolean;
}

type RawEditor = Omit<SiteEditorView, "draft" | "published" | "addresses" | "analytics_enabled"> & {
  draft: (Omit<NonNullable<SiteEditorView["draft"]>, "document"> & { document: unknown }) | null;
  published:
    (Omit<NonNullable<SiteEditorView["published"]>, "document"> & { document: unknown }) | null;
};

const MAX_DOCUMENT_CHARS = 200_000;

function revision(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
    throw new InputError("גרסת הטיוטה לא תקינה");
  return v;
}

export const hospitalitySiteEditor = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteEditorView> => {
    const [{ manageRpc }, { currentSiteAddresses }] = await Promise.all([
      import("../server/manage.server"),
      import("@/platform/tenancy/current-site.server"),
    ]);
    const [raw, addresses, analytics] = await Promise.all([
      manageRpc<RawEditor>("site_editor", {}),
      currentSiteAddresses(),
      // בלי מיגרציית ההסכמה / כשהמסד לא ענה — כאילו כבוי (אין שדה)
      manageRpc<boolean>("analytics_enabled", {}).catch(() => false),
    ]);
    return {
      ...raw,
      addresses,
      analytics_enabled: analytics === true,
      draft: raw.draft
        ? { ...raw.draft, document: JSON.stringify(raw.draft.document ?? {}) }
        : null,
      published: raw.published
        ? { ...raw.published, document: JSON.stringify(raw.published.document ?? {}) }
        : null,
    };
  },
);

export const hospitalitySiteDraftSave = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const json = typeof input?.["document"] === "string" ? input["document"] : "";
    if (!json || json.length > MAX_DOCUMENT_CHARS) throw new InputError("מסמך האתר לא תקין");
    return { revision: revision(input?.["revision"]), design: normalizeDesign(json) };
  })
  .handler(async ({ data }): Promise<{ revision: number; updated_at: string }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ revision: number; updated_at: string }>("site_draft_save", {
      _revision: data.revision,
      _theme: data.design.theme,
      _document: data.design,
    });
  });

export const hospitalitySitePublish = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const note = input?.["note"];
    if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 120))
      throw new InputError("ההערה ארוכה מדי (עד 120 תווים)");
    return {
      revision: revision(input?.["revision"]),
      note: typeof note === "string" ? note : null,
    };
  })
  .handler(async ({ data }): Promise<{ version: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ version: number }>("site_publish", {
      _revision: data.revision,
      _note: data.note,
    });
  });

export const hospitalitySiteRestore = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const v = input?.["version"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
      throw new InputError("הגרסה לא נמצאה");
    return { version: v };
  })
  .handler(async ({ data }): Promise<{ revision: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ revision: number }>("site_restore", { _version: data.version });
  });

/** התצוגה המקדימה: נתוני האתר + הטיוטה — גם כשהאתר עוד סגור לגולשים */
export const hospitalitySitePreview = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSite> => {
    const [{ manageRpc }, { publicUrl }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/media.server"),
    ]);
    const [raw, types, packages] = await Promise.all([
      manageRpc<RawPublicSite>("site_preview", {}),
      // סוגי חדרים — לתצוגה (מי שאין לו הרשאת קטלוג רואה את היחידות בלי קיבוץ)
      manageRpc<PublicRoomType[]>("room_types_view", {}).catch(() => [] as PublicRoomType[]),
      // שלב א' 7: החבילות שמוצגות באתר (מי שאין לו הרשאת קטלוג — בלי)
      manageRpc<{ packages: (PublicPackage & { is_active: boolean })[] }>("packages_view", {})
        .then((v) => v.packages.filter((p) => p.is_active))
        .catch(() => [] as PublicPackage[]),
    ]);
    return toPublicSite(raw, publicUrl, types, packages);
  },
);
