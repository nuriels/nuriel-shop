// ספריית המדיה בעורך: העלאה (תמונות בלבד — נבדקות ומקודדות מחדש בשרת), טקסט חלופי, מחיקה, ובחירת תמונה
// לשדה (לוגו, פתיח, אודות, עבודה בתיק, המלצה)
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/platform/ui";
import {
  studioDeleteMedia,
  studioMedia,
  studioSetMediaAlt,
  studioUploadMedia,
} from "../../api/media.functions";
import type { ImageRef } from "../../document/schema";
import type { MediaItem, MediaLibrary } from "../../types";

export const MEDIA_QUERY = ["bp", "media"] as const;
const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)}MB`;

export function useMediaLibrary() {
  const load = useServerFn(studioMedia);
  return useQuery({ queryKey: MEDIA_QUERY, queryFn: () => load() });
}

function UploadButton({ onUploaded }: { onUploaded?: (lib: MediaLibrary) => void }) {
  const qc = useQueryClient();
  const upload = useServerFn(studioUploadMedia);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const m = useMutation({
    mutationFn: async (files: File[]) => {
      let lib: MediaLibrary | null = null;
      for (const file of files) {
        const fd = new FormData();
        fd.set("file", file);
        lib = await upload({ data: fd });
      }
      return lib!;
    },
    onSuccess: (lib) => {
      qc.setQueryData(MEDIA_QUERY, lib);
      toast.success("התמונות נשמרו בספרייה");
      onUploaded?.(lib);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "ההעלאה נכשלה"),
  });
  return (
    <>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) m.mutate(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={m.isPending}
        onClick={() => input.current?.click()}
      >
        {m.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ImagePlus className="size-4" aria-hidden="true" />
        )}
        {m.isPending ? "מעלה…" : "העלאת תמונות"}
      </Button>
    </>
  );
}

function AltEditor({ item }: { item: MediaItem }) {
  const qc = useQueryClient();
  const save = useServerFn(studioSetMediaAlt);
  const remove = useServerFn(studioDeleteMedia);
  const [alt, setAlt] = useState(item.alt.he);
  const id = useId();
  const saveM = useMutation({
    mutationFn: () => save({ data: { id: item.id, alt: { he: alt } } }),
    onSuccess: (lib) => {
      qc.setQueryData(MEDIA_QUERY, lib);
      toast.success("הטקסט החלופי נשמר");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "השמירה נכשלה"),
  });
  const removeM = useMutation({
    mutationFn: () => remove({ data: { id: item.id } }),
    onSuccess: (lib) => qc.setQueryData(MEDIA_QUERY, lib),
    onError: (e) => toast.error(e instanceof Error ? e.message : "המחיקה נכשלה"),
  });
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs">
        תיאור התמונה (לקוראי מסך ולגוגל)
      </Label>
      <div className="flex gap-1">
        <Input id={id} value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={saveM.isPending || alt === item.alt.he}
          onClick={() => saveM.mutate()}
        >
          שמירה
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={removeM.isPending}
        onClick={() => removeM.mutate()}
      >
        מחיקה מהספרייה
      </Button>
    </div>
  );
}

export function MediaLibraryPanel() {
  const q = useMediaLibrary();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {q.data ? `בשימוש ${mb(q.data.used_bytes)} מתוך ${mb(q.data.quota_bytes)}` : "טוען…"}
        </p>
        <UploadButton />
      </div>
      <p className="text-xs text-muted-foreground">
        JPG, PNG, WEBP או AVIF, עד 12MB. כל תמונה נשמרת בכמה גדלים, בלי פרטי מיקום ומכשיר.
      </p>
      {q.data && q.data.items.length === 0 && <p className="text-sm">עוד אין תמונות.</p>}
      <ul className="grid grid-cols-2 gap-3">
        {q.data?.items.map((item) => (
          <li key={item.id} className="space-y-2 rounded-md border p-2">
            <img
              src={item.thumb}
              alt={item.alt.he || ""}
              className="aspect-[4/3] w-full rounded object-cover"
              loading="lazy"
            />
            <AltEditor item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** שדה תמונה: תמונה נבחרת + "בחירה" (מהספרייה או העלאה) + "הסרה" */
export function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ImageRef;
  onChange: (v: ImageRef) => void;
}) {
  const q = useMediaLibrary();
  const [open, setOpen] = useState(false);
  const current = value.media ? q.data?.items.find((i) => i.id === value.media) : undefined;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        {current ? (
          <img src={current.thumb} alt="" className="size-16 rounded object-cover" />
        ) : (
          <span className="grid size-16 place-items-center rounded border border-dashed text-xs text-muted-foreground">
            אין
          </span>
        )}
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            {current ? "החלפה" : "בחירת תמונה"}
          </Button>
          {current && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange({ media: null, alt: value.alt })}
            >
              <X className="size-4" aria-hidden="true" /> הסרה
            </Button>
          )}
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-lg" dir="rtl">
          <SheetHeader>
            <SheetTitle>בחירת תמונה — {label}</SheetTitle>
            <SheetDescription>מהספרייה של האתר, או העלאה של תמונה חדשה.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-4">
            <UploadButton />
            <ul className="grid grid-cols-3 gap-2">
              {q.data?.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="block w-full overflow-hidden rounded border-2 border-transparent focus-visible:border-primary aria-pressed:border-primary"
                    aria-pressed={item.id === value.media}
                    aria-label={
                      item.alt.he
                        ? `בחירת "${item.alt.he}"`
                        : `בחירת ${item.original_name ?? "תמונה"}`
                    }
                    onClick={() => {
                      onChange({ media: item.id, alt: item.alt.he ? item.alt : value.alt });
                      setOpen(false);
                    }}
                  >
                    <img
                      src={item.thumb}
                      alt=""
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** מפת המדיה לתצוגה המקדימה — מהספרייה (כולל תמונות שעוד לא פורסמו) */
export function previewMediaMap(lib: MediaLibrary | undefined) {
  const map: Record<
    string,
    {
      url: string;
      width: number | null;
      height: number | null;
      srcset: string | null;
      avif: string | null;
    }
  > = {};
  for (const item of lib?.items ?? []) {
    map[item.id] = {
      url: item.url,
      width: item.width,
      height: item.height,
      srcset: null,
      avif: null,
    };
  }
  return map;
}
