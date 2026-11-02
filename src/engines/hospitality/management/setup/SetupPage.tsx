// מסך "הקמת העסק" (/manage/setup): כל הדרך מעסק חדש לאתר מוכן לפרסום — 13 צעדים בארבע קבוצות,
// חמש אבני דרך, והמשך בדיוק מאותה נקודה (הצעד האחרון נשמר במסד, לכל העסק). הסטטוס של כל צעד מחושב
// במסד מהנתונים עצמם; כאן — מה מציגים, לאן כל צעד מוביל (רק למי שיש לו הרשאה למסך), "בדקתי, מתאים
// לי" לצעדי בדיקה, ודילוג לצעדי רשות. טיוטה אף פעם לא מוצגת כמפורסמת.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDashed,
  Globe,
  Loader2,
  Lock,
  PartyPopper,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, cn } from "@/platform/ui";
import { hospitalitySetupGuide, hospitalitySetupSave } from "../../api/setup.functions";
import type { SetupAction, SetupGuideView, SetupStepKey } from "../../types/setup";
import { errorText } from "../catalog/refresh";
import { formatDate } from "../lib/format";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import {
  ErrorState,
  MeterBar,
  NoAccess,
  PageHeader,
  SectionCard,
  SkeletonBlock,
  StatusPill,
} from "../ui/kit";
import {
  MILESTONES,
  SETUP_GROUPS,
  SETUP_STEP_DEFS,
  STATE_LABEL,
  publishText,
  resumeStep,
  setupKey,
  setupProgress,
  stepDef,
  stepFact,
  stepState,
  type SetupStepDef,
} from "./model";

export function SetupPage() {
  const ctx = useManagement();
  const allowed = ctx.permissions["settings"] === true;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: setupKey,
    queryFn: () => hospitalitySetupGuide(),
    enabled: allowed,
  });
  const [busy, setBusy] = useState<string | null>(null);

  if (!allowed) return <NoAccess text="מדריך ההקמה פתוח לבעלים ולמנהלים עם הרשאת הגדרות." />;

  const save = async (step: SetupStepKey, action: SetupAction, quiet = false) => {
    if (!quiet) setBusy(`${step}:${action}`);
    try {
      const view = await hospitalitySetupSave({ data: { step, action } });
      qc.setQueryData(setupKey, view);
      // הרשימה בלוח הבקרה (management_context) — מתעדכנת גם היא
      if (action !== "visit") void qc.invalidateQueries({ queryKey: manageKeys.context });
      if (!quiet)
        toast.success(
          action === "confirm"
            ? "סומן כנבדק"
            : action === "skip"
              ? "דילגתם — אפשר לחזור לזה בכל רגע"
              : "עודכן",
        );
    } catch (e) {
      if (!quiet) toast.error(errorText(e));
    } finally {
      if (!quiet) setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="הקמת העסק"
        description="כל מה שצריך כדי שהאתר יהיה מוכן לקבל אורחים, לפי הסדר. אפשר לעצור בכל שלב — כשתחזרו, נמשיך בדיוק מאותה נקודה."
      />
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <div className="flex flex-col gap-4" role="status" aria-label="טוען את מדריך ההקמה">
          <SkeletonBlock className="h-36 w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      ) : (
        <Guide view={query.data} busy={busy} onSave={save} />
      )}
    </div>
  );
}

function Guide({
  view,
  busy,
  onSave,
}: {
  view: SetupGuideView;
  busy: string | null;
  onSave: (step: SetupStepKey, action: SetupAction, quiet?: boolean) => Promise<void>;
}) {
  const ctx = useManagement();
  const progress = setupProgress(view);
  const next = resumeStep(view);
  const canOpen = (d: SetupStepDef) => ctx.permissions[d.permission] === true;

  return (
    <>
      {/* ההתקדמות וחמש אבני הדרך */}
      <section
        aria-labelledby="setup-progress-title"
        className="rounded-2xl border border-[var(--hm-champagne-100)] bg-[linear-gradient(180deg,#fffdf8,#fff)] p-5 shadow-[var(--hm-shadow-card)] sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="setup-progress-title" className="text-base font-bold">
            ההתקדמות שלכם
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-bold text-[var(--hm-lagoon-700)]" data-num="">
              {progress.done} מתוך {progress.total}
            </span>{" "}
            צעדים הושלמו
          </p>
        </div>
        <MeterBar
          value={progress.percent}
          label="התקדמות ההקמה"
          tone="champagne"
          className="mt-3"
        />
        <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="אבני הדרך">
          {MILESTONES.map((m, i) => {
            const done = view.milestones[m.key];
            return (
              <li
                key={m.key}
                data-milestone={m.key}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
                  done
                    ? "border-[var(--hm-success-bg)] bg-[var(--hm-success-bg)]/40 font-semibold"
                    : "bg-card text-[var(--hm-ink-2)]",
                )}
              >
                {done ? (
                  <CheckCircle2
                    className="size-5 shrink-0 text-[var(--hm-success)]"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold text-muted-foreground"
                  >
                    {i + 1}
                  </span>
                )}
                <span className="min-w-0">
                  {m.label}
                  <span className="sr-only">{done ? " — הושלם" : " — עוד לא"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* להמשיך מאותה נקודה */}
      {next ? (
        <ResumeCard
          def={stepDef(next)}
          fact={stepFact(view, next)}
          canOpen={canOpen(stepDef(next))}
          resumed={view.state.current_step === next}
          onVisit={() => void onSave(next, "visit", true)}
        />
      ) : (
        <section
          aria-label="ההקמה הושלמה"
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--hm-success-bg)] bg-card p-5 shadow-[var(--hm-shadow-card)]"
        >
          <PartyPopper className="size-8 text-[var(--hm-champagne-600)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">כל צעדי ההקמה הושלמו</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {publishText(view, (iso) => formatDate(iso, ctx.business.timezone)).open}
            </p>
          </div>
        </section>
      )}

      {/* הצעדים לפי קבוצות */}
      {SETUP_GROUPS.map((g) => {
        const steps = SETUP_STEP_DEFS.filter((d) => d.group === g.key);
        const done = steps.filter((d) => view.steps[d.key].done).length;
        return (
          <SectionCard
            key={g.key}
            id={`setup-${g.key}`}
            title={g.title}
            description={g.description}
            actions={
              <StatusPill tone={done === steps.length ? "success" : "neutral"} dot={false}>
                {done} מתוך {steps.length}
              </StatusPill>
            }
          >
            <ol className="flex flex-col divide-y">
              {steps.map((d) => (
                <StepRow
                  key={d.key}
                  def={d}
                  view={view}
                  current={d.key === next}
                  canOpen={canOpen(d)}
                  busy={busy}
                  onSave={onSave}
                />
              ))}
            </ol>
            {g.key === "site" && <PublishPanel view={view} />}
          </SectionCard>
        );
      })}
    </>
  );
}

function ResumeCard({
  def,
  fact,
  canOpen,
  resumed,
  onVisit,
}: {
  def: SetupStepDef;
  fact: string;
  canOpen: boolean;
  resumed: boolean;
  onVisit: () => void;
}) {
  const group = SETUP_GROUPS.find((g) => g.key === def.group);
  return (
    <section
      aria-labelledby="setup-next-title"
      className="flex flex-col gap-3 rounded-2xl bg-[var(--hm-lagoon-900)] p-5 text-white shadow-[var(--hm-shadow-lift)] sm:flex-row sm:items-center sm:p-6"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[var(--hm-champagne-100)]">
          {resumed ? "ממשיכים מאיפה שעצרתם" : "הצעד הבא"} · {group?.title}
        </p>
        <h2 id="setup-next-title" className="mt-1 text-xl font-bold">
          {def.title}
        </h2>
        <p className="mt-1 text-sm text-white/85">{def.hint}</p>
        <p className="mt-1 text-[13px] text-white/85">{fact}</p>
      </div>
      {canOpen ? (
        <Link
          to={def.to}
          {...(def.search ? { search: def.search } : {})}
          {...(def.hash ? { hash: def.hash } : {})}
          onClick={onVisit}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--hm-champagne-100)] px-5 text-sm font-bold text-[var(--hm-lagoon-900)] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {def.cta}
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <p className="text-sm text-white/85">למסך הזה צריך הרשאה — בקשו מבעל העסק.</p>
      )}
    </section>
  );
}

function StepRow({
  def,
  view,
  current,
  canOpen,
  busy,
  onSave,
}: {
  def: SetupStepDef;
  view: SetupGuideView;
  current: boolean;
  canOpen: boolean;
  busy: string | null;
  onSave: (step: SetupStepKey, action: SetupAction, quiet?: boolean) => Promise<void>;
}) {
  const state = stepState(view, def.key);
  const done = state !== "todo";
  const s = view.steps[def.key] as { confirmed?: boolean; skipped?: boolean };
  const factId = `setup-fact-${def.key}`;
  const action = (a: SetupAction, label: string, variant: "outline" | "ghost" = "outline") => (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className="min-h-10"
      disabled={busy !== null}
      onClick={() => void onSave(def.key, a)}
    >
      {busy === `${def.key}:${a}` && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {label}
      <span className="sr-only"> — {def.title}</span>
    </Button>
  );
  return (
    <li
      data-setup-step={def.key}
      aria-current={current ? "step" : undefined}
      className={cn(
        "flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center",
        current && "rounded-xl bg-[var(--hm-lagoon-50)] px-3 first:pt-3.5 last:pb-3.5",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {state === "skipped" ? (
          <CircleDashed
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : done ? (
          <CheckCircle2
            className="mt-0.5 size-5 shrink-0 text-[var(--hm-success)]"
            aria-hidden="true"
          />
        ) : (
          <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
            {def.title}
            <StatusPill
              tone={state === "todo" ? "neutral" : state === "skipped" ? "neutral" : "success"}
              dot={false}
            >
              {STATE_LABEL[state]}
            </StatusPill>
            {def.kind === "optional" && state === "todo" && (
              <span className="text-xs font-normal text-muted-foreground">לא חובה</span>
            )}
            {current && <span className="sr-only">(הצעד הנוכחי)</span>}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{def.hint}</p>
          <p id={factId} className="mt-0.5 text-[13px] text-[var(--hm-ink-2)]">
            {stepFact(view, def.key)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 ps-8 sm:ps-0">
        {canOpen ? (
          <Link
            to={def.to}
            {...(def.search ? { search: def.search } : {})}
            {...(def.hash ? { hash: def.hash } : {})}
            onClick={() => void onSave(def.key, "visit", true)}
            aria-describedby={factId}
            className={cn(
              "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold",
              done
                ? "border hover:bg-[var(--hm-surface-2)]"
                : "bg-[var(--hm-lagoon-700)] text-white hover:bg-[var(--hm-lagoon-900)]",
            )}
          >
            {done ? "לעריכה" : def.cta}
            <span className="sr-only"> — {def.title}</span>
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            צריך הרשאה למסך
          </span>
        )}
        {def.kind === "review" &&
          (s.confirmed
            ? action("unconfirm", "ביטול האישור", "ghost")
            : state === "todo" && action("confirm", "בדקתי, מתאים לי"))}
        {def.kind === "optional" &&
          (s.skipped
            ? action("unskip", "ביטול הדילוג", "ghost")
            : state === "todo" && action("skip", "דילוג", "ghost"))}
      </div>
    </li>
  );
}

/** מצב הפרסום — "פורסם" רק כשיש גרסה מפורסמת; שינויים בטיוטה בנפרד; פתיחת האתר — של הפלטפורמה */
function PublishPanel({ view }: { view: SetupGuideView }) {
  const ctx = useManagement();
  const t = publishText(view, (iso) => formatDate(iso, ctx.business.timezone));
  return (
    <div
      data-publish-state={
        view.steps.publish.published
          ? view.steps.publish.unpublished
            ? "published-with-changes"
            : "published"
          : "draft"
      }
      className="mt-4 flex flex-col gap-2 rounded-xl border bg-[var(--hm-surface-2)] p-4 text-sm"
    >
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        <Globe className="size-4 text-[var(--hm-lagoon-700)]" aria-hidden="true" />
        {t.headline}
        <StatusPill tone={t.tone} dot={false}>
          {view.steps.publish.published ? "מפורסם" : "טיוטה"}
        </StatusPill>
      </p>
      {t.detail && <p className="text-muted-foreground">{t.detail}</p>}
      <p className="text-muted-foreground">{t.open}</p>
    </div>
  );
}
