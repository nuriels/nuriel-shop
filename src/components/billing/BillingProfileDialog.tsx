import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, ShieldCheck } from "lucide-react";
import { saveBillingProfile } from "@/lib/payments.functions";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  billingProfileProblem,
  taxIdLabel,
  type BillingProfile,
  type BusinessType,
} from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * פרטי העוסק של בעל החנות (חלק 16) — נדרשים לפני התשלום הראשון על מנוי /
 * תוסף: סוג עוסק, שם העסק, ח.פ / ע.מ / ת.ז וכתובת. נשמרים פעם אחת ומופיעים
 * בכל חיוב.
 */
export function BillingProfileDialog({
  open,
  initial,
  onClose,
  onSaved,
  submitLabel = "שמירה והמשך לתשלום",
}: {
  open: boolean;
  initial: BillingProfile | null;
  onClose: () => void;
  onSaved: (profile: BillingProfile) => void;
  submitLabel?: string;
}) {
  const save = useServerFn(saveBillingProfile);
  const [businessType, setBusinessType] = useState<BusinessType | "">("");
  const [companyName, setCompanyName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusinessType(initial?.businessType ?? "");
    setCompanyName(initial?.companyName ?? "");
    setTaxId(initial?.taxId ?? "");
    setAddress(initial?.address ?? "");
    setBillingEmail(initial?.billingEmail ?? "");
    setError(null);
  }, [open, initial]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = { businessType, companyName, taxId, address, billingEmail };
    const problem = billingProfileProblem(input);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await save({ data: input }));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto text-right sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-accent" aria-hidden="true" />
            פרטי העסק לחיוב
          </DialogTitle>
          <DialogDescription>
            לפני התשלום הראשון — הפרטים שיופיעו בחיובי המנוי והתוספים. ממלאים פעם אחת.
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bp-type">סוג העוסק</Label>
            <Select
              value={businessType}
              onValueChange={(value) => setBusinessType(value as BusinessType)}
            >
              <SelectTrigger id="bp-type" aria-label="סוג העוסק">
                <SelectValue placeholder="בחרו…" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {BUSINESS_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {BUSINESS_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-name">
              {businessType === "company" ? "שם החברה" : "שם העסק / שם מלא"}
            </Label>
            <Input
              id="bp-name"
              value={companyName}
              maxLength={120}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-tax">{taxIdLabel(businessType)}</Label>
            <Input
              id="bp-tax"
              dir="ltr"
              inputMode="numeric"
              maxLength={9}
              placeholder="9 ספרות"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value.replace(/\D/g, "").slice(0, 9))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-address">כתובת העסק</Label>
            <Input
              id="bp-address"
              value={address}
              maxLength={200}
              placeholder="רחוב, מספר, עיר"
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-email">מייל לחיובים (לא חובה)</Label>
            <Input
              id="bp-email"
              type="email"
              dir="ltr"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full font-bold" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {submitLabel}
          </Button>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            הפרטים נשמרים רק עבור החנות שלכם ומשמשים לחיובי המנוי בלבד.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
