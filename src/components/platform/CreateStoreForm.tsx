import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { checkStoreSlug, createStore } from "@/lib/platform.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CreatedStore = { id: string; name: string; slug: string; url: string };

type SlugState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "taken"; message: string };

/**
 * טופס הקמת חנות (פאנל הפלטפורמה): שם החנות + כתובת באנגלית.
 * הכתובת נבדקת בזמן ההקלדה (פנויה / תפוסה / שמורה / לא תקינה), ושוב
 * בשרת ובמסד ברגע השליחה.
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
      const store = await createStore({ data: { name, slug } });
      toast.success(`החנות "${store.name}" הוקמה`);
      setName("");
      setSlug("");
      onCreated(store);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      // אולי מישהו תפס את הכתובת בינתיים — בודקים אותה מחדש
      setRecheck((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && name.trim() !== "" && slugState.status === "available";

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
