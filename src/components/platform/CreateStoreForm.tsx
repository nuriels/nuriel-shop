import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { TenantPlan, TenantStatus } from "@/integrations/supabase/types";
import {
  PLAN_LABELS,
  STATUS_LABELS,
  TENANT_PLANS,
  TENANT_STATUSES,
  checkStoreSlug,
  createStore,
} from "@/lib/platform.functions";
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

export type CreatedStore = Awaited<ReturnType<typeof createStore>>;

type SlugState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "taken"; message: string };

/**
 * טופס הקמת חנות (פאנל הפלטפורמה): שם, כתובת באנגלית, אימייל מנהל החנות,
 * ח.פ / עוסק מורשה, סוג מנוי וסטטוס. הכתובת נבדקת בזמן ההקלדה (פנויה /
 * תפוסה / שמורה / לא תקינה), ושוב בשרת ובמסד ברגע השליחה. מנהל החנות
 * נוצר יחד עם החנות, עם סיסמה זמנית.
 */
export function CreateStoreForm({
  baseDomain,
  onCreated,
}: {
  baseDomain: string | null;
  onCreated: (store: CreatedStore) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [plan, setPlan] = useState<TenantPlan>("trial");
  const [status, setStatus] = useState<TenantStatus>("active");
  const [slugState, setSlugState] = useState<SlugState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [recheck, setRecheck] = useState(0);

  // בדיקת זמינות 400ms אחרי ההקשה האחרונה; תשובה ישנה לא דורסת חדשה
  useEffect(() => {
    if (slug === "") {
      setSlugState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setSlugState({ status: "checking" });
    const timer = setTimeout(() => {
      checkStoreSlug({ data: { slug } })
        .then((result) => {
          if (cancelled) return;
          setSlugState(
            result.available
              ? { status: "available" }
              : { status: "taken", message: result.message ?? "הכתובת לא זמינה" },
          );
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSlugState({
              status: "taken",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, recheck]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const store = await createStore({
        data: { name, slug, ownerEmail, taxId, plan, status },
      });
      if (store.adminError) toast.warning(`החנות הוקמה, אבל המנהל לא נוצר: ${store.adminError}`);
      else toast.success(`החנות "${store.name}" הוקמה`);
      setName("");
      setSlug("");
      setOwnerEmail("");
      setTaxId("");
      setPlan("trial");
      setStatus("active");
      onCreated(store);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      // אולי מישהו תפס את הכתובת בינתיים — בודקים אותה מחדש
      setRecheck((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const taxIdDigits = taxId.replace(/[\s-]/g, "");
  const taxIdValid = taxIdDigits === "" || /^[0-9]{5,12}$/.test(taxIdDigits);
  const canSubmit =
    !busy &&
    name.trim() !== "" &&
    ownerEmail.trim() !== "" &&
    taxIdValid &&
    slugState.status === "available";

  return (
    <Card>
      <CardHeader>
        <CardTitle>הקמת חנות חדשה</CardTitle>
        <CardDescription>
          החנות תהיה בכתובת
          <span dir="ltr" className="mx-1 font-mono">
            {slug || "shop"}.{baseDomain ?? "…"}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="store-name">שם החנות</Label>
            <Input
              id="store-name"
              required
              maxLength={120}
              placeholder="נוריאל מחשבים"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="store-slug">כתובת באנגלית (Slug)</Label>
            <div className="flex items-center gap-2" dir="ltr">
              <Input
                id="store-slug"
                required
                maxLength={63}
                autoComplete="off"
                spellCheck={false}
                placeholder="nuriel-computers"
                value={slug}
                onChange={(e) =>
                  // רק מה שמותר בכתובת: אותיות קטנות, ספרות ומקף
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
              />
              <span className="shrink-0 text-sm text-muted-foreground">.{baseDomain ?? "…"}</span>
            </div>
            <SlugStatus state={slugState} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="store-owner-email">אימייל מנהל החנות</Label>
            <Input
              id="store-owner-email"
              type="email"
              required
              dir="ltr"
              autoComplete="off"
              placeholder="owner@example.com"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              המשתמש הראשון של החנות — יקבל סיסמה זמנית להחלפה בכניסה הראשונה
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="store-tax-id">ח.פ / עוסק מורשה</Label>
            <Input
              id="store-tax-id"
              inputMode="numeric"
              dir="ltr"
              maxLength={14}
              placeholder="515555555"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value.replace(/[^0-9\s-]/g, ""))}
            />
            {!taxIdValid && <p className="text-xs text-destructive">ספרות בלבד, 5 עד 12</p>}
          </div>

          <div className="space-y-1.5">
            <Label>סוג מנוי</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v as TenantPlan)}>
              <SelectTrigger dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {TENANT_PLANS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLAN_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>סטטוס</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as TenantStatus)}>
              <SelectTrigger dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {TENANT_STATUSES.map((st) => (
                  <SelectItem key={st} value={st}>
                    {STATUS_LABELS[st]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={!canSubmit}>
              {busy ? "מקים…" : "הקמת החנות"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SlugStatus({ state }: { state: SlugState }) {
  if (state.status === "idle") return null;
  if (state.status === "checking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> בודק זמינות…
      </p>
    );
  }
  if (state.status === "available") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-green-700">
        <CheckCircle2 className="size-3.5" /> הכתובת פנויה
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-destructive">
      <XCircle className="size-3.5" /> {state.message}
    </p>
  );
}
