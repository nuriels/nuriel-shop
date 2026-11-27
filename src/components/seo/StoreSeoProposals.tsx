// NURIEL AI SEO ENGINE — Ecommerce: the proposals waiting for the store owner. Approve (as is / after editing),
// save for later, reject; restore an approved one while the field still holds it. A proposal never changes the
// store by itself — and approving checks again that the field did not change since it was made.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, cn } from "@/platform/ui";
import { GoogleSnippet } from "@/platform/seo/ui/GoogleSnippet";
import { SEO_CENTER_KEY } from "@/platform/seo/ui/SeoCenter";
import {
  decideStoreSeoProposalFn,
  generateStoreSeoFn,
  getStoreSeoProposals,
  revertStoreSeoProposalFn,
  type StoreSeoProposal,
} from "@/lib/seo/store-seo.functions";
import { CONDITION_LABEL, isItemCondition, ITEM_CONDITIONS } from "@/lib/product-facts";

const KEY = ["seo", "store-proposals"] as const;
const FIELD: Record<string, string> = {
  seo_title: "הכותרת בגוגל",
  seo_description: "התיאור בגוגל",
  seo_keywords: "ביטויי חיפוש",
  // migration 207: facts about the product (Google's product data) — approved by the owner, never automatically
  brand: "מותג / יצרן",
  item_condition: "מצב המוצר",
};
const LIMIT: Record<string, number> = {
  seo_title: 60,
  seo_description: 155,
  seo_keywords: 500,
  brand: 80,
};
/** the condition is a choice (the DB takes only these three), shown in Hebrew */
const conditionText = (v: string | null | undefined) =>
  isItemCondition(v) ? CONDITION_LABEL[v] : (v ?? "");
const HISTORY: Record<string, string> = {
  approved: "אושר ונשמר",
  rejected: "בוטל",
  superseded: "הוחלף בהצעה חדשה",
  stale: "לא הוחל — השדה השתנה מאז",
  reverted: "שוחזר לערך הקודם",
};
const messageOf = (e: unknown) =>
  e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : "הפעולה נכשלה — נסו שוב";

const groupTitle = (p: StoreSeoProposal) =>
  p.target_kind === "store"
    ? "דף הבית של החנות"
    : `${p.target_kind === "category" ? "קטגוריה" : "מוצר"}: ${p.label ?? "—"}`;

export function StoreSeoProposals() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => getStoreSeoProposals(), retry: false });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: SEO_CENTER_KEY });
  };
  const generate = useMutation({
    mutationFn: (kind: "template" | "ai") => generateStoreSeoFn({ data: { kind } }),
    onSuccess: (r) => {
      if (r.status === "ok")
        toast.success(
          r.added
            ? `נוספו ${r.added} הצעות${r.auto_applied ? ` (${r.auto_applied} מולאו אוטומטית לפי ההגדרה שלכם)` : ""}`
            : "אין הצעות חדשות — כל השדות כבר מלאים או ממתינים לאישור",
        );
      else toast.error(r.message);
      refresh();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; action: "approve" | "reject" | "later"; text?: string }) =>
      decideStoreSeoProposalFn({ data: v }),
    onSuccess: (r) => {
      toast[r.status === "stale" ? "warning" : "success"](
        r.status === "approved"
          ? "נשמר — יופיע בגוגל בסריקה הבאה של האתר"
          : r.status === "later"
            ? "נשמר לאחר כך"
            : r.status === "stale"
              ? "השדה השתנה מאז שההצעה הוכנה — לא החלפנו את מה שכתבתם"
              : "ההצעה בוטלה",
      );
      refresh();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const revert = useMutation({
    mutationFn: (id: string) => revertStoreSeoProposalFn({ data: { id } }),
    onSuccess: () => {
      toast.success("שוחזר לערך שהיה לפני האישור");
      refresh();
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const all = useMemo(() => query.data?.proposals ?? [], [query.data]);
  const open = useMemo(
    () => all.filter((p) => p.status === "pending" || p.status === "later"),
    [all],
  );
  const decided = useMemo(
    () => all.filter((p) => p.status !== "pending" && p.status !== "later"),
    [all],
  );
  const groups = useMemo(() => {
    const m = new Map<string, StoreSeoProposal[]>();
    for (const p of open) {
      const k = `${p.target_kind}:${p.target_id ?? ""}`;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.values()];
  }, [open]);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <section
      aria-labelledby="store-seo-proposals"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      data-testid="store-seo-proposals"
    >
      <h2 id="store-seo-proposals" className="flex items-center gap-2 text-base font-semibold">
        <Sparkles className="size-5 text-primary" aria-hidden="true" />
        הצעות לשיפור בגוגל
      </h2>
      <p className="text-sm text-muted-foreground">
        כותרות ותיאורים שמופיעים בתוצאות החיפוש. <strong>שום דבר לא משתנה בחנות</strong> עד שתאשרו —
        ואפשר לערוך כל הצעה לפני האישור, לשמור לאחר כך, או לשחזר אחרי אישור.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={generate.isPending}
          onClick={() => generate.mutate("template")}
          data-testid="store-seo-template"
        >
          <Wand2 className="size-4" aria-hidden="true" />
          הצעות בסיסיות (חינם)
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={generate.isPending}
          onClick={() => generate.mutate("ai")}
          data-testid="store-seo-ai"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          הצעות עם NURIEL AI
        </Button>
      </div>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">טוענים…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {messageOf(query.error)}
        </p>
      ) : open.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין הצעות שממתינות לאישור.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((items) => (
            <div
              key={`${items[0]!.target_kind}:${items[0]!.target_id ?? ""}`}
              className="flex flex-col gap-2"
            >
              <h3 className="text-sm font-semibold">{groupTitle(items[0]!)}</h3>
              <ul className="flex flex-col gap-2">
                {items.map((p) => (
                  <ProposalCard
                    key={p.id}
                    p={p}
                    sibling={
                      items.find(
                        (x) =>
                          x.id !== p.id &&
                          x.field !== p.field &&
                          (x.field === "seo_title" || x.field === "seo_description"),
                      ) ?? null
                    }
                    url={`${origin}${p.path}`}
                    busy={decide.isPending}
                    onDecide={(action, text) =>
                      decide.mutate({ id: p.id, action, ...(text ? { text } : {}) })
                    }
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {decided.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            היסטוריה ({decided.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5" data-testid="store-seo-history">
            {decided.slice(0, 60).map((p) => {
              const restorable =
                p.status === "approved" && p.current !== null && p.current === (p.applied ?? "");
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-2"
                  data-testid="store-seo-history-item"
                  data-target={`${p.target_kind}:${p.target_id ?? ""}:${p.field}`}
                  data-status={p.status}
                >
                  <span className="min-w-0 flex-1">
                    {FIELD[p.field]} · {groupTitle(p)} — {HISTORY[p.status] ?? p.status}
                    {p.applied ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        "{p.field === "item_condition" ? conditionText(p.applied) : p.applied}"
                      </span>
                    ) : null}
                  </span>
                  {restorable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={revert.isPending}
                      onClick={() => revert.mutate(p.id)}
                      data-testid="store-seo-revert"
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      שחזור
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

function ProposalCard(props: {
  p: StoreSeoProposal;
  sibling: StoreSeoProposal | null;
  url: string;
  busy: boolean;
  onDecide: (action: "approve" | "reject" | "later", text?: string) => void;
}) {
  const { p } = props;
  const id = useId();
  const [text, setText] = useState(p.proposed);
  useEffect(() => setText(p.proposed), [p.proposed]);
  const stale = (p.current ?? "") !== (p.base ?? "");
  const limit = LIMIT[p.field] ?? 500;
  const edited = text !== p.proposed;
  const isCondition = p.field === "item_condition";
  // the Google result preview only for Google texts (title / description)
  const preview =
    p.field !== "seo_title" && p.field !== "seo_description"
      ? null
      : {
          title: p.field === "seo_title" ? text : (props.sibling?.proposed ?? null),
          description: p.field === "seo_description" ? text : (props.sibling?.proposed ?? null),
        };
  return (
    <li
      className={cn("flex flex-col gap-2 rounded-md border p-3", stale && "border-amber-500")}
      data-testid="store-seo-proposal"
      data-field={p.field}
      data-target={`${p.target_kind}:${p.target_id ?? ""}:${p.field}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{FIELD[p.field]}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {p.source === "ai" ? "NURIEL AI" : "הצעה בסיסית"}
        </span>
        {p.status === "later" && (
          <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-900">
            <Clock className="size-3" aria-hidden="true" />
            נשמר לאחר כך
          </span>
        )}
      </div>
      {p.reason && <p className="text-xs text-muted-foreground">למה: {p.reason}</p>}
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">עכשיו: </span>
        {p.current ? (
          isCondition ? (
            conditionText(p.current)
          ) : (
            p.current
          )
        ) : (
          <span className="italic">
            {p.field === "brand"
              ? "ריק — אין מותג בנתונים לגוגל"
              : isCondition
                ? "לא נקבע — לפי המילים בשם המוצר, אחרת חדש"
                : "ריק — מוצג טקסט ברירת מחדל"}
          </span>
        )}
      </p>
      {stale ? (
        <p className="text-xs text-amber-800" role="status">
          השדה השתנה מאז שההצעה הוכנה — לא נחליף את מה שכתבתם. אפשר לבטל את ההצעה.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs font-medium">
            {isCondition ? "מוצע (אפשר לבחור אחרת)" : "מוצע (אפשר לערוך)"}
          </label>
          {isCondition ? (
            <select
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
              data-testid="store-seo-condition"
            >
              {ITEM_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABEL[c]}
                </option>
              ))}
            </select>
          ) : (
            <textarea
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={p.field === "seo_title" || p.field === "brand" ? 2 : 3}
              dir={p.field === "brand" ? "auto" : "rtl"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
              data-testid="store-seo-text"
            />
          )}
          {!isCondition && (
            <span
              dir="ltr"
              className={cn(
                "self-end text-xs",
                text.length > limit ? "font-semibold text-amber-800" : "text-muted-foreground",
              )}
            >
              {text.length}/{limit}
            </span>
          )}
          {preview && (
            <GoogleSnippet
              title={preview.title}
              description={preview.description}
              url={props.url}
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
            onClick={() => props.onDecide("approve", edited ? text : undefined)}
            data-testid="store-seo-approve"
          >
            {edited ? "שמירה עם העריכה" : "אישור"}
          </Button>
        )}
        {!stale && p.status === "pending" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={props.busy}
            onClick={() => props.onDecide("later")}
            data-testid="store-seo-later"
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
          onClick={() => props.onDecide("reject")}
          data-testid="store-seo-reject"
        >
          <X className="size-4" aria-hidden="true" />
          ביטול ההצעה
        </Button>
      </div>
    </li>
  );
}
