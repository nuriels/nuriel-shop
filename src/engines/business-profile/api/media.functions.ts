// ספריית המדיה בממשק הניהול (מיגרציה 194): רשימה, העלאה, טקסט חלופי ומחיקה. הקבצים נבדקים ומקודדים מחדש
// בשרת (data/media.server.ts) ונשמרים בדלי עם הטוקן של המשתמש; הרשומות — רק דרך פונקציות המסד.
import { createServerFn } from "@tanstack/react-start";
import type { MediaLibrary } from "../types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (v: unknown) => {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(s)) throw new Error("מזהה תמונה לא תקין");
  return s;
};
const altOf = (v: unknown) => {
  const he = String((v as { he?: unknown } | null)?.he ?? v ?? "").trim();
  if (he.length > 200) throw new Error("טקסט חלופי עד 200 תווים");
  return { he };
};

type RawLibrary = {
  items: {
    id: string;
    storage_path: string;
    variants: Record<string, string>;
    width: number | null;
    height: number | null;
    size_bytes: number;
    alt: { he: string; en?: string };
    original_name: string | null;
    created_at: string;
  }[];
  used_bytes: number;
  quota_bytes: number;
};

async function library(): Promise<MediaLibrary> {
  const [{ studioRpc }, { publicUrl }] = await Promise.all([
    import("../data/rpc.server"),
    import("../data/media.server"),
  ]);
  const raw = await studioRpc<RawLibrary>("bp_media_list");
  return {
    used_bytes: Number(raw.used_bytes),
    quota_bytes: Number(raw.quota_bytes),
    items: raw.items.map((m) => ({
      id: m.id,
      url: publicUrl(m.storage_path)!,
      thumb: publicUrl(m.variants["480"] ?? m.storage_path)!,
      width: m.width,
      height: m.height,
      size_bytes: Number(m.size_bytes),
      alt: m.alt,
      original_name: m.original_name,
      created_at: m.created_at,
    })),
  };
}

export const studioMedia = createServerFn({ method: "GET" }).handler(() => library());

export const studioUploadMedia = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error("בקשה לא תקינה");
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("לא נבחר קובץ");
    if (file.size > 12 * 1024 * 1024) throw new Error("התמונה גדולה מדי — עד 12MB");
    const alt = altOf(typeof data.get("alt") === "string" ? data.get("alt") : "");
    const name = String(file.name ?? "").slice(0, 200);
    return { file, alt, name };
  })
  .handler(async ({ data }): Promise<MediaLibrary> => {
    const [
      { requireSession },
      { allowAction },
      { businessSiteId, studioRpc },
      media,
      { randomUUID },
    ] = await Promise.all([
      import("@/platform/auth/session.server"),
      import("@/platform/security/rate-limit.server"),
      import("../data/rpc.server"),
      import("../data/media.server"),
      import("node:crypto"),
    ]);
    const session = await requireSession();
    if (!allowAction(`bp-media-upload:${session.userId}`, 120, 10 * 60 * 1000)) {
      throw new Error("יותר מדי העלאות בזמן קצר. נסו שוב בעוד כמה דקות.");
    }
    const siteId = await businessSiteId();
    const id = randomUUID();
    const prepared = await media.prepareImage(
      Buffer.from(await data.file.arrayBuffer()),
      siteId,
      id,
    );
    // יש מקום? (גם ההרשאה נבדקת כאן — לפני ששומרים קבצים)
    await studioRpc("bp_media_check_quota", { _bytes: prepared.record.size_bytes });
    await media.storeFiles(siteId, session.accessToken, prepared.files);
    try {
      await studioRpc("bp_media_add", {
        _id: id,
        _storage_path: prepared.record.storage_path,
        _variants: prepared.record.variants,
        _width: prepared.record.width,
        _height: prepared.record.height,
        _size_bytes: prepared.record.size_bytes,
        _alt: data.alt,
        _original_name: data.name || null,
      });
    } catch (error) {
      await media.removeFiles(
        siteId,
        session.accessToken,
        prepared.files.map((f) => f.path),
      );
      throw error;
    }
    return library();
  });

export const studioSetMediaAlt = createServerFn({ method: "POST" })
  .inputValidator((input: { id?: unknown; alt?: unknown }) => ({
    id: uuidOf(input?.id),
    alt: altOf(input?.alt),
  }))
  .handler(async ({ data }) => {
    const { studioRpc } = await import("../data/rpc.server");
    await studioRpc("bp_media_set_alt", { _id: data.id, _alt: data.alt });
    return library();
  });

export const studioDeleteMedia = createServerFn({ method: "POST" })
  .inputValidator((input: { id?: unknown }) => ({ id: uuidOf(input?.id) }))
  .handler(async ({ data }) => {
    const [{ requireSession }, { businessSiteId, studioRpc }, { removeFiles }] = await Promise.all([
      import("@/platform/auth/session.server"),
      import("../data/rpc.server"),
      import("../data/media.server"),
    ]);
    const session = await requireSession();
    const r = await studioRpc<{ paths: string[] }>("bp_media_delete", { _id: data.id });
    await removeFiles(await businessSiteId(), session.accessToken, r.paths);
    return library();
  });
