import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Megaphone, Monitor, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { refreshSiteSettings, useSiteSettings } from "@/hooks/useSiteSettings";
import {
  saveSideBanner,
  sideBannerLinkProblem,
  uploadSideBannerImage,
  type SideBannerSettings,
} from "@/lib/site";
import { cn } from "@/lib/utils";

type Form = { active: boolean; imageUrl: string; link: string };

const fromSettings = (settings: SideBannerSettings): Form => ({
  active: settings.desktop_banner_active,
  imageUrl: settings.desktop_banner_image_url ?? "",
  link: settings.desktop_banner_link ?? "",
});

/**
 * "באנרים ופרסומים" בהגדרות החנות (חלק 19): באנר צדדי למסכי מחשב.
 * מעלים תמונה (נדחסת ל-WebP ועולה ל-Storage של החנות, כמו הלוגו), מגדירים
 * קישור (למשל לעמוד המבצעים) ומדליקים / מכבים. באתר הוא מוצג בעמודה השמאלית
 * רק במסכים גדולים (lg ומעלה), נשאר במקום בזמן הגלילה, ומוסתר לגמרי בנייד
 * ובטאבלט. נשמר בכפתור משלו; המסד בודק שוב את הקישורים.
 */
export function SideBannerCard() {
  const { settings } = useSiteSettings();
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ההגדרות השמורות (פעם אחת כשנטענו) — לא דורסים עריכה
  useEffect(() => {
    if (!settings || saved) return;
    const current = fromSettings(settings);
    setSaved(current);
    setForm(current);
  }, [settings, saved]);

  if (!form || !saved) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          טוען את הבאנרים…
        </CardContent>
      </Card>
    );
  }

  const linkProblem = sideBannerLinkProblem(form.link);
  const dirty =
    form.active !== saved.active ||
    form.imageUrl !== saved.imageUrl ||
    form.link.trim() !== saved.link.trim();
  const patch = (next: Partial<Form>) =>
    setForm((current) => (current ? { ...current, ...next } : current));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadSideBannerImage(file);
      // תמונה ראשונה — הבאנר נדלק אוטומטית (אפשר לכבות לפני השמירה)
      patch({ imageUrl: url, ...(form.imageUrl === "" ? { active: true } : {}) });
      toast.success("התמונה הועלתה — שמרו כדי שתופיע באתר");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת התמונה נכשלה");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    if (linkProblem) {
      toast.error(linkProblem);
      document.getElementById("side-banner-link")?.focus();
      return;
    }
    if (form.active && form.imageUrl === "") {
      toast.error("כדי להציג את הבאנר צריך קודם להעלות תמונה");
      return;
    }
    setBusy(true);
    try {
      const row = await saveSideBanner({
        desktop_banner_active: form.active,
        desktop_banner_image_url: form.imageUrl || null,
        desktop_banner_link: form.link.trim() || null,
      });
      const next = fromSettings(row);
      setSaved(next);
      setForm(next);
      await refreshSiteSettings();
      toast.success(next.active ? "הבאנר נשמר ומוצג באתר במסכי מחשב" : "הבאנר נשמר (כבוי)");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="side-banner" className="shadow-card" data-side-banner-card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4" aria-hidden="true" />
          באנרים ופרסומים
        </CardTitle>
        <Badge variant={saved.active ? "default" : "outline"} className="gap-1">
          <Monitor className="size-3.5" aria-hidden="true" />
          {saved.active ? "באנר צדדי פעיל" : "באנר צדדי כבוי"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="leading-6 text-muted-foreground">
          באנר צדדי שמנצל את השטח הריק בצד שמאל של האתר — רק במסכי מחשב גדולים. הוא נשאר במקום בזמן
          שהלקוח גולל, ולא מוצג בכלל בנייד ובטאבלט. מומלץ תמונה צרה וגבוהה (למשל 300×600).
        </p>

        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          {/* תצוגה מקדימה */}
          <div
            className={cn(
              "flex aspect-[1/2] w-40 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-secondary/40",
              form.imageUrl && "border-solid",
            )}
          >
            {form.imageUrl ? (
              <img
                src={form.imageUrl}
                alt="תצוגה מקדימה של הבאנר"
                className="h-full w-full object-contain"
                data-side-banner-preview
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                <ImageIcon className="size-6" aria-hidden="true" />
                אין תמונה
              </span>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                id="side-banner-file"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => void upload(event.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                {form.imageUrl ? "החלפת התמונה" : "העלאת תמונת באנר"}
              </Button>
              {form.imageUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => patch({ imageUrl: "", active: false })}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  הסרת התמונה
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              JPG / PNG / WEBP עד 15MB — התמונה נדחסת אוטומטית לטעינה מהירה.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="side-banner-link">קישור (לא חובה)</Label>
              <Input
                id="side-banner-link"
                dir="ltr"
                inputMode="url"
                maxLength={2000}
                placeholder="/?category=מבצעים  או  https://…"
                className="text-right"
                aria-invalid={linkProblem !== null}
                value={form.link}
                onChange={(event) => patch({ link: event.target.value })}
              />
              {linkProblem ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {linkProblem}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  לאן הלקוח מגיע בלחיצה — עמוד באתר (מתחיל ב-/) או כתובת מלאה. ריק = הבאנר בלי
                  קישור.
                </p>
              )}
            </div>

            <label
              htmlFor="side-banner-active"
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-xl border-2 p-3 transition-colors",
                form.active ? "border-primary/50 bg-primary/5" : "border-border",
                !form.imageUrl && "cursor-not-allowed opacity-60",
              )}
            >
              <span className="space-y-0.5">
                <span className="block font-bold text-foreground">הצגת הבאנר באתר</span>
                <span className="block text-xs text-muted-foreground">
                  {form.imageUrl
                    ? "בעמוד הקטלוג ובעמודי המוצרים, במסכי מחשב בלבד"
                    : "העלו קודם תמונה"}
                </span>
              </span>
              <Switch
                id="side-banner-active"
                checked={form.active}
                disabled={!form.imageUrl}
                onCheckedChange={(checked) => patch({ active: checked })}
                aria-label="הצגת הבאנר באתר"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy || uploading || !dirty} onClick={() => void save()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "שומר…" : "שמירת הבאנר"}
          </Button>
          {dirty && !busy && <span className="text-xs text-amber-700">יש שינויים שלא נשמרו</span>}
        </div>
      </CardContent>
    </Card>
  );
}
