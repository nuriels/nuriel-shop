// התצוגה המקדימה של הטיוטה (בתוך מסגרת בעורך). נטענת מהטיוטה השמורה, ומתעדכנת מיד בכל שינוי בעורך — עוד לפני
// השמירה — מהודעה של החלון שמעליה בלבד (אותו מקור, אותו חלון אב). המסמך שמתקבל עובר נרמול לפני ההצגה.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { normalizeDocument, pageBySlug } from "../document/normalize";
import type { SiteDocument } from "../document/schema";
import { studioDraft } from "../api/studio.functions";
import { SiteView } from "../site/SiteView";
import type { MediaMap } from "../types";
import { previewMediaMap, useMediaLibrary } from "./editor/media";

/** העורך → התצוגה: {type, doc, media} */
export const PREVIEW_DOC = "bp-preview-doc";
/** התצוגה → העורך: "נטענתי, שלחו את המסמך" */
export const PREVIEW_READY = "bp-preview-ready";

const SAFE_URL = /^(https?:\/\/|\/)[^\s"'<>]*$/;

/** רק כתובות תמונה תקינות (http/https או נתיב באתר) — שום דבר אחר מההודעה לא נכנס לתצוגה */
function mediaOf(value: unknown): MediaMap | null {
  if (!value || typeof value !== "object") return null;
  const out: MediaMap = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const m = raw as Record<string, unknown> | null;
    const url = typeof m?.["url"] === "string" ? m["url"] : "";
    if (!SAFE_URL.test(url)) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) =>
      typeof v === "string" && SAFE_URL.test(v.split(" ")[0] ?? "") ? v : null;
    out[id] = {
      url,
      width: num(m?.["width"]),
      height: num(m?.["height"]),
      srcset: str(m?.["srcset"]),
      avif: str(m?.["avif"]),
    };
  }
  return out;
}

export function DraftPreview() {
  const load = useServerFn(studioDraft);
  const q = useQuery({ queryKey: ["bp", "preview-draft"], queryFn: () => load(), retry: false });
  const library = useMediaLibrary();
  const [live, setLive] = useState<{ doc: SiteDocument; media: MediaMap | null } | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const data = e.data as { type?: unknown; doc?: unknown; media?: unknown } | null;
      if (!data || data.type !== PREVIEW_DOC) return;
      setLive({ doc: normalizeDocument(data.doc), media: mediaOf(data.media) });
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window)
      window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const doc = live?.doc ?? q.data?.document;
  if (!doc) {
    if (q.isPending)
      return <p style={{ padding: "2rem", textAlign: "center" }}>טוען תצוגה מקדימה…</p>;
    return (
      <p style={{ padding: "2rem", textAlign: "center" }}>אין הרשאה לתצוגה המקדימה של האתר הזה.</p>
    );
  }
  const page = pageBySlug(doc, "");
  if (!page) return null;
  const media = live?.media ?? previewMediaMap(library.data);
  return <SiteView doc={doc} media={media} page={page} mode="preview" />;
}
