// התצוגה המקדימה של העורך (/manage/preview, בתוך iframe): אותו רנדרר כמו האתר, עם נתוני האתר
// והטיוטה — גם כשהאתר עוד סגור לגולשים. העורך שולח כל שינוי ב-postMessage (רק מאותו מקור),
// כך שרואים את השינוי מיד, עוד לפני השמירה האוטומטית. קישורים לא מנווטים (רק גלילה בעמוד).
// D2: טקסטים ניתנים לעריכה ישירה (components/Editable); לחיצה על מקטע פותחת אותו בעורך.
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { hospitalitySitePreview } from "../../api/site-editor.functions";
import {
  PREVIEW_DESIGN_MESSAGE,
  PREVIEW_READY_MESSAGE,
  PREVIEW_RELOAD_MESSAGE,
  PREVIEW_SELECT_MESSAGE,
} from "../design/preview";
import { normalizeDesign, type SiteDesign } from "../design/schema";
import { findUnit } from "../lib/format";
import { SiteShell } from "../SiteLayout";
import { HomePage } from "./HomePage";
import { UnitPage } from "./UnitPage";

export function PreviewPage() {
  const search = useSearch({ strict: false }) as { page?: string; unit?: string };
  const query = useQuery({
    queryKey: ["hospitality", "site", "preview"],
    queryFn: () => hospitalitySitePreview(),
    retry: false,
    staleTime: 60_000,
  });
  const [design, setDesign] = useState<SiteDesign | null>(null);
  const { refetch } = query;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const data = e.data as { type?: string; design?: unknown } | null;
      if (data?.type === PREVIEW_DESIGN_MESSAGE) setDesign(normalizeDesign(data.design));
      // תמונה / לוגו חדשים — נתוני האתר מחדש
      if (data?.type === PREVIEW_RELOAD_MESSAGE) void refetch();
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window)
      window.parent.postMessage({ type: PREVIEW_READY_MESSAGE }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [refetch]);

  if (query.isPending)
    return <p className="p-8 text-center text-sm text-muted-foreground">טוענים תצוגה מקדימה…</p>;
  if (query.isError || !query.data)
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        התצוגה המקדימה זמינה רק לצוות המחובר לאזור הניהול.
      </p>
    );
  const site = query.data;
  const effective = design ?? normalizeDesign(site.design?.document, site.design?.theme);
  const unit = search.page === "unit" ? findUnit(site.units, search.unit) : undefined;

  // קישורים בתצוגה: עוגן בעמוד → גלילה; כל השאר — לא מנווטים. לחיצה בתוך מקטע — העורך פותח אותו
  const onClickCapture = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const section = target.closest<HTMLElement>("[data-section-id]")?.dataset["sectionId"];
    if (section && window.parent !== window)
      window.parent.postMessage({ type: PREVIEW_SELECT_MESSAGE, section }, window.location.origin);
    const a = target.closest("a");
    if (!a) return;
    e.preventDefault();
    // עריכת טקסט בתוך קישור (כפתור) — בלי לגלול
    if (target.closest("[data-inline-edit]")) return;
    const hash = a.getAttribute("href")?.split("#")[1];
    if (hash) document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div onClickCapture={onClickCapture}>
      <SiteShell site={site} design={effective} page={unit ? "unit" : "home"} preview>
        {unit ? <UnitPage slug={unit.slug} /> : <HomePage />}
      </SiteShell>
    </div>
  );
}
