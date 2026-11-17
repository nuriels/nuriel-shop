// עורך האתר — "גוגל ושיתוף" → ביטויי חיפוש בעברית: רשימת עבודה לכל עסק (הוספה, עריכה, מחיקה, ביטוי
// מרכזי, כלליים / מקומיים / לפי שירות) ותצוגה מקדימה: איפה כל ביטוי כבר מופיע באתר לפי הטיוטה —
// כותרת SEO, תיאור, H1, כותרות, תוכן, יחידות, טקסט חלופי — ומה חסר.
// הביטויים נשמרים בטיוטת האתר ולא מוצגים לגולשים בשום צורה (אין meta keywords, אין טקסט מוסתר).
import { Pencil, Star, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button, cn } from "@/platform/ui";
import type { PublicSite } from "../../types/website";
import type { SiteDesign } from "../../website/design/schema";
import { draftKeywordReport } from "../../website/seo-keywords-report";
import {
  KEYWORD_GROUP_LABELS,
  KEYWORD_GROUPS,
  KEYWORD_LIMITS,
  KEYWORD_PLACE_LABELS,
  KEYWORD_STATUS_LABELS,
  keywordError,
  keywordLine,
  newKeywordId,
  type KeywordGroup,
  type KeywordReport,
  type KeywordStatus,
  type SeoKeyword,
} from "../../website/seo-keywords";

export function SeoKeywordsPanel({
  design,
  site,
  onChange,
}: {
  design: SiteDesign;
  site: PublicSite;
  onChange: (d: SiteDesign) => void;
}) {
  const list = useMemo(() => design.seo?.keywords ?? [], [design.seo?.keywords]);
  const setList = (next: SeoKeyword[]) => {
    const seo = { ...(design.seo ?? {}) };
    if (next.length) seo.keywords = next;
    else delete seo.keywords;
    const out: SiteDesign = { ...design };
    if (Object.keys(seo).length) out.seo = seo;
    else delete out.seo;
    onChange(out);
  };
  const report = useMemo(() => draftKeywordReport(site, design), [site, design]);

  return (
    <section aria-labelledby="seo-keywords-title" className="flex flex-col gap-3">
      <h3 id="seo-keywords-title" className="text-sm font-bold">
        ביטויי חיפוש בעברית
      </h3>
      <p className="text-xs text-muted-foreground">
        רשימת עבודה: הביטויים שגולשים מחפשים בגוגל. הם <strong>לא</strong> מוצגים באתר ולא נשלחים
        לגוגל — גוגל לא משתמש בתגית keywords. משלבים אותם באופן טבעי בכותרת, בתיאור, בכותרות ובתוכן
        — רק כשהם נכונים לגבי המקום. נשמר בטיוטה.
      </p>

      <AddKeyword list={list} onAdd={(k) => setList([...list, k])} />

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          עוד אין ביטויים. מוסיפים ביטוי, בוחרים סוג, ומסמנים ⭐ לביטויים המרכזיים.
        </p>
      ) : (
        KEYWORD_GROUPS.map((g) => {
          const items = list.filter((k) => k.group === g);
          if (!items.length) return null;
          return (
            <div key={g} className="flex flex-col gap-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground">
                {KEYWORD_GROUP_LABELS[g]} ({items.length})
              </h4>
              <ul className="flex flex-col gap-1.5" data-testid={`seo-keywords-${g}`}>
                {items.map((k) => (
                  <KeywordRow
                    key={k.id}
                    keyword={k}
                    list={list}
                    onChange={(next) => setList(list.map((x) => (x.id === k.id ? next : x)))}
                    onDelete={() => setList(list.filter((x) => x.id !== k.id))}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}

      {list.length > 0 && <KeywordPreview rows={report.rows} warnings={report.warnings} />}
    </section>
  );
}

function GroupSelect(props: {
  value: KeywordGroup;
  onChange: (g: KeywordGroup) => void;
  label: string;
}) {
  return (
    <select
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as KeywordGroup)}
      className="min-h-11 rounded-md border border-input bg-background px-2 text-sm"
    >
      {KEYWORD_GROUPS.map((g) => (
        <option key={g} value={g}>
          {KEYWORD_GROUP_LABELS[g]}
        </option>
      ))}
    </select>
  );
}

function AddKeyword({ list, onAdd }: { list: SeoKeyword[]; onAdd: (k: SeoKeyword) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [group, setGroup] = useState<KeywordGroup>("general");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const e = keywordError(text, list);
    if (e) return setError(e);
    onAdd({ id: newKeywordId(list), text: keywordLine(text), group });
    setText("");
    setError(null);
  };
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        ביטוי חדש
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          value={text}
          maxLength={KEYWORD_LIMITS.text}
          placeholder="למשל: צימר ליד בית שמש"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          data-testid="seo-keyword-input"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        />
        <GroupSelect value={group} onChange={setGroup} label="סוג הביטוי" />
        <Button type="submit" className="min-h-11" data-testid="seo-keyword-add">
          הוספה
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function KeywordRow(props: {
  keyword: SeoKeyword;
  list: SeoKeyword[];
  onChange: (k: SeoKeyword) => void;
  onDelete: () => void;
}) {
  const k = props.keyword;
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (editing === null) return;
    const e = keywordError(editing, props.list, k.id);
    if (e) return setError(e);
    props.onChange({ ...k, text: keywordLine(editing) });
    setEditing(null);
    setError(null);
  };
  return (
    <li className="flex flex-col gap-1 rounded-md border p-2" data-testid="seo-keyword-row">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={k.primary === true}
          aria-label={
            k.primary ? `ביטוי מרכזי: ${k.text} (לביטול)` : `לסמן כביטוי מרכזי: ${k.text}`
          }
          onClick={() => {
            const { primary: _p, ...rest } = k;
            void _p;
            props.onChange(k.primary ? rest : { ...rest, primary: true });
          }}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Star
            aria-hidden="true"
            className={cn(
              "size-4",
              k.primary
                ? "fill-[var(--hm-warning)] text-[var(--hm-warning)]"
                : "text-muted-foreground",
            )}
          />
        </button>
        {editing === null ? (
          <span className="min-w-0 flex-1 text-sm break-words">{k.text}</span>
        ) : (
          <input
            autoFocus
            aria-label={`עריכת הביטוי ${k.text}`}
            value={editing}
            maxLength={KEYWORD_LIMITS.text}
            onChange={(e) => {
              setEditing(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                setEditing(null);
                setError(null);
              }
            }}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base"
          />
        )}
        <GroupSelect
          value={k.group}
          label={`סוג הביטוי ${k.text}`}
          onChange={(group) => props.onChange({ ...k, group })}
        />
        {editing === null ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`עריכה: ${k.text}`}
            onClick={() => setEditing(k.text)}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button type="button" size="sm" className="min-h-11" onClick={save}>
            שמירה
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 text-destructive"
          aria-label={`מחיקה: ${k.text}`}
          onClick={props.onDelete}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

const STATUS_STYLE: Record<KeywordStatus, string> = {
  strong: "bg-[var(--hm-success)]/15 text-[var(--hm-success)]",
  present: "bg-primary/10 text-primary",
  partial: "bg-[var(--hm-warning)]/15 text-[var(--hm-warning)]",
  missing: "bg-destructive/10 text-destructive",
};

const places = (r: KeywordReport["home"]) =>
  [
    ...r.exact.map((p) => KEYWORD_PLACE_LABELS[p]),
    ...r.words.map((p) => `${KEYWORD_PLACE_LABELS[p]} (חלקי)`),
  ].join(" · ") || "—";

function KeywordPreview(props: {
  rows: KeywordReport[];
  warnings: { place: "title" | "description"; message: string }[];
}) {
  const missing = props.rows.filter((r) => r.status === "missing").length;
  return (
    <section
      aria-labelledby="seo-keywords-preview"
      className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3"
      data-testid="seo-keywords-preview"
    >
      <h4 id="seo-keywords-preview" className="text-sm font-bold">
        תצוגה מקדימה — איפה הביטויים מופיעים (לפי הטיוטה)
      </h4>
      <p className="text-xs text-muted-foreground">
        נבדק מול הכותרת והתיאור שגוגל יקבל, ה-H1, כותרות המקטעים, התוכן, עמודי היחידות והטקסט החלופי
        שכתבתם לתמונות. {missing ? `${missing} ביטויים עוד לא מופיעים באתר.` : ""}
      </p>
      {props.warnings.length > 0 && (
        <ul className="list-disc ps-5 text-xs text-[var(--hm-warning)]" role="status">
          {props.warnings.map((w) => (
            <li key={w.place + w.message}>
              {w.place === "title" ? "כותרת SEO" : "תיאור SEO"}: {w.message}
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-start text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th scope="col" className="py-1.5 text-start font-medium">
                ביטוי
              </th>
              <th scope="col" className="py-1.5 text-start font-medium">
                מצב
              </th>
              <th scope="col" className="py-1.5 text-start font-medium">
                דף הבית
              </th>
              <th scope="col" className="py-1.5 text-start font-medium">
                עמודי יחידות
              </th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.keyword.id} className="border-b align-top last:border-0">
                <th scope="row" className="py-1.5 pe-2 text-start font-medium">
                  {r.keyword.primary && <span aria-label="ביטוי מרכזי">⭐ </span>}
                  {r.keyword.text}
                </th>
                <td className="py-1.5 pe-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 whitespace-nowrap",
                      STATUS_STYLE[r.status],
                    )}
                  >
                    {KEYWORD_STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="py-1.5 pe-2">{places(r.home)}</td>
                <td className="py-1.5">
                  {r.units.length === 0 ? (
                    "—"
                  ) : r.units.length <= 2 ? (
                    <UnitPlaces units={r.units} />
                  ) : (
                    <details>
                      <summary className="cursor-pointer">ב-{r.units.length} עמודי יחידות</summary>
                      <UnitPlaces units={r.units} />
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UnitPlaces({ units }: { units: KeywordReport["units"] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {units.map((u) => (
        <li key={u.page}>
          {u.label}: {places(u)}
        </li>
      ))}
    </ul>
  );
}
