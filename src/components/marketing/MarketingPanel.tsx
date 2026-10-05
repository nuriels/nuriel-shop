import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  Gift,
  Loader2,
  Lock,
  Megaphone,
  Puzzle,
  Save,
  Scale,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SeoCounter } from "@/components/marketing/SeoCounter";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useSubscription } from "@/hooks/useSubscription";
import { ADDON_DEFAULTS, addonPriceLabel } from "@/lib/addons";

const ZAP_ADDON_PRICE_LABEL = addonPriceLabel(ADDON_DEFAULTS.zapier);
import {
  EMPTY_MARKETING,
  MARKETING_COLUMNS,
  PROMO_TEXT_MAX,
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_RECOMMENDED,
  SEO_TITLE_MAX,
  SEO_TITLE_RECOMMENDED,
  ZAP_JOIN_URL,
  gaIdProblem,
  normalizeGaId,
  normalizePixelId,
  pixelIdProblem,
  zapFeedUrl,
  type MarketingSettings,
} from "@/lib/marketing";
import { COUPON_COLUMNS, couponLabel, type Coupon } from "@/lib/coupons";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { cn } from "@/lib/utils";

const NO_COUPON = "__none__";

function same(a: MarketingSettings, b: MarketingSettings): boolean {
  return (Object.keys(a) as (keyof MarketingSettings)[]).every((key) => a[key] === b[key]);
}

/** הודעה ברורה במקום שם ה-constraint מהמסד */
function friendlyError(message: string): string {
  if (/tracking_check/.test(message)) return "מזהה ה-Pixel או ה-Google Analytics לא בפורמט הנכון";
  if (/promo_popup_check/.test(message)) return "פופ-אפ פעיל חייב טקסט (עד 600 תווים)";
  if (/seo_check/.test(message)) return "כותרת SEO עד 120 תווים, תיאור עד 320";
  if (/zap_delivery_days/.test(message)) return "זמן אספקה לזאפ: 0 עד 60 ימים";
  return message;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("הקישור הועתק");
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          toast.info(value);
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "הועתק!" : label}
    </Button>
  );
}

/**
 * שיווק ואינטגרציות (חלק 14): SEO של החנות (גוגל ושיתוף), פופ-אפ מבצעים
 * בכניסה, Facebook Pixel ו-Google Analytics, והחיבור לזאפ השוואת מחירים.
 */
export function MarketingPanel() {
  const router = useRouter();
  const { settings } = useSiteSettings();
  // חלק 15: הפיד לזאפ נפתח רק עם התוסף "חיבור לזאפ" (גם בפרימיום)
  const zapUnlocked = useSubscription().can("zapFeed");
  const [saved, setSaved] = useState<MarketingSettings | null>(null);
  const [form, setForm] = useState<MarketingSettings>(EMPTY_MARKETING);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [zapCount, setZapCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const feedUrl = zapFeedUrl(origin);
  const storeName =
    settings?.business_name?.trim() || settings?.site_title?.trim() || DEFAULT_STORE_NAME;

  const load = useCallback(async () => {
    const [{ data, error }, { data: couponRows }, { count }] = await Promise.all([
      supabase.from("site_settings").select(MARKETING_COLUMNS).eq("id", true).maybeSingle(),
      supabase
        .from("coupons")
        .select(COUPON_COLUMNS)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("global_products")
        .select("id", { count: "exact", head: true })
        .eq("show_in_zap", true)
        .eq("is_hidden", false)
        .eq("is_out_of_stock", false),
    ]);
    if (error) toast.error(error.message);
    const next: MarketingSettings = data
      ? { ...(data as MarketingSettings), zap_delivery_days: Number(data.zap_delivery_days) }
      : EMPTY_MARKETING;
    setSaved(next);
    setForm(next);
    setCoupons(
      ((couponRows ?? []) as Coupon[]).map((c) => ({
        ...c,
        discount_value: Number(c.discount_value),
      })),
    );
    setZapCount(count ?? 0);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (next: Partial<MarketingSettings>) =>
    setForm((current) => ({ ...current, ...next }));
  const dirty = saved !== null && !same(form, saved);

  const pixel = normalizePixelId(form.facebook_pixel_id);
  const ga = normalizeGaId(form.google_analytics_id);
  const pixelProblem = pixelIdProblem(pixel);
  const gaProblem = gaIdProblem(ga);

  const save = async () => {
    if (pixelProblem || gaProblem) {
      toast.error(pixelProblem ?? gaProblem ?? "");
      return;
    }
    if (form.promo_popup_enabled && form.promo_popup_text.trim() === "") {
      toast.error("כתבו את טקסט הפופ-אפ, או כבו אותו");
      return;
    }
    const days = Math.round(Number(form.zap_delivery_days));
    if (!Number.isFinite(days) || days < 0 || days > 60) {
      toast.error("זמן אספקה לזאפ: 0 עד 60 ימים");
      return;
    }
    setBusy(true);
    const values: MarketingSettings = {
      seo_title: form.seo_title.trim(),
      seo_description: form.seo_description.trim(),
      promo_popup_enabled: form.promo_popup_enabled,
      promo_popup_text: form.promo_popup_text.trim(),
      promo_popup_coupon: form.promo_popup_coupon || null,
      facebook_pixel_id: pixel || null,
      google_analytics_id: ga || null,
      zap_delivery_days: days,
    };
    const { error } = await supabase.from("site_settings").update(values).eq("id", true);
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error.message));
      return;
    }
    setSaved(values);
    setForm(values);
    // הכותרת, המעקב והפופ-אפ נטענים ב-root (גם ל-SSR) — מרעננים כדי שיחולו מיד
    await router.invalidate();
    toast.success("ההגדרות נשמרו");
  };

  const previewTitle = form.seo_title.trim() || storeName;
  const previewDescription =
    form.seo_description.trim() || "הוסיפו תיאור קצר שיופיע מתחת לשם החנות בתוצאות החיפוש.";
  const popupCoupon = form.promo_popup_coupon ?? NO_COUPON;
  const couponOptions = useMemo(() => {
    const list = [...coupons];
    if (form.promo_popup_coupon && !list.some((c) => c.code === form.promo_popup_coupon)) {
      // קוד שנבחר בעבר וכבר לא פעיל — נשאר ברשימה כדי שיראו מה מוגדר
      list.unshift({ code: form.promo_popup_coupon, id: form.promo_popup_coupon } as Coupon);
    }
    return list;
  }, [coupons, form.promo_popup_coupon]);

  if (saved === null) {
    return <p className="text-sm text-muted-foreground">טוען הגדרות…</p>;
  }

  return (
    <section className="space-y-5">
      <div className="sticky top-[var(--site-header-h,0px)] z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-b border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Megaphone className="size-5 text-accent" aria-hidden="true" />
            שיווק ואינטגרציות
          </h2>
          <p className="text-sm text-muted-foreground">
            גוגל, פופ-אפ מבצעים, Facebook Pixel, Google Analytics וזאפ השוואת מחירים
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="text-xs font-medium text-amber-700">יש שינויים שלא נשמרו</span>
          )}
          <Button onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            שמירה
          </Button>
        </div>
      </div>

      {/* ---------- SEO ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="size-5 text-primary" aria-hidden="true" />
            קידום בגוגל (SEO)
          </CardTitle>
          <CardDescription>
            הכותרת והתיאור של החנות בתוצאות החיפוש ובשיתוף קישור בווטסאפ / פייסבוק. לכל מוצר יש עמוד
            משלו עם SEO נפרד (בעריכת המוצר).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mk-seo-title">כותרת האתר</Label>
            <Input
              id="mk-seo-title"
              value={form.seo_title}
              maxLength={SEO_TITLE_MAX}
              placeholder={`${storeName} — חנות אונליין`}
              onChange={(e) => patch({ seo_title: e.target.value })}
            />
            <SeoCounter value={form.seo_title} recommended={SEO_TITLE_RECOMMENDED} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mk-seo-desc">תיאור האתר</Label>
            <Textarea
              id="mk-seo-desc"
              rows={3}
              value={form.seo_description}
              maxLength={SEO_DESCRIPTION_MAX}
              placeholder="למשל: משלוחים מהירים לכל הארץ, מבצעים כל שבוע ושירות אישי."
              onChange={(e) => patch({ seo_description: e.target.value })}
            />
            <SeoCounter value={form.seo_description} recommended={SEO_DESCRIPTION_RECOMMENDED} />
          </div>
          {/* תצוגה מקדימה בסגנון תוצאת חיפוש */}
          <div className="rounded-xl border bg-card p-4 shadow-sm" aria-label="תצוגה מקדימה בגוגל">
            <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
              כך זה ייראה בגוגל
            </p>
            <p className="truncate text-xs text-emerald-700 dark:text-emerald-400" dir="ltr">
              {origin.replace(/^https?:\/\//, "")}
            </p>
            <p className="truncate text-lg text-[#1a0dab] dark:text-sky-400">{previewTitle}</p>
            <p className="line-clamp-2 text-sm text-muted-foreground">{previewDescription}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FileCode2 className="size-3.5" aria-hidden="true" />
              מפת האתר לגוגל (מתעדכנת לבד):
            </span>
            <a
              href={`${origin}/sitemap.xml`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
              dir="ltr"
            >
              {origin}/sitemap.xml
            </a>
            <span>· אפשר להגיש אותה ב-Google Search Console</span>
          </div>
        </CardContent>
      </Card>

      {/* ---------- פופ-אפ ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gift className="size-5 text-accent" aria-hidden="true" />
            פופ-אפ מבצעים בכניסה לאתר
          </CardTitle>
          <CardDescription>
            חלון שיווקי שקופץ ללקוח בכניסה לחנות — פעם אחת לכל נוסח (נוסח חדש יוצג שוב לכולם). לא
            מוצג בקופה ובפאנל הניהול.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <span className="text-sm font-medium">הפופ-אפ פעיל</span>
            <Switch
              checked={form.promo_popup_enabled}
              onCheckedChange={(v) => patch({ promo_popup_enabled: v })}
            />
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="mk-popup-text">הטקסט בפופ-אפ</Label>
            <Textarea
              id="mk-popup-text"
              rows={4}
              value={form.promo_popup_text}
              maxLength={PROMO_TEXT_MAX}
              placeholder="10% הנחה על ההזמנה הראשונה! 🎉 הקלידו את הקוד בקופה."
              onChange={(e) => patch({ promo_popup_text: e.target.value })}
            />
            <p className="text-left text-[11px] text-muted-foreground" dir="ltr">
              {form.promo_popup_text.length}/{PROMO_TEXT_MAX}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>קוד קופון בפופ-אפ (לא חובה)</Label>
            <Select
              value={popupCoupon}
              onValueChange={(value) =>
                patch({ promo_popup_coupon: value === NO_COUPON ? null : value })
              }
              dir="rtl"
            >
              <SelectTrigger>
                <SelectValue placeholder="בלי קופון" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COUPON}>בלי קופון</SelectItem>
                {couponOptions.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code}
                    {c.discount_type
                      ? ` — ${couponLabel(c.discount_type, c.discount_value)}`
                      : " (לא פעיל)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              הלקוח רואה את הקוד עם כפתור "העתקה". קופונים — בלשונית "קופונים".
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---------- מעקב ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="size-5 text-primary" aria-hidden="true" />
            מעקב ופרסום
          </CardTitle>
          <CardDescription>
            הקוד הרשמי נטען אוטומטית בכל עמודי החנות (לא בפאנל הניהול). נמדדים צפיות בעמודים, הוספה
            לסל ורכישה — לקמפיינים בפייסבוק / אינסטגרם ובגוגל.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mk-pixel">מזהה Facebook Pixel</Label>
            <Input
              id="mk-pixel"
              dir="ltr"
              inputMode="numeric"
              value={form.facebook_pixel_id ?? ""}
              placeholder="1234567890123456"
              aria-invalid={pixelProblem ? true : undefined}
              onChange={(e) => patch({ facebook_pixel_id: e.target.value || null })}
            />
            <p
              className={cn("text-xs", pixelProblem ? "text-destructive" : "text-muted-foreground")}
            >
              {pixelProblem ?? "מ-Meta Events Manager ← מקורות נתונים ← מזהה ה-Pixel (ספרות בלבד)"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mk-ga">מזהה Google Analytics</Label>
            <Input
              id="mk-ga"
              dir="ltr"
              value={form.google_analytics_id ?? ""}
              placeholder="G-XXXXXXXXXX"
              aria-invalid={gaProblem ? true : undefined}
              onChange={(e) => patch({ google_analytics_id: e.target.value || null })}
            />
            <p className={cn("text-xs", gaProblem ? "text-destructive" : "text-muted-foreground")}>
              {gaProblem ?? "מ-Google Analytics ← ניהול ← Data Streams ← מזהה המדידה"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---------- זאפ ---------- */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-l from-orange-50 to-transparent dark:from-orange-950/30">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Scale className="size-5 text-orange-600" aria-hidden="true" />
            חיבור לזאפ השוואת מחירים
          </CardTitle>
          <CardDescription>
            זאפ קורא את המוצרים שלכם מקובץ XML שמתעדכן לבד — מחירים, מלאי ותמונות תמיד מעודכנים.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                1
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-semibold">פתחו חשבון חנות בזאפ</p>
                <p className="text-sm text-muted-foreground">
                  ההצטרפות מתבצעת מול צוות זאפ (מודל תשלום לפי הקלקות).
                </p>
                {/* חלק 16: קישור ההרשמה — רק אחרי רכישת התוסף "חיבור לזאפ" */}
                {zapUnlocked ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={ZAP_JOIN_URL} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      להרשמת חנות חדשה בזאפ
                    </a>
                  </Button>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5" aria-hidden="true" />
                    הקישור להרשמה יופיע כאן אחרי רכישת התוסף.
                  </p>
                )}
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                2
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-semibold">מסרו לתמיכה של זאפ את הקישור לקובץ המוצרים</p>
                {zapUnlocked ? (
                  <>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <code
                        dir="ltr"
                        className="min-w-0 flex-1 truncate rounded-lg border bg-secondary/60 px-3 py-2 text-sm"
                      >
                        {feedUrl}
                      </code>
                      <CopyButton value={feedUrl} label="העתק קישור למסירה לתמיכה של זאפ" />
                    </div>
                    <a
                      href={feedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      צפייה בקובץ
                    </a>
                  </>
                ) : (
                  <div className="space-y-2 rounded-lg border border-dashed border-orange-300 bg-orange-50/60 p-3 text-sm dark:border-orange-800 dark:bg-orange-950/30">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <Lock className="size-4 text-orange-700" aria-hidden="true" />
                      הקישור לקובץ ייפתח עם התוסף "חיבור לזאפ"
                      <span className="rounded-full bg-orange-600 px-2 py-0.5 text-[11px] font-bold text-white">
                        {ZAP_ADDON_PRICE_LABEL}
                      </span>
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      זאפ מאשר חנויות רק לאחר חיבור סליקת אשראי פעילה. אחרי רכישת התוסף יופיעו כאן
                      הקישור להרשמה והקישור לקובץ — ובינתיים אפשר כבר לבחור אילו מוצרים יופיעו.
                    </p>
                    <Link
                      to="/admin"
                      search={{ tab: "addons" }}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      <Puzzle className="size-4" aria-hidden="true" />
                      לשדרוגים ותוספים
                    </Link>
                  </div>
                )}
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                3
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold">בחרו אילו מוצרים יופיעו</p>
                <p className="text-sm text-muted-foreground">
                  בעריכת מוצר — "הצג בזאפ השוואת מחירים" (מסומן כברירת מחדל). בפיד נכללים רק מוצרים
                  שבמלאי ועם מחיר.
                </p>
                <p className="text-sm font-semibold">
                  {zapCount === null ? "…" : `${zapCount.toLocaleString("he-IL")} מוצרים בפיד כרגע`}
                </p>
              </div>
            </li>
          </ol>
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-[12rem_1fr] sm:items-center">
            <Label htmlFor="mk-zap-days">זמן אספקה (ימי עסקים)</Label>
            <div className="flex items-center gap-3">
              <Input
                id="mk-zap-days"
                type="number"
                min={0}
                max={60}
                className="w-24"
                dir="ltr"
                value={String(form.zap_delivery_days)}
                onChange={(e) => patch({ zap_delivery_days: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">
                מופיע בזאפ ליד כל מוצר. דמי המשלוח — לפי שיטת המשלוח הזולה שלכם.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
