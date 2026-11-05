import { useRef, useState } from "react";
import { Archive, CheckCircle2, FileText, Loader2, Star, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  LICENSE_PRODUCTS,
  LICENSE_PRODUCT_LABEL,
  MAX_EXE_BYTES,
  MAX_PDF_BYTES,
  formatBytes,
  formatDateTimeHe,
  type LicenseProduct,
} from "@/lib/licenses";
import {
  archiveLicenseFile,
  setDefaultLicenseFile,
  type LicenseFileSummary,
} from "@/lib/licenses.functions";
import { ACCEPT_FOR_KIND, errorText, uploadLicenseFile } from "./license-client";

type Kind = "guide" | "installer";
const KIND_TITLE: Record<Kind, string> = {
  guide: "מדריך התקנה (PDF)",
  installer: "תוכנת התקנה (EXE)",
};
const KIND_NOTE: Record<Kind, string> = {
  guide: `מצורף לכל מייל רישיון. עד ${Math.round(MAX_PDF_BYTES / 1024 / 1024)}MB.`,
  installer: `לא מצורפת למייל — נשמרת באחסון פרטי, והלקוח מקבל קישור הורדה אישי. עד ${Math.round(MAX_EXE_BYTES / 1024 / 1024)}MB.`,
};

/** קבצי ברירת המחדל לכל מוצר: העלאה (נבדקת בשרת), הגדרה כברירת מחדל, הסרה מהרשימה */
export function LicenseFilesManager({
  files,
  onChanged,
}: {
  files: LicenseFileSummary[];
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs leading-5 text-foreground dark:border-sky-900 dark:bg-sky-950/30">
        החלפת קובץ לא פוגעת בלקוחות שכבר קיבלו קישור: כל קישור נשאר צמוד לקובץ שנשלח איתו, גם אחרי
        שמעלים גרסה חדשה או מסירים את הקודמת. הקבצים נשמרים באחסון פרטי של החנות ונבדקים בשרת (סוג
        אמיתי וגודל).
      </p>
      {LICENSE_PRODUCTS.map((product) => (
        <section key={product} className="space-y-3 rounded-xl border border-border p-3 sm:p-4">
          <h3 className="font-bold text-foreground" dir="ltr">
            <span className="block text-right">{LICENSE_PRODUCT_LABEL[product]}</span>
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {(["guide", "installer"] as const).map((kind) => (
              <FileKindBlock
                key={kind}
                product={product}
                kind={kind}
                files={files.filter((f) => f.product === product && f.kind === kind)}
                onChanged={onChanged}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FileKindBlock({
  product,
  kind,
  files,
  onChanged,
}: {
  product: LicenseProduct;
  kind: Kind;
  files: LicenseFileSummary[];
  onChanged: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  const [uploading, setUploading] = useState<{ name: string; size: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<LicenseFileSummary | null>(null);
  const sorted = [...files].sort((a, b) =>
    a.isDefault === b.isDefault ? b.createdAt.localeCompare(a.createdAt) : a.isDefault ? -1 : 1,
  );
  const hasDefault = files.some((f) => f.isDefault);
  const id = `lic-upload-${product}-${kind}`;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading({ name: file.name, size: file.size });
    try {
      await uploadLicenseFile({ file, product, kind, makeDefault: makeDefault || !hasDefault });
      toast.success(`הקובץ הועלה${makeDefault || !hasDefault ? " והוגדר כברירת מחדל" : ""}`);
      await onChanged();
    } catch (error) {
      toast.error(errorText(error, "ההעלאה נכשלה"));
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  };

  const act = async (name: string, action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(name);
    try {
      await action();
      toast.success(success);
      await onChanged();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2.5 rounded-lg bg-muted/40 p-3">
      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <FileText className="size-4" aria-hidden /> {KIND_TITLE[kind]}
        </h4>
        <p className="text-xs text-muted-foreground">{KIND_NOTE[kind]}</p>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-amber-300 bg-amber-50/60 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          עדיין לא הועלה קובץ.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((f) => (
            <li key={f.id} className="rounded-md border border-border bg-card p-2.5 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium" dir="ltr">
                    <span className="block text-right">{f.fileName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(f.sizeBytes)} · הועלה {formatDateTimeHe(f.createdAt)}
                  </p>
                </div>
                {f.isDefault ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                    <CheckCircle2 className="size-3.5" aria-hidden /> ברירת מחדל
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {!f.isDefault ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        `default-${f.id}`,
                        () => setDefaultLicenseFile({ data: { fileId: f.id } }),
                        "הקובץ הוגדר כברירת מחדל",
                      )
                    }
                  >
                    {busy === `default-${f.id}` ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Star className="size-3.5" aria-hidden />
                    )}
                    הגדרה כברירת מחדל
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => setArchiveTarget(f)}
                >
                  <Archive className="size-3.5" aria-hidden /> הסרה מהרשימה
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5"
          disabled={uploading !== null}
          onClick={() => input.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {uploading ? "מעלה…" : sorted.length > 0 ? "העלאת גרסה חדשה" : "העלאת קובץ"}
        </Button>
        {hasDefault ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={makeDefault} onCheckedChange={(v) => setMakeDefault(v === true)} />
            להגדיר את הקובץ החדש כברירת מחדל
          </label>
        ) : null}
      </div>
      {uploading ? (
        <p className="text-xs text-muted-foreground" role="status">
          מעלה את <span dir="ltr">{uploading.name}</span> ({formatBytes(uploading.size)}) — נא לא
          לסגור את הדף עד לסיום.
        </p>
      ) : null}
      <input
        ref={input}
        id={id}
        type="file"
        accept={ACCEPT_FOR_KIND[kind]}
        className="sr-only"
        tabIndex={-1}
        aria-label={`העלאת ${KIND_TITLE[kind]} ל-${LICENSE_PRODUCT_LABEL[product]}`}
        onChange={(e) => void upload(e.target.files?.[0])}
      />

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => (open ? undefined : setArchiveTarget(null))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>להסיר את הקובץ מהרשימה?</AlertDialogTitle>
            <AlertDialogDescription>
              <span dir="ltr">{archiveTarget?.fileName}</span> לא ייבחר יותר לשליחות חדשות. לקוחות
              שכבר קיבלו קישור הורדה לקובץ הזה ימשיכו להוריד אותו כרגיל.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start sm:gap-2">
            <AlertDialogAction
              onClick={() => {
                const target = archiveTarget;
                setArchiveTarget(null);
                if (target) {
                  void act(
                    `archive-${target.id}`,
                    () => archiveLicenseFile({ data: { fileId: target.id } }),
                    "הקובץ הוסר מהרשימה",
                  );
                }
              }}
            >
              הסרה
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
