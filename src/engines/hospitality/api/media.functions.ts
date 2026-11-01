// תמונות וגלריות (Stage 2e). הרשומות — רק דרך פונקציות המסד (מיגרציה 12) עם הטוקן של
// המשתמש; הקבצים — נבדקים ומקודדים מחדש בשרת (server/media.server.ts) ונשמרים בדלי עם
// אותו טוקן. ייבוא מקישור — ההורדה המוגנת (SSRF) של הפלטפורמה; העותק שלנו בלבד מוצג.
import { createServerFn } from "@tanstack/react-start";
import type {
  GalleriesOverview,
  Gallery,
  GalleryCard,
  GalleryRef,
  MediaActionResult,
  MediaItem,
} from "../types/media";
import {
  parseAlt,
  parseGallery,
  parseImportInput,
  parseMediaId,
  parseMediaOrder,
  parseUploadForm,
  parseVideoLinkInput,
} from "../validation/media";

type RawItem = Omit<MediaItem, "url" | "thumb_url" | "srcset"> & {
  storage_path: string | null;
  variants: Record<string, string>;
};
type RawGallery = Omit<Gallery, "items"> & { items: RawItem[] };

async function withUrls(item: RawItem | null): Promise<MediaItem | null> {
  if (!item) return null;
  const { publicUrl } = await import("../server/media.server");
  const { storage_path, variants, ...rest } = item;
  const v = variants ?? {};
  return {
    ...rest,
    url: publicUrl(storage_path),
    thumb_url: publicUrl(v["thumb"] ?? (item.kind === "image" ? storage_path : null)),
    srcset:
      item.kind === "image" && v["480"] && v["960"]
        ? `${publicUrl(v["480"])} 480w, ${publicUrl(v["960"])} 960w, ${publicUrl(storage_path)} ${item.width ?? 1600}w`
        : null,
  };
}

async function gallery(ref: GalleryRef): Promise<Gallery> {
  const { manageRpc } = await import("../server/manage.server");
  const raw = await manageRpc<RawGallery>("media_list", {
    _owner_kind: ref.ownerKind,
    _owner_id: ref.ownerId,
  });
  return { ...raw, items: (await Promise.all(raw.items.map(withUrls))) as MediaItem[] };
}

export const hospitalityGallery = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGallery(input))
  .handler(({ data }): Promise<Gallery> => gallery(data));

export const hospitalityGalleries = createServerFn({ method: "GET" }).handler(
  async (): Promise<GalleriesOverview> => {
    const { manageRpc } = await import("../server/manage.server");
    type RawCard = Omit<GalleryCard, "cover"> & { cover: RawItem | null };
    const raw = await manageRpc<{
      usage: GalleriesOverview["usage"];
      site: { count: number; cover: RawItem | null };
      properties: (RawCard & { units: (RawCard & { is_active: boolean })[] })[];
    }>("media_galleries", {});
    return {
      usage: raw.usage,
      site: { count: raw.site.count, cover: await withUrls(raw.site.cover) },
      properties: await Promise.all(
        raw.properties.map(async (p) => ({
          ...p,
          cover: await withUrls(p.cover),
          units: await Promise.all(
            p.units.map(async (u) => ({ ...u, cover: await withUrls(u.cover) })),
          ),
        })),
      ),
    };
  },
);

/** קובץ מוכן (תמונה מקודדת מחדש / סרטון) → הדלי → רשומה; כישלון ברישום — הקבצים נמחקים */
async function storeAndRecord(
  ref: GalleryRef,
  replaceId: string | null,
  bytes: Buffer,
  extra: { alt: string | null; source_url?: string },
  allowVideo: boolean,
): Promise<Gallery> {
  const [{ manageRpc, manageSession }, media] = await Promise.all([
    import("../server/manage.server"),
    import("../server/media.server"),
  ]);
  const { siteId, accessToken } = await manageSession();
  const prepared = await media.prepareMedia(siteId, bytes, allowVideo);
  await media.storeFiles(siteId, accessToken, prepared.files);
  const item = {
    ...prepared.item,
    alt: extra.alt,
    ...(extra.source_url ? { source_url: extra.source_url } : {}),
  };
  try {
    if (replaceId) {
      const r = await manageRpc<{ removed_files: string[] }>("media_replace", {
        _id: replaceId,
        _item: item,
      });
      await media.removeFiles(siteId, accessToken, r.removed_files);
      return gallery(ref);
    }
    await manageRpc("media_add", {
      _owner_kind: ref.ownerKind,
      _owner_id: ref.ownerId,
      _item: item,
    });
  } catch (error) {
    await media.removeFiles(
      siteId,
      accessToken,
      prepared.files.map((f) => f.path),
    );
    throw error;
  }
  return gallery(ref);
}

/** העלאה מהמחשב / מהטלפון (FormData: ownerKind, ownerId, file, alt) — או החלפה (replaceId) */
export const hospitalityUploadMedia = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => parseUploadForm(data))
  .handler(async ({ data }): Promise<Gallery> => {
    const bytes = Buffer.from(await data.file.arrayBuffer());
    return storeAndRecord(data.gallery, data.replaceId, bytes, { alt: data.alt }, true);
  });

/** ייבוא מקישור: השרת מוריד (הגנת SSRF), בודק, מקודד מחדש ושומר עותק עצמאי */
export const hospitalityImportMedia = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseImportInput(input))
  .handler(async ({ data }): Promise<Gallery> => {
    const [{ fetchRemoteImage, describeImageError }, { allowAction, requestIp }] =
      await Promise.all([
        import("@/platform/media/remote-image.server"),
        import("@/platform/security/rate-limit.server"),
      ]);
    const { HospitalityError } = await import("../server/rpc.server");
    if (!allowAction(`hosp-media-import:${await requestIp()}`, 30, 10 * 60 * 1000))
      throw new HospitalityError("יותר מדי ייבואים בזמן קצר — נסו שוב בעוד כמה דקות", "53400");
    let bytes: Buffer;
    try {
      bytes = (await fetchRemoteImage(data.url)).bytes;
    } catch (error) {
      throw new HospitalityError(describeImageError(error), "22023");
    }
    return storeAndRecord(data, null, bytes, { alt: data.alt, source_url: data.url }, false);
  });

export const hospitalityAddVideoLink = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseVideoLinkInput(input))
  .handler(async ({ data }): Promise<Gallery> => {
    const { manageRpc } = await import("../server/manage.server");
    await manageRpc("media_add_embed", {
      _owner_kind: data.ownerKind,
      _owner_id: data.ownerId,
      _provider: data.video.provider,
      _embed_id: data.video.id,
      _alt: data.alt,
    });
    return gallery(data);
  });

export const hospitalitySetMediaCover = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    ...parseMediaId(input),
    ...parseGallery(input),
  }))
  .handler(async ({ data }): Promise<Gallery> => {
    const { manageRpc } = await import("../server/manage.server");
    await manageRpc("media_set_cover", { _id: data.id });
    return gallery(data);
  });

export const hospitalityUpdateMediaAlt = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    ...parseAlt(input),
    ...parseGallery(input),
  }))
  .handler(async ({ data }): Promise<Gallery> => {
    const { manageRpc } = await import("../server/manage.server");
    await manageRpc("media_update", { _id: data.id, _alt: data.alt });
    return gallery(data);
  });

/** סדר: נשמר רק אם הסדר שנטען עדיין נכון; אחרת — הגלריה העדכנית (לא שגיאה) */
export const hospitalityReorderMedia = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseMediaOrder(input))
  .handler(async ({ data }): Promise<MediaActionResult> => {
    const [{ manageRpc }, { HospitalityError }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/rpc.server"),
    ]);
    try {
      await manageRpc("media_reorder", {
        _owner_kind: data.ownerKind,
        _owner_id: data.ownerId,
        _expected: data.expected,
        _ids: data.ids,
      });
      return { status: "done", gallery: await gallery(data) };
    } catch (error) {
      if (error instanceof HospitalityError && error.code === "HS409")
        return { status: "conflict", message: error.message, gallery: await gallery(data) };
      throw error;
    }
  });

/** מחיקה: הרשומה במסד, ואז הקבצים שהמסד החזיר — מהדלי */
export const hospitalityDeleteMedia = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    ...parseMediaId(input),
    ...parseGallery(input),
  }))
  .handler(async ({ data }): Promise<Gallery> => {
    const [{ manageRpc, manageSession }, { removeFiles }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/media.server"),
    ]);
    const { siteId, accessToken } = await manageSession();
    const r = await manageRpc<{ removed_files: string[] }>("media_delete", { _id: data.id });
    await removeFiles(siteId, accessToken, r.removed_files);
    return gallery(data);
  });
