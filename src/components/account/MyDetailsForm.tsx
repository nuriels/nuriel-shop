import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckoutField, fieldA11y } from "@/components/checkout/CheckoutField";
import { validateMyDetails, type MyDetails, type MyDetailsErrors } from "@/lib/checkout";
import { updateMyDetails } from "@/lib/checkout.functions";

const EMPTY: MyDetails = {
  businessName: "",
  contactName: "",
  taxId: "",
  phone: "",
  city: "",
  address: "",
  zipCode: "",
};

const same = (a: MyDetails, b: MyDetails) =>
  (Object.keys(a) as (keyof MyDetails)[]).every((key) => a[key].trim() === b[key].trim());

/**
 * "הפרטים שלי": שם / חברה, ת.ז / ח.פ, טלפון וכתובת — נשמרים לפרופיל
 * ומשמשים כברירת מחדל בקופה. קבוצת המחיר והסוכן — רק בידי מנהל החנות.
 */
export function MyDetailsForm({
  userId,
  email,
  onSaved,
}: {
  userId: string;
  email: string;
  onSaved?: () => void;
}) {
  const save = useServerFn(updateMyDetails);
  const [loaded, setLoaded] = useState<MyDetails | null>(null);
  const [form, setForm] = useState<MyDetails>(EMPTY);
  const [errors, setErrors] = useState<MyDetailsErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("customer_profiles")
        .select("business_name, contact_name, tax_id, phone, business_address, city, zip_code")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const next: MyDetails = {
        businessName: data?.business_name ?? "",
        contactName: data?.contact_name ?? "",
        taxId: data?.tax_id ?? "",
        phone: data?.phone ?? "",
        city: data?.city ?? "",
        address: data?.business_address ?? "",
        zipCode: data?.zip_code ?? "",
      };
      setLoaded(next);
      setForm(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const dirty = loaded !== null && !same(form, loaded);
  const patch = (key: keyof MyDetails, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const field = (key: keyof MyDetails, id: string) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => patch(key, event.target.value),
    ...fieldA11y(id, errors[key]),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateMyDetails(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error("נא לתקן את השדות המסומנים");
      return;
    }
    setBusy(true);
    try {
      await save({ data: form });
      setLoaded(form);
      toast.success("הפרטים נשמרו — הם ימולאו אוטומטית בקופה");
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת הפרטים נכשלה");
    } finally {
      setBusy(false);
    }
  };

  if (loaded === null) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> טוען את הפרטים…
      </p>
    );
  }

  return (
    <form noValidate onSubmit={submit}>
      <Card className="shadow-card">
        <CardContent className="space-y-6 pt-6">
          <div>
            <h2 className="text-lg font-bold text-foreground">הפרטים שלי</h2>
            <p className="text-sm text-muted-foreground">
              הפרטים האלה ימולאו אוטומטית בקופה בכל הזמנה. אפשר תמיד לשנות אותם גם בקופה עצמה.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <CheckoutField
              id="me-name"
              label="שם מלא / שם חברה"
              required
              error={errors.businessName}
            >
              <Input
                autoComplete="organization"
                maxLength={120}
                {...field("businessName", "me-name")}
              />
            </CheckoutField>
            <CheckoutField id="me-contact" label="איש קשר" error={errors.contactName}>
              <Input autoComplete="name" maxLength={80} {...field("contactName", "me-contact")} />
            </CheckoutField>
            <CheckoutField id="me-tax" label="ת.ז / ח.פ" error={errors.taxId}>
              <Input
                inputMode="numeric"
                dir="ltr"
                maxLength={20}
                className="text-right"
                {...field("taxId", "me-tax")}
              />
            </CheckoutField>
            <CheckoutField id="me-phone" label="טלפון" error={errors.phone}>
              <Input
                type="tel"
                inputMode="tel"
                dir="ltr"
                autoComplete="tel"
                maxLength={20}
                className="text-right"
                {...field("phone", "me-phone")}
              />
            </CheckoutField>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_9rem]">
            <CheckoutField id="me-city" label="עיר" error={errors.city}>
              <Input autoComplete="address-level2" maxLength={80} {...field("city", "me-city")} />
            </CheckoutField>
            <CheckoutField id="me-address" label="כתובת (רחוב ומספר)" error={errors.address}>
              <Input
                autoComplete="street-address"
                maxLength={200}
                {...field("address", "me-address")}
              />
            </CheckoutField>
            <CheckoutField id="me-zip" label="מיקוד" error={errors.zipCode}>
              <Input
                inputMode="numeric"
                dir="ltr"
                autoComplete="postal-code"
                maxLength={9}
                className="text-right"
                {...field("zipCode", "me-zip")}
              />
            </CheckoutField>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">אימייל החשבון</p>
            <p dir="ltr" className="rounded-md bg-secondary/60 px-3 py-2 text-right text-sm">
              {email}
            </p>
            <p className="text-xs text-muted-foreground">
              לכאן נשלחים אישורי ההזמנות. שינוי סיסמה — ב"הגדרות חשבון" בראש העמוד.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            {dirty && <span className="text-sm text-amber-700">יש שינויים שלא נשמרו</span>}
            <Button type="submit" disabled={busy || !dirty}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              שמירת הפרטים
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
