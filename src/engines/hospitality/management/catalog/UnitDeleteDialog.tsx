// "למחוק את היחידה?" — חלון אחד לכל מקום שמוחקים ממנו יחידה (הכרטיס ברשימה ועמוד היחידה).
// לפני השאלה בודקים במסד (מיגרציה 205, unit_delete_preview — קריאה בלבד) מה יימחק יחד איתה ומה
// עוצר את המחיקה. יחידה שאי אפשר למחוק — מסבירים למה ומציעים את מה שכן אפשר (להשבית, לערוך את
// החבילה, להוציא מ"כל המתחם"). המחיקה עצמה נבדקת שוב במסד — החלון רק מסביר מראש.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, PowerOff, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@/platform/ui";
import {
  hospitalityDeleteUnit,
  hospitalitySetUnitActive,
  hospitalityUnitDeletePreview,
} from "../../api/catalog.functions";
import type { CatalogView } from "../../types/catalog";
import { manageKeys } from "../lib/query-keys";
import { unitDeleteSummary } from "./model";

const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "הפעולה נכשלה — נסו שוב";

export function UnitDeleteDialog(props: {
  unit: { id: string; name: string; revision: number; property_id: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** אחרי מחיקה מוצלחת */
  onDeleted: () => void;
  /** אחרי השבתה מהחלון (במקום מחיקה) */
  onDeactivated?: () => void;
  /** מישהו אחר שינה את היחידה בינתיים — הנתונים העדכניים */
  onConflict?: (view: CatalogView, message: string) => void;
}) {
  const { unit } = props;
  const [busy, setBusy] = useState<"delete" | "deactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: [...manageKeys.catalog, "delete-preview", unit.id],
    queryFn: () => hospitalityUnitDeletePreview({ data: { id: unit.id } }),
    enabled: props.open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const p = preview.data;
  const blocked = p?.block ?? null;
  const summary = p ? unitDeleteSummary(p) : [];

  const close = (open: boolean) => {
    if (busy) return;
    if (!open) setError(null);
    props.onOpenChange(open);
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      const r = await hospitalityDeleteUnit({ data: { id: unit.id, revision: unit.revision } });
      if (r.status === "conflict") {
        props.onConflict?.(r.view, r.message);
        props.onOpenChange(false);
        return;
      }
      toast.success(`היחידה "${unit.name}" נמחקה`);
      props.onOpenChange(false);
      props.onDeleted();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const deactivate = async () => {
    setBusy("deactivate");
    setError(null);
    try {
      const r = await hospitalitySetUnitActive({
        data: { id: unit.id, active: false, revision: unit.revision },
      });
      if (r.status === "conflict") {
        props.onConflict?.(r.view, r.message);
        props.onOpenChange(false);
        return;
      }
      toast.success(`"${unit.name}" הושבתה — היא לא מוצגת באתר ולא מקבלת הזמנות`);
      props.onOpenChange(false);
      props.onDeactivated?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AlertDialog open={props.open} onOpenChange={close}>
      <AlertDialogContent data-testid="unit-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? `אי אפשר למחוק את "${unit.name}"` : `למחוק את "${unit.name}" לצמיתות?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              {preview.isPending ? (
                <p role="status" className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  בודקים מה יימחק יחד עם היחידה…
                </p>
              ) : preview.isError ? (
                <p role="alert" className="text-destructive">
                  {errorText(preview.error)}
                </p>
              ) : blocked ? (
                <>
                  <p className="text-foreground">{blocked.reason}.</p>
                  {blocked.code === "history" && (
                    <p>
                      הזמנות וחסימות הן רישום של מה שקרה — לכן לא מוחקים יחידה שיש לה כאלה. השבתה
                      מסתירה אותה מהאתר ומההזמנות, וההיסטוריה נשמרת.
                    </p>
                  )}
                </>
              ) : p ? (
                <>
                  <p className="text-foreground">
                    היחידה תימחק עם כל הפרטים שלה. אי אפשר לבטל את זה.
                  </p>
                  {summary.length > 0 && (
                    <div>
                      <p>יימחקו יחד איתה:</p>
                      <ul className="ms-5 list-disc">
                        {summary.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.addon_packages.length > 0 && (
                    <p>
                      היא תצא מרשימת החדרים הנוספים של: {p.addon_packages.join(", ")}. החבילות עצמן
                      נשארות.
                    </p>
                  )}
                  {p.seo_open > 0 && <p>הצעות לשיפור בגוגל שהוכנו לה ייסגרו.</p>}
                  {p.is_active && (
                    <p>
                      רוצים רק להסתיר אותה? אפשר להשבית במקום למחוק — היא לא תוצג באתר, ותמיד אפשר
                      להפעיל אותה שוב.
                    </p>
                  )}
                </>
              ) : null}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel className="min-h-11" disabled={busy !== null}>
            {blocked ? "סגירה" : "ביטול"}
          </AlertDialogCancel>
          {blocked?.code === "package" && (
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/manage/packages">לחבילות</Link>
            </Button>
          )}
          {blocked?.code === "whole" && (
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/manage/properties/$propertyId" params={{ propertyId: unit.property_id }}>
                ל"כל המתחם"
              </Link>
            </Button>
          )}
          {p?.is_active && (blocked === null || blocked.code === "history") && (
            <Button
              type="button"
              variant={blocked ? "default" : "outline"}
              className="min-h-11 gap-2"
              disabled={busy !== null}
              onClick={() => void deactivate()}
            >
              {busy === "deactivate" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <PowerOff className="size-4" aria-hidden="true" />
              )}
              להשבית במקום
            </Button>
          )}
          {p && !blocked && (
            <Button
              type="button"
              variant="destructive"
              className="min-h-11 gap-2"
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === "delete" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              מחיקה לצמיתות
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
