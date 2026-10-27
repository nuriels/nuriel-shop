import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  Clock,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Megaphone,
  Monitor,
  Palette,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { BrandColorField } from "@/components/BrandColorField";
import {
  BannerPlacementCard,
  BannerPreviewPage,
  SaveRow,
  useBannersEditor,
} from "@/components/HomeBannersPanel";
import { SideBannerCard } from "@/components/marketing/SideBannerCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { refreshSiteSettings, useSiteSettings } from "@/hooks/useSiteSettings";
import { textColorOn, normalizeBrandColor } from "@/lib/brand-theme";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import type { BannerDevice } from "@/lib/banners";
import {
  BANNER_INTERVAL,
  normalizeBannerInterval,
  resolveSiteLogoUrl,
  saveBannerInterval,
  saveBranding,
  uploadSiteLogo,
  type BrandingSettings,
} from "@/lib/site";

const SECTIONS = [
  { id: "design-branding", label: "מיתוג" },
  { id: "design-main-banner", label: "באנר ראשי" },
  { id: "design-promotions", label: "מבצעים ופרסומות" },
  { id: "design-preview", label: "תצוגה מקדימה" },
] as const;

const sameBranding = (a: BrandingSettings, b: BrandingSettings) =>
  a.site_title === b.site_title &&
  a.logo_path === b.logo_path &&
  normalizeBrandColor(a.brand_color) === normalizeBrandColor(b.brand_color);

/** המיתוג בעריכה (כותרת, לוגו, צבע) — נשמר בנפרד משאר הגדרות האתר */
function useBrandingEditor() {
  const { settings } = useSiteSettings();
  const router = useRouter();
  const [saved, setSaved] = useState<BrandingSettings | null>(null);
  const [form, setForm] = useState<BrandingSettings | null>(null);
  const [saving, setSaving] = useState(false);

  // נטען פעם אחת — רענון מאוחר של ההגדרות לא דורס עריכה שלא נשמרה
  useEffect(() => {
    if (!settings || saved) return;
    const current = {
      site_title: settings.site_title,
      logo_path: settings.logo_path,
      brand_color: settings.brand_color,
    };
    setSaved(current);
    setForm(current);
  }, [settings, saved]);

  const dirty = !!form && !!saved && !sameBranding(form, saved);
  const patch = (next: Partial<BrandingSettings>) =>
    setForm((current) => (current ? { ...current, ...next } : current));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const row = await saveBranding(form);
      setSaved(row);
      setForm(row);
      await refreshSiteSettings();
      // שם החנות וצבע המותג נטענים ב-root (גם ל-SSR) — מרעננים כדי שיחולו מיד
      await router.invalidate();
      toast.success("המיתוג נשמר ומוצג באתר");
    } catch (error) {
      toast.error(`המיתוג לא נשמר: ${error instanceof Error ? error.message : "שגיאה"}`);
    } finally {
      setSaving(false);
    }
  };

  return {
    form,
    dirty,
    saving,
    patch,
    save,
    discard: () => saved && setForm(saved),
  };
}

/** זמן ההחלפה בין הבאנרים — נשמר בנפרד */
function useIntervalEditor() {
  const { settings } = useSiteSettings();
  const [saved, setSaved] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings || saved !== null) return;
    setSaved(settings.banner_interval_seconds);
    setValue(String(settings.banner_interval_seconds));
  }, [settings, saved]);

  const parsed = Number(value);
  const valid =
    Number.isInteger(parsed) && parsed >= BANNER_INTERVAL.min && parsed <= BANNER_INTERVAL.max;
  const seconds = valid ? parsed : (saved ?? BANNER_INTERVAL.default);
  const dirty = saved !== null && value !== String(saved);

  const save = async () => {
    if (!valid) {
      toast.error(`זמן ההחלפה: מספר שלם בין ${BANNER_INTERVAL.min} ל-${BANNER_INTERVAL.max} שניות`);
      return;
    }
    setSaving(true);
    try {
      const next = await saveBannerInterval(parsed);
      setSaved(next);
      setValue(String(next));
      await refreshSiteSettings();
      toast.success(`זמן ההחלפה נשמר: כל ${next} שניות`);
    } catch (error) {
      toast.error(`זמן ההחלפה לא נשמר: ${error instanceof Error ? error.message : "שגיאה"}`);
    } finally {
      setSaving(false);
    }
  };

  return {
    value,
    setValue,
    valid,
    seconds,
    dirty,
    saving,
    save,
    discard: () => saved !== null && setValue(String(saved)),
  };
}

/**
 * עיצוב מסך הבית — כל הגדרות המראה של החנות במקום אחד:
 *   1. מיתוג (כותרת, לוגו, צבע)  2. באנר ראשי (עליון) + זמן החלפה
 *   3. מבצעים ופרסומות (באנר תחתון + באנר צדדי)  4. תצוגה מקדימה למחשב ולנייד
 * כל חלק נשמר בכפתור משלו, דרך מנגנון השמירה הקיים שלו, עם הודעה משלו.
 */
export function HomeDesignPanel() {
  const branding = useBrandingEditor();
  const banners = useBannersEditor();
  const interval = useIntervalEditor();
  const [device, setDevice] = useState<BannerDevice>("desktop");

  const anyDirty =
    branding.dirty || interval.dirty || banners.isDirty("top") || banners.isDirty("bottom");
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  return (
    <section className="space-y-6" data-home-design>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
            <LayoutTemplate className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">עיצוב מסך הבית</h2>
            <p className="text-sm text-muted-foreground">
              המיתוג, הבאנרים והפרסומות של החנות במקום אחד. כל חלק נשמר בנפרד — והתצוגה המקדימה מראה
              גם שינויים שעוד לא נשמרו.
            </p>
          </div>
        </div>
        <nav aria-label="חלקי המסך" className="flex flex-wrap gap-2">
          {SECTIONS.map((section, index) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:border-accent hover:text-foreground"
            >
              {index + 1}. {section.label}
            </a>
          ))}
        </nav>
      </div>

      {anyDirty && (
        <div
          className="rounded-lg border border-accent/50 bg-accent/10 p-3 text-sm text-foreground"
          role="status"
        >
          יש שינויים שעדיין לא נשמרו. התצוגה המקדימה מציגה אותם — באתר עצמו הם יופיעו רק אחרי השמירה
          של אותו חלק.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-8">
          {/* 1. מיתוג */}
          <div id="design-branding" className="scroll-mt-24">
            <BrandingCard editor={branding} />
          </div>

          {/* 2. באנר ראשי */}
          <div id="design-main-banner" className="scroll-mt-24 space-y-4">
            <SectionTitle icon={<ImagePlus className="size-4" />} title="באנר ראשי" />
            {banners.loading ? (
              <Loading text="טוען באנרים…" />
            ) : (
              <BannerPlacementCard
                editor={banners}
                placement="top"
                title="באנר עליון"
                description="בראש מסך הבית, מעל המבצעים החמים. פריט אחד מוצג כתמונה קבועה; כמה פריטים מתחלפים אוטומטית."
              />
            )}
            <IntervalCard editor={interval} />
          </div>

          {/* 3. מבצעים ופרסומות */}
          <div id="design-promotions" className="scroll-mt-24 space-y-4">
            <SectionTitle icon={<Megaphone className="size-4" />} title="מבצעים ופרסומות" />
            {banners.loading ? (
              <Loading text="טוען באנרים…" />
            ) : (
              <BannerPlacementCard
                editor={banners}
                placement="bottom"
                title="באנר תחתון"
                description="מעל תחתית האתר. תמונות, GIF או סרטונים קצרים — לפרסום מבצעים."
              />
            )}
            <SideBannerCard />
          </div>
        </div>

        {/* 4. תצוגה מקדימה */}
        <div id="design-preview" className="scroll-mt-24 lg:sticky lg:top-4 lg:self-start">
          <HomePreviewCard
            device={device}
            onDeviceChange={setDevice}
            branding={branding.form}
            banners={banners.set}
            intervalSeconds={interval.seconds}
          />
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
      <span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-foreground">
        {icon}
      </span>
      {title}
    </h3>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {text}
    </div>
  );
}

function BrandingCard({ editor }: { editor: ReturnType<typeof useBrandingEditor> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { form } = editor;
  if (!form) {
    return (
      <Card className="shadow-card">
        <CardContent className="pt-6">
          <Loading text="טוען את המיתוג…" />
        </CardContent>
      </Card>
    );
  }
  const logoUrl = resolveSiteLogoUrl(form.logo_path);

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      editor.patch({ logo_path: await uploadSiteLogo(file) });
      toast.success("הלוגו הועלה — שמרו את המיתוג כדי שיופיע באתר");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת הלוגו נכשלה");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card className="shadow-card" data-branding-card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Palette className="size-4" aria-hidden="true" />
          מיתוג
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          שם החנות, הלוגו וצבע המותג — מופיעים בכותרת האתר, בתחתית, בכפתורים ובמסמכים.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="design-title">כותרת האתר (שם החנות)</Label>
          <Input
            id="design-title"
            value={form.site_title}
            maxLength={120}
            onChange={(event) => editor.patch({ site_title: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="design-logo">לוגו</Label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-1.5">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="הלוגו של החנות"
                  className="max-h-full max-w-full object-contain"
                  data-branding-logo
                />
              ) : (
                <span className="text-xs text-muted-foreground">אין לוגו</span>
              )}
            </div>
            <input
              ref={fileRef}
              id="design-logo"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => void uploadLogo(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              {logoUrl ? "החלפת הלוגו" : "העלאת לוגו"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            תמונה עד 10MB — נשמרת כ-PNG דחוס (שומר על רקע שקוף).
          </p>
        </div>

        <BrandColorField
          value={form.brand_color}
          onChange={(next) => editor.patch({ brand_color: next })}
          storeName={form.site_title.trim() || DEFAULT_STORE_NAME}
        />

        <SaveRow
          dirty={editor.dirty}
          saving={editor.saving}
          disabled={uploading}
          onSave={() => void editor.save()}
          onDiscard={editor.discard}
          label="שמירת המיתוג"
        />
      </CardContent>
    </Card>
  );
}

function IntervalCard({ editor }: { editor: ReturnType<typeof useIntervalEditor> }) {
  return (
    <Card className="shadow-card" data-interval-card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="design-interval" className="flex items-center gap-1.5">
              <Clock className="size-4" aria-hidden="true" />
              זמן החלפה בין הבאנרים (שניות)
            </Label>
            <Input
              id="design-interval"
              type="number"
              inputMode="numeric"
              min={BANNER_INTERVAL.min}
              max={BANNER_INTERVAL.max}
              step={1}
              className="w-28"
              value={editor.value}
              aria-invalid={!editor.valid}
              onChange={(event) => editor.setValue(event.target.value)}
              onBlur={() => {
                if (editor.value !== "")
                  editor.setValue(String(normalizeBannerInterval(editor.value)));
              }}
            />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">
            {BANNER_INTERVAL.min}–{BANNER_INTERVAL.max} שניות (ברירת מחדל {BANNER_INTERVAL.default}
            ). חל על הבאנר העליון והתחתון. סרטון מתנגן עד סופו ואז עובר לפריט הבא; בריחוף עם העכבר
            ההחלפה נעצרת.
          </p>
        </div>
        <SaveRow
          dirty={editor.dirty}
          saving={editor.saving}
          onSave={() => void editor.save()}
          onDiscard={editor.discard}
          label="שמירת זמן ההחלפה"
        />
      </CardContent>
    </Card>
  );
}

function HomePreviewCard({
  device,
  onDeviceChange,
  branding,
  banners,
  intervalSeconds,
}: {
  device: BannerDevice;
  onDeviceChange: (device: BannerDevice) => void;
  branding: BrandingSettings | null;
  banners: Parameters<typeof BannerPreviewPage>[0]["set"];
  intervalSeconds: number;
}) {
  const { settings } = useSiteSettings();
  const sideBanner =
    settings?.desktop_banner_active && settings.desktop_banner_image_url
      ? settings.desktop_banner_image_url
      : null;
  const header = <PreviewHeader branding={branding} device={device} />;
  return (
    <Card className="shadow-card" data-home-preview>
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
              onClick={() => onDeviceChange(option)}
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
            {header}
            <div className="flex gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <BannerPreviewPage
                  set={banners}
                  device="desktop"
                  intervalSeconds={intervalSeconds}
                />
              </div>
              {/* הבאנר הצדדי — בצד שמאל, כמו באתר (לפי מה שנשמר) */}
              {sideBanner && (
                <div className="w-14 shrink-0" data-preview-side-banner>
                  <img
                    src={sideBanner}
                    alt="באנר צדדי"
                    className="w-full rounded-md border border-border object-contain"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-[17.5rem] rounded-[2.25rem] border-[10px] border-foreground/85 bg-foreground/85 shadow-lg">
            <div className="relative overflow-hidden rounded-[1.6rem] bg-background">
              <div className="absolute inset-x-0 top-0 z-10 mx-auto h-5 w-24 rounded-b-xl bg-foreground/85" />
              <div className="max-h-[32rem] overflow-y-auto pt-5">
                {header}
                <div className="p-2.5">
                  <BannerPreviewPage
                    set={banners}
                    device="mobile"
                    intervalSeconds={intervalSeconds}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {device === "desktop"
            ? 'מחשב: באנרים פעילים שסומנו "הצג במחשב". הבאנר הצדדי מוצג לפי מה שנשמר.'
            : 'נייד: באנרים פעילים שסומנו "הצג בנייד". הבאנר הצדדי לא מוצג בנייד.'}
        </p>
      </CardContent>
    </Card>
  );
}

/** כותרת האתר בתצוגה המקדימה — בצבע המותג, עם הלוגו והשם (גם לפני שמירה) */
function PreviewHeader({
  branding,
  device,
}: {
  branding: BrandingSettings | null;
  device: BannerDevice;
}) {
  const color = normalizeBrandColor(branding?.brand_color);
  const logo = resolveSiteLogoUrl(branding?.logo_path ?? null);
  const title = branding?.site_title.trim() || DEFAULT_STORE_NAME;
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 ${color ? "" : "bg-primary text-primary-foreground"}`}
      style={color ? { backgroundColor: color, color: textColorOn(color) } : undefined}
      data-preview-header
    >
      {logo && (
        <img
          src={logo}
          alt=""
          className={`${device === "desktop" ? "h-7" : "h-6"} w-auto rounded bg-white/90 p-0.5`}
        />
      )}
      <span className="truncate text-sm font-bold">{title}</span>
      <span className="ms-auto h-2 w-10 rounded bg-current opacity-30" aria-hidden="true" />
    </div>
  );
}
