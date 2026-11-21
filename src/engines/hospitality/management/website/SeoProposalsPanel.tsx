// עורך האתר — "גוגל ושיתוף" → הצעות לשיפור בגוגל. בפעם הראשונה המערכת מכינה לבד הצעות בסיסיות (חינם), ולעסק
// עם NURIEL AI פעיל — גם הפקת AI ראשונית אחת. כל הצעה ממתינה עד שהעסק מאשר: אישור בודד, כמה יחד, עריכה לפני
// אישור, ביטול, או ניסוח אחר (AI). אישור נשמר דרך המסך הרגיל של אותו שדה — שדות דף הבית לטיוטה (נכנסים לאתר רק
// ב"פרסום"); שדה שהשתנה מאז ההצעה לא מוחלף. בשפה פשוטה, בלי מונחים טכניים.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Clock, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, cn } from "@/platform/ui";
import { GoogleSnippet } from "@/platform/seo/ui/GoogleSnippet";
import {
  hospitalitySeoAutoStart,
  hospitalitySeoDecide,
  hospitalitySeoGenerate,
  hospitalitySeoProposals,
  hospitalitySeoRevert,
} from "../../api/seo-proposals.functions";
import type { SeoGenerateResult, SeoProposal } from "../../types/seo";
import { SEO_RECOMMENDED } from "../../types/seo";
import type { PublicSite } from "../../types/website";
import type { SiteDesign } from "../../website/design/schema";
import { seoChecklist } from "../../website/seo-checklist";

const KEY = ["hospitality", "manage", "seo-proposals"] as const;

const FIELD_LABEL: Record<string, string> = {
  "site.seo_title": "הכותרת בגוגל",
  "site.seo_description": "התיאור בגוגל",
  "site.hero_title": "הכותרת הראשית בעמוד",
  "site.about_title": 'הכותרת של "על המקום"',
  "site.about_body": 'הטקסט של "על המקום"',
  "unit.seo_title": "הכותרת בגוגל",
  "unit.seo_description": "התיאור בגוגל",
  "unit.description": "הטקסט בעמוד היחידה",
  "media.alt": "תיאור התמונה",
  "package.seo_title": "הכותרת בגוגל",
  "package.seo_description": "התיאור בגוגל",
};
const multiline = (p: SeoProposal) => p.field === "about_body" || p.field === "description";
const limitOf = (p: SeoProposal) =>
  p.field === "seo_title"
    ? SEO_RECOMMENDED.title
    : p.field === "seo_description"
      ? SEO_RECOMMENDED.description
      : null;
const isOpen = (p: SeoProposal) => p.status === "pending" || p.status === "later";
const isStale = (p: SeoProposal) => isOpen(p) && (p.current ?? null) !== (p.base ?? null);
/** מיגרציה 204: אפשר לשחזר הצעה שאושרה כל עוד השדה מכיל בדיוק את מה שאושר */
const isRestorable = (p: SeoProposal) =>
  p.status === "approved" && (p.current ?? null) === (p.applied ?? null);

function resultText(r: SeoGenerateResult): string | null {
  switch (r.status) {
    case "ok":
      return r.added ? `נוספו ${r.added} הצעות` : "אין הצעות חדשות כרגע";
    case "already":
      return null;
    default:
      return r.message;
  }
}

export function SeoProposalsPanel({
  site,
  design,
  flush,
  onDraftChanged,
}: {
  site: PublicSite;
  design: SiteDesign;
  /** שמירת הטיוטה שבעורך לפני אישור של שדה בדף הבית */
  flush?: (() => Promise<void>) | undefined;
  /** אחרי אישור של שדה בדף הבית — העורך נטען מחדש עם הטיוטה */
  onDraftChanged?: (() => void) | undefined;
}) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => hospitalitySeoProposals(), retry: false });
  const view = query.data;
  const started = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);

  // הפעם הראשונה: הכנה אוטומטית — פעם אחת לעסק (המסד נועל), בלי שהעסק צריך לדעת מה זה SEO
  const auto = useMutation({
    mutationFn: () => hospitalitySeoAutoStart(),
    onSuccess: (r) => {
      const msgs = [
        resultText(r.template),
        r.ai.status === "unavailable" ? null : resultText(r.ai),
      ].filter(Boolean);
      if (msgs.length) toast.success(`הכנו לכם הצעות לשיפור בגוגל. ${msgs.join(" · ")}`);
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  useEffect(() => {
    if (!view || started.current) return;
    const needs = !view.runs.template_initial || (view.ai.available && !view.runs.ai_initial);
    if (needs) {
      started.current = true;
      auto.mutate();
    }
  }, [view, auto]);

  const generate = useMutation({
    mutationFn: (
      input:
        | { kind: "template" }
        | { kind: "ai"; what: "text" | "alt" }
        | { kind: "reword"; proposalId: string },
    ) => hospitalitySeoGenerate({ data: input }),
    onMutate: (input) =>
      setBusy(
        input.kind === "reword"
          ? input.proposalId
          : `${input.kind}:${"what" in input ? input.what : ""}`,
      ),
    onSettled: () => setBusy(null),
    onSuccess: (r) => {
      const msg = resultText(r);
      if (r.status === "ok") toast.success(msg ?? "");
      else if (msg) toast.message(msg);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "הפעולה נכשלה"),
  });

  const decide = useMutation({
    mutationFn: async (input: {
      items: SeoProposal[];
      action: "approve" | "reject" | "later";
      text?: string | undefined;
    }) => {
      // שינויים בעורך שעוד לא נשמרו — נשמרים קודם, כדי שהאישור לא ייתקל ב"השתנה ממקום אחר"
      if (input.action === "approve" && input.items.some((p) => p.target_kind === "site"))
        await flush?.();
      const results = await hospitalitySeoDecide({
        data: { ids: input.items.map((p) => p.id), action: input.action, text: input.text ?? null },
      });
      return { results, input };
    },
    onSuccess: ({ results, input }) => {
      const approved = results.filter((r) => r.status === "approved").length;
      const rejected = results.filter((r) => r.status === "rejected").length;
      const stale = results.filter((r) => r.status === "stale").length;
      const later = results.filter((r) => r.status === "later").length;
      const failed = results.filter((r) => r.status === "error");
      if (later) toast.message("נשמר לאחר כך — ההצעה מחכה לכם כאן");
      if (approved) toast.success(approved === 1 ? "ההצעה נשמרה" : `${approved} הצעות נשמרו`);
      if (rejected) toast.message(rejected === 1 ? "ההצעה בוטלה" : `${rejected} הצעות בוטלו`);
      if (stale) toast.message("שדה אחד או יותר השתנה מאז שההצעה הוכנה — השארנו את מה שכתבתם");
      if (failed.length) toast.error(failed[0]!.message ?? "הפעולה נכשלה");
      void qc.invalidateQueries({ queryKey: KEY });
      const siteApproved = input.items.some(
        (p) =>
          p.target_kind === "site" && results.find((r) => r.id === p.id)?.status === "approved",
      );
      if (siteApproved) onDraftChanged?.();
      // יחידות ותמונות — מה שהעורך מציג בתצוגה המקדימה
      if (approved && input.items.some((p) => p.target_kind !== "site"))
        void qc.invalidateQueries({ queryKey: ["hospitality", "manage", "website"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "הפעולה נכשלה"),
  });
  // מיגרציה 204: שחזור לערך שלפני האישור (רק כשהשדה עדיין מכיל את מה שאושר)
  const revert = useMutation({
    mutationFn: (p: SeoProposal) => hospitalitySeoRevert({ data: { id: p.id } }),
    onSuccess: (r, p) => {
      if (r.status === "reverted") {
        toast.success(
          p.target_kind === "site"
            ? "שוחזר בטיוטה — נכנס לאתר בפרסום"
            : "שוחזר לערך שהיה לפני האישור",
        );
        if (p.target_kind === "site") onDraftChanged?.();
        else void qc.invalidateQueries({ queryKey: ["hospitality", "manage", "website"] });
      } else toast.error(r.message ?? "השחזור נכשל");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "השחזור נכשל"),
  });

  // פתוחות: ממתינות + "לאחר כך"
  const pending = useMemo(() => (view?.proposals ?? []).filter(isOpen), [view]);
  const decided = useMemo(() => (view?.proposals ?? []).filter((p) => !isOpen(p)), [view]);
  const siteUrl = typeof window === "undefined" ? null : window.location.origin;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const checklist = useMemo(() => seoChecklist(site, design), [site, design]);
  const thumbs = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [
      ...site.units.flatMap((u) => u.media),
      ...site.properties.flatMap((p) => p.media),
      ...site.gallery,
    ])
      if (x.thumb_url ?? x.url) m.set(x.id, (x.thumb_url ?? x.url)!);
    return m;
  }, [site]);

  const groups = useMemo(() => {
    const g = new Map<string, { title: string; items: SeoProposal[] }>();
    for (const p of pending) {
      const key =
        p.target_kind === "unit" || p.target_kind === "package"
          ? `${p.target_kind}:${p.target_id}`
          : p.target_kind;
      const title =
        p.target_kind === "site"
          ? "דף הבית"
          : p.target_kind === "media"
            ? "תיאורי תמונות"
            : p.target_kind === "package"
              ? `חבילה: ${p.target_label ?? ""}`
              : (p.target_label ?? "יחידה");
      if (!g.has(key)) g.set(key, { title, items: [] });
      g.get(key)!.items.push(p);
    }
    return [...g.entries()];
  }, [pending]);

  const ready = selected.size > 0 && !decide.isPending;
  const aiOk = view?.ai.available === true;

  return (
    <section
      aria-labelledby="seo-proposals-title"
      className="flex flex-col gap-3"
      data-testid="seo-proposals"
    >
      <h3 id="seo-proposals-title" className="flex items-center gap-1.5 text-sm font-bold">
        <Sparkles className="size-4 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
        הצעות לשיפור בגוגל
      </h3>
      <p className="text-xs text-muted-foreground">
        הכנו הצעות לכותרות ולתיאורים שמופיעים בגוגל, ולתיאורי התמונות.{" "}
        <strong>שום דבר לא משתנה באתר</strong> עד שתאשרו. אפשר לערוך כל הצעה לפני האישור. מה שתאשרו
        לדף הבית נשמר בטיוטה ונכנס לאתר רק כשתלחצו "פרסום".
      </p>

      <details className="rounded-md border bg-muted/30 p-2 text-xs" data-testid="seo-checklist">
        <summary className="cursor-pointer font-medium">מה חסר לי בגוגל?</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {checklist.map((c) => (
            <li key={c.key} className="flex items-start gap-1.5">
              {c.ok ? (
                <CheckCircle2
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--hm-success)]"
                  aria-hidden="true"
                />
              ) : (
                <CircleAlert
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--hm-warning)]"
                  aria-hidden="true"
                />
              )}
              <span>
                <span className="sr-only">{c.ok ? "תקין: " : "חסר: "}</span>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={generate.isPending}
          onClick={() => generate.mutate({ kind: "template" })}
          data-testid="seo-generate-template"
        >
          הצעות בסיסיות (חינם)
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={!aiOk || generate.isPending}
          onClick={() => generate.mutate({ kind: "ai", what: "text" })}
          data-testid="seo-generate-ai-text"
        >
          {busy === "ai:text" ? "מכין…" : "ניסוח משופר עם AI"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={!aiOk || generate.isPending}
          onClick={() => generate.mutate({ kind: "ai", what: "alt" })}
          data-testid="seo-generate-ai-alt"
        >
          {busy === "ai:alt" ? "מכין…" : "תיאורי תמונות עם AI"}
        </Button>
      </div>
      {view && !aiOk && view.ai.message && (
        <p className="text-xs text-muted-foreground" data-testid="seo-ai-unavailable">
          {view.ai.message}
        </p>
      )}

      {query.isPending || auto.isPending ? (
        <p className="text-xs text-muted-foreground" role="status">
          מכינים הצעות…
        </p>
      ) : query.isError ? (
        <p className="text-xs text-destructive" role="alert">
          {query.error instanceof Error ? query.error.message : "לא הצלחנו לטעון את ההצעות"}
        </p>
      ) : pending.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground"
          data-testid="seo-proposals-empty"
        >
          אין הצעות שממתינות לאישור.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              disabled={!ready}
              onClick={() =>
                decide.mutate({
                  items: pending.filter((p) => selected.has(p.id) && !isStale(p)),
                  action: "approve",
                })
              }
              data-testid="seo-approve-selected"
            >
              אישור הנבחרות ({selected.size})
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={() =>
                setSelected(new Set(pending.filter((p) => !isStale(p)).map((p) => p.id)))
              }
            >
              בחירת הכול
            </Button>
          </div>
          {groups.map(([key, g]) => (
            <div key={key} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-muted-foreground">{g.title}</h4>
              <ul className="flex flex-col gap-2">
                {g.items.map((p) => (
                  <ProposalCard
                    key={p.id}
                    p={p}
                    thumb={
                      p.target_kind === "media" && p.target_id
                        ? (thumbs.get(p.target_id) ?? null)
                        : null
                    }
                    selected={selected.has(p.id)}
                    onSelect={(on) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (on) n.add(p.id);
                        else n.delete(p.id);
                        return n;
                      })
                    }
                    aiOk={aiOk}
                    busy={busy === p.id || decide.isPending}
                    onApprove={(text) => decide.mutate({ items: [p], action: "approve", text })}
                    onReject={() => decide.mutate({ items: [p], action: "reject" })}
                    onLater={() => decide.mutate({ items: [p], action: "later" })}
                    sibling={
                      g.items.find(
                        (x) =>
                          x.id !== p.id &&
                          x.target_id === p.target_id &&
                          (x.field === "seo_title" || x.field === "seo_description") &&
                          x.field !== p.field,
                      ) ?? null
                    }
                    siteUrl={siteUrl}
                    onReword={() => generate.mutate({ kind: "reword", proposalId: p.id })}
                  />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {decided.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">החלטות אחרונות ({decided.length})</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {decided.slice(0, 50).map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2"
                data-testid="seo-history-item"
              >
                <span>
                  {FIELD_LABEL[`${p.target_kind}.${p.field}`]}
                  {p.target_label ? ` · ${p.target_label}` : ""} —{" "}
                  {p.status === "approved"
                    ? p.auto_applied
                      ? "מולא אוטומטית (לפי ההגדרה שלכם)"
                      : "נשמר"
                    : p.status === "rejected"
                      ? "בוטל"
                      : p.status === "stale"
                        ? "לא הוחלף (השתנה מאז)"
                        : p.status === "reverted"
                          ? "שוחזר לערך הקודם"
                          : "הוחלף בהצעה חדשה"}
                </span>
                {isRestorable(p) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    disabled={revert.isPending}
                    onClick={() => revert.mutate(p)}
                    data-testid="seo-revert"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    שחזור
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ProposalCard(props: {
  p: SeoProposal;
  thumb: string | null;
  selected: boolean;
  onSelect: (on: boolean) => void;
  aiOk: boolean;
  busy: boolean;
  onApprove: (text?: string) => void;
  onReject: () => void;
  onReword: () => void;
  onLater: () => void;
  /** the other Google field of the same target (for the preview) */
  sibling: SeoProposal | null;
  siteUrl: string | null;
}) {
  const { p } = props;
  const id = useId();
  const [text, setText] = useState(p.proposed);
  useEffect(() => setText(p.proposed), [p.proposed]);
  const stale = isStale(p);
  const limit = limitOf(p);
  const Input = multiline(p) ? "textarea" : "input";
  const label = FIELD_LABEL[`${p.target_kind}.${p.field}`] ?? p.field;
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        stale && "border-[var(--hm-warning)]",
      )}
      data-testid="seo-proposal"
      data-target={`${p.target_kind}:${p.target_id ?? ""}:${p.field}`}
      data-source={p.source}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={props.selected}
          disabled={stale}
          onChange={(e) => props.onSelect(e.target.checked)}
          aria-label={`לבחור: ${label}${p.target_label ? ` · ${p.target_label}` : ""}`}
        />
        <span className="text-sm font-medium">{label}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {p.source === "ai" ? "NURIEL AI" : "הצעה בסיסית"}
        </span>
        {p.status === "later" && (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
            <Clock className="size-3" aria-hidden="true" />
            נשמר לאחר כך
          </span>
        )}
      </div>
      {p.reason && <p className="text-xs text-muted-foreground">למה: {p.reason}</p>}
      {props.thumb && (
        <img src={props.thumb} alt="" className="h-24 w-36 rounded object-cover" loading="lazy" />
      )}
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">עכשיו: </span>
        {p.current ?? p.base ?? <span className="italic">ריק (מוצג ברירת המחדל)</span>}
      </p>
      {stale ? (
        <p className="flex items-center gap-1 text-xs text-[var(--hm-warning)]" role="status">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          השדה השתנה מאז שההצעה הוכנה — לא נחליף את מה שכתבתם. אפשר לבטל את ההצעה.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs font-medium">
            מוצע (אפשר לערוך)
          </label>
          <Input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            {...(multiline(p) ? { rows: 5 } : { type: "text" })}
            dir="rtl"
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
            data-testid="seo-proposal-text"
          />
          {limit && (
            <span
              dir="ltr"
              className={cn(
                "self-end text-xs",
                text.length > limit
                  ? "font-semibold text-[var(--hm-warning)]"
                  : "text-muted-foreground",
              )}
            >
              {text.length}/{limit}
            </span>
          )}
          {(p.field === "seo_title" || p.field === "seo_description") && (
            <GoogleSnippet
              title={p.field === "seo_title" ? text : (props.sibling?.proposed ?? null)}
              description={p.field === "seo_description" ? text : (props.sibling?.proposed ?? null)}
              url={props.siteUrl}
            />
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!stale && (
          <Button
            type="button"
            size="sm"
            className="min-h-11"
            disabled={props.busy || !text.trim()}
            onClick={() => props.onApprove(text !== p.proposed ? text : undefined)}
            data-testid="seo-approve"
          >
            {text !== p.proposed ? "שמירה עם העריכה" : "אישור"}
          </Button>
        )}
        {!stale && p.status === "pending" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={props.busy}
            onClick={props.onLater}
            data-testid="seo-later"
          >
            <Clock className="size-4" aria-hidden="true" />
            לאחר כך
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          disabled={props.busy}
          onClick={props.onReject}
          data-testid="seo-reject"
        >
          <X className="size-4" aria-hidden="true" />
          ביטול ההצעה
        </Button>
        {props.aiOk && !stale && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            disabled={props.busy}
            onClick={props.onReword}
            data-testid="seo-reword"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            ניסוח אחר
          </Button>
        )}
      </div>
    </li>
  );
}
