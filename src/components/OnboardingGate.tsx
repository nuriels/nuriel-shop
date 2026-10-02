import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeOnboarding } from "@/lib/onboarding.functions";

type FormState = {
  businessName: string;
  businessAddress: string;
  taxId: string;
  contactName: string;
  phone: string;
  password: string;
  confirmation: string;
};

/**
 * מסך חסימה בכניסה הראשונה.
 * הלקוח חייב להשלים את פרטי העסק, ואם נכנס עם סיסמה זמנית — גם לקבוע
 * סיסמה קבועה. עד אז אין גישה לקטלוג ולהזמנות.
 */
export function OnboardingGate({
  userId,
  email,
  mustChangePassword,
  onDone,
}: {
  userId: string;
  email: string;
  mustChangePassword: boolean;
  onDone: () => void;
}) {
  const submitOnboarding = useServerFn(completeOnboarding);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState<FormState>({
    businessName: "",
    businessAddress: "",
    taxId: "",
    contactName: "",
    phone: "",
    password: "",
    confirmation: "",
  });

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("customer_profiles")
        .select("business_name, business_address, tax_id, contact_name, phone")
        .eq("user_id", userId)
        .maybeSingle();
      // משתמש חדש מ-Google: שם איש הקשר כבר ידוע — ממלאים מראש (אפשר לשנות)
      const { data: auth } = await supabase.auth.getUser();
      const meta = (auth.user?.user_metadata ?? {}) as { full_name?: string; name?: string };
      setForm((current) => ({
        ...current,
        businessName: data?.business_name ?? "",
        businessAddress: data?.business_address ?? "",
        taxId: data?.tax_id ?? "",
        contactName: data?.contact_name ?? meta.full_name ?? meta.name ?? "",
        phone: data?.phone ?? "",
      }));
      setLoading(false);
    })();
  }, [userId]);

  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mustChangePassword && form.password !== form.confirmation) {
      toast.error("הסיסמאות אינן זהות");
      return;
    }
    setBusy(true);
    try {
      await submitOnboarding({
        data: {
          businessName: form.businessName,
          businessAddress: form.businessAddress,
          taxId: form.taxId,
          contactName: form.contactName,
          phone: form.phone,
          ...(mustChangePassword ? { newPassword: form.password } : {}),
        },
      });
      toast.success("הפרטים נשמרו. ברוכים הבאים!");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת הפרטים נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex flex-1 items-start justify-center px-4 py-10">
      <Card className="w-full max-w-xl shadow-soft">
        <CardContent className="space-y-5 pt-6">
          <div>
            <h1 className="font-display text-2xl text-foreground">השלמת פרטי החשבון</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              כדי להמשיך לקטלוג נשאר להשלים את פרטי העסק
              {mustChangePassword ? " ולקבוע סיסמה קבועה" : ""}. הפרטים משמשים לחשבוניות ולמשלוחים.
            </p>
            <p dir="ltr" className="mt-2 text-xs text-muted-foreground">
              {email}
            </p>
          </div>

          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              טוען את הפרטים...
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ob-business">שם העסק *</Label>
                  <Input
                    id="ob-business"
                    required
                    value={form.businessName}
                    onChange={(e) => patch({ businessName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-tax">ח.פ / עוסק מורשה *</Label>
                  <Input
                    id="ob-tax"
                    dir="ltr"
                    required
                    value={form.taxId}
                    onChange={(e) => patch({ taxId: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ob-address">כתובת למשלוח *</Label>
                <Input
                  id="ob-address"
                  required
                  value={form.businessAddress}
                  onChange={(e) => patch({ businessAddress: e.target.value })}
                  placeholder="רחוב, מספר, עיר"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ob-contact">שם איש קשר *</Label>
                  <Input
                    id="ob-contact"
                    required
                    value={form.contactName}
                    onChange={(e) => patch({ contactName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-phone">טלפון *</Label>
                  <Input
                    id="ob-phone"
                    type="tel"
                    dir="ltr"
                    required
                    value={form.phone}
                    onChange={(e) => patch({ phone: e.target.value })}
                  />
                </div>
              </div>

              {mustChangePassword && (
                <div className="space-y-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="size-4 text-accent" />
                    נכנסתם עם סיסמה זמנית — יש לקבוע סיסמה קבועה
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="ob-password">סיסמה חדשה *</Label>
                    <div className="relative">
                      <Input
                        id="ob-password"
                        dir="ltr"
                        type={visible ? "text" : "password"}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => patch({ password: e.target.value })}
                        className="pl-10"
                      />
                      <button
                        type="button"
                        onClick={() => setVisible((current) => !current)}
                        aria-label={visible ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">לפחות 8 תווים.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ob-confirm">אימות סיסמה *</Label>
                    <Input
                      id="ob-confirm"
                      dir="ltr"
                      type={visible ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={form.confirmation}
                      onChange={(e) => patch({ confirmation: e.target.value })}
                    />
                    {form.confirmation !== "" && form.confirmation !== form.password && (
                      <p className="text-xs text-destructive">הסיסמאות אינן זהות</p>
                    )}
                  </div>
                </div>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "שומר..." : "שמירה ומעבר לקטלוג"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
