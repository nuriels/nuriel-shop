// הגרסה המפורסמת של אתר (לגולשים): רק מה שהמסד מחזיר ב-bp_public_site — גרסה שאושרה, דגלים דולקים,
// אתר פעיל. המסמך מנורמל לפני ההצגה.
import { normalizeDocument } from "../document/normalize";
import { toMediaMap } from "./media.server";
import type { PublicSiteData } from "../types";
import { siteRpc } from "./rpc.server";

interface RawPublic {
  name: string;
  version: number;
  template: string;
  document: unknown;
  published_at: string;
}

export async function loadPublicSite(siteId?: string): Promise<PublicSiteData | null> {
  const opts = siteId ? { siteId } : {};
  const raw = await siteRpc<RawPublic | null>("bp_public_site", {}, opts);
  if (!raw) return null;
  const document = normalizeDocument(raw.document);
  // רק התמונות של הגרסה המפורסמת (המסד מחזיר רק אותן)
  const media = toMediaMap(
    await siteRpc<Parameters<typeof toMediaMap>[0]>("bp_media_public", {}, opts).catch(() => []),
  );
  return {
    name: raw.name,
    version: raw.version,
    publishedAt: raw.published_at,
    document,
    media,
    origin: null,
  };
}
