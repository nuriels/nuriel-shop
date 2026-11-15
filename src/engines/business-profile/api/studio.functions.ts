// ממשק הניהול של בעל העסק (/studio): ההקשר, הטיוטה (שמירה עם revision), פרסום / בקשת פרסום, היסטוריה
// ושחזור. כל ההרשאות במסד (bp_*: האתר של הבקשה + התפקיד); כאן — אימות קלט ונירמול המסמך לפני שמירה.
import { createServerFn } from "@tanstack/react-start";
import { normalizeDocument } from "../document/normalize";
import type { DraftData, StudioContext, VersionRow } from "../types";
import type { SiteDocument } from "../document/schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const revisionOf = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000_000) throw new Error("גרסת טיוטה לא תקינה");
  return n;
};
const uuidOf = (v: unknown) => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new Error("מזהה גרסה לא תקין");
  return s;
};
const noteOf = (v: unknown) => {
  const s = String(v ?? "").trim();
  if (s.length > 300) throw new Error("ההערה ארוכה מדי (עד 300 תווים)");
  return s || null;
};

async function afterPublish() {
  const [{ businessSiteId }, { invalidateSiteEnabled }] = await Promise.all([
    import("../data/rpc.server"),
    import("../access.server"),
  ]);
  invalidateSiteEnabled(await businessSiteId());
}

export const studioContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { state: "ok"; context: StudioContext } | { state: "signed_out" } | { state: "forbidden" }
  > => {
    const [{ sessionFromRequest }, { siteRpc, BusinessProfileError }] = await Promise.all([
      import("@/platform/auth/session.server"),
      import("../data/rpc.server"),
    ]);
    let session;
    try {
      session = await sessionFromRequest();
    } catch {
      return { state: "signed_out" };
    }
    if (!session) return { state: "signed_out" };
    try {
      const context = await siteRpc<StudioContext>(
        "bp_studio_context",
        {},
        { accessToken: session.accessToken },
      );
      return { state: "ok", context };
    } catch (error) {
      if (error instanceof BusinessProfileError && error.code === "42501")
        return { state: "forbidden" };
      throw error;
    }
  },
);

export const studioDraft = createServerFn({ method: "GET" }).handler(
  async (): Promise<DraftData> => {
    const { studioRpc } = await import("../data/rpc.server");
    const raw = await studioRpc<{ document: unknown; revision: number; updated_at: string }>(
      "bp_draft_get",
    );
    return {
      document: normalizeDocument(raw.document),
      revision: raw.revision,
      updatedAt: raw.updated_at,
    };
  },
);

export const studioSaveDraft = createServerFn({ method: "POST" })
  .inputValidator((input: { document: unknown; revision: unknown }) => ({
    // רק המסמך המנורמל נשמר: שדות לא מוכרים נזרקים, טקסטים מקוצרים, קישורים לא בטוחים מתאפסים
    document: normalizeDocument(input?.document) as SiteDocument,
    revision: revisionOf(input?.revision),
  }))
  .handler(async ({ data }): Promise<{ revision: number }> => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc("bp_draft_save", { _document: data.document, _revision: data.revision });
  });

export const studioPublish = createServerFn({ method: "POST" })
  .inputValidator((input: { revision: unknown; note?: unknown }) => ({
    revision: revisionOf(input?.revision),
    note: noteOf(input?.note),
  }))
  .handler(
    async ({
      data,
    }): Promise<{ mode: "pending_review" } | { mode: "published"; version: number }> => {
      const { studioRpc } = await import("../data/rpc.server");
      const result = await studioRpc<
        { mode: "pending_review" } | { mode: "published"; version: number }
      >("bp_publish", { _revision: data.revision, _note: data.note });
      if (result.mode === "published") await afterPublish();
      return result;
    },
  );

export const studioCancelPublishRequest = createServerFn({ method: "POST" }).handler(async () => {
  const { studioRpc } = await import("../data/rpc.server");
  await studioRpc("bp_cancel_publish_request");
  return { ok: true as const };
});

export const studioVersions = createServerFn({ method: "GET" }).handler(
  async (): Promise<VersionRow[]> => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<VersionRow[]>("bp_versions");
  },
);

export const studioVersion = createServerFn({ method: "GET" })
  .inputValidator((input: { id: unknown }) => ({ id: uuidOf(input?.id) }))
  .handler(async ({ data }) => {
    const { studioRpc } = await import("../data/rpc.server");
    const raw = await studioRpc<{ id: string; version: number | null; document: unknown }>(
      "bp_version_get",
      { _version: data.id },
    );
    return { id: raw.id, version: raw.version, document: normalizeDocument(raw.document) };
  });

export const studioRestoreVersion = createServerFn({ method: "POST" })
  .inputValidator((input: { id: unknown; revision: unknown }) => ({
    id: uuidOf(input?.id),
    revision: revisionOf(input?.revision),
  }))
  .handler(async ({ data }): Promise<{ revision: number }> => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc("bp_version_restore", { _version: data.id, _revision: data.revision });
  });

/** הכניסה לממשק הניהול — דרך הכניסה המרכזית של Nuriel (כמו בחנויות ובצימרים); חוזרים בקוד חד-פעמי */
export const studioCentralLogin = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ url: string | null }> => {
    const { portalLoginUrl } = await import("@/platform/tenancy/portal.server");
    return { url: portalLoginUrl() };
  },
);
