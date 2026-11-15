// הגרסה המפורסמת של אתר (לגולשים): רק מה שהמסד מחזיר ב-bp_public_site — גרסה שאושרה, דגלים דולקים,
// אתר פעיל. המסמך מנורמל לפני ההצגה.
import { normalizeDocument } from "../document/normalize";
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
  const raw = await siteRpc<RawPublic | null>("bp_public_site", {}, siteId ? { siteId } : {});
  if (!raw) return null;
  const document = normalizeDocument(raw.document);
  return {
    name: raw.name,
    version: raw.version,
    publishedAt: raw.published_at,
    document,
    media: {},
    origin: null,
  };
}
