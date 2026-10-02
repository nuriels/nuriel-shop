import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminProductDialog } from "@/components/AdminProductDialog";
import { resolvePendingProduct } from "@/lib/scan.functions";
import { formatOrderDate } from "@/lib/orders";

type PendingProduct = {
  id: string;
  barcode: string | null;
  suggested_name: string;
  scanned_count: number;
  created_at: string;
};

/**
 * מוצרים שנסרקו ואינם קיימים בקטלוג.
 * המנהל פותח כל שורה כמוצר חדש (הברקוד והשם המוצע מגיעים מוכנים),
 * ואחרי היצירה הבקשה מסומנת כמאושרת ויורדת מהרשימה.
 */
export function PendingProductsPanel({ onProductCreated }: { onProductCreated?: () => void }) {
  const [items, setItems] = useState<PendingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const resolve = useServerFn(resolvePendingProduct);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pending_products")
      .select("id, barcode, suggested_name, scanned_count, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems((data as PendingProduct[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markResolved = async (id: string, status: "approved" | "rejected") => {
    setBusy(id);
    try {
      await resolve({ data: { id, status } });
      toast.success(status === "approved" ? "הבקשה סומנה כטופלה" : "הבקשה נדחתה");
      void load();
      if (status === "approved") onProductCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "עדכון הבקשה נכשל");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-foreground">מוצרים ממתינים לאישור</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? "טוען..." : `${items.length} ברקודים שנסרקו ואינם בקטלוג`}
          </p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          רענון נתונים
        </Button>
      </div>

      {items.length === 0 && !loading ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              אין בקשות פתוחות. ברקודים לא מוכרים שייסרקו בקליטה יופיעו כאן.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">ממתינים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.suggested_name || "ללא שם מוצע"}
                  </p>
                  <p dir="ltr" className="numeric text-right text-xs text-muted-foreground">
                    {item.barcode ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    נסרק {item.scanned_count} פעמים · {formatOrderDate(item.created_at)}
                  </p>
                </div>
                <Badge variant="outline">ממתין</Badge>

                <AdminProductDialog
                  triggerLabel="יצירת מוצר"
                  initialBarcode={item.barcode ?? ""}
                  initialName={item.suggested_name}
                  onSaved={() => {
                    void markResolved(item.id, "approved");
                  }}
                />

                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busy === item.id}
                  onClick={() => void markResolved(item.id, "rejected")}
                >
                  <X className="size-4" />
                  דחייה
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
