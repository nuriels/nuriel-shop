import { useState, type KeyboardEvent } from "react";
import { Layers, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ATTRIBUTE_TEXT_MAX,
  MAX_ATTRIBUTES,
  MAX_ATTRIBUTE_VALUES,
  syncDrafts,
  variantLabel,
  type VariantAttribute,
  type VariantDraft,
} from "@/lib/variants";
import { cn } from "@/lib/utils";

const SUGGESTED = ["צבע", "מידה", "נפח", "חומר"];

/**
 * עורך הוריאציות בטופס המוצר:
 *  1. מאפיינים — שם (צבע / מידה) וערכים (אדום, שחור / S, M, L), עד 3 מאפיינים
 *  2. טבלת הצירופים (נוצרת לבד מהמאפיינים): לכל צירוף מק"ט, מחיר ומלאי
 *     (ריק = של המוצר) ופעיל/כבוי.
 * הנתונים נשמרים יחד עם המוצר (save_product_variants).
 */
export function VariantsEditor({
  attributes,
  variants,
  onChange,
  basePrice,
  isDigital,
}: {
  attributes: VariantAttribute[];
  variants: VariantDraft[];
  onChange: (attributes: VariantAttribute[], variants: VariantDraft[]) => void;
  /** מחיר המוצר — מוצג כ"ברירת מחדל" בשדות המחיר */
  basePrice: string;
  isDigital: boolean;
}) {
  // ערך חדש שמוקלד לכל מאפיין (לפי מיקום)
  const [pending, setPending] = useState<string[]>([]);
  const [bulkStock, setBulkStock] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");

  const update = (nextAttributes: VariantAttribute[]) => {
    // רק מאפיינים שלמים (שם + ערך) יוצרים צירופים
    const complete = nextAttributes.filter(
      (attribute) => attribute.name.trim() !== "" && attribute.values.length > 0,
    );
    onChange(nextAttributes, syncDrafts(variants, complete));
  };

  const complete = attributes.filter(
    (attribute) => attribute.name.trim() !== "" && attribute.values.length > 0,
  );

  const addAttribute = (name = "") => {
    if (attributes.length >= MAX_ATTRIBUTES) return;
    update([...attributes, { name, values: [] }]);
  };

  const renameAttribute = (index: number, name: string) => {
    const current = attributes[index];
    if (!current) return;
    const nextName = name.slice(0, ATTRIBUTE_TEXT_MAX);
    // שם המאפיין הוא מפתח בצירופים — מעדכנים גם אותם, כדי לא לאבד מה שהוזן
    const renamed = attributes.map((attribute, i) =>
      i === index ? { ...attribute, name: nextName } : attribute,
    );
    const movedVariants = variants.map((variant) => {
      if (!(current.name in variant.options)) return variant;
      const { [current.name]: value, ...rest } = variant.options;
      return { ...variant, options: nextName ? { ...rest, [nextName]: value ?? "" } : rest };
    });
    const completeAfter = renamed.filter((a) => a.name.trim() !== "" && a.values.length > 0);
    onChange(renamed, syncDrafts(movedVariants, completeAfter));
  };

  const removeAttribute = (index: number) => {
    update(attributes.filter((_, i) => i !== index));
    setPending((current) => current.filter((_, i) => i !== index));
  };

  const addValues = (index: number, raw: string) => {
    const attribute = attributes[index];
    if (!attribute) return;
    const incoming = raw
      .split(/[,،;\n]/)
      .map((value) => value.trim().slice(0, ATTRIBUTE_TEXT_MAX))
      .filter((value) => value !== "" && !attribute.values.includes(value));
    if (incoming.length === 0) return;
    const values = [...new Set([...attribute.values, ...incoming])].slice(0, MAX_ATTRIBUTE_VALUES);
    update(attributes.map((a, i) => (i === index ? { ...a, values } : a)));
    setPending((current) => {
      const next = [...current];
      next[index] = "";
      return next;
    });
  };

  const removeValue = (index: number, value: string) =>
    update(
      attributes.map((a, i) =>
        i === index ? { ...a, values: a.values.filter((v) => v !== value) } : a,
      ),
    );

  const onValueKey = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addValues(index, pending[index] ?? "");
    }
  };

  const patchVariant = (index: number, next: Partial<VariantDraft>) =>
    onChange(
      attributes,
      variants.map((variant, i) => (i === index ? { ...variant, ...next } : variant)),
    );

  const applyBulk = (key: "stock" | "price", value: string) =>
    onChange(
      attributes,
      variants.map((variant) => ({ ...variant, [key]: value.trim() })),
    );

  const unused = SUGGESTED.filter((name) => !attributes.some((a) => a.name.trim() === name));

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
          וריאציות (צבע, מידה...)
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          מגדירים מאפיינים וערכים — וכל צירוף מקבל מק"ט, מחיר ומלאי משלו. הלקוח חייב לבחור אפשרות
          לפני ההוספה לסל. בלי מאפיינים — המוצר נמכר כרגיל.
        </p>
      </div>

      {attributes.map((attribute, index) => (
        <div key={index} className="space-y-2 rounded-md bg-secondary/50 p-2.5">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor={`attr-name-${index}`} className="text-xs">
                שם המאפיין
              </Label>
              <Input
                id={`attr-name-${index}`}
                value={attribute.name}
                maxLength={ATTRIBUTE_TEXT_MAX}
                placeholder="למשל: צבע"
                className="bg-background"
                onChange={(event) => renameAttribute(index, event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => removeAttribute(index)}
              aria-label={`הסרת המאפיין ${attribute.name || index + 1}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {attribute.values.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={`הערכים של ${attribute.name}`}>
              {attribute.values.map((value) => (
                <li
                  key={value}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pe-1 ps-2.5 text-sm"
                >
                  {value}
                  <button
                    type="button"
                    onClick={() => removeValue(index, value)}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label={`הסרת ${value}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              value={pending[index] ?? ""}
              placeholder={
                attribute.name.trim() === "מידה" ? "S, M, L — Enter להוספה" : "ערך — Enter להוספה"
              }
              className="bg-background"
              onChange={(event) =>
                setPending((current) => {
                  const next = [...current];
                  next[index] = event.target.value;
                  return next;
                })
              }
              onKeyDown={(event) => onValueKey(index, event)}
              aria-label={`ערך חדש ל${attribute.name || "מאפיין"}`}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => addValues(index, pending[index] ?? "")}
              disabled={(pending[index] ?? "").trim() === ""}
            >
              <Plus className="size-4" aria-hidden="true" />
              ערך
            </Button>
          </div>
        </div>
      ))}

      {attributes.length < MAX_ATTRIBUTES && (
        <div className="flex flex-wrap gap-2">
          {unused.slice(0, 2).map((name) => (
            <Button
              key={name}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addAttribute(name)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {name}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => addAttribute()}>
            <Plus className="size-3.5" aria-hidden="true" />
            מאפיין אחר
          </Button>
        </div>
      )}

      {variants.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2 border-t border-border pt-3">
            <p className="text-sm font-medium">
              {variants.length} צירופים · {variants.filter((v) => v.isActive).length} פעילים
            </p>
            <div className="flex flex-wrap items-end gap-2">
              {!isDigital && (
                <div className="flex items-end gap-1">
                  <Input
                    value={bulkStock}
                    onChange={(event) => setBulkStock(event.target.value)}
                    inputMode="numeric"
                    placeholder="מלאי"
                    className="h-8 w-20"
                    aria-label="מלאי לכל הצירופים"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => applyBulk("stock", bulkStock)}
                  >
                    מלאי לכולם
                  </Button>
                </div>
              )}
              <div className="flex items-end gap-1">
                <Input
                  value={bulkPrice}
                  onChange={(event) => setBulkPrice(event.target.value)}
                  inputMode="decimal"
                  placeholder="מחיר"
                  className="h-8 w-20"
                  aria-label="מחיר לכל הצירופים"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => applyBulk("price", bulkPrice)}
                >
                  מחיר לכולם
                </Button>
              </div>
            </div>
          </div>
          <ul className="space-y-1.5">
            {variants.map((variant, index) => {
              const label = variantLabel(variant.options, complete) || "—";
              return (
                <li
                  key={label + index}
                  className={cn(
                    "grid grid-cols-2 items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_6rem_auto]",
                    !variant.isActive && "bg-muted/60 opacity-70",
                  )}
                >
                  <p className="col-span-2 self-center text-sm font-semibold sm:col-span-1">
                    {label}
                  </p>
                  <div className="space-y-0.5">
                    <Label className="text-[11px] text-muted-foreground">מק"ט</Label>
                    <Input
                      value={variant.sku}
                      dir="ltr"
                      maxLength={40}
                      className="h-8 text-right"
                      placeholder="TS-RED-S"
                      onChange={(event) => patchVariant(index, { sku: event.target.value })}
                      aria-label={`מק"ט ל${label}`}
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[11px] text-muted-foreground">מחיר</Label>
                    <Input
                      value={variant.price}
                      inputMode="decimal"
                      dir="ltr"
                      className="h-8 text-right"
                      placeholder={basePrice.trim() || "כמו המוצר"}
                      onChange={(event) => patchVariant(index, { price: event.target.value })}
                      aria-label={`מחיר ל${label}`}
                    />
                  </div>
                  {isDigital ? (
                    <p className="self-center text-[11px] text-muted-foreground">בלי מלאי</p>
                  ) : (
                    <div className="space-y-0.5">
                      <Label className="text-[11px] text-muted-foreground">מלאי</Label>
                      <Input
                        value={variant.stock}
                        inputMode="numeric"
                        dir="ltr"
                        className="h-8 text-right"
                        placeholder="של המוצר"
                        onChange={(event) => patchVariant(index, { stock: event.target.value })}
                        aria-label={`מלאי ל${label}`}
                      />
                    </div>
                  )}
                  <label className="col-span-2 flex items-center gap-1.5 self-center text-xs sm:col-span-1">
                    <Switch
                      checked={variant.isActive}
                      onCheckedChange={(next) => patchVariant(index, { isActive: next })}
                      aria-label={`${label} פעיל`}
                    />
                    פעיל
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">
            מחיר ריק = מחיר המוצר (כולל דרגים, מבצע ומחירון אישי); מחיר שהוזן — מחיר קבוע לצירוף
            הזה.{" "}
            {isDigital
              ? "מוצר דיגיטלי — בלי מלאי."
              : 'מלאי ריק = משתמש במלאי של המוצר; מספר = מלאי נפרד לצירוף (ב-0 — "אזל").'}
          </p>
        </div>
      )}
    </div>
  );
}
