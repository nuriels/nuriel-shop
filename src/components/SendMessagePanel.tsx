import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Loader2, Mail, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { sendManualMessage } from "@/lib/crm.functions";

type Recipient = { user_id: string; email: string; business_name: string | null };

/**
 * שליחת הודעת מייל ידנית.
 * הנמען הוא לקוח קיים מהרשימה, או כתובת חופשית (למשל לקוח פוטנציאלי
 * שעדיין אין לו חשבון). קישורים שמודבקים בגוף ההודעה הופכים ללחיצים,
 * ואפשר להוסיף כפתור בולט — שימושי בעיקר לקישורי תשלום.
 */
export function SendMessagePanel() {
  const [mode, setMode] = useState<"customer" | "free">("customer");
  const [customers, setCustomers] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [freeEmail, setFreeEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const send = useServerFn(sendManualMessage);

  const load = useCallback(async () => {
    setLoading(true);
    const [rolesResult, profilesResult] = await Promise.all([
      supabase.from("user_roles").select("user_id, email").order("email"),
      supabase.from("customer_profiles").select("user_id, business_name"),
    ]);
    const names = new Map(
      ((profilesResult.data as { user_id: string; business_name: string }[] | null) ?? []).map(
        (row) => [row.user_id, row.business_name],
      ),
    );
    setCustomers(
      ((rolesResult.data as { user_id: string; email: string }[] | null) ?? []).map((row) => ({
        user_id: row.user_id,
        email: row.email,
        business_name: names.get(row.user_id) ?? null,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const query = term.trim().toLowerCase();
  const filtered = customers.filter(
    (customer) =>
      query === "" ||
      customer.email.toLowerCase().includes(query) ||
      (customer.business_name ?? "").toLowerCase().includes(query),
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await send({
        data: {
          ...(mode === "customer" ? { userId: selected } : { email: freeEmail }),
          subject,
          body,
          ctaLabel,
          ctaUrl,
        },
      });
      toast.success(`ההודעה נשלחה אל ${result.sentTo}`);
      setSubject("");
      setBody("");
      setCtaLabel("");
      setCtaUrl("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת ההודעה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const canSend =
    subject.trim() !== "" &&
    body.trim() !== "" &&
    (mode === "customer" ? selected !== "" : freeEmail.trim() !== "");

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4" />
          שליחת הודעה ללקוח
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <RadioGroup
            dir="rtl"
            value={mode}
            onValueChange={(next) => setMode(next as typeof mode)}
            className="flex flex-wrap gap-4"
          >
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value="customer" id="msg-mode-customer" />
              לקוח קיים במערכת
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value="free" id="msg-mode-free" />
              כתובת מייל חופשית
            </label>
          </RadioGroup>

          {mode === "customer" ? (
            <div className="space-y-2">
              <Label htmlFor="msg-search">בחירת נמען</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="msg-search"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="חיפוש לפי שם עסק או אימייל"
                  className="pr-9"
                />
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                {loading ? (
                  <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    טוען נמענים...
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">לא נמצאו נמענים תואמים</p>
                ) : (
                  filtered.map((customer) => (
                    <button
                      key={customer.user_id}
                      type="button"
                      onClick={() => setSelected(customer.user_id)}
                      className={`flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-right transition-colors ${
                        selected === customer.user_id
                          ? "bg-accent/15 ring-1 ring-accent"
                          : "hover:bg-secondary"
                      }`}
                    >
                      <span className="text-sm font-medium">
                        {customer.business_name || customer.email}
                      </span>
                      <span dir="ltr" className="text-xs text-muted-foreground">
                        {customer.email}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="msg-email">כתובת מייל</Label>
              <Input
                id="msg-email"
                type="email"
                dir="ltr"
                value={freeEmail}
                onChange={(e) => setFreeEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="msg-subject">נושא</Label>
            <Input
              id="msg-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="לדוגמה: קישור לתשלום עבור הזמנה SH260000042"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="msg-body">תוכן ההודעה</Label>
            <Textarea
              id="msg-body"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              קישורים שמדביקים בטקסט (https://...) יהפכו אוטומטית ללחיצים במייל.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="size-4" />
              כפתור פעולה (אופציונלי)
            </p>
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <div className="space-y-2">
                <Label htmlFor="msg-cta-label">טקסט הכפתור</Label>
                <Input
                  id="msg-cta-label"
                  value={ctaLabel}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder="מעבר לתשלום"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="msg-cta-url">קישור</Label>
                <Input
                  id="msg-cta-url"
                  dir="ltr"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              מוסיף כפתור בולט בסוף ההודעה — נוח לקישורי תשלום או לטופס חיצוני.
            </p>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={busy || !canSend}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy ? "שולח..." : "שליחת ההודעה"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
