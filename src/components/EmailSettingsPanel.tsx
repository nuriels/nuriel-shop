import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Mail, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadEmailSettings, saveEmailSettings, type EmailSettings } from "@/lib/site";
import { getEmailDiagnostics, sendTestEmail } from "@/lib/email.functions";
import { SendMessagePanel } from "@/components/SendMessagePanel";

type AdminOption = { user_id: string; email: string };

/** הגדרות מייל: כתובת שולחת ואילו מנהלים מקבלים התראה על הזמנה חדשה */
export function EmailSettingsPanel() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Awaited<
    ReturnType<typeof getEmailDiagnostics>
  > | null>(null);
  const sendTest = useServerFn(sendTestEmail);
  const loadDiagnostics = useServerFn(getEmailDiagnostics);

  useEffect(() => {
    void (async () => {
      const [emailSettings, rolesResult] = await Promise.all([
        loadEmailSettings(),
        supabase.from("user_roles").select("user_id, email, role"),
      ]);
      setSettings(emailSettings);
      try {
        setDiagnostics(await loadDiagnostics({ data: {} }));
      } catch {
        // אבחון הוא תוספת בלבד — כשל בו לא מונע את עריכת ההגדרות
      }
      setAdmins(
        (rolesResult.data ?? [])
          .filter((r) => r.role === "admin")
          .map((r) => ({ user_id: r.user_id, email: r.email })),
      );
    })();
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
    setBusy(true);
    try {
      await saveEmailSettings(settings);
      toast.success("הגדרות המייל נשמרו");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const runTestEmail = async () => {
    setTesting(true);
    try {
      const result = await sendTest({ data: {} });
      toast.success(`מייל בדיקה נשלח אל ${result.sentTo}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת מייל הבדיקה נכשלה");
    } finally {
      setTesting(false);
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
          <p className="text-sm text-muted-foreground">שליחת הודעות, כתובת השולח והתראות על הזמנות חדשות</p>
        </div>
      </div>

      <SendMessagePanel />

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">כתובת שולחת</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="e-sender">כתובת המייל שממנה יישלחו כל המיילים ללקוחות ולצוות</Label>
            <Input
              id="e-sender"
              dir="ltr"
              placeholder="orders@yourdomain.co.il"
              value={settings.sender_email}
              onChange={(e) => setSettings({ ...settings, sender_email: e.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            יש להגדיר בשרת את משתנה הסביבה RESEND_API_KEY, ולוודא שהדומיין של הכתובת השולחת מאומת
            בחשבון Resend — אחרת שליחת המיילים תיכשל בשקט ולא תעצור את קליטת ההזמנה.
          </p>
          {diagnostics && (
            <ul className="space-y-1.5 rounded-lg border border-border bg-secondary p-3 text-xs">
              <li className="flex items-center gap-2">
                {diagnostics.hasApiKey ? (
                  <CheckCircle2 className="size-4 shrink-0 text-accent" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-destructive" />
                )}
                {diagnostics.hasApiKey
                  ? `מפתח Resend מוגדר בשרת (${diagnostics.apiKeyHint})`
                  : "מפתח Resend חסר בשרת — אף מייל לא יישלח. יש להגדיר RESEND_API_KEY ב-.env.production ולהפעיל מחדש."}
              </li>
              <li className="flex items-center gap-2">
                {diagnostics.senderEmail ? (
                  <CheckCircle2 className="size-4 shrink-0 text-accent" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-destructive" />
                )}
                {diagnostics.senderEmail
                  ? `כתובת שולחת: ${diagnostics.senderEmail} — יש לוודא שהדומיין ${diagnostics.senderDomain} מאומת ב-Resend`
                  : "לא הוגדרה כתובת שולחת"}
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
          <Button type="button" variant="outline" disabled={testing} onClick={runTestEmail}>
            <Send className="size-4" />
            {testing ? "שולח..." : "שליחת מייל בדיקה"}
          </Button>
          <p className="text-xs text-muted-foreground">
            נשלח אליך (המנהל המחובר) מייל קצר לוודא שהתקשורת עובדת תקין.
          </p>
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
