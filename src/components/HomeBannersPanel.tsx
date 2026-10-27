import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ImageIcon,
  ImagePlus,
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
import { BannerLinkPicker } from "@/components/home-design/BannerLinkPicker";
import { Badge } from "@/components/ui/badge";
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
  uploadBannerPoster,
  type BannerDevice,
  type BannerPlacement,
  type BannerSet,
  type BannerSlide,
  BANNER_ACCEPT,
  BANNER_LIMITS,
  bannerMediaKind,
} from "@/lib/banners";
import { cn } from "@/lib/utils";

/** השוואה בלי המפתח המקומי — כדי לדעת אם יש שינויים שלא נשמרו */
function comparable(slides: BannerSlide[] | undefined): string {
  return JSON.stringify(
    (slides ?? []).map((slide) => {
      const { key, ...rest } = slide;
      void key;
      return rest;
    }),
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
  if (!slide.is_active) {
    warnings.push("מושבת — נשמר, אבל לא יוצג באתר עד שתפעילו אותו");
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
  for (const device of ["desktop", "mobile"] as const) {
    const url = device === "desktop" ? slide.desktop_image_url : slide.mobile_image_url;
    const poster = device === "desktop" ? slide.desktop_poster_url : slide.mobile_poster_url;
    if (bannerMediaKind(url) === "video" && !poster) {
      warnings.push(
        `אין פוסטר לסרטון ה${BANNER_GUIDE[device].label} — אם הסרטון לא ייטען יוצג רקע ריק`,
      );
    }
  }
  return { errors, warnings };
}

/**
 * מצב העריכה של הבאנר העליון והתחתון. כל מיקום נשמר בנפרד: נשלח המיקום הערוך
 * יחד עם המיקום השני כפי שהוא שמור כרגע — כך ששמירת העליון לא מפרסמת שינויים
 * שעדיין לא אושרו בתחתון (ולהפך). השמירה עצמה היא אותה פונקציה אטומית כמו קודם.
 */
export function useBannersEditor() {
  const [saved, setSaved] = useState<BannerSet | null>(null);
  const [set, setSet] = useState<BannerSet>({ top: [], bottom: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<BannerPlacement | null>(null);
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

  const isDirty = (placement: BannerPlacement) =>
    saved !== null && comparable(set[placement]) !== comparable(saved[placement]);

  const update = (placement: BannerPlacement, key: string, patch: Partial<BannerSlide>) =>
    setSet((current) => ({
      ...current,
      [placement]: current[placement].map((slide) =>
        slide.key === key ? { ...slide, ...patch } : slide,
      ),
    }));

  const add = (placement: BannerPlacement) =>
    setSet((current) => ({
      ...current,
      [placement]: [...current[placement], emptySlide(placement)],
    }));

  const remove = (placement: BannerPlacement, key: string) =>
    setSet((current) => ({
      ...current,
      [placement]: current[placement].filter((slide) => slide.key !== key),
    }));

  const move = (placement: BannerPlacement, key: string, direction: -1 | 1) =>
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

  const discard = (placement: BannerPlacement) => {
    if (saved)
      setSet((current) => ({ ...current, [placement]: structuredClone(saved[placement]) }));
  };

  const save = async (placement: BannerPlacement) => {
    if (!saved) return;
    const label = BANNER_PLACEMENT_LABEL[placement];
    const errorCount = set[placement].reduce(
      (sum, slide) => sum + slideProblems(slide).errors.length,
      0,
    );
    if (errorCount > 0) {
      toast.error(`${label}: יש לתקן את השגיאות המסומנות באדום לפני השמירה`);
      return;
    }
    setSaving(placement);
    try {
      const next: BannerSet = { ...saved, [placement]: set[placement] };
      await saveHomeBanners(next);
      // קבצים שכבר לא בשימוש — לא בשמור ולא בעריכה הנוכחית (גם של המיקום השני)
      const keep = new Set([...bannerUrls(next), ...bannerUrls(set)]);
      const candidates = new Set([
        ...bannerUrls(
          placement === "top" ? { top: saved.top, bottom: [] } : { top: [], bottom: saved.bottom },
        ),
        ...sessionUploads.current,
      ]);
      const unused = [...candidates].filter((url) => !keep.has(url));
      for (const url of unused) sessionUploads.current.delete(url);
      void removeBannerFiles(unused).catch(() => undefined);
      setSaved(structuredClone(next));
      toast.success(`${label} נשמר ומוצג באתר`);
    } catch (error) {
      toast.error(`${label} לא נשמר: ${error instanceof Error ? error.message : "שגיאה לא ידועה"}`);
    } finally {
      setSaving(null);
    }
  };

  return {
    set,
    loading,
    saving,
    isDirty,
    update,
    add,
    remove,
    move,
    discard,
    save,
    trackUpload: (url: string) => sessionUploads.current.add(url),
  };
}

export type BannersEditor = ReturnType<typeof useBannersEditor>;

/** כרטיס של מיקום אחד (עליון / תחתון): רשימת הפריטים, הוספה, ושמירה משלו */
export function BannerPlacementCard({
  editor,
  placement,
  title,
  description,
}: {
  editor: BannersEditor;
  placement: BannerPlacement;
  title: string;
  description: string;
}) {
  const slides = editor.set[placement];
  const dirty = editor.isDirty(placement);
  const saving = editor.saving === placement;
  const activeCount = slides.filter((slide) => slide.is_active).length;
  return (
    <Card className="shadow-card" data-banner-placement={placement}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-lg">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="text-xs text-muted-foreground" data-banner-summary>
            {slides.length === 0
              ? "אין פריטים — הבאנר לא מוצג באתר"
              : `${slides.length} פריטים · ${activeCount} פעילים · מחשב: ${slidesFor(slides, "desktop").length} · נייד: ${slidesFor(slides, "mobile").length}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => editor.add(placement)}>
          <Plus className="size-4" />
          הוספת פריט
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {slides.map((slide, slideIndex) => (
          <SlideEditor
            key={slide.key}
            slide={slide}
            index={slideIndex}
            total={slides.length}
            onChange={(patch) => editor.update(placement, slide.key, patch)}
            onRemove={() => editor.remove(placement, slide.key)}
            onMove={(direction) => editor.move(placement, slide.key, direction)}
            onUploaded={editor.trackUpload}
          />
        ))}
        {slides.length === 0 && (
          <button
            type="button"
            onClick={() => editor.add(placement)}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-sm text-muted-foreground hover:border-accent hover:text-foreground"
          >
            <ImagePlus className="size-6" />
            הוספת הפריט הראשון ל{BANNER_PLACEMENT_LABEL[placement]}
          </button>
        )}
        <SaveRow
          dirty={dirty}
          saving={saving}
          disabled={editor.loading || editor.saving !== null}
          onSave={() => void editor.save(placement)}
          onDiscard={() => editor.discard(placement)}
          label={`שמירת ה${BANNER_PLACEMENT_LABEL[placement]}`}
        />
      </CardContent>
    </Card>
  );
}

/** שורת שמירה אחידה לכל חלק במסך — "שינויים שלא נשמרו", ביטול ושמירה */
export function SaveRow({
  dirty,
  saving,
  disabled = false,
  onSave,
  onDiscard,
  label,
}: {
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
      {dirty && !saving && (
        <span
          className="me-auto flex items-center gap-1.5 text-xs font-medium text-amber-700"
          role="status"
        >
          <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
          יש שינויים שלא נשמרו
        </span>
      )}
      {onDiscard && (
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={!dirty || saving}>
          <RotateCcw className="size-4" />
          ביטול שינויים
        </Button>
      )}
      <Button size="sm" onClick={onSave} disabled={!dirty || saving || disabled}>
        {saving && <Loader2 className="size-4 animate-spin" />}
        {saving ? "שומר…" : label}
      </Button>
    </div>
  );
}

/** עמוד הבית בתצוגה מקדימה: הבאנרים (כולל שינויים שלא נשמרו) במקומם באתר */
export function BannerPreviewPage({
  set,
  device,
  intervalSeconds,
}: {
  set: BannerSet;
  device: BannerDevice;
  intervalSeconds: number;
}) {
  const top = slidesFor(set.top, device);
  const bottom = slidesFor(set.bottom, device);
  const placeholder = (text: string) => (
    <div className="rounded-lg border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
      {text}
    </div>
  );
  return (
    <div className="space-y-2.5">
      {top.length > 0 ? (
        <BannerCarousel
          key={`top-${device}`}
          slides={top}
          device={device}
          label="באנר עליון"
          intervalSeconds={intervalSeconds}
        />
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
          intervalSeconds={intervalSeconds}
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
  const { errors, warnings } = useMemo(() => slideProblems(slide), [slide]);
  const activeId = `active-${slide.key}`;
  return (
    <div
      className={cn(
        "space-y-4 rounded-lg border p-3 transition-colors sm:p-4",
        slide.is_active ? "border-border" : "border-dashed border-muted-foreground/40 bg-muted/30",
      )}
      data-banner-slide
      data-active={slide.is_active}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">
            פריט {index + 1}
            {total > 1 && <span className="font-normal text-muted-foreground"> מתוך {total}</span>}
          </p>
          {!slide.is_active && <Badge variant="outline">מושבת</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <label
            htmlFor={activeId}
            className="me-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"
          >
            פעיל
            <Switch
              id={activeId}
              checked={slide.is_active}
              onCheckedChange={(value) => onChange({ is_active: value })}
              aria-label={`הצגת פריט ${index + 1} באתר`}
            />
          </label>
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
            aria-label={`מחיקת פריט ${index + 1}`}
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
          poster={slide.desktop_poster_url}
          width={slide.desktop_width}
          height={slide.desktop_height}
          shown={slide.show_desktop}
          onShownChange={(value) => onChange({ show_desktop: value })}
          onUploaded={(upload) => {
            onUploaded(upload.url);
            if (upload.poster) onUploaded(upload.poster);
            onChange({
              desktop_image_url: upload.url,
              desktop_width: upload.width,
              desktop_height: upload.height,
              desktop_poster_url: upload.poster ?? null,
            });
          }}
          onPoster={(poster) => {
            if (poster) onUploaded(poster);
            onChange({ desktop_poster_url: poster });
          }}
          onClear={() =>
            onChange({
              desktop_image_url: null,
              desktop_width: null,
              desktop_height: null,
              desktop_poster_url: null,
            })
          }
        />
        <UploadTile
          device="mobile"
          url={slide.mobile_image_url}
          poster={slide.mobile_poster_url}
          width={slide.mobile_width}
          height={slide.mobile_height}
          shown={slide.show_mobile}
          onShownChange={(value) => onChange({ show_mobile: value })}
          onUploaded={(upload) => {
            onUploaded(upload.url);
            if (upload.poster) onUploaded(upload.poster);
            onChange({
              mobile_image_url: upload.url,
              mobile_width: upload.width,
              mobile_height: upload.height,
              mobile_poster_url: upload.poster ?? null,
            });
          }}
          onPoster={(poster) => {
            if (poster) onUploaded(poster);
            onChange({ mobile_poster_url: poster });
          }}
          onClear={() =>
            onChange({
              mobile_image_url: null,
              mobile_width: null,
              mobile_height: null,
              mobile_poster_url: null,
            })
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <BannerLinkPicker
          value={slide.link_url}
          onChange={(next) => onChange({ link_url: next })}
        />
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
  poster,
  width,
  height,
  shown,
  onShownChange,
  onUploaded,
  onPoster,
  onClear,
}: {
  device: BannerDevice;
  url: string | null;
  poster: string | null;
  width: number | null;
  height: number | null;
  shown: boolean;
  onShownChange: (value: boolean) => void;
  onUploaded: (upload: {
    url: string;
    width: number | null;
    height: number | null;
    poster?: string | null;
  }) => void;
  onPoster: (poster: string | null) => void;
  onClear: () => void;
}) {
  const guide = BANNER_GUIDE[device];
  const inputRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [posterUploading, setPosterUploading] = useState(false);
  const warning = url ? bannerSizeWarning(device, width, height) : null;
  const isVideo = bannerMediaKind(url) === "video";
  const Icon = device === "desktop" ? Monitor : Smartphone;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const upload = await uploadBannerImage(file, device);
      onUploaded(upload);
      if (bannerMediaKind(upload.url) === "video" && !upload.poster) {
        toast.message("הסרטון הועלה. לא הצלחנו ליצור ממנו תמונת פוסטר — אפשר להעלות אחת ידנית");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת הקובץ נכשלה");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const pickPoster = async (file: File | undefined) => {
    if (!file) return;
    setPosterUploading(true);
    try {
      onPoster(await uploadBannerPoster(file, device));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת הפוסטר נכשלה");
    } finally {
      setPosterUploading(false);
      if (posterRef.current) posterRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2 rounded-lg bg-secondary/50 p-3" data-upload-tile={device}>
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
        {BANNER_LIMITS.videoSeconds} שניות, {BANNER_LIMITS.videoMb}MB, מתנגן בלי קול עם כפתור להפעלת
        קול)
      </p>
      <div
        className={`overflow-hidden rounded-md border border-border bg-card ${device === "desktop" ? "aspect-[16/5]" : "mx-auto aspect-square max-w-44"}`}
      >
        {url ? (
          isVideo ? (
            <video
              src={url}
              poster={poster ?? undefined}
              className="size-full object-cover"
              muted
              loop
              playsInline
              autoPlay
            />
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
          {warning ?? `⁦${width}×${height}⁩ — מתאים`}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={BANNER_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={`קובץ ל${guide.label}`}
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
          {url ? "החלפה" : `העלאה ל${guide.label}`}
        </Button>
        {url && (
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            הסרה
          </Button>
        )}
      </div>

      {isVideo && (
        <div className="space-y-2 rounded-md border border-border bg-card p-2" data-poster-tile>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-secondary">
              {poster ? (
                <img src={poster} alt="" className="size-full object-cover" />
              ) : (
                <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              תמונת פוסטר — מוצגת עד שהסרטון נטען, ובמקומו אם הטעינה נכשלת
            </p>
          </div>
          <input
            ref={posterRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label={`פוסטר ל${guide.label}`}
            onChange={(event) => void pickPoster(event.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={posterUploading}
              onClick={() => posterRef.current?.click()}
            >
              {posterUploading && <Loader2 className="size-4 animate-spin" />}
              {poster ? "החלפת פוסטר" : "העלאת פוסטר"}
            </Button>
            {poster && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onPoster(null)}>
                הסרת הפוסטר
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
