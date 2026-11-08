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
  parseHeroVideoForm,
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

interface VideoCheck {
  seconds: number | null;
  codec: HeroVideoUpload["codec"] | "other";
  hero_ok: boolean;
}

/**
 * סרטון שנשמר: האורך וה-codec מתוך הקובץ עצמו (video-info.ts — הארוך מבין הכותרת, הרצועות והפריים
 * האחרון) → המסד, במפתח השירות (מיגרציה 62: הצוות לא יכול להצהיר על אורך). כישלון — הסרטון נשאר
 * "לא נבדק" (לא מוצג בפתיח), והבדיקה ברקע תמדוד אותו שוב
 */
async function recordVideoInfo(
  siteId: string,
  id: string,
  bytes: Uint8Array,
): Promise<VideoCheck | null> {
  const [{ videoInfo }, { callServerRpc }] = await Promise.all([
    import("../media/video-info"),
    import("../server/rpc.server"),
  ]);
  const info = videoInfo(bytes);
  try {
    return await callServerRpc<VideoCheck>(
      "media_video_verified",
      { _tenant: siteId, _id: id, _seconds: info?.seconds ?? null, _codec: info?.codec ?? null },
      { ip: "unknown", userAgent: "hospitality-media-check" },
    );
  } catch (error) {
    console.error(
      "[hospitality] video length not recorded",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * קובץ מוכן (תמונה מקודדת מחדש / סרטון) → הדלי → רשומה; כישלון ברישום — הקבצים נמחקים.
 * סרטון — האורך שנמדד נרשם לפני שהגלריה נטענת מחדש
 */
async function storeAndRecord(
  ref: GalleryRef,
  replaceId: string | null,
  bytes: Buffer,
  extra: { alt: string | null; source_url?: string },
  allowVideo: boolean,
): Promise<{ gallery: Gallery; id: string; video: VideoCheck | null }> {
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
  let id: string;
  try {
    if (replaceId) {
      const r = await manageRpc<{ removed_files: string[] }>("media_replace", {
        _id: replaceId,
        _item: item,
      });
      await media.removeFiles(siteId, accessToken, r.removed_files);
      id = replaceId;
    } else {
      const added = await manageRpc<{ id: string }>("media_add", {
        _owner_kind: ref.ownerKind,
        _owner_id: ref.ownerId,
        _item: item,
      });
      id = added.id;
    }
  } catch (error) {
    await media.removeFiles(
      siteId,
      accessToken,
      prepared.files.map((f) => f.path),
    );
    throw error;
  }
  const video = prepared.kind === "video" ? await recordVideoInfo(siteId, id, bytes) : null;
  return { gallery: await gallery(ref), id, video };
}

/** העלאה מהמחשב / מהטלפון (FormData: ownerKind, ownerId, file, alt) — או החלפה (replaceId) */
export const hospitalityUploadMedia = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => parseUploadForm(data))
  .handler(async ({ data }): Promise<Gallery> => {
    const [{ guardStaff }, { manageSession }] = await Promise.all([
      import("../security/guard.server"),
      import("../server/manage.server"),
    ]);
    const session = await manageSession();
    await guardStaff("mediaUpload", { userId: session.userId, siteId: session.siteId });
    const bytes = Buffer.from(await data.file.arrayBuffer());
    // לוגו — תמונה בלבד (גם המסד בודק). סרטון בגלריה — כל אורך (עד 50MB), אבל נמדד: לפתיח רק עד 15 שניות
    const allowVideo = data.gallery.ownerKind !== "brand";
    const r = await storeAndRecord(
      data.gallery,
      data.replaceId,
      bytes,
      { alt: data.alt },
      allowVideo,
    );
    return r.gallery;
  });

export interface HeroVideoUpload {
  id: string;
  url: string | null;
  seconds: number;
  /** HEVC (אייפון, "יעילות גבוהה") — חלק מהדפדפנים לא מנגנים; שם האתר נשאר עם התמונה */
  codec: "h264" | "hevc" | "av1" | "vp8" | "vp9" | null;
}

/**
 * סרטון הפתיח (עיצוב האתר): עד 15 שניות ועד 20MB — נבדק כאן על הקובץ עצמו (סוג, גודל ואורך
 * מתוך המכולה), לא לפי מה שהדפדפן דיווח ולא לפי הסיומת. נשמר בגלריית האתר (כמו כל סרטון), האורך
 * שנמדד נרשם במסד (מיגרציה 62) — והמסד מקבל אותו כסרטון הפתיח רק אחרי הרישום.
 */
export const hospitalityUploadHeroVideo = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => parseHeroVideoForm(data))
  .handler(async ({ data }): Promise<HeroVideoUpload> => {
    const [{ guardStaff }, { manageSession }, { videoInfo, heroVideoProblem }, { MediaError }] =
      await Promise.all([
        import("../security/guard.server"),
        import("../server/manage.server"),
        import("../media/video-info"),
        import("../server/media.server"),
      ]);
    const session = await manageSession();
    await guardStaff("mediaUpload", { userId: session.userId, siteId: session.siteId });
    const bytes = Buffer.from(await data.file.arrayBuffer());
    const info = videoInfo(bytes);
    const problem = heroVideoProblem(info, bytes.length);
    if (problem || !info || info.seconds === null)
      throw new MediaError(problem ?? "הסרטון לא תקין");
    const ref: GalleryRef = { ownerKind: "site", ownerId: null };
    const r = await storeAndRecord(ref, null, bytes, { alt: data.alt }, true);
    const added = r.gallery.items.find((m) => m.id === r.id && m.kind === "video");
    if (!added) throw new MediaError("הסרטון נשמר, אבל לא נמצא בגלריה — רעננו את העמוד ונסו שוב");
    // בלי רישום האורך המסד לא יקבל אותו לפתיח — עדיף להגיד עכשיו (הסרטון נשאר ב"תמונות")
    if (!r.video?.hero_ok)
      throw new MediaError('הסרטון נשמר ב"תמונות", אבל בדיקת האורך לא הושלמה — נסו להעלות שוב');
    return {
      id: added.id,
      url: added.url,
      seconds: Math.round(info.seconds * 10) / 10,
      codec: info.codec,
    };
  });

/** ייבוא מקישור: השרת מוריד (הגנת SSRF), בודק, מקודד מחדש ושומר עותק עצמאי */
export const hospitalityImportMedia = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseImportInput(input))
  .handler(async ({ data }): Promise<Gallery> => {
    const [{ fetchRemoteImage, describeImageError }, { guardStaff }, { manageSession }] =
      await Promise.all([
        import("@/platform/media/remote-image.server"),
        import("../security/guard.server"),
        import("../server/manage.server"),
      ]);
    const { HospitalityError } = await import("../server/rpc.server");
    // הגבלה משותפת לכל השרתים, לפי המשתמש (אחרי שהוא מזוהה כצוות של העסק)
    const session = await manageSession();
    await guardStaff("mediaImport", { userId: session.userId, siteId: session.siteId });
    let bytes: Buffer;
    try {
      bytes = (await fetchRemoteImage(data.url)).bytes;
    } catch (error) {
      throw new HospitalityError(describeImageError(error), "22023");
    }
    return (await storeAndRecord(data, null, bytes, { alt: data.alt, source_url: data.url }, false))
      .gallery;
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
