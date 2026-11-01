// התצוגה המקדימה של העורך (/manage/preview, בתוך iframe): אותו רנדרר כמו האתר, עם נתוני האתר
// והטיוטה — גם כשהאתר עוד סגור לגולשים. העורך שולח כל שינוי ב-postMessage (רק מאותו מקור),
// כך שרואים את השינוי מיד, עוד לפני השמירה האוטומטית. קישורים לא מנווטים (רק גלילה בעמוד).
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { hospitalitySitePreview } from "../../api/site-editor.functions";
import { PREVIEW_DESIGN_MESSAGE, PREVIEW_READY_MESSAGE } from "../design/preview";
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

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const data = e.data as { type?: string; design?: unknown } | null;
      if (data?.type === PREVIEW_DESIGN_MESSAGE) setDesign(normalizeDesign(data.design));
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window)
      window.parent.postMessage({ type: PREVIEW_READY_MESSAGE }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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

  // קישורים בתצוגה: עוגן בעמוד → גלילה; כל השאר — לא מנווטים
  const onClickCapture = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
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
