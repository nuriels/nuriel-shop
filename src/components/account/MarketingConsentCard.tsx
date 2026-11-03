import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { marketingConsentText } from "@/lib/marketing-consent";
import { myMarketingConsent, setMyMarketingConsent } from "@/lib/marketing-consent.functions";

/**
 * חלק 40: "דיוור" ב"החשבון שלי" — הלקוח רואה אם הוא מנוי, ומצטרף / מסיר את
 * עצמו בלחיצה. הצטרפות נרשמת עם הנוסח שמוצג כאן (הוכחה להסכמה).
 * SEC-H5: הצטרפות נכנסת לתוקף רק אחרי לחיצה על הקישור במייל האישור; הסרה — מיד.
 */
export function MarketingConsentCard() {
  const { settings } = useSiteSettings();
  const load = useServerFn(myMarketingConsent);
  const save = useServerFn(setMyMarketingConsent);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const storeName = settings?.business_name?.trim() || settings?.site_title?.trim() || "";

  useEffect(() => {
    void load()
      .then((result) => setSubscribed(result.subscribed))
      .catch(() => setSubscribed(false));
  }, [load]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const result = await save({ data: { subscribed: next } });
      setSubscribed(result.subscribed);
      if (result.subscribed) {
        setPendingEmail(null);
        toast.success("את/ה ברשימת הדיוור");
      } else if (next && result.pending) {
        setPendingEmail(result.email);
        toast.success("שלחנו לך מייל לאישור ההצטרפות");
      } else {
        setPendingEmail(null);
        toast.success("הוסרת מרשימת הדיוור");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4" data-testid="account-marketing">
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-semibold">
            <Mail className="size-4" aria-hidden="true" />
            דיוור והטבות במייל
          </p>
          <p id="account-marketing-text" className="text-sm text-muted-foreground">
            {marketingConsentText(storeName, "account")}
          </p>
          {pendingEmail ? (
            <p role="status" className="text-sm font-medium" data-testid="account-marketing-pending">
              כמעט סיימנו — שלחנו מייל אישור אל <bdi dir="ltr">{pendingEmail}</bdi>. ההצטרפות
              תיכנס לתוקף אחרי הלחיצה על הקישור שבמייל.
            </p>
          ) : null}
        </div>
        <Switch
          aria-label="קבלת דיוור והטבות במייל"
          aria-describedby="account-marketing-text"
          checked={subscribed === true}
          disabled={busy || subscribed === null}
          onCheckedChange={(value) => void toggle(value)}
          data-testid="account-marketing-switch"
        />
      </CardContent>
    </Card>
  );
}
