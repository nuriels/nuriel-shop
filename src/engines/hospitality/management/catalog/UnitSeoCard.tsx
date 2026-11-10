// כותרת ותיאור לגוגל ליחידה (שלב 2 של פרויקט Google SEO). כרטיס נפרד עם שמירה משלו — לא נוגע
// בשמירה של שאר פרטי היחידה. הגרסה משותפת לעמוד: אחרי שמירה כאן העמוד מקבל את הגרסה החדשה,
// כדי שהשמירה הבאה של הפרטים לא תיחשב "עודכן בינתיים". ריק = ברירת המחדל של האתר.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/platform/ui";
import { hospitalitySaveUnitSeo, hospitalityUnitSeo } from "../../api/catalog.functions";
import { SEO_LIMITS } from "../../website/design/schema";
import { UNIT_SEO_RECOMMENDED, seoLine, unitSeoErrors } from "../../validation/unit-seo";
import { TextAreaField, TextField } from "../lib/fields";
import { useManagement } from "../shell/management-context";

type SeoForm = { title: string; description: string };
const sameSeo = (a: SeoForm, b: SeoForm) =>
  seoLine(a.title) === seoLine(b.title) && seoLine(a.description) === seoLine(b.description);

const lengthHint = (value: string, recommended: number, max: number) => {
  const n = seoLine(value).length;
  return n === 0
    ? `ריק — ברירת המחדל של האתר. מומלץ עד ${recommended} תווים (לכל היותר ${max}).`
    : `${n} תווים · מומלץ עד ${recommended}${n > recommended ? " — גוגל עלול לקצר בתוצאות" : ""}`;
};

export function UnitSeoCard(props: {
  unitId: string;
  unitName: string;
  unitDescription: string;
  revision: number;
  disabled: boolean;
  onSaved: (revision: number) => void;
  onConflict: () => void;
}) {
  const { business } = useManagement();
  const query = useQuery({
    queryKey: ["hospitality", "manage", "unit-seo", props.unitId, props.revision],
    queryFn: () => hospitalityUnitSeo({ data: { id: props.unitId } }),
  });
  const [base, setBase] = useState<SeoForm>({ title: "", description: "" });
  const [form, setForm] = useState<SeoForm>({ title: "", description: "" });
  const baseRef = useRef(base);
  baseRef.current = base;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ערכים שנטענו (גם אחרי שמירה של שאר הפרטים, שמעלה את הגרסה): הטופס מתעדכן רק כשאין בו
  // שינוי שלא נשמר — כדי לא למחוק טקסט שהמשתמש עוד לא שמר
  useEffect(() => {
    if (!query.data) return;
    const loaded = {
      title: query.data.seo_title ?? "",
      description: query.data.seo_description ?? "",
    };
    const previous = baseRef.current;
    setForm((current) => (sameSeo(current, previous) ? loaded : current));
    setBase(loaded);
  }, [query.data]);

  const errors = unitSeoErrors(form);
  const dirty = !sameSeo(form, base);
  const defaultTitle = `${props.unitName} | ${business.name}`;
  const defaultDescription = props.unitDescription.trim()
    ? "המשפט הראשון של תיאור היחידה"
    : "התיאור של האתר";

  const save = async () => {
    if (!dirty || errors.title || errors.description || props.disabled) return;
    setBusy(true);
    setError(null);
    try {
      const result = await hospitalitySaveUnitSeo({
        data: {
          id: props.unitId,
          title: form.title,
          description: form.description,
          revision: props.revision,
        },
      });
      if (result.status === "saved") {
        const saved = { title: seoLine(form.title), description: seoLine(form.description) };
        setBase(saved);
        setForm(saved);
        toast.success("הכותרת והתיאור לגוגל נשמרו");
        props.onSaved(result.revision);
        return;
      }
      setError("היחידה עודכנה בינתיים — הנתונים רועננו. בדקו ושמרו שוב.");
      props.onConflict();
    } catch (e) {
      setError(e instanceof Error ? e.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-section="unit-seo">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>גוגל ושיתוף</h2>
        </CardTitle>
        <CardDescription>
          הכותרת והתיאור של עמוד היחידה בתוצאות החיפוש. אפשר להשאיר ריק — אז נשתמש בשם היחידה
          ובתיאור שלה.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset
          disabled={props.disabled || busy || query.isLoading}
          className="grid gap-4"
          aria-busy={busy || query.isLoading}
        >
          <TextField
            idPrefix="unit-seo"
            name="title"
            label="כותרת לגוגל (Meta Title)"
            value={form.title}
            placeholder={defaultTitle}
            onChange={(v) => setForm((f) => ({ ...f, title: v }))}
            error={errors.title}
            hint={lengthHint(form.title, UNIT_SEO_RECOMMENDED.title, SEO_LIMITS.title)}
          />
          <TextAreaField
            idPrefix="unit-seo"
            name="description"
            label="תיאור לגוגל (Meta Description)"
            rows={3}
            value={form.description}
            onChange={(v) => setForm((f) => ({ ...f, description: v }))}
            error={errors.description}
            hint={
              seoLine(form.description)
                ? lengthHint(
                    form.description,
                    UNIT_SEO_RECOMMENDED.description,
                    SEO_LIMITS.description,
                  )
                : `ריק — ${defaultDescription}. מומלץ עד ${UNIT_SEO_RECOMMENDED.description} תווים.`
            }
          />
          {query.isError && (
            <p role="alert" className="text-sm text-destructive">
              לא הצלחנו לטעון את הנתונים לגוגל. רעננו את העמוד.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div>
            <Button type="button" onClick={() => void save()} disabled={!dirty || busy}>
              {busy ? "שומרים…" : "שמירת הכותרת והתיאור"}
            </Button>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
