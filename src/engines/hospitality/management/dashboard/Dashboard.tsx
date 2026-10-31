// לוח הבקרה — שלב 2a: רשימת ההקמה, מצב האתר, והחבילה (לבעלים). המספרים
// (הגעות, תפוסה, הכנסות) יתווספו בשלב 2k.
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Globe, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from "@/platform/ui";
import { CHECKLIST_STEPS, checklistProgress } from "../lib/checklist";
import { formatDate, usageText } from "../lib/format";
import { useManagement } from "../shell/management-context";

export function Dashboard() {
  const ctx = useManagement();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">שלום, {ctx.business.name}</h1>
        <p className="mt-1 text-muted-foreground">
          כאן מנהלים את העסק: יחידות, מחירים, הזמנות ואורחים.
        </p>
      </div>
      <SetupChecklist />
      <div className="grid gap-5 md:grid-cols-2">
        <SiteStatusCard />
        {ctx.permissions["billing.manage"] && <PlanCard />}
      </div>
    </div>
  );
}

function SetupChecklist() {
  const ctx = useManagement();
  const progress = checklistProgress(ctx.checklist);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>{progress.complete ? "העסק מוכן" : "הקמת העסק"}</h2>
        </CardTitle>
        <CardDescription>
          {progress.done} מתוך {progress.total} צעדים הושלמו
        </CardDescription>
        <Progress value={progress.percent} aria-label="התקדמות ההקמה" className="mt-2" />
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col divide-y">
          {CHECKLIST_STEPS.map((step) => {
            const done = ctx.checklist[step.key];
            return (
              <li key={step.key} className="flex items-start gap-3 py-3" data-step={step.key}>
                {done ? (
                  <CheckCircle2
                    className="mt-0.5 size-5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {step.title}
                    <span className="sr-only">{done ? " — הושלם" : " — עוד לא הושלם"}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{step.hint}</p>
                </div>
                {!done && step.to && (
                  <Link
                    to={step.to}
                    className="flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    להשלמה<span className="sr-only"> — {step.title}</span>
                  </Link>
                )}
                {!done && !step.to && (
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    המסך בקרוב
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function SiteStatusCard() {
  const ctx = useManagement();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>מצב האתר</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="flex items-center gap-2">
          {ctx.flags.frontend ? (
            <Globe className="size-4 text-primary" aria-hidden="true" />
          ) : (
            <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {ctx.flags.frontend ? "האתר הציבורי פתוח לאורחים" : "האתר הציבורי עדיין סגור לאורחים"}
        </p>
        <p className="text-muted-foreground">
          {ctx.flags.booking
            ? "קבלת הזמנות מהאתר פעילה."
            : "קבלת הזמנות מהאתר עדיין לא פעילה — אפשר להכין הכול מראש."}
        </p>
      </CardContent>
    </Card>
  );
}

function PlanCard() {
  const ctx = useManagement();
  const e = ctx.entitlements;
  const status =
    e.status === "trialing"
      ? `ניסיון עד ${formatDate(e.trial_ends_at, ctx.business.timezone)}`
      : e.active
        ? "פעיל"
        : "לא פעיל";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>החבילה שלי</h2>
        </CardTitle>
        <CardDescription>{e.plan_name}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">מצב</dt>
          <dd>{status}</dd>
          <dt className="text-muted-foreground">יחידות</dt>
          <dd>{usageText(e.units_used, e.max_units)}</dd>
          <dt className="text-muted-foreground">מנהלים</dt>
          <dd>{usageText(e.managers_used ?? 0, e.max_managers)}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
