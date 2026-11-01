// סידור היחידות הפעילות של מתחם (Stage 2c.3): גרירה במחשב, או חצים בכל מכשיר (גם
// במקלדת ובקורא מסך). כל הזזה נשמרת מיד, בפעולה אחת במסד. אם מישהו אחר שינה את הסדר
// בינתיים — ההזזה לא נשמרת, והרשימה מתרעננת עם הודעה.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, GripVertical, Loader2 } from "lucide-react";
import { Button, cn } from "@/platform/ui";
import { hospitalityReorderUnits } from "../../api/catalog.functions";
import type { CatalogProperty, CatalogView } from "../../types/catalog";
import { manageKeys } from "../lib/query-keys";
import { activeUnits, moveItem, withUnitOrder } from "./model";
import { errorText, useRefresh } from "./refresh";

export function UnitOrder({ property, onDone }: { property: CatalogProperty; onDone: () => void }) {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const units = activeUnits(property);
  const ids = units.map((u) => u.id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const move = async (from: number, to: number) => {
    if (busy || from === to || to < 0 || to >= ids.length) return;
    const next = moveItem(ids, from, to);
    const name = units[from]!.name;
    const previous = queryClient.getQueryData<CatalogView>(manageKeys.catalog);
    queryClient.setQueryData<CatalogView>(
      manageKeys.catalog,
      (v) => v && withUnitOrder(v, property.id, next),
    );
    setBusy(true);
    setMessage(null);
    try {
      const result = await hospitalityReorderUnits({
        data: { propertyId: property.id, expected: ids, ids: next },
      });
      if (result.status === "conflict") {
        queryClient.setQueryData<CatalogView>(manageKeys.catalog, result.view);
        setMessage({ error: false, text: result.message });
        return;
      }
      setAnnounce(`${name} — מקום ${to + 1} מתוך ${ids.length}. הסדר נשמר.`);
      refresh();
    } catch (e) {
      if (previous) queryClient.setQueryData<CatalogView>(manageKeys.catalog, previous);
      setMessage({ error: true, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="unit-order">
      <p className="text-sm text-muted-foreground">
        גררו יחידה למקום החדש, או השתמשו בחצים. כל שינוי נשמר מיד. יחידות לא פעילות מופיעות אחרי
        הפעילות.
      </p>
      <ol aria-label={`סדר היחידות ב${property.name}`} className="divide-y rounded-md border">
        {units.map((u, i) => (
          <li
            key={u.id}
            data-unit={u.name}
            draggable={!busy}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", u.id);
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              if (dragOver !== i) setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) void move(dragFrom, i);
              endDrag();
            }}
            onDragEnd={endDrag}
            className={cn(
              "flex items-center gap-2 bg-card p-2",
              dragOver === i && dragFrom !== i && "bg-primary/5 ring-2 ring-inset ring-primary",
              dragFrom === i && "opacity-50",
            )}
          >
            <GripVertical
              className="hidden size-5 shrink-0 cursor-grab text-muted-foreground sm:block"
              aria-hidden="true"
            />
            <span
              className="w-6 shrink-0 text-center text-sm text-muted-foreground"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 break-words font-medium">{u.name}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              disabled={busy || i === 0}
              aria-label={`הזזת ${u.name} למעלה`}
              onClick={() => void move(i, i - 1)}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              disabled={busy || i === units.length - 1}
              aria-label={`הזזת ${u.name} למטה`}
              onClick={() => void move(i, i + 1)}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={cn(
            "rounded-md border p-3 text-sm",
            message.error
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/30 bg-primary/5",
          )}
        >
          {message.text}
        </p>
      )}
      <Button type="button" className="min-h-11 w-fit gap-2" disabled={busy} onClick={onDone}>
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="size-4" aria-hidden="true" />
        )}
        סיום הסידור
      </Button>
    </div>
  );
}
