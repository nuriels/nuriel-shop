// "תקנו לי" ליד ממצא בבדיקה הטכנית (מרכז ה-SEO, אתר אירוח). כותרת / תיאור לגוגל: הצעה ממתינה לעמוד המסוים
// (hospitalitySeoFix — תבנית, ואם אין חדש: NURIEL AI לעסק זכאי), ואז קופצים אליה ברשימת ההצעות שמתחת —
// בעל העסק מאשר / עורך / דוחה שם. תוכן ותמונות: קישור למסך שבו מתקנים. שום דבר לא משתנה באתר מכאן.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/platform/ui";
import type { AuditIssue } from "@/platform/seo/audit/rules";
import { hospitalitySeoFix } from "../../api/seo-proposals.functions";
import type { PublicSite } from "../../types/website";
import { SEO_FIX_FIELD, seoFixTargets, type SeoFixTarget } from "../../website/seo-fix";

/** אותו מפתח כמו רשימת ההצעות (SeoProposalsPanel) — רענון אחרי ההפקה */
const PROPOSALS_KEY = ["hospitality", "manage", "seo-proposals"] as const;

const pagesOf = (issue: AuditIssue) =>
  issue.urls && issue.urls.length > 0 ? issue.urls : issue.url ? [issue.url] : [];

/** קופצים להצעה הראשונה של העמוד ומדגישים אותה לרגע (כרטיסי ההצעות: data-target) */
function showProposal(targets: SeoFixTarget[], field: string) {
  if (typeof document === "undefined") return;
  for (const t of targets) {
    const el = document.querySelector<HTMLElement>(
      `[data-testid="seo-proposal"][data-target="${t.target_kind}:${t.target_id ?? ""}:${field}"]`,
    );
    if (!el) continue;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
    el.classList.add("ring-2", "ring-[var(--hm-lagoon-500)]");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-[var(--hm-lagoon-500)]"), 4000);
    return;
  }
}

/** איפה עורכים בעצמכם — כשאין הצעה אוטומטית טובה יותר */
function EditLink({ target }: { target: SeoFixTarget | undefined }) {
  if (!target) return null;
  const cls = "font-medium text-primary underline underline-offset-2";
  if (target.target_kind === "unit" && target.target_id)
    return (
      <Link to="/manage/units/$unitId" params={{ unitId: target.target_id }} className={cls}>
        לעריכת היחידה
      </Link>
    );
  if (target.target_kind === "package")
    return (
      <Link to="/manage/packages" className={cls}>
        לעריכת החבילה
      </Link>
    );
  return (
    <Link to="/manage/website" className={cls}>
      לעריכת דף הבית
    </Link>
  );
}

export function SeoIssueAction({
  issue,
  site,
}: {
  issue: AuditIssue;
  /** האתר (הטיוטה בעורך) — לתרגום כתובת לעמוד: יחידה / חבילה */
  site: PublicSite | undefined;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const pages = pagesOf(issue);
  const field = SEO_FIX_FIELD[issue.code];
  const targets =
    site && pages.length ? seoFixTargets(site, { code: issue.code, urls: pages }) : [];

  const fix = useMutation({
    mutationFn: () => hospitalitySeoFix({ data: { code: issue.code, urls: pages } }),
    onMutate: () => setNote(null),
    onSuccess: async (r) => {
      if (r.status === "ok" && r.field) {
        toast.success(
          r.added > 0
            ? "הכנו הצעה — היא מחכה לאישור שלכם ברשימה למטה. שום דבר לא משתנה באתר עד שתאשרו."
            : "יש כבר הצעה שמחכה לאישור שלכם — הנה היא.",
        );
        await qc.refetchQueries({ queryKey: PROPOSALS_KEY });
        window.requestAnimationFrame(() => showProposal(r.targets, r.field!));
        return;
      }
      setNote(r.message ?? "לא הצלחנו להכין הצעה כרגע.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "הפעולה נכשלה — נסו שוב"),
  });

  // כותרת / תיאור לגוגל של עמוד באתר — "תקנו לי"
  if (field && pages.length > 0) {
    return (
      <span className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 gap-1.5"
          disabled={fix.isPending}
          onClick={() => fix.mutate()}
          data-testid="seo-issue-fix"
        >
          {fix.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          תקנו לי
        </Button>
        {note && (
          <span
            role="status"
            className="text-xs text-muted-foreground"
            data-testid="seo-issue-note"
          >
            {note} <EditLink target={targets[0]} />
          </span>
        )}
      </span>
    );
  }

  // מעט תוכן בעמוד — הטקסט של בעל העסק: קישור לעמוד שבו כותבים אותו
  if (issue.code === "content.thin") {
    const t =
      site && pages.length ? seoFixTargets(site, { code: issue.code, urls: pages })[0] : undefined;
    if (!t) return null;
    return (
      <span className="text-xs">
        <EditLink target={t} /> — הוסיפו כמה משפטים משלכם.
      </span>
    );
  }

  // תמונות בלי תיאור — במסך התמונות (או "תיאורי תמונות עם AI" ברשימת ההצעות)
  if (issue.code === "images.alt_missing") {
    return (
      <span className="text-xs">
        <Link to="/manage/photos" className="font-medium text-primary underline underline-offset-2">
          למסך התמונות
        </Link>{" "}
        — או "תיאורי תמונות עם AI" ברשימת ההצעות למטה.
      </span>
    );
  }
  return null;
}
