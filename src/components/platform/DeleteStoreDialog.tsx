import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteStore } from "@/lib/platform.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DeletableStore = {
  id: string;
  name: string;
  slug: string;
  admins: number;
  customers: number;
  products: number;
  orders: number;
};

/**
 * מחיקת חנות לצמיתות — רק אחרי הקלדת כתובת החנות. מוחק את כל המידע,
 * את חשבונות ההתחברות ואת הקבצים שלה. אין שחזור.
 */
export function DeleteStoreDialog({
  store,
  onClose,
  onDeleted,
}: {
  store: DeletableStore | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = store !== null && typed.trim().toLowerCase() === store.slug;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!store || !matches) return;
    setBusy(true);
    try {
      const result = await deleteStore({ data: { tenantId: store.id, confirmSlug: typed } });
      toast.success(
        `החנות "${store.name}" נמחקה (${result.rows} רשומות, ${result.users} חשבונות, ${result.files} קבצים)`,
      );
      if (result.warnings.length > 0) {
        toast.warning(`חלק מהניקוי לא הושלם: ${result.warnings.join(" · ")}`);
      }
      onDeleted(store.id);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={store !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-destructive">מחיקת "{store?.name}" לצמיתות</DialogTitle>
          <DialogDescription>
            נמחקים כל המידע של החנות ({store?.products} מוצרים, {store?.orders} הזמנות,{" "}
            {store?.customers} לקוחות), חשבונות ההתחברות של {store?.admins} המנהלים והלקוחות שלה,
            והתמונות והקבצים. אי אפשר לשחזר. אם רק צריך לחסום את האתר — עדיף להקפיא את החנות.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="confirm-delete-slug">
              לאישור, הקלידו את כתובת החנות:{" "}
              <span dir="ltr" className="font-mono font-semibold">
                {store?.slug}
              </span>
            </Label>
            <Input
              id="confirm-delete-slug"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <Button type="submit" variant="destructive" disabled={!matches || busy}>
            <Trash2 className="size-4" /> {busy ? "מוחק…" : "מחיקת החנות לצמיתות"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
