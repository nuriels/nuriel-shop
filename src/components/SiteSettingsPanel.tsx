import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Loader2, Save, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSiteSettings, refreshSiteSettings } from "@/hooks/useSiteSettings";
import {
  labelSizeProblem,
  saveSiteSettings,
  uploadSiteLogo,
  resolveSiteLogoUrl,
  type SiteSettings,
} from "@/lib/site";
import { defaultPrivacyPolicy, defaultTermsOfService } from "@/lib/legal";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { BrandColorField } from "@/components/BrandColorField";
import { SabbathModeCard } from "@/components/SabbathModeCard";
import { LabelSizeCard } from "@/components/delivery/LabelSizeCard";

/** האם שני מצבי הגדרות זהים (כל השדות פשוטים: טקסט / מספר / בוליאני / null) */
function sameSettings(a: SiteSettings, b: SiteSettings): boolean {
  return (Object.keys(a) as (keyof SiteSettings)[]).every((key) => a[key] === b[key]);
}

/** ניהול תוכן האתר, מיתוג ופרטי העסק (משפיע על עמודי אודות/תנאים/פרטיות) */
export function SiteSettingsPanel() {
  const { settings } = useSiteSettings();
  const router = useRouter();
  const [form, setForm] = useState<SiteSettings | null>(settings);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  // הטופס מתמלא פעם אחת כשההגדרות נטענות. רענון מאוחר של ההגדרות (למשל אחרי
  // הפעלת מצב שבת) לא דורס שינויים שהמנהל הקליד ועוד לא שמר.
  useEffect(() => {
    if (settings) setForm((current) => current ?? settings);
  }, [settings]);

  if (!form) return <p className="text-sm text-muted-foreground">טוען הגדרות...</p>;

  const dirty = settings !== null && !sameSettings(form, settings);

  const patch = (next: Partial<SiteSettings>) =>
    setForm((current) => (current ? { ...current, ...next } : current));

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadSiteLogo(file);
      patch({ logo_path: path });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת הלוגו נכשלה");
    } finally {
      setUploading(false);
    }
  };

  const fillDefaults = () => {
    const info = {
      businessName: form.business_name,
      taxId: form.business_tax_id,
      address: form.business_address,
      phone: form.business_phone,
      email: form.business_email,
      sellsAlcohol: form.sells_alcohol,
    };
    patch({
      terms_content: defaultTermsOfService(info),
      privacy_content: defaultPrivacyPolicy(info),
    });
    toast.message('טיוטת ברירת מחדל מולאה — מומלץ להעביר לבדיקת עו"ד לפני פרסום');
  };

  const save = async () => {
    const labelProblem = labelSizeProblem(form.label_width_mm, form.label_height_mm);
    if (labelProblem) {
      toast.error(`מדבקות משלוח — ${labelProblem}`);
      return;
    }
    setBusy(true);
    try {
      await saveSiteSettings(form);
      // מה שנשמר בפועל (למשל צבע מנורמל) — מכאן והלאה זה הבסיס להשוואה
      setForm(await refreshSiteSettings());
      // צבע המותג ושם החנות נטענים ב-root (גם ל-SSR) — מרעננים כדי שיחולו מיד
      await router.invalidate();
      toast.success("ההגדרות נשמרו");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת ההגדרות נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      {/* כותרת + שמירה: נצמדת מתחת לכותרת האתר בזמן גלילה, כך שהשמירה תמיד בהישג יד */}
      <div className="sticky top-[var(--site-header-h,0px)] z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-b border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground">הגדרות אתר ותוכן</h2>
          <p className="text-sm text-muted-foreground">
            מצב שבת, מיתוג וצבע החנות, פרטי העסק, תצוגת מע״מ, מדבקות משלוח, עמודי אודות ומסמכים
            משפטיים
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span
              className="flex items-center gap-1.5 text-xs font-medium text-amber-700"
              role="status"
            >
              <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
              שינויים שלא נשמרו
            </span>
          )}
          <Button disabled={busy || !dirty} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "שומר..." : "שמירת ההגדרות"}
          </Button>
        </div>
      </div>

      <SabbathModeCard
        checked={form.is_sabbath_mode}
        storeName={form.business_name.trim() || form.site_title || DEFAULT_STORE_NAME}
        onSaved={(on) => patch({ is_sabbath_mode: on })}
      />

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">מיתוג</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="s-title">כותרת האתר</Label>
            <Input
              id="s-title"
              value={form.site_title}
              onChange={(e) => patch({ site_title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-logo">לוגו</Label>
            <div className="flex items-center gap-3">
              {form.logo_path && (
                <img
                  src={resolveSiteLogoUrl(form.logo_path) ?? ""}
                  alt="לוגו"
                  className="h-12 w-auto rounded border border-border bg-card p-1"
                />
              )}
              <Input
                id="s-logo"
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => void uploadLogo(e.target.files?.[0])}
              />
              {uploading && <Loader2 className="size-4 animate-spin" />}
            </div>
          </div>
          <BrandColorField
            value={form.brand_color}
            onChange={(next) => patch({ brand_color: next })}
            storeName={form.business_name.trim() || form.site_title || DEFAULT_STORE_NAME}
          />
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">עמוד אודות ויצירת קשר</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="s-about">תוכן עמוד "אודות"</Label>
            <Textarea
              id="s-about"
              rows={5}
              value={form.about_content}
              onChange={(e) => patch({ about_content: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-contact">תוכן עמוד "יצירת קשר"</Label>
            <Textarea
              id="s-contact"
              rows={4}
              value={form.contact_content}
              onChange={(e) => patch({ contact_content: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">
            פרטי העסק (משמשים במסמכים המשפטיים ובחשבוניות)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="s-bname">שם העסק הרשמי</Label>
              <Input
                id="s-bname"
                value={form.business_name}
                onChange={(e) => patch({ business_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-btax">ח.פ / עוסק מורשה</Label>
              <Input
                id="s-btax"
                dir="ltr"
                value={form.business_tax_id}
                onChange={(e) => patch({ business_tax_id: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-baddr">כתובת</Label>
            <Input
              id="s-baddr"
              value={form.business_address}
              onChange={(e) => patch({ business_address: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="s-bphone">טלפון</Label>
              <Input
                id="s-bphone"
                dir="ltr"
                value={form.business_phone}
                onChange={(e) => patch({ business_phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-support">טלפון שירות לקוחות</Label>
              <Input
                id="s-support"
                dir="ltr"
                value={form.support_phone}
                onChange={(e) => patch({ support_phone: e.target.value })}
                placeholder="מופיע במסמכים ובתחתית האתר"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-bemail">אימייל ליצירת קשר</Label>
              <Input
                id="s-bemail"
                dir="ltr"
                value={form.business_email}
                onChange={(e) => patch({ business_email: e.target.value })}
              />
            </div>
          </div>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
            <span className="text-sm font-medium">
              העסק מוכר משקאות אלכוהוליים (מפעיל הגבלת גיל 18+)
            </span>
            <Switch
              checked={form.sells_alcohol}
              onCheckedChange={(v) => patch({ sells_alcohol: v })}
            />
          </label>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">מיתוג המיילים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            לוגו האתר מופיע אוטומטית בראש כל מייל. כאן קובעים את החתימה שתופיע בתחתית ההודעות (אישור
            הזמנה, איפוס סיסמה, טופס הצטרפות והודעות אישיות).
          </p>
          <div className="space-y-2">
            <Label htmlFor="s-signature">חתימת העסק במיילים</Label>
            <Textarea
              id="s-signature"
              rows={4}
              value={form.email_signature}
              onChange={(e) => patch({ email_signature: e.target.value })}
              placeholder={"בכבוד רב,\nצוות סוכנות המשקאות\nרחוב התעשייה 12, חיפה\n04-8000000"}
            />
            <p className="text-xs text-muted-foreground">
              שורה חדשה = שורה חדשה במייל. אם משאירים ריק, נבנית חתימה אוטומטית מפרטי העסק.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">מצב תחזוקה</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <span className="space-y-1">
              <span className="block text-sm font-medium">לחסום את האתר ללקוחות ולאורחים</span>
              <span className="block text-xs text-muted-foreground">
                מנהלים וסוכנים ממשיכים לעבוד כרגיל — אפשר לעדכן מלאי ומחירים בזמן שהאתר סגור.
              </span>
            </span>
            <Switch
              checked={form.maintenance_mode}
              onCheckedChange={(v) => patch({ maintenance_mode: v })}
              aria-label="מצב תחזוקה"
            />
          </label>
          <div className="space-y-2">
            <Label htmlFor="s-maintenance">ההודעה שתוצג לגולשים</Label>
            <Textarea
              id="s-maintenance"
              rows={2}
              value={form.maintenance_message}
              onChange={(e) => patch({ maintenance_message: e.target.value })}
              placeholder="האתר בשיפוצים ויחזור לפעילות בקרוב."
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">מע״מ ותצוגת מחירים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <span className="space-y-1">
              <span className="block text-sm font-medium">המחירים שמוזנים בקטלוג כוללים מע״מ</span>
              <span className="block text-xs text-muted-foreground">
                {form.prices_include_vat
                  ? "מוצג ללקוח סה״כ סופי אחד, בלי תוספת."
                  : `ליד כל מחיר בקטלוג יופיע "+ מע״מ", ובעגלה ובמסמכים יתווסף אוטומטית מע״מ ${form.vat_rate}% מעל סכום המוצרים.`}
              </span>
            </span>
            <Switch
              checked={form.prices_include_vat}
              onCheckedChange={(v) => patch({ prices_include_vat: v })}
              aria-label="המחירים כוללים מע״מ"
            />
          </label>

          <div className="space-y-2 sm:max-w-48">
            <Label htmlFor="s-vat">שיעור מע״מ (%)</Label>
            <Input
              id="s-vat"
              type="number"
              min={0}
              max={100}
              step="0.5"
              dir="ltr"
              className="numeric"
              value={form.vat_rate}
              onChange={(e) => patch({ vat_rate: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">שיעור המע״מ בישראל נכון להיום: 18%.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">משלוח חינם</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="space-y-2 sm:max-w-56">
            <Label htmlFor="s-free-shipping">משלוח חינם בהזמנה מעל (₪)</Label>
            <Input
              id="s-free-shipping"
              type="number"
              min={1}
              step="1"
              dir="ltr"
              className="numeric"
              placeholder="ללא"
              value={form.free_shipping_threshold ?? ""}
              onChange={(e) => {
                const value = e.target.value.trim();
                patch({
                  free_shipping_threshold:
                    value === "" || !(Number(value) > 0) ? null : Number(value),
                });
              }}
            />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            בסל של הלקוח יוצג מד: "חסרים לך עוד X ₪ למשלוח חינם!", ובהגעה לסכום — הודעת הצלחה. הסכום
            נמדד לפי סכום המוצרים בסל{form.prices_include_vat ? "" : " (לפני מע״מ)"}, בלי פיקדון.
            ריק = בלי מד משלוח.
          </p>
        </CardContent>
      </Card>

      <LabelSizeCard
        width={form.label_width_mm}
        height={form.label_height_mm}
        storeName={form.business_name || form.site_title}
        storePhone={form.support_phone || form.business_phone}
        onChange={patch}
      />

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">תנאי שימוש ומדיניות פרטיות</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={fillDefaults}>
            <Wand2 className="size-4" />
            מלא טיוטת ברירת מחדל
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
            הטיוטה האוטומטית היא נקודת פתיחה כללית בהתאם לדין הישראלי ואינה תחליף לייעוץ משפטי.
            מומלץ להעביר לבדיקת עו"ד לפני פרסום לציבור.
          </p>
          <div className="space-y-2">
            <Label htmlFor="s-terms">תנאי שימוש</Label>
            <Textarea
              id="s-terms"
              dir="rtl"
              rows={10}
              value={form.terms_content}
              onChange={(e) => patch({ terms_content: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-privacy">מדיניות פרטיות</Label>
            <Textarea
              id="s-privacy"
              dir="rtl"
              rows={10}
              value={form.privacy_content}
              onChange={(e) => patch({ privacy_content: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
