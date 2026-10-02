import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Monitor,
  Plus,
  RotateCcw,
  Smartphone,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { BannerCarousel } from "@/components/BannerCarousel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  BANNER_GUIDE,
  BANNER_PLACEMENT_LABEL,
  bannerSizeWarning,
  bannerUrls,
  emptySlide,
  isValidBannerLink,
  loadHomeBanners,
  removeBannerFiles,
  saveHomeBanners,
  slidesFor,
  uploadBannerImage,
  type BannerDevice,
  type BannerPlacement,
  type BannerSet,
  type BannerSlide,
  BANNER_ACCEPT,
  BANNER_LIMITS,
  bannerMediaKind,
} from "@/lib/banners";

const PLACEMENTS: BannerPlacement[] = ["top", "bottom"];

/** השוואה בלי המפתח המקומי — כדי לדעת אם יש שינויים שלא נשמרו */
function comparable(set: BannerSet | null): string {
  if (!set) return "";
  return JSON.stringify(
    PLACEMENTS.map((placement) =>
      set[placement].map((slide) => {
        const { key, ...rest } = slide;
        void key;
        return rest;
      }),
    ),
  );
}

function slideProblems(slide: BannerSlide): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!slide.desktop_image_url && !slide.mobile_image_url) {
    errors.push("יש להעלות לפחות תמונה אחת (מחשב או נייד), או למחוק את התמונה הזו");
  }
  if (slide.link_url && !isValidBannerLink(slide.link_url)) {
    errors.push("הקישור חייב להתחיל ב-/ (עמוד באתר) או ב-https://");
  }
  if (slide.show_desktop && !slide.desktop_image_url && slide.mobile_image_url) {
    warnings.push("מסומן להצגה במחשב אבל אין תמונת מחשב — במחשב הוא לא יוצג");
  }
  if (slide.show_mobile && !slide.mobile_image_url && slide.desktop_image_url) {
    warnings.push("מסומן להצגה בנייד אבל אין תמונת נייד — בנייד הוא לא יוצג");
  }
  if (!slide.show_desktop && !slide.show_mobile) {
    warnings.push("כבוי גם במחשב וגם בנייד — לא יוצג בכלל");
  }
  return { errors, warnings };
}

/** עיצוב מסך הבית — באנר עליון ותחתון, כל אחד עם כמה תמונות שמתחלפות כל 5 שניות */
export function HomeBannersPanel() {
  const [saved, setSaved] = useState<BannerSet | null>(null);
  const [set, setSet] = useState<BannerSet>({ top: [], bottom: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState<BannerDevice>("desktop");
  // קבצים שהועלו בסשן הזה — אם הוסרו לפני השמירה, נמחק אותם מהאחסון
  const sessionUploads = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadHomeBanners(true);
      setSaved(next);
      setSet(structuredClone(next));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טעינת הבאנרים נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = saved !== null && comparable(set) !== comparable(saved);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateSlide = (placement: BannerPlacement, key: string, patch: Partial<BannerSlide>) =>
    setSet((current) => ({
      ...current,
      [placement]: current[placement].map((slide) =>
        slide.key === key ? { ...slide, ...patch } : slide,
      ),
    }));

  const addSlide = (placement: BannerPlacement) =>
    setSet((current) => ({
      ...current,
      [placement]: [...current[placement], emptySlide(placement)],
    }));

  const removeSlide = (placement: BannerPlacement, key: string) =>
    setSet((current) => ({
      ...current,
      [placement]: current[placement].filter((slide) => slide.key !== key),
    }));

  const moveSlide = (placement: BannerPlacement, key: string, direction: -1 | 1) =>
    setSet((current) => {
      const list = [...current[placement]];
      const from = list.findIndex((slide) => slide.key === key);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= list.length) return current;
      const moving = list[from];
      const other = list[to];
      if (!moving || !other) return current;
      list[from] = other;
      list[to] = moving;
      return { ...current, [placement]: list };
    });

  const problems = useMemo(
    () => PLACEMENTS.flatMap((placement) => set[placement].map((slide) => slideProblems(slide))),
    [set],
  );
  const errorCount = problems.reduce((sum, item) => sum + item.errors.length, 0);

  const save = async () => {
    if (errorCount > 0) {
      toast.error("יש לתקן את השגיאות המסומנות באדום לפני השמירה");
      return;
    }
    setSaving(true);
    try {
      await saveHomeBanners(set);
      const keep = bannerUrls(set);
      const candidates = new Set([
        ...bannerUrls(saved ?? { top: [], bottom: [] }),
        ...sessionUploads.current,
      ]);
      const unused = [...candidates].filter((url) => !keep.has(url));
      void removeBannerFiles(unused).catch(() => undefined);
      sessionUploads.current.clear();
      setSaved(structuredClone(set));
      toast.success("הבאנרים נשמרו ומוצגים באתר");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת הבאנרים נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (saved) setSet(structuredClone(saved));
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
            <LayoutTemplate className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">עיצוב מסך הבית</h2>
            <p className="text-sm text-muted-foreground">
              באנר עליון מעל המבצעים החמים ובאנר תחתון מעל תחתית האתר. כמה תמונות באותו באנר מתחלפות
              אוטומטית כל 5 שניות.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={discard} disabled={!dirty || saving}>
            <RotateCcw className="size-4" />
            ביטול שינויים
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || saving || loading}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            שמירה ופרסום באתר
          </Button>
        </div>
      </div>

      {dirty && (
        <div className="rounded-lg border border-accent/50 bg-accent/10 p-3 text-sm text-foreground">
          יש שינויים שעדיין לא נשמרו. התצוגה המקדימה מציגה אותם — באתר עצמו הם יופיעו רק אחרי "שמירה
          ופרסום".
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          טוען באנרים...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="space-y-6">
            {PLACEMENTS.map((placement) => (
              <Card key={placement}>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="text-lg">{BANNER_PLACEMENT_LABEL[placement]}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {set[placement].length === 0
                        ? "אין תמונות — הבאנר לא מוצג באתר"
                        : `${set[placement].length} תמונות · מחשב: ${slidesFor(set[placement], "desktop").length} · נייד: ${slidesFor(set[placement], "mobile").length}`}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => addSlide(placement)}>
                    <Plus className="size-4" />
                    הוספת תמונה לבאנר
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {set[placement].map((slide, slideIndex) => (
                    <SlideEditor
                      key={slide.key}
                      slide={slide}
                      index={slideIndex}
                      total={set[placement].length}
                      onChange={(patch) => updateSlide(placement, slide.key, patch)}
                      onRemove={() => removeSlide(placement, slide.key)}
                      onMove={(direction) => moveSlide(placement, slide.key, direction)}
                      onUploaded={(url) => sessionUploads.current.add(url)}
                    />
                  ))}
                  {set[placement].length === 0 && (
                    <button
                      type="button"
                      onClick={() => addSlide(placement)}
                      className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-sm text-muted-foreground hover:border-accent hover:text-foreground"
                    >
                      <ImagePlus className="size-6" />
                      הוספת התמונה הראשונה ל{BANNER_PLACEMENT_LABEL[placement]}
                    </button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="lg:sticky lg:top-4 lg:self-start">
            <Card>
              <CardHeader className="space-y-3">
                <CardTitle className="text-lg">תצוגה מקדימה</CardTitle>
                <div
                  role="radiogroup"
                  aria-label="סוג תצוגה"
                  className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1"
                >
                  {(["desktop", "mobile"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={device === option}
                      onClick={() => setDevice(option)}
                      className={`flex min-h-10 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors ${
                        device === option
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {option === "desktop" ? (
                        <Monitor className="size-4" />
                      ) : (
                        <Smartphone className="size-4" />
                      )}
                      {option === "desktop" ? "תצוגת מחשב" : "תצוגת נייד"}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {device === "desktop" ? (
                  <div className="overflow-hidden rounded-lg border border-border bg-background">
                    <div className="flex items-center gap-1.5 border-b border-border bg-secondary px-3 py-2">
                      <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                      <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                      <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                    </div>
                    <PreviewPage set={set} device="desktop" />
                  </div>
                ) : (
                  <div className="mx-auto w-[17.5rem] rounded-[2.25rem] border-[10px] border-foreground/85 bg-foreground/85 shadow-lg">
                    <div className="relative overflow-hidden rounded-[1.6rem] bg-background">
                      <div className="absolute inset-x-0 top-0 z-10 mx-auto h-5 w-24 rounded-b-xl bg-foreground/85" />
                      <div className="max-h-[32rem] overflow-y-auto pt-6">
                        <PreviewPage set={set} device="mobile" />
                      </div>
                    </div>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {device === "desktop"
                    ? 'כך ייראו הבאנרים במחשב — רק התמונות שסומנו "הצג במחשב".'
                    : 'כך ייראו הבאנרים בטלפון — רק תמונות הנייד שסומנו "הצג בנייד".'}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}

function PreviewPage({ set, device }: { set: BannerSet; device: BannerDevice }) {
  const top = slidesFor(set.top, device);
  const bottom = slidesFor(set.bottom, device);
  const placeholder = (text: string) => (
    <div className="rounded-lg border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
      {text}
    </div>
  );
  return (
    <div className="space-y-2.5 p-2.5">
      {top.length > 0 ? (
        <BannerCarousel key={`top-${device}`} slides={top} device={device} label="באנר עליון" />
      ) : (
        placeholder(`אין באנר עליון ב${device === "desktop" ? "מחשב" : "נייד"}`)
      )}
      <div className="space-y-1.5 rounded-lg bg-secondary/60 p-2.5">
        <div className="h-2.5 w-24 rounded bg-muted-foreground/20" />
        <div className={`grid gap-1.5 ${device === "desktop" ? "grid-cols-4" : "grid-cols-2"}`}>
          {Array.from({ length: device === "desktop" ? 4 : 2 }, (_, i) => (
            <div key={i} className="aspect-[3/4] rounded bg-card" />
          ))}
        </div>
        <p className="text-center text-[11px] text-muted-foreground">המבצעים החמים והקטלוג</p>
      </div>
      {bottom.length > 0 ? (
        <BannerCarousel
          key={`bottom-${device}`}
          slides={bottom}
          device={device}
          label="באנר תחתון"
        />
      ) : (
        placeholder(`אין באנר תחתון ב${device === "desktop" ? "מחשב" : "נייד"}`)
      )}
    </div>
  );
}

function SlideEditor({
  slide,
  index,
  total,
  onChange,
  onRemove,
  onMove,
  onUploaded,
}: {
  slide: BannerSlide;
  index: number;
  total: number;
  onChange: (patch: Partial<BannerSlide>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onUploaded: (url: string) => void;
}) {
  const { errors, warnings } = slideProblems(slide);
  const linkInvalid = !!slide.link_url && !isValidBannerLink(slide.link_url);
  return (
    <div className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          תמונה {index + 1}
          {total > 1 && <span className="font-normal text-muted-foreground"> מתוך {total}</span>}
        </p>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="הזזה למעלה בסדר ההצגה"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="הזזה למטה בסדר ההצגה"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="מחיקת התמונה מהבאנר"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <UploadTile
          device="desktop"
          url={slide.desktop_image_url}
          width={slide.desktop_width}
          height={slide.desktop_height}
          shown={slide.show_desktop}
          onShownChange={(value) => onChange({ show_desktop: value })}
          onUploaded={(upload) => {
            onUploaded(upload.url);
            onChange({
              desktop_image_url: upload.url,
              desktop_width: upload.width,
              desktop_height: upload.height,
            });
          }}
          onClear={() =>
            onChange({ desktop_image_url: null, desktop_width: null, desktop_height: null })
          }
        />
        <UploadTile
          device="mobile"
          url={slide.mobile_image_url}
          width={slide.mobile_width}
          height={slide.mobile_height}
          shown={slide.show_mobile}
          onShownChange={(value) => onChange({ show_mobile: value })}
          onUploaded={(upload) => {
            onUploaded(upload.url);
            onChange({
              mobile_image_url: upload.url,
              mobile_width: upload.width,
              mobile_height: upload.height,
            });
          }}
          onClear={() =>
            onChange({ mobile_image_url: null, mobile_width: null, mobile_height: null })
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`link-${slide.key}`}>קישור בלחיצה (אופציונלי)</Label>
          <Input
            id={`link-${slide.key}`}
            dir="ltr"
            value={slide.link_url ?? ""}
            onChange={(event) => onChange({ link_url: event.target.value || null })}
            placeholder="/about או https://..."
            aria-invalid={linkInvalid}
            className={linkInvalid ? "border-destructive" : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`alt-${slide.key}`}>תיאור התמונה (לנגישות)</Label>
          <Input
            id={`alt-${slide.key}`}
            value={slide.alt_text}
            onChange={(event) => onChange({ alt_text: event.target.value })}
            placeholder="למשל: מבצע קיץ על בירות"
          />
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-1 text-sm">
          {errors.map((text) => (
            <li key={text} className="flex items-start gap-2 text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {text}
            </li>
          ))}
          {warnings.map((text) => (
            <li key={text} className="flex items-start gap-2 text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" />
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadTile({
  device,
  url,
  width,
  height,
  shown,
  onShownChange,
  onUploaded,
  onClear,
}: {
  device: BannerDevice;
  url: string | null;
  width: number | null;
  height: number | null;
  shown: boolean;
  onShownChange: (value: boolean) => void;
  onUploaded: (upload: { url: string; width: number | null; height: number | null }) => void;
  onClear: () => void;
}) {
  const guide = BANNER_GUIDE[device];
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const warning = url ? bannerSizeWarning(device, width, height) : null;
  const Icon = device === "desktop" ? Monitor : Smartphone;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      onUploaded(await uploadBannerImage(file, device));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת התמונה נכשלה");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2 rounded-lg bg-secondary/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Icon className="size-4" />
          {guide.label}
        </p>
        <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
          הצג ב{guide.label}
          <Switch checked={shown} onCheckedChange={onShownChange} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{guide.hint}</p>
      <p className="text-xs text-muted-foreground">
        תמונה · GIF מונפש (עד {BANNER_LIMITS.gifMb}MB) · סרטון MP4 / WebM (עד{" "}
        {BANNER_LIMITS.videoSeconds} שניות, {BANNER_LIMITS.videoMb}MB, מתנגן בלי קול)
      </p>
      <div
        className={`overflow-hidden rounded-md border border-border bg-card ${device === "desktop" ? "aspect-[16/5]" : "mx-auto aspect-square max-w-44"}`}
      >
        {url ? (
          bannerMediaKind(url) === "video" ? (
            <video src={url} className="size-full object-cover" muted loop playsInline autoPlay />
          ) : (
            <img src={url} alt="" className="size-full object-cover" />
          )
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            אין תמונת {guide.label}
          </div>
        )}
      </div>
      {url && width && height && (
        <p className={`text-xs ${warning ? "text-destructive" : "text-muted-foreground"}`}>
          {warning ?? `\u2066${width}×${height}\u2069 — מתאים`}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={BANNER_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={url ? "outline" : "default"}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {url ? "החלפת תמונה" : `העלאת תמונה ל${guide.label}`}
        </Button>
        {url && (
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            הסרה
          </Button>
        )}
      </div>
    </div>
  );
}
