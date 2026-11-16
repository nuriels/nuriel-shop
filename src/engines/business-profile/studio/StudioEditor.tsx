// "עריכת האתר": כל התוכן בצד אחד, ותצוגה מקדימה חיה בצד השני (מחשב — ברוחב 1280 מוקטן למסך; נייד — 390).
// התצוגה מתעדכנת מיד, עוד לפני השמירה (הודעה מאותו מקור לתוך המסגרת). השמירה — לטיוטה בלבד, עם revision:
// אם מישהו אחר שמר בינתיים, לא דורסים — מציעים לטעון מחדש. האתר הציבורי משתנה רק בפרסום.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Monitor, Save, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@/platform/ui";
import { studioDraft, studioSaveDraft } from "../api/studio.functions";
import type { SiteDocument } from "../document/schema";
import { PREVIEW_DOC, PREVIEW_READY } from "./DraftPreview";
import { DRAFT_QUERY } from "./StudioOverview";
import { previewMediaMap, MediaLibraryPanel, useMediaLibrary } from "./editor/media";
import { AccessibilityPanel } from "./editor/AccessibilityPanel";
import { SeoPanel } from "./editor/SeoPanel";
import {
  BlocksPanel,
  BusinessPanel,
  DesignPanel,
  PortfolioPanel,
  ServicesPanel,
  TestimonialsPanel,
  type SetDoc,
} from "./editor/panels";

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 390;

function Preview({ doc, media }: { doc: SiteDocument; media: ReturnType<typeof previewMediaMap> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [boxWidth, setBoxWidth] = useState(800);
  const latest = useRef({ doc, media });
  latest.current = { doc, media };

  const post = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: PREVIEW_DOC, doc: latest.current.doc, media: latest.current.media },
      window.location.origin,
    );
  }, []);
  useEffect(() => {
    const t = window.setTimeout(post, 120);
    return () => window.clearTimeout(t);
  }, [doc, media, post]);
  // המסגרת מודיעה כשהיא מוכנה (גם אחרי ניווט או רענון בתוכה) — שולחים לה את המסמך העדכני
  useEffect(() => {
    const onReady = (e: MessageEvent) => {
      const data = e.data as { type?: unknown } | null;
      if (
        e.origin === window.location.origin &&
        e.source === frame.current?.contentWindow &&
        data?.type === PREVIEW_READY
      )
        post();
    };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [post]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // מחשב: האתר נטען ברוחב מחשב אמיתי ומוקטן; נייד: רוחב טלפון
  const width = device === "desktop" ? DESKTOP_WIDTH : MOBILE_WIDTH;
  const scale = device === "desktop" ? Math.min(1, boxWidth / DESKTOP_WIDTH) : 1;
  const height = 760;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">תצוגה מקדימה — הטיוטה, לפני השמירה והפרסום</p>
        <div role="group" aria-label="גודל התצוגה" className="flex gap-1">
          <Button
            size="sm"
            variant={device === "desktop" ? "default" : "outline"}
            aria-pressed={device === "desktop"}
            onClick={() => setDevice("desktop")}
          >
            <Monitor className="size-4" aria-hidden="true" /> מחשב
          </Button>
          <Button
            size="sm"
            variant={device === "mobile" ? "default" : "outline"}
            aria-pressed={device === "mobile"}
            onClick={() => setDevice("mobile")}
          >
            <Smartphone className="size-4" aria-hidden="true" /> נייד
          </Button>
        </div>
      </div>
      <div
        ref={box}
        className="overflow-hidden rounded-lg border bg-muted/40"
        style={{ height: height }}
      >
        <div className="flex h-full justify-center">
          <iframe
            ref={frame}
            title="תצוגה מקדימה של האתר"
            src="/studio/preview"
            onLoad={post}
            className="shrink-0 border-0 bg-white"
            style={{
              width,
              height: height / scale,
              transform: `scale(${scale})`,
              transformOrigin: "top center",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function StudioEditor() {
  const qc = useQueryClient();
  const load = useServerFn(studioDraft);
  const save = useServerFn(studioSaveDraft);
  const draft = useQuery({ queryKey: DRAFT_QUERY, queryFn: () => load() });
  const media = useMediaLibrary();
  const [doc, setDocState] = useState<SiteDocument | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (draft.data && !dirty) {
      setDocState(draft.data.document);
      setRevision(draft.data.revision);
    }
  }, [draft.data, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setDoc: SetDoc = useCallback((change) => {
    setDocState((d) => (d ? change(d) : d));
    setDirty(true);
  }, []);

  const saveM = useMutation({
    mutationFn: () => save({ data: { document: doc!, revision: revision! } }),
    onSuccess: async (r) => {
      setRevision(r.revision);
      setDirty(false);
      setConflict(false);
      toast.success("הטיוטה נשמרה");
      await qc.invalidateQueries({ queryKey: DRAFT_QUERY });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "השמירה נכשלה";
      if (/נשמרה בינתיים/.test(message)) setConflict(true);
      toast.error(message);
    },
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saveM.isPending) saveM.mutate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saveM]);

  if (draft.isPending || !doc)
    return <p className="text-sm text-muted-foreground">טוען את העורך…</p>;
  if (draft.isError)
    return <p className="text-sm text-destructive">העורך לא נטען — רעננו את העמוד.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">עריכת האתר</h1>
          <p className="text-sm text-muted-foreground">
            השינויים נשמרים בטיוטה. הגולשים יראו אותם רק אחרי{" "}
            <Link to="/studio" className="underline underline-offset-4">
              פרסום
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {dirty ? "יש שינויים שלא נשמרו" : "הכול נשמר"}
          </span>
          <Button onClick={() => saveM.mutate()} disabled={!dirty || saveM.isPending}>
            {saveM.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            שמירה
          </Button>
        </div>
      </div>
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          הטיוטה נשמרה בינתיים ממקום אחר (לשונית אחרת או אדם אחר). כדי לא לדרוס — טענו את הגרסה
          העדכנית.
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDirty(false);
              setConflict(false);
              void draft.refetch();
            }}
          >
            טעינה מחדש (השינויים שלי יאבדו)
          </Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto lg:pe-1">
          <Tabs defaultValue="blocks" dir="rtl">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="blocks">מקטעים</TabsTrigger>
              <TabsTrigger value="business">פרטי העסק</TabsTrigger>
              <TabsTrigger value="design">עיצוב</TabsTrigger>
              <TabsTrigger value="services">שירותים</TabsTrigger>
              <TabsTrigger value="portfolio">תיק עבודות</TabsTrigger>
              <TabsTrigger value="testimonials">המלצות</TabsTrigger>
              <TabsTrigger value="media">תמונות</TabsTrigger>
              <TabsTrigger value="accessibility">הצהרת נגישות</TabsTrigger>
              <TabsTrigger value="seo">SEO וגוגל</TabsTrigger>
            </TabsList>
            <div className="mt-4 rounded-lg border bg-background p-4">
              <TabsContent value="blocks">
                <BlocksPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
              <TabsContent value="business">
                <BusinessPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
              <TabsContent value="design">
                <DesignPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
              <TabsContent value="services">
                <ServicesPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
              <TabsContent value="portfolio">
                <PortfolioPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
              <TabsContent value="testimonials">
                <TestimonialsPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
              <TabsContent value="media">
                <MediaLibraryPanel />
              </TabsContent>
              <TabsContent value="accessibility">
                <AccessibilityPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
              <TabsContent value="seo">
                <SeoPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Preview doc={doc} media={previewMediaMap(media.data)} />
        </div>
      </div>
    </div>
  );
}
