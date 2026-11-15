// התצוגה המקדימה של הטיוטה (בתוך מסגרת בעורך). מתעדכנת כשהעורך שומר (הודעה מאותו מקור בלבד).
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { pageBySlug } from "../document/normalize";
import { studioDraft } from "../api/studio.functions";
import { SiteView } from "../site/SiteView";

export const PREVIEW_REFRESH = "bp-preview-refresh";

export function DraftPreview() {
  const load = useServerFn(studioDraft);
  const q = useQuery({ queryKey: ["bp", "preview-draft"], queryFn: () => load(), retry: false });
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data === PREVIEW_REFRESH) void q.refetch();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [q]);
  if (q.isPending)
    return <p style={{ padding: "2rem", textAlign: "center" }}>טוען תצוגה מקדימה…</p>;
  if (q.isError || !q.data) {
    return (
      <p style={{ padding: "2rem", textAlign: "center" }}>אין הרשאה לתצוגה המקדימה של האתר הזה.</p>
    );
  }
  const page = pageBySlug(q.data.document, "");
  if (!page) return null;
  return <SiteView doc={q.data.document} media={{}} page={page} mode="preview" />;
}
