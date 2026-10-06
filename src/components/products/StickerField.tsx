import { useEffect, useId, useRef, useState } from "react";
import { Ban, Loader2, Package, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProductSticker } from "@/components/products/ProductSticker";
import {
  STICKER_NAME_MAX,
  STICKER_OPACITY,
  STICKER_SIZE,
  clampStickerOpacity,
  clampStickerSize,
  deleteSticker,
  listStickers,
  stickerNameFromFile,
  uploadSticker,
  type Sticker,
} from "@/lib/stickers";
import { cn } from "@/lib/utils";

export type StickerValue = {
  /** "" = בלי מדבקה */
  stickerId: string;
  size: number;
  opacity: number;
};

/**
 * "מדבקת מוצר" בעריכת מוצר (חלק 23): בחירה מגלריית המדבקות של החנות (או
 * העלאה חדשה — נשמרת בגלריה לשאר המוצרים), גודל ושקיפות בשני סליידרים,
 * ותצוגה מקדימה חיה על תמונת המוצר.
 */
export function StickerField({
  value,
  onChange,
  previewImage,
}: {
  value: StickerValue;
  onChange: (next: Partial<StickerValue>) => void;
  previewImage: string | null;
}) {
  const ids = useId();
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<Sticker | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    listStickers()
      .then((list) => {
        if (alive) setStickers(list);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setStickers([]);
        toast.error(error instanceof Error ? error.message : "טעינת גלריית המדבקות נכשלה");
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = stickers?.find((sticker) => sticker.id === value.stickerId) ?? null;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const created = await uploadSticker(file, name.trim() || stickerNameFromFile(file.name));
      setStickers((current) => [created, ...(current ?? [])]);
      onChange({ stickerId: created.id });
      setName("");
      toast.success("המדבקה נשמרה בגלריה ונבחרה למוצר");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת המדבקה נכשלה");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (sticker: Sticker) => {
    try {
      await deleteSticker(sticker);
      setStickers((current) => (current ?? []).filter((item) => item.id !== sticker.id));
      if (value.stickerId === sticker.id) onChange({ stickerId: "" });
      toast.success("המדבקה נמחקה מהגלריה");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "מחיקת המדבקה נכשלה");
    }
  };

  const size = clampStickerSize(value.size);
  const opacity = clampStickerOpacity(value.opacity);

  return (
    <section className="space-y-3 rounded-lg border border-border p-3" data-sticker-field>
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">מדבקת מוצר</p>
        <p className="text-xs leading-5 text-muted-foreground">
          מדבקה עגולה בפינה העליונה השמאלית של תמונת המוצר (למשל &quot;חדש&quot;, &quot;מומלץ&quot;,
          &quot;כשר&quot;). מדבקה שמעלים נשמרת בגלריה — במוצר אחר פשוט בוחרים אותה.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
        {/* תצוגה מקדימה — כמו בכרטיס המוצר באתר */}
        <div
          className="relative mx-auto flex size-32 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary/60 p-2 sm:mx-0"
          aria-label="תצוגה מקדימה של המדבקה על המוצר"
          role="img"
          data-sticker-preview
        >
          {previewImage ? (
            <img
              src={previewImage}
              alt=""
              className="h-full w-full object-contain mix-blend-multiply"
            />
          ) : (
            <Package className="size-8 text-muted-foreground" aria-hidden="true" />
          )}
          {selected && (
            <ProductSticker
              sticker={{ url: selected.image_url, size, opacity, label: null }}
              className="left-1.5 top-1.5 sm:left-1.5 sm:top-1.5"
            />
          )}
        </div>

        <div className="min-w-0 space-y-3">
          {/* הגלריה */}
          <div
            role="radiogroup"
            aria-label="גלריית המדבקות"
            className="flex flex-wrap gap-2"
            data-sticker-gallery
          >
            <button
              type="button"
              role="radio"
              aria-checked={value.stickerId === ""}
              onClick={() => onChange({ stickerId: "" })}
              className={cn(
                "flex size-12 flex-col items-center justify-center rounded-full border-2 bg-card text-[10px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                value.stickerId === "" ? "border-primary" : "border-border",
              )}
            >
              <Ban className="size-4" aria-hidden="true" />
              ללא
            </button>
            {stickers === null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                טוען את הגלריה...
              </span>
            )}
            {stickers?.map((sticker) => {
              const isSelected = sticker.id === value.stickerId;
              return (
                <div key={sticker.id} className="relative">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`מדבקה: ${sticker.name || "ללא שם"}`}
                    title={sticker.name || undefined}
                    onClick={() => onChange({ stickerId: sticker.id })}
                    className={cn(
                      "block size-12 overflow-hidden rounded-full border-2 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected ? "border-primary ring-2 ring-primary/30" : "border-border",
                    )}
                    data-sticker-option={sticker.name}
                  >
                    <img
                      src={sticker.image_url}
                      alt=""
                      loading="lazy"
                      className="size-full rounded-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setToDelete(sticker)}
                    aria-label={`מחיקת המדבקה ${sticker.name || ""} מהגלריה`.trim()}
                    className="absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* העלאה חדשה */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor={`${ids}-name`} className="text-xs">
                שם למדבקה חדשה (לא חובה)
              </Label>
              <Input
                id={`${ids}-name`}
                value={name}
                maxLength={STICKER_NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                placeholder='למשל "חדש"'
                className="h-9"
              />
            </div>
            <input
              ref={fileRef}
              id={`${ids}-file`}
              type="file"
              accept="image/png,image/webp,image/jpeg,image/gif,image/svg+xml"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => void upload(event.target.files?.[0])}
              data-sticker-upload
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              העלאת מדבקה
            </Button>
          </div>

          {/* גודל ושקיפות — למדבקה שנבחרה */}
          {selected && (
            <div className="grid gap-3 sm:grid-cols-2" data-sticker-sliders>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span id={`${ids}-size`} className="font-medium text-foreground">
                    גודל המדבקה
                  </span>
                  <span className="numeric text-muted-foreground" data-sticker-size-value>
                    {size}%
                  </span>
                </div>
                <Slider
                  dir="rtl"
                  min={STICKER_SIZE.min}
                  max={STICKER_SIZE.max}
                  step={1}
                  value={[size]}
                  onValueChange={([next]) => onChange({ size: clampStickerSize(next ?? size) })}
                  aria-labelledby={`${ids}-size`}
                  thumbLabel="גודל המדבקה"
                  valueText={`${size}% מרוחב התמונה`}
                  data-sticker-size
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span id={`${ids}-opacity`} className="font-medium text-foreground">
                    שקיפות (נראוּת)
                  </span>
                  <span className="numeric text-muted-foreground" data-sticker-opacity-value>
                    {opacity}%
                  </span>
                </div>
                <Slider
                  dir="rtl"
                  min={STICKER_OPACITY.min}
                  max={STICKER_OPACITY.max}
                  step={5}
                  value={[opacity]}
                  onValueChange={([next]) =>
                    onChange({ opacity: clampStickerOpacity(next ?? opacity) })
                  }
                  aria-labelledby={`${ids}-opacity`}
                  thumbLabel="שקיפות המדבקה"
                  valueText={`${opacity}% — ${opacity === 100 ? "מלאה" : "שקופה בחלקה"}`}
                  data-sticker-opacity
                />
                <p className="text-[11px] text-muted-foreground">100% = מלאה; פחות = שקופה יותר</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את המדבקה מהגלריה?</AlertDialogTitle>
            <AlertDialogDescription>
              המדבקה תוסר מכל המוצרים שמשתמשים בה. המוצרים עצמם לא נמחקים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (toDelete) void remove(toDelete);
                setToDelete(null);
              }}
            >
              מחיקה
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
