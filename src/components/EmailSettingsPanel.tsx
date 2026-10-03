import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadEmailSettings, saveEmailSettings, type EmailSettings } from "@/lib/site";
import { getEmailDiagnostics } from "@/lib/email.functions";
import { SendMessagePanel } from "@/components/SendMessagePanel";
import { EmailTestCard } from "@/components/EmailTestCard";

type AdminOption = { user_id: string; email: string };
type Diagnostics = Awaited<ReturnType<typeof getEmailDiagnostics>>;

const EMAIL_FORMAT = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * הגדרות מייל של החנות.
 * המיילים יוצאים מתשתית אחת לכל החנויות (מפתח Resend גלובלי בשרת), מהכתובת
 * של המערכת עם שם החנות — "שם החנות <orders@nuri1.fit>". כאן החנות קובעת לאן
 * יגיעו תשובות של לקוחות (Reply-To), מי מקבל התראה על הזמנה חדשה, ובודקת
 * שהשליחה עובדת.
 */
export function EmailSettingsPanel() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const loadDiagnostics = useServerFn(getEmailDiagnostics);

  useEffect(() => {
    void (async () => {
      const [emailSettings, rolesResult] = await Promise.all([
        loadEmailSettings(),
        supabase.from("user_roles").select("user_id, email, role"),
      ]);
      let diag: Diagnostics | null = null;
      try {
        diag = await loadDiagnostics({ data: {} });
        setDiagnostics(diag);
      } catch {
        // אבחון הוא תוספת בלבד — כשל בו לא מונע את עריכת ההגדרות
      }
      // כתובת על דומיין המערכת (ברירת המחדל הישנה) אינה כתובת למענה — מוצגת ריקה
      const replyTo = emailSettings.sender_email.trim().toLowerCase();
      const systemDomain = diag?.senderDomain?.toLowerCase() ?? "";
      setSettings({
        ...emailSettings,
        sender_email: systemDomain !== "" && replyTo.endsWith(`@${systemDomain}`) ? "" : replyTo,
      });
      setAdmins(
        (rolesResult.data ?? [])
          .filter((r) => r.role === "admin")
          .map((r) => ({ user_id: r.user_id, email: r.email })),
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- נטען פעם אחת
  }, []);

  // הפאנל לשליחת הודעה אינו תלוי בהגדרות המייל — מוצג גם בזמן טעינה או
  // אם טעינת ההגדרות נכשלה, כדי שהאפשרות תמיד תהיה גלויה
  if (!settings) {
    return (
      <section className="space-y-5">
        <SendMessagePanel />
        <p className="text-sm text-muted-foreground">טוען הגדרות מייל...</p>
      </section>
    );
  }

  const toggleAdmin = (userId: string, checked: boolean) =>
    setSettings((current) =>
      current
        ? {
            ...current,
            notify_admin_user_ids: checked
              ? [...current.notify_admin_user_ids, userId]
              : current.notify_admin_user_ids.filter((id) => id !== userId),
          }
        : current,
    );

  const save = async () => {
    const replyTo = settings.sender_email.trim().toLowerCase();
    if (replyTo !== "" && !EMAIL_FORMAT.test(replyTo)) {
      toast.error("הכתובת למענה אינה תקינה");
      return;
    }
    setBusy(true);
    try {
      await saveEmailSettings({ ...settings, sender_email: replyTo });
      setDiagnostics(await loadDiagnostics({ data: {} }).catch(() => diagnostics));
      toast.success("הגדרות המייל נשמרו");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
          <Mail className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">הגדרות מייל</h2>
          <p className="text-sm text-muted-foreground">
            שליחת הודעות, בדיקת שליחה, כתובת למענה והתראות על הזמנות חדשות
          </p>
        </div>
      </div>

      <SendMessagePanel />

      <EmailTestCard
        sender={
          diagnostics ? { name: diagnostics.senderName, address: diagnostics.senderAddress } : null
        }
      />

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">שולח המיילים של החנות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {diagnostics && (
            <ul className="space-y-1.5 rounded-lg border border-border bg-secondary p-3 text-xs">
              <li className="flex items-center gap-2">
                {diagnostics.hasApiKey ? (
                  <CheckCircle2 className="size-4 shrink-0 text-accent" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-destructive" />
                )}
                {diagnostics.hasApiKey
                  ? `תשתית המייל של המערכת פעילה (מפתח Resend ${diagnostics.apiKeyHint})`
                  : "מפתח Resend חסר בשרת — אף מייל לא יישלח. מנהל הפלטפורמה מגדיר אותו פעם אחת לכל החנויות (RESEND_API_KEY)."}
              </li>
              <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <CheckCircle2 className="size-4 shrink-0 text-accent" />
                <span>המיילים ללקוחות ולצוות יוצאים מ:</span>
                <span className="font-semibold text-foreground">{diagnostics.senderName}</span>
                <span dir="ltr" className="text-foreground">
                  &lt;{diagnostics.senderAddress}&gt;
                </span>
              </li>
              <li className="flex items-center gap-2">
                {diagnostics.siteUrlConfigured ? (
                  <CheckCircle2 className="size-4 shrink-0 text-accent" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-destructive" />
                )}
                {diagnostics.siteUrlConfigured
                  ? "כתובת האתר מוגדרת (קישורי איפוס סיסמה ייבנו נכון)"
                  : "כתובת החנות לא מוגדרת (דומיין לחנות או TENANT_BASE_DOMAIN / PUBLIC_SITE_URL) — קישורים במיילים לא יישלחו"}
              </li>
            </ul>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            שם השולח הוא שם העסק מ"הגדרות אתר". כתובת השולח היא של המערכת (מאומתת), כך שאין צורך
            לאמת דומיין לכל חנות.
          </p>
          <div className="space-y-2">
            <Label htmlFor="e-reply-to">כתובת למענה (Reply-To) — לכאן יגיעו תשובות של לקוחות</Label>
            <Input
              id="e-reply-to"
              type="email"
              dir="ltr"
              placeholder="office@yourbusiness.co.il"
              value={settings.sender_email}
              onChange={(e) => setSettings({ ...settings, sender_email: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              ריק = אימייל העסק מ"הגדרות אתר"
              {diagnostics?.replyTo ? (
                <>
                  {" "}
                  (כרגע: <span dir="ltr">{diagnostics.replyTo}</span>)
                </>
              ) : null}
              .
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">מנהלים שיקבלו התראה על כל הזמנה חדשה</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {admins.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין עדיין משתמשי מנהל נוספים</p>
          ) : (
            admins.map((admin) => (
              <label
                key={admin.user_id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <span dir="ltr" className="truncate text-sm">
                  {admin.email}
                </span>
                <Checkbox
                  checked={settings.notify_admin_user_ids.includes(admin.user_id)}
                  onCheckedChange={(v) => toggleAdmin(admin.user_id, v === true)}
                />
              </label>
            ))
          )}
        </CardContent>
      </Card>

      <Button size="lg" className="w-full" disabled={busy} onClick={save}>
        {busy ? "שומר..." : "שמירת הגדרות המייל"}
      </Button>
    </section>
  );
}
