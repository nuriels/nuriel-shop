// "מסמכים ומדיניות האתר" (מיגרציה 60): שמונה מסמכים לכל אתר בנפרד — תקנון, תנאי הזמנה, ביטולים
// והחזרים, פרטיות, תשלומים, אירועים, כללי המקום והצהרת נגישות. תבנית בעברית עם משתנים מפרטי העסק,
// עריכה, תצוגה מקדימה, טיוטה, פרסום (גרסה קבועה), עדכון, תאריך העדכון, התראה על פרטים חסרים, וסימון
// "נבדק על ידי" עורך דין / מורשה נגישות. טיוטות לבדיקה — לא ייעוץ משפטי ולא אישור עמידה בתקן.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
  Textarea,
  cn,
} from "@/platform/ui";
import {
  hospitalityDocumentPublish,
  hospitalityDocumentReview,
  hospitalityDocumentSave,
  hospitalityDocumentUnpublish,
  hospitalityDocuments,
  hospitalityLegalProfileSave,
} from "../../api/documents.functions";
import { DOC_KINDS, DOC_REVIEWER, docPath, type DocKind } from "../../documents/kinds";
import { VARIABLES, buildVars, renderDocument, type Rendered } from "../../documents/render";
import { TEMPLATES } from "../../documents/templates";
import type { DocumentsView, LegalProfile } from "../../types/documents";
import { errorText } from "../catalog/refresh";
import { formatDate } from "../lib/format";
import { manageKeys } from "../lib/query-keys";
import { DocumentBody } from "../../documents/DocumentBody";

const KEY = ["hospitality", "manage", "documents"] as const;
type View = DocumentsView & { context: { siteUrl: string; today: string } };

interface DocState {
  kind: DocKind;
  title: string;
  body: string;
  saved: boolean;
  revision: number | null;
  publishedVersion: number | null;
  published: View["versions"][number] | null;
  versions: View["versions"];
  rendered: Rendered;
  changed: boolean;
}

function docStates(view: View): DocState[] {
  const vars = buildVars(view, view.context);
  const coordinator = view.profile?.coordinator_required === true;
  return DOC_KINDS.map((kind) => {
    const d = view.documents.find((x) => x.kind === kind);
    const title = d?.draft_title ?? TEMPLATES[kind].title;
    const body = d?.draft_body ?? TEMPLATES[kind].body;
    const versions = view.versions.filter((v) => v.kind === kind);
    const published = d?.published_version
      ? (versions.find((v) => v.version === d.published_version) ?? null)
      : null;
    const rendered = renderDocument(body, vars, coordinator);
    return {
      kind,
      title,
      body,
      saved: !!d,
      revision: d?.revision ?? null,
      publishedVersion: d?.published_version ?? null,
      published,
      versions,
      rendered,
      // מה שבאתר שונה ממה שהטיוטה מייצרת עכשיו (נערכה, או שפרטי העסק השתנו)
      changed: !!published && published.body !== null && published.body !== rendered.text,
    };
  });
}

export function DocumentsPage() {
  const view = useQuery({ queryKey: KEY, queryFn: () => hospitalityDocuments() });
  const [open, setOpen] = useState<DocKind | null>(null);
  const states = useMemo(() => (view.data ? docStates(view.data) : []), [view.data]);
  const current = open ? states.find((s) => s.kind === open) : undefined;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">מסמכים ומדיניות האתר</h1>
        <p className="mt-1 text-muted-foreground">
          תבניות בעברית, נפרדות לכל אתר וממולאות בפרטי העסק שלכם. כל פרסום נשמר כגרסה קבועה עם תאריך
          עדכון, ובכל הזמנה באתר נרשם איזו גרסה האורח אישר.
        </p>
      </div>
      <p
        role="note"
        className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        data-testid="documents-disclaimer"
      >
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <span>
          אלה טיוטות לבדיקה — לא ייעוץ משפטי ולא אישור שהאתר עומד בתקן. לפני שמסתמכים על מסמך —
          בדיקה של עורך דין, ובהצהרת הנגישות — של מורשה נגישות שירות. אסור לכתוב שהאתר עומד בתקן בלי
          בדיקה שמבססת זאת.
        </span>
      </p>

      {view.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
          {errorText(view.error)}
        </p>
      ) : !view.data ? (
        <Skeleton className="h-72 w-full" />
      ) : current ? (
        <DocumentEditor
          key={`${current.kind}:${current.revision ?? "new"}`}
          doc={current}
          view={view.data}
          onBack={() => setOpen(null)}
        />
      ) : (
        <>
          <ProfileCard view={view.data} />
          <ul className="flex flex-col gap-3" data-testid="documents-list">
            {states.map((s) => (
              <li key={s.kind}>
                <DocumentRow doc={s} onOpen={() => setOpen(s.kind)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StatusBadges({ doc }: { doc: DocState }) {
  const missing = doc.rendered.missing.length + doc.rendered.placeholders.length;
  const reviewer = DOC_REVIEWER[doc.kind] === "lawyer" ? "עורך דין" : "מורשה נגישות";
  return (
    <div className="flex flex-wrap gap-1.5">
      {doc.published ? (
        <Badge variant="secondary">
          באתר — גרסה {doc.published.version}, עודכן {formatDate(doc.published.published_at)}
        </Badge>
      ) : (
        <Badge variant="outline">לא מוצג באתר</Badge>
      )}
      {!doc.saved && <Badge variant="outline">תבנית — עוד לא נשמר</Badge>}
      {doc.changed && <Badge variant="outline">יש שינויים שלא פורסמו</Badge>}
      {missing > 0 && (
        <Badge className="border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-50">
          חסרים פרטים ({missing})
        </Badge>
      )}
      {doc.published?.review_kind ? (
        <Badge className="border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-50">
          נבדק — {doc.published.reviewed_by}
        </Badge>
      ) : (
        <Badge variant="outline">לבדיקת {reviewer}</Badge>
      )}
    </div>
  );
}

function DocumentRow({ doc, onOpen }: { doc: DocState; onOpen: () => void }) {
  return (
    <Card data-document-row={doc.kind}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-medium">{doc.title}</h2>
            <div className="mt-1.5">
              <StatusBadges doc={doc} />
            </div>
          </div>
        </div>
        <Button variant="outline" className="min-h-11" onClick={onOpen}>
          עריכה <span className="sr-only">— {doc.title}</span>
        </Button>
      </CardContent>
    </Card>
  );
}

function DocumentEditor({ doc, view, onBack }: { doc: DocState; view: View; onBack: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = title !== doc.title || body !== doc.body || !doc.saved;
  const vars = useMemo(() => buildVars(view, view.context), [view]);
  const rendered = useMemo(
    () => renderDocument(body, vars, view.profile?.coordinator_required === true),
    [body, vars, view.profile],
  );
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: manageKeys.activity });
  };
  const save = useMutation({
    mutationFn: () =>
      hospitalityDocumentSave({
        data: { kind: doc.kind, title, body, expectedRevision: doc.revision },
      }),
    onSuccess: () => {
      toast.success("הטיוטה נשמרה");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const publish = useMutation({
    mutationFn: () =>
      hospitalityDocumentPublish({ data: { kind: doc.kind, expectedRevision: doc.revision } }),
    onSuccess: (r) => {
      toast.success(`פורסם באתר — גרסה ${r.version}`);
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const unpublish = useMutation({
    mutationFn: () => hospitalityDocumentUnpublish({ data: { kind: doc.kind } }),
    onSuccess: () => {
      toast.success("המסמך הוסר מהאתר (הגרסאות נשמרות)");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const insert = (key: string) => {
    const el = area.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const blockers = rendered.missing.length + rendered.placeholders.length;
  const where = (label: string) => VARIABLES.find((v) => v.label === label)?.where;

  return (
    <section aria-labelledby="doc-editor-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className="min-h-11 gap-2" onClick={onBack}>
          <ArrowRight className="size-4" aria-hidden="true" />
          לכל המסמכים
        </Button>
        {doc.published && (
          <a
            href={docPath(doc.kind)}
            target="_blank"
            rel="noopener"
            className="text-sm font-medium underline underline-offset-4"
          >
            צפייה בגרסה שבאתר
          </a>
        )}
      </div>
      <div>
        <h2 id="doc-editor-title" className="text-xl font-semibold">
          {doc.title}
        </h2>
        <div className="mt-2">
          <StatusBadges doc={doc} />
        </div>
      </div>
      <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm whitespace-pre-line">
        {TEMPLATES[doc.kind].note}
      </p>

      {blockers > 0 && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          data-testid="document-missing"
        >
          <p className="font-medium">לפני פרסום חסרים פרטים חיוניים:</p>
          <ul className="mt-1 list-disc ps-5">
            {rendered.missing.map((m) => (
              <li key={m}>
                {m}
                {where(m) && <span className="text-amber-900/80"> — ב{where(m)}</span>}
              </li>
            ))}
            {rendered.placeholders.length > 0 && (
              <li>
                {rendered.placeholders.length} פרטים שרק אתם יודעים — מסומנים בתצוגה המקדימה בסימון
                [[להשלמה]]. כתבו אותם במקום הסימון.
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="doc-title">כותרת המסמך</Label>
            <Input
              id="doc-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="doc-body">הטקסט</Label>
            <p id="doc-body-help" className="text-xs text-muted-foreground">
              "## " בתחילת שורה — כותרת; "- " — פריט ברשימה. {"{{…}}"} — פרט שמתמלא מפרטי העסק.
            </p>
            <Textarea
              id="doc-body"
              ref={area}
              value={body}
              rows={20}
              dir="rtl"
              aria-describedby="doc-body-help"
              onChange={(e) => setBody(e.target.value)}
              className="font-mono text-sm leading-relaxed"
            />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium" id="doc-vars">
              הוספת פרט מפרטי העסק
            </p>
            <div role="group" aria-labelledby="doc-vars" className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insert(v.key)}
                  className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={() => save.mutate()} disabled={save.isPending}>
              שמירת טיוטה
            </Button>
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => publish.mutate()}
              disabled={dirty || blockers > 0 || publish.isPending || !doc.saved}
              aria-describedby="doc-publish-help"
            >
              {doc.published ? "פרסום הגרסה המעודכנת" : "פרסום באתר"}
            </Button>
            {doc.published && (
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => unpublish.mutate()}
                disabled={unpublish.isPending}
              >
                הסרה מהאתר
              </Button>
            )}
            <Button
              variant="ghost"
              className="min-h-11 gap-2"
              onClick={() => {
                setTitle(TEMPLATES[doc.kind].title);
                setBody(TEMPLATES[doc.kind].body);
              }}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              חזרה לתבנית
            </Button>
          </div>
          <p id="doc-publish-help" className="text-xs text-muted-foreground">
            {dirty
              ? "שמרו את הטיוטה לפני הפרסום."
              : blockers > 0
                ? "אפשר לפרסם אחרי שכל הפרטים החסרים הושלמו."
                : "הפרסום שומר גרסה קבועה — מה שמוצג באתר ומה שאורחים מאשרים בהזמנה."}
          </p>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium" id="doc-preview-label">
            תצוגה מקדימה
          </p>
          {/* אזור גלילה — נגיש גם במקלדת (Tab אליו, ואז החצים) */}
          <div
            role="region"
            aria-labelledby="doc-preview-label"
            tabIndex={0}
            className="max-h-[42rem] overflow-y-auto rounded-md border bg-background p-5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-testid="document-preview"
          >
            <h3 className="mb-3 text-xl font-semibold">{title}</h3>
            <DocumentBody text={rendered.text} markMissing />
          </div>
        </div>
      </div>

      <Versions doc={doc} onChanged={refresh} />
    </section>
  );
}

function Versions({ doc, onChanged }: { doc: DocState; onChanged: () => void }) {
  const latest = doc.versions[0];
  const [kind, setKind] = useState<"lawyer" | "accessibility">(DOC_REVIEWER[doc.kind]);
  const [by, setBy] = useState("");
  const [on, setOn] = useState("");
  const review = useMutation({
    mutationFn: (clear: boolean) =>
      hospitalityDocumentReview({
        data: clear
          ? { kind: doc.kind, version: latest!.version, reviewKind: null }
          : {
              kind: doc.kind,
              version: latest!.version,
              reviewKind: kind,
              reviewedBy: by,
              reviewedOn: on,
            },
      }),
    onSuccess: () => {
      toast.success("נשמר");
      onChanged();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  if (!latest) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <h3 className="font-medium">גרסאות שפורסמו</h3>
        <ul className="flex flex-col gap-1.5 text-sm">
          {doc.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">גרסה {v.version}</span>
              <span className="text-muted-foreground">{formatDate(v.published_at)}</span>
              {v.version === doc.publishedVersion && <Badge variant="secondary">באתר</Badge>}
              <span className="text-muted-foreground">אושרה ב-{v.acceptances} הזמנות</span>
              {v.review_kind && (
                <span className="inline-flex items-center gap-1 text-emerald-800">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  נבדקה ({v.review_kind === "lawyer" ? "עורך דין" : "מורשה נגישות"}):{" "}
                  {v.reviewed_by}, {v.reviewed_on && formatDate(v.reviewed_on)}
                </span>
              )}
            </li>
          ))}
        </ul>
        <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-[auto_1fr_auto_auto] sm:items-end">
          <legend className="px-1 text-sm font-medium">סימון: גרסה {latest.version} נבדקה</legend>
          <div className="grid gap-1.5">
            <Label htmlFor="review-kind">על ידי</Label>
            <select
              id="review-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as "lawyer" | "accessibility")}
              className="h-10 rounded-md border bg-background px-2 text-sm"
            >
              <option value="lawyer">עורך דין</option>
              <option value="accessibility">מורשה נגישות</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="review-by">שם הבודק</Label>
            <Input
              id="review-by"
              value={by}
              onChange={(e) => setBy(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="review-on">תאריך הבדיקה</Label>
            <Input id="review-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="min-h-10"
              onClick={() => review.mutate(false)}
              disabled={review.isPending || by.trim().length < 2 || !on}
            >
              שמירת הסימון
            </Button>
            {latest.review_kind && (
              <Button variant="ghost" className="min-h-10" onClick={() => review.mutate(true)}>
                ביטול
              </Button>
            )}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}

const PROFILE_FIELDS: { key: keyof LegalProfile; label: string; type?: string; dir?: "ltr" }[] = [
  { key: "legal_name", label: "שם העוסק / החברה" },
  { key: "registration_id", label: "מספר עוסק / ח.פ", dir: "ltr" },
  { key: "legal_address", label: "כתובת העוסק" },
  { key: "a11y_contact_name", label: "איש קשר לפניות נגישות" },
  { key: "a11y_contact_phone", label: "טלפון לפניות נגישות", type: "tel", dir: "ltr" },
  { key: "a11y_contact_email", label: "אימייל לפניות נגישות", type: "email", dir: "ltr" },
];

function ProfileCard({ view }: { view: View }) {
  const qc = useQueryClient();
  const p = view.profile;
  const [form, setForm] = useState<Record<string, string | boolean>>(() => ({
    legal_name: p?.legal_name ?? "",
    registration_id: p?.registration_id ?? "",
    legal_address: p?.legal_address ?? "",
    a11y_contact_name: p?.a11y_contact_name ?? "",
    a11y_contact_phone: p?.a11y_contact_phone ?? "",
    a11y_contact_email: p?.a11y_contact_email ?? "",
    coordinator_required: p?.coordinator_required ?? false,
    coordinator_name: p?.coordinator_name ?? "",
    coordinator_phone: p?.coordinator_phone ?? "",
    coordinator_email: p?.coordinator_email ?? "",
  }));
  const save = useMutation({
    mutationFn: () =>
      hospitalityLegalProfileSave({
        data: { profile: form, expectedRevision: p?.revision ?? null },
      }),
    onSuccess: () => {
      toast.success("פרטי העסק למסמכים נשמרו");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const required = form["coordinator_required"] === true;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="font-medium">פרטי העסק למסמכים</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            פרטים שאין בהגדרות העסק. שם העסק, הטלפון, האימייל והכתובת — מהגדרות העסק.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROFILE_FIELDS.map((f) => (
            <div key={f.key} className="grid gap-1.5">
              <Label htmlFor={`profile-${f.key}`}>{f.label}</Label>
              <Input
                id={`profile-${f.key}`}
                type={f.type ?? "text"}
                dir={f.dir}
                value={String(form[f.key] ?? "")}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={required}
            onChange={(e) => set("coordinator_required", e.target.checked)}
          />
          <span>
            העסק חייב במינוי רכז נגישות (מעסיק 25 עובדים או יותר). בלי סימון — הרכז לא מופיע בהצהרה.
          </span>
        </label>
        {required && (
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["coordinator_name", "שם רכז הנגישות", "text"],
                ["coordinator_phone", "טלפון", "tel"],
                ["coordinator_email", "אימייל", "email"],
              ] as const
            ).map(([k, label, type]) => (
              <div key={k} className="grid gap-1.5">
                <Label htmlFor={`profile-${k}`}>{label}</Label>
                <Input
                  id={`profile-${k}`}
                  type={type}
                  dir={type === "text" ? undefined : "ltr"}
                  value={String(form[k] ?? "")}
                  onChange={(e) => set(k, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
        <div>
          <Button
            className={cn("min-h-11")}
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            שמירת הפרטים
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
