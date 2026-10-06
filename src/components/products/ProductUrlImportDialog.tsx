import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Download, ExternalLink, ImageOff, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AdminProductDialog } from "@/components/AdminProductDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  previewProductFromUrl,
  saveImportedProductImages,
} from "@/lib/product-url-import.functions";
import { extractUrlFromText } from "@/lib/url";
import {
  DEFAULT_SELECTED_IMAGES,
  MAX_IMPORT_IMAGES,
  importDescriptionHtml,
  type ProductPrefill,
  type UrlImportPreview,
} from "@/lib/url-import";
import { cn } from "@/lib/utils";

function formatPrice(price: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: currency ?? "ILS",
    }).format(price);
  } catch {
    return `${price.toLocaleString("he-IL")} ${currency ?? ""}`.trim();
  }
}

/**
 * "ייבוא מקישור" במסך המוצרים (חלק 29): מדביקים קישור לעמוד מוצר (AliExpress,
 * Amazon, חנות אחרת) → השרת מושך כותרת, תיאור, מפרט ותמונות → בוחרים אילו
 * תמונות לשמור (עד 10; הראשונה שנבחרה = התמונה הראשית) → רק הן יורדות לשרת
 * שלנו → טופס המוצר הרגיל נפתח מלא, ונשאר לבחור קטגוריה, מחיר וכמות ולשמור.
 */
export function ProductUrlImportDialog({
  disabled = false,
  onSaved,
  onDraftsChanged,
}: {
  /** הגעתם למספר המוצרים המרבי בחבילה */
  disabled?: boolean;
  onSaved: () => void;
  onDraftsChanged?: () => void;
}) {
  const preview = useServerFn(previewProductFromUrl);
  const saveImages = useServerFn(saveImportedProductImages);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"fetch" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UrlImportPreview | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const [withDescription, setWithDescription] = useState(true);
  const [withSpecs, setWithSpecs] = useState(true);
  const [prefill, setPrefill] = useState<{ key: number; values: ProductPrefill } | null>(null);

  const reset = () => {
    setLink("");
    setData(null);
    setName("");
    setSelected([]);
    setBroken(new Set());
    setError(null);
  };

  const fetchDetails = async (event: FormEvent) => {
    event.preventDefault();
    const url = extractUrlFromText(link);
    if (!url) {
      setError("לא נמצא קישור — הדביקו את הכתובת של עמוד המוצר");
      return;
    }
    setBusy("fetch");
    setError(null);
    try {
      const result = await preview({ data: { url } });
      setData(result);
      setName(result.shortTitle || result.title);
      setSelected(result.images.slice(0, DEFAULT_SELECTED_IMAGES));
      setBroken(new Set());
      setWithDescription(result.description !== "");
      setWithSpecs(result.specs.length > 0);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "משיכת פרטי המוצר נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (url: string) =>
    setSelected((current) =>
      current.includes(url)
        ? current.filter((item) => item !== url)
        : current.length >= MAX_IMPORT_IMAGES
          ? current
          : [...current, url],
    );

  const proceed = async () => {
    if (!data) return;
    const title = name.trim();
    if (title === "") {
      setError("נדרש שם מוצר");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const saved = selected.length > 0 ? await saveImages({ data: { urls: selected } }) : [];
      const urls = saved.flatMap((item) => ("url" in item ? [item.url] : []));
      const failures = saved.flatMap((item) => ("error" in item ? [item.error] : []));
      if (failures.length > 0) {
        toast.warning(
          urls.length === 0
            ? "התמונות לא הורדו — אפשר להעלות תמונות בטופס המוצר"
            : `${failures.length} מתוך ${saved.length} תמונות לא הורדו`,
          { description: failures[0] },
        );
      }
      setPrefill({
        key: Date.now(),
        values: {
          name: title.slice(0, 200),
          description: importDescriptionHtml(data.description, data.specs, {
            description: withDescription,
            specs: withSpecs,
          }),
          imageUrl: urls[0] ?? "",
          extraImages: urls.slice(1),
        },
      });
      setOpen(false);
      reset();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "הורדת התמונות נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const selectable = data ? data.images.filter((url) => !broken.has(url)) : [];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && busy !== null) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            title={disabled ? "הגעתם למספר המוצרים המרבי בחבילה" : undefined}
          >
            <Link2 className="size-4" />
            ייבוא מקישור
          </Button>
        </DialogTrigger>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right sm:max-w-2xl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="size-5 text-accent" aria-hidden="true" />
              ייבוא מוצר מקישור
            </DialogTitle>
            <DialogDescription>
              מדביקים קישור לעמוד מוצר (AliExpress, Amazon, חנות אחרת) — הכותרת, המפרט והתמונות
              נמשכים אוטומטית. בוחרים אילו תמונות לשמור, ובטופס המוצר משלימים קטגוריה, מחיר וכמות.
            </DialogDescription>
          </DialogHeader>

          {!data ? (
            <form onSubmit={(event) => void fetchDetails(event)} className="space-y-2">
              <Label htmlFor="url-import-link">קישור לעמוד המוצר</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="url-import-link"
                  dir="ltr"
                  inputMode="url"
                  autoComplete="off"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder="https://he.aliexpress.com/item/…"
                  className="text-left"
                  disabled={busy !== null}
                />
                <Button
                  type="submit"
                  disabled={busy !== null || link.trim() === ""}
                  className="shrink-0"
                >
                  {busy === "fetch" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {busy === "fetch" ? "מושכים את הפרטים…" : "משיכת פרטים"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                אפשר להדביק גם הודעת שיתוף מהאפליקציה — הקישור יזוהה מתוכה.
              </p>
            </form>
          ) : (
            <div className="space-y-5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>נמשך מ-{data.siteName ?? new URL(data.sourceUrl).hostname}</span>
                <a
                  href={data.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
                >
                  לעמוד המקורי
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
                {data.price !== null && (
                  <span>
                    · מחיר אצל הספק:{" "}
                    <span dir="ltr" className="font-semibold text-foreground">
                      {formatPrice(data.price, data.currency)}
                    </span>
                  </span>
                )}
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="url-import-name">שם המוצר</Label>
                <Input
                  id="url-import-name"
                  dir="auto"
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
                {data.title !== "" && data.title !== name && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    הכותרת המקורית: <span dir="auto">{data.title}</span>{" "}
                    <button
                      type="button"
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                      onClick={() => setName(data.title.slice(0, 200))}
                    >
                      להשתמש בה
                    </button>
                  </p>
                )}
              </div>

              <section className="space-y-2" aria-labelledby="url-import-images">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="url-import-images" className="font-semibold">
                    תמונות{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      — נבחרו {selected.length} מתוך {data.images.length} (עד {MAX_IMPORT_IMAGES};
                      הראשונה = התמונה הראשית)
                    </span>
                  </h3>
                  {data.images.length > 0 && (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(selectable.slice(0, MAX_IMPORT_IMAGES))}
                      >
                        בחירת {Math.min(MAX_IMPORT_IMAGES, selectable.length)} הראשונות
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected([])}
                        disabled={selected.length === 0}
                      >
                        ניקוי
                      </Button>
                    </div>
                  )}
                </div>
                {data.images.length === 0 ? (
                  <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
                    לא נמצאו תמונות בעמוד — אפשר להעלות תמונות בטופס המוצר.
                  </p>
                ) : (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {data.images.map((url, index) => {
                      const order = selected.indexOf(url);
                      const isSelected = order >= 0;
                      const full = !isSelected && selected.length >= MAX_IMPORT_IMAGES;
                      return (
                        <li key={url}>
                          <button
                            type="button"
                            onClick={() => toggle(url)}
                            disabled={full}
                            aria-pressed={isSelected}
                            aria-label={
                              isSelected
                                ? `תמונה ${index + 1} — נבחרה (${order === 0 ? "ראשית" : order + 1})`
                                : `תמונה ${index + 1}`
                            }
                            className={cn(
                              "relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-muted transition",
                              isSelected
                                ? "border-primary ring-2 ring-primary/30"
                                : "border-transparent opacity-60 hover:opacity-100",
                              full && "cursor-not-allowed opacity-30 hover:opacity-30",
                            )}
                          >
                            {broken.has(url) ? (
                              <span className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                                <ImageOff className="size-5" aria-hidden="true" />
                                אין תצוגה
                              </span>
                            ) : (
                              <img
                                src={url}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="size-full object-cover"
                                onError={() => setBroken((current) => new Set(current).add(url))}
                              />
                            )}
                            {isSelected && (
                              <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-4 text-primary-foreground">
                                {order === 0 ? "ראשית" : order + 1}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {(data.description !== "" || data.specs.length > 0) && (
                <section className="space-y-3 rounded-xl border bg-secondary/30 p-3">
                  {data.description !== "" && (
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox
                        checked={withDescription}
                        onCheckedChange={(value) => setWithDescription(value === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">לכלול את התיאור</span>
                        <span
                          className="mt-0.5 line-clamp-3 block text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {data.description}
                        </span>
                      </span>
                    </label>
                  )}
                  {data.specs.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={withSpecs}
                          onCheckedChange={(value) => setWithSpecs(value === true)}
                        />
                        <span className="font-semibold">
                          לכלול את המפרט ({data.specs.length} שורות)
                        </span>
                      </label>
                      <dl className="max-h-40 overflow-y-auto rounded-lg border bg-background px-3 py-2 text-xs">
                        {data.specs.map((spec) => (
                          <div key={spec.name} className="flex gap-2 py-0.5">
                            <dt className="shrink-0 font-semibold" dir="auto">
                              {spec.name}:
                            </dt>
                            <dd className="min-w-0 text-muted-foreground" dir="auto">
                              {spec.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </section>
              )}

              <p className="text-xs text-muted-foreground">
                בשלב הבא נפתח טופס המוצר הרגיל — שם בוחרים קטגוריה, מחיר וכמות במלאי, ואפשר לערוך
                הכל לפני השמירה.
              </p>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          {data && (
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setData(null);
                  setError(null);
                }}
                disabled={busy !== null}
              >
                <ArrowRight className="size-4" />
                קישור אחר
              </Button>
              <Button
                type="button"
                onClick={() => void proceed()}
                disabled={busy !== null || name.trim() === ""}
              >
                {busy === "save" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {busy === "save"
                  ? `מורידים ${selected.length} תמונות לשרת…`
                  : selected.length > 0
                    ? `המשך לטופס המוצר (${selected.length} תמונות)`
                    : "המשך לטופס המוצר (בלי תמונות)"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {prefill && (
        <AdminProductDialog
          key={prefill.key}
          autoOpen
          hideTrigger
          prefill={prefill.values}
          onSaved={onSaved}
          {...(onDraftsChanged ? { onDraftsChanged } : {})}
          onClosed={() => window.setTimeout(() => setPrefill(null), 300)}
        />
      )}
    </>
  );
}
