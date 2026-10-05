import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AtSign, CheckCircle2, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadEmailSettings, saveEmailSettings, type EmailSettings } from "@/lib/site";
import { getEmailDiagnostics } from "@/lib/email.functions";
import { getStoreEmailProvider, type StoreEmailProviderState } from "@/lib/notifications.functions";
import {
  DEFAULT_SENDER_LOCAL_PART,
  parseSenderInput,
  senderLocalPartProblem,
} from "@/lib/email-sender";
import { SendMessagePanel } from "@/components/SendMessagePanel";
import { EmailTestCard } from "@/components/EmailTestCard";
import { StoreResendCard } from "@/components/StoreResendCard";
import { NotificationLogCard } from "@/components/NotificationLogCard";

type AdminOption = { user_id: string; email: string };
type Diagnostics = Awaited<ReturnType<typeof getEmailDiagnostics>>;

const EMAIL_FORMAT = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
/** דומיין המערכת — עד שהאבחון נטען (בשרת הוא נקבע מ-EMAIL_FROM_ADDRESS) */
const FALLBACK_DOMAIN = "nuri1.fit";

/**
 * התראות מייל של החנות.
 * ברירת המחדל: המיילים יוצאים מתשתית אחת לכל החנויות (מפתח Resend גלובלי
 * בשרת), שמאומת רק על דומיין המערכת — לכן כתובת השולח @nuri1.fit. החנות
 * בוחרת את החלק שלפני ה-@ (ברירת מחדל orders), לאן יגיעו תשובות (Reply-To),
 * מי מקבל התראה על הזמנה חדשה, ובודקת שהשליחה עובדת.
 * חלק 17: אפשר לחבר חשבון Resend משלכם (מפתח + כתובת על הדומיין שלכם) —
 * אישורי ההזמנה ללקוחות יוצאים אז ממנו; ויומן של כל ההתראות שנשלחו.
 */
export function EmailSettingsPanel() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [senderInputProblem, setSenderInputProblem] = useState<string | null>(null);
  const [provider, setProvider] = useState<StoreEmailProviderState | null>(null);
  const [logRefresh, setLogRefresh] = useState(0);
  const loadDiagnostics = useServerFn(getEmailDiagnostics);
  const loadProvider = useServerFn(getStoreEmailProvider);

  const domain = diagnostics?.senderDomain || FALLBACK_DOMAIN;
  const defaultLocal = diagnostics?.defaultLocalPart || DEFAULT_SENDER_LOCAL_PART;

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
      try {
        setProvider(await loadProvider({ data: {} }));
      } catch {
        // החשבון של החנות — תוספת; כשל בטעינה לא מונע את שאר ההגדרות
      }
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

  const localPart = settings.sender_local_part;
  const localProblem = senderInputProblem ?? senderLocalPartProblem(localPart);
  const previewAddress = `${localProblem ? defaultLocal : localPart}@${domain}`;

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

  const onSenderInput = (raw: string) => {
    const parsed = parseSenderInput(raw, domain);
    setSenderInputProblem(parsed.problem);
    setSettings((current) => (current ? { ...current, sender_local_part: parsed.local } : current));
  };

  const save = async () => {
    if (localProblem) {
      toast.error(`כתובת השולח: ${localProblem}`);
      return;
    }
    const replyTo = settings.reply_to_email.trim().toLowerCase();
    if (replyTo !== "" && !EMAIL_FORMAT.test(replyTo)) {
      toast.error("הכתובת למענה אינה תקינה");
      return;
    }
    setBusy(true);
    try {
      await saveEmailSettings({
        ...settings,
        sender_local_part: localPart,
        reply_to_email: replyTo,
      });
      setSettings({ ...settings, reply_to_email: replyTo });
      setDiagnostics(await loadDiagnostics({ data: {} }).catch(() => diagnostics));
      toast.success(`הגדרות המייל נשמרו — המיילים יישלחו מ-${localPart}@${domain}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "השמירה נכשלה";
      toast.error(
        /sender_local_part/.test(message) ? "כתובת השולח אינה תקינה או שמורה למערכת" : message,
      );
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
          <h2 className="text-xl font-bold text-foreground">התראות מייל</h2>
          <p className="text-sm text-muted-foreground">
            אישורי הזמנה ללקוחות, חשבון Resend משלכם, כתובת השולח, יומן התראות ובדיקת שליחה
          </p>
        </div>
      </div>

      <StoreResendCard state={provider} onChange={setProvider} />

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AtSign className="size-4" aria-hidden="true" />
            כתובת השולח של החנות
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {provider?.configured && (
            <p className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs leading-5 text-foreground dark:border-sky-900 dark:bg-sky-950/30">
              החשבון שלכם ב-Resend מחובר: אישורי ההזמנה ללקוחות יוצאים מ-{" "}
              <span dir="ltr" className="font-semibold">
                {provider.senderEmail}
              </span>
              . הכתובת כאן משמשת לשאר המיילים (קודי כניסה, איפוס סיסמה, התראות לצוות) ולגיבוי — אם
              השליחה דרך החשבון שלכם נכשלת.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="e-sender-local">המיילים ללקוחות ולצוות יישלחו מהכתובת</Label>
            <div dir="ltr" className="flex max-w-md">
              <Input
                id="e-sender-local"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                maxLength={80}
                placeholder={defaultLocal}
                aria-invalid={localProblem !== null}
                className="rounded-r-none text-left"
                value={localPart}
                onChange={(e) => onSenderInput(e.target.value)}
              />
              <span className="inline-flex shrink-0 items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
                @{domain}
              </span>
            </div>
            {localProblem ? (
              <p className="text-sm font-medium text-destructive">{localProblem}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                בתיבת הדואר של הלקוח:{" "}
                <span className="font-semibold text-foreground">
                  {diagnostics?.senderName ?? "שם החנות"}
                </span>{" "}
                <span dir="ltr" className="font-semibold text-foreground">
                  &lt;{previewAddress}&gt;
                </span>
              </p>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              אפשר לבחור רק את החלק שלפני ה-@ (למשל השם של החנות באנגלית). הדומיין קבוע —{" "}
              <span dir="ltr">@{domain}</span> — כי רק ממנו מותר לשלוח במערכת. ברירת מחדל:{" "}
              <span dir="ltr">
                {defaultLocal}@{domain}
              </span>
              .
            </p>
            {localPart !== defaultLocal && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => onSenderInput(defaultLocal)}
              >
                חזרה לברירת המחדל ({defaultLocal}@{domain})
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="e-reply-to">כתובת למענה (Reply-To) — לכאן יגיעו תשובות של לקוחות</Label>
            <Input
              id="e-reply-to"
              type="email"
              dir="ltr"
              className="max-w-md"
              placeholder="office@yourbusiness.co.il"
              value={settings.reply_to_email}
              onChange={(e) => setSettings({ ...settings, reply_to_email: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              כל כתובת (גם Gmail). ריק = אימייל העסק מ"הגדרות אתר"
              {diagnostics?.replyTo ? (
                <>
                  {" "}
                  (כרגע: <span dir="ltr">{diagnostics.replyTo}</span>)
                </>
              ) : null}
              .
            </p>
          </div>

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
                <span>שולח שמור כרגע:</span>
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

          <Button disabled={busy || localProblem !== null} onClick={save}>
            {busy ? "שומר..." : "שמירת הגדרות המייל"}
          </Button>
        </CardContent>
      </Card>

      <EmailTestCard
        sender={
          diagnostics
            ? {
                name: diagnostics.senderName,
                address:
                  provider?.configured && provider.senderEmail
                    ? provider.senderEmail
                    : diagnostics.senderAddress,
              }
            : null
        }
        onSent={() => {
          setLogRefresh((current) => current + 1);
          void loadProvider({ data: {} })
            .then(setProvider)
            .catch(() => undefined);
        }}
      />

      <NotificationLogCard refreshKey={logRefresh} />

      <SendMessagePanel />

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

      <Button size="lg" className="w-full" disabled={busy || localProblem !== null} onClick={save}>
        {busy ? "שומר..." : "שמירת הגדרות המייל"}
      </Button>
    </section>
  );
}
