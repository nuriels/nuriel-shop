// מסך צוות הניהול (/manage/team) — לבעלים בלבד. כל פעולה נבדקת שוב במסד
// (team_* — בעלים, מגבלת מקומות, כללי user_roles). אין מייל הזמנה בשלב הזה:
// אחרי ההוספה הבעלים משתף את הכתובת, והמנהל נכנס בקוד שנשלח למייל שלו.
// שלב F3: לכל מנהל — מתג "נתונים כספיים" (הכנסות וגבייה בלוח הבקרה). ברירת המחדל: כבוי;
// נאכף במסד (team_set_finance, can('reports.finance')).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Copy,
  FileSignature,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  WalletCards,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Switch,
  useIsMobile,
} from "@/platform/ui";
import {
  hospitalityAddManager,
  hospitalityRemoveManager,
  hospitalityTeam,
  hospitalityTeamActivity,
  hospitalityTeamSetBusinessAdmin,
  hospitalityTeamSetContracts,
  hospitalityTeamSetFinance,
} from "../../api/team.functions";
import type { TeamMember, TeamView } from "../../types/team";
import { managerEmailError, managerNameError } from "../../validation/team";
import { formatDateTime } from "../lib/format";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import { activityText, seatsText } from "./activity";

const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "הפעולה נכשלה — נסו שוב";

export function TeamPage() {
  const ctx = useManagement();
  // ניהול הצוות: הבעלים ומנהלי עסק (מיגרציה 188 — נאכף במסד); מינוי מנהלי עסק — הבעלים בלבד
  const canTeam = ctx.permissions["staff.managers"] === true;
  const isOwner = ctx.permissions["ownership"] === true;
  const team = useQuery({
    queryKey: manageKeys.team,
    queryFn: () => hospitalityTeam(),
    enabled: canTeam,
  });
  const activity = useQuery({
    queryKey: manageKeys.activity,
    queryFn: () => hospitalityTeamActivity(),
    enabled: canTeam,
  });

  if (!canTeam) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">צוות ניהול</h1>
        <p role="status" className="mt-3 rounded-md border p-4 text-muted-foreground">
          המסך הזה זמין לבעל העסק ולמנהלי עסק בלבד.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">צוות ניהול</h1>
        <p className="mt-1 text-muted-foreground">
          מי מנהל איתך את העסק. בעל העסק ומנהלי עסק רואים את המסך הזה.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          מנהלים רואים הזמנות, יומן ותפוסה. הכנסות וגבייה — רק למי שתפעילו לו &quot;נתונים
          כספיים&quot;. <strong>מנהל/ת עסק</strong> — כל ההרשאות של הבעלים, חוץ ממנוי, תשלום ובעלות;
          רק בעל העסק ממנה.
        </p>
      </div>
      {team.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
          {errorText(team.error)}
        </p>
      ) : !team.data ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
          <span className="sr-only">טוען את הצוות…</span>
        </div>
      ) : (
        <TeamContent
          team={team.data}
          isOwner={isOwner}
          siteUrl={typeof window === "undefined" ? "" : window.location.origin}
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <h2>פעילות אחרונה</h2>
          </CardTitle>
          <CardDescription>שינויים בצוות ובהגדרות העסק.</CardDescription>
        </CardHeader>
        <CardContent>
          {activity.isError ? (
            <p role="alert" className="text-destructive">
              {errorText(activity.error)}
            </p>
          ) : !activity.data ? (
            <Skeleton className="h-16 w-full" />
          ) : activity.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">עוד אין פעילות.</p>
          ) : (
            <ol className="flex flex-col divide-y" aria-label="פעילות אחרונה">
              {activity.data.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="flex flex-col gap-0.5 py-2.5">
                  <span className="text-sm">{activityText(entry)}</span>
                  <time className="text-xs text-muted-foreground" dateTime={entry.at}>
                    {formatDateTime(entry.at, ctx.business.timezone)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TeamContent({
  team,
  siteUrl,
  isOwner,
}: {
  team: TeamView;
  siteUrl: string;
  isOwner: boolean;
}) {
  const ctx = useManagement();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const seats = seatsText(team.seats);
  const canAdd = team.seats.active && !seats.full;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: manageKeys.team });
    void queryClient.invalidateQueries({ queryKey: manageKeys.activity });
    void queryClient.invalidateQueries({ queryKey: manageKeys.context });
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await hospitalityRemoveManager({ data: { userId: removing.user_id } });
      toast.success(`${removing.display_name || removing.email} הוסר/ה מהצוות`);
      setRemoving(null);
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <h2>מקומות בצוות</h2>
          </CardTitle>
          <CardDescription>{seats.text} (בעל העסק נספר כמקום אחד)</CardDescription>
          {team.seats.limit !== null && (
            <Progress
              value={Math.min(100, Math.round((team.seats.used / team.seats.limit) * 100))}
              aria-label="מקומות בשימוש"
              className="mt-2"
            />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!team.seats.active && (
            <p role="status" className="text-sm text-destructive">
              המנוי של העסק אינו פעיל — אי אפשר להוסיף מנהלים.
            </p>
          )}
          {team.seats.active && seats.full && (
            <p role="status" className="text-sm text-muted-foreground">
              הגעתם למגבלת המנהלים בחבילה. אפשר להסיר מנהל, או לבקש מנוריאל מקומות נוספים.
            </p>
          )}
          <Button
            className="min-h-11 w-full gap-2 sm:w-fit"
            disabled={!canAdd}
            onClick={() => setAdding(true)}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            הוספת מנהל
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <h2>הצוות</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y" aria-label="חברי הצוות">
            {team.members.map((m) => (
              <li
                key={m.user_id}
                className="flex flex-wrap items-center gap-3 py-3"
                data-member={m.email}
              >
                {/* בסיס 14rem: בטלפון הגישה לנתונים הכספיים וההסרה יורדות לשורה משלהן */}
                <div className="min-w-0 flex-[1_1_14rem]">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{m.display_name || m.email}</span>
                    {m.role === "owner" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        <ShieldCheck className="size-3" aria-hidden="true" />
                        בעלים
                      </span>
                    ) : m.business_admin ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        <Sparkles className="size-3" aria-hidden="true" />
                        מנהל/ת עסק
                      </span>
                    ) : (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                        מנהל/ת
                      </span>
                    )}
                    {m.is_blocked && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                        חסום/ה
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted-foreground" dir="ltr">
                    {m.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.last_sign_in_at
                      ? `כניסה אחרונה: ${formatDateTime(m.last_sign_in_at, ctx.business.timezone)}`
                      : "עוד לא נכנס/ה"}
                  </p>
                </div>
                {isOwner && <BusinessAdminAccess member={m} onChanged={refresh} />}
                <FinanceAccess member={m} onChanged={refresh} />
                <ContractsAccess member={m} onChanged={refresh} />
                {/* מנהל/ת עסק מסיר/ה רק מנהלים רגילים; מנהל/ת עסק — רק הבעלים */}
                {m.role !== "owner" && (isOwner || !m.business_admin) && (
                  <Button
                    variant="outline"
                    className="min-h-11 gap-2"
                    onClick={() => setRemoving(m)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    הסרה<span className="sr-only"> של {m.display_name || m.email} מהצוות</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <AddManagerSheet open={adding} onOpenChange={setAdding} siteUrl={siteUrl} onAdded={refresh} />

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              להסיר את {removing?.display_name || removing?.email} מהצוות?
            </AlertDialogTitle>
            <AlertDialogDescription>
              הגישה לניהול העסק תיחסם מיד. החשבון עצמו לא נמחק, ואפשר להוסיף אותו שוב בהמשך.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              הסרה מהצוות
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** מיגרציה 188: מנהל/ת עסק — הבעלים בלבד רואה את המתג; כבוי כברירת מחדל */
function BusinessAdminAccess({ member, onChanged }: { member: TeamMember; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  if (member.role === "owner") return null;
  const id = `business-admin-${member.user_id}`;
  const name = member.display_name || member.email;
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await hospitalityTeamSetBusinessAdmin({ data: { userId: member.user_id, enabled } });
      toast.success(
        enabled
          ? `${name} מנהל/ת עסק מעכשיו — כל ההרשאות חוץ ממנוי ותשלום`
          : `${name} חזר/ה להיות מנהל/ת רגיל/ה`,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <div
      className="flex min-h-11 items-center gap-2 rounded-lg border px-3"
      data-business-admin={member.email}
    >
      <Switch
        id={id}
        checked={member.business_admin === true}
        disabled={busy || member.is_blocked}
        onCheckedChange={(v) => void toggle(v)}
      />
      <Label htmlFor={id} className="text-sm">
        מנהל/ת עסק
        <span className="sr-only"> — כל ההרשאות חוץ ממנוי, תשלום ובעלות, ל{name}</span>
      </Label>
    </div>
  );
}

/** נתונים כספיים (הכנסות וגבייה בלוח הבקרה): לבעלים — תמיד; למנהל — מתג, כבוי כברירת מחדל */
function FinanceAccess({ member, onChanged }: { member: TeamMember; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const id = `finance-${member.user_id}`;
  const name = member.display_name || member.email;
  if (member.role === "owner" || member.business_admin)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--hm-champagne-100)] px-2.5 py-1 text-xs font-semibold text-[var(--hm-champagne-700)]">
        <WalletCards className="size-3.5" aria-hidden="true" />
        נתונים כספיים — תמיד
      </span>
    );
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await hospitalityTeamSetFinance({ data: { userId: member.user_id, enabled } });
      toast.success(
        enabled
          ? `${name} יראה/תראה מעכשיו הכנסות וגבייה`
          : `${name} כבר לא יראה/תראה הכנסות וגבייה`,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <div
      className="flex min-h-11 items-center gap-2 rounded-lg border px-3"
      data-finance={member.email}
    >
      <Switch
        id={id}
        checked={member.finance === true}
        disabled={busy || member.is_blocked}
        onCheckedChange={(v) => void toggle(v)}
      />
      <Label htmlFor={id} className="text-sm">
        נתונים כספיים
        <span className="sr-only"> — הכנסות וגבייה בלוח הבקרה, ל{name}</span>
      </Label>
    </div>
  );
}

/** מסמכי לקוחות (חוזים לחתימה, הארכיון וה-PDF החתומים): לבעלים — תמיד; למנהל — מתג, כבוי כברירת מחדל */
function ContractsAccess({ member, onChanged }: { member: TeamMember; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const id = `contracts-${member.user_id}`;
  const name = member.display_name || member.email;
  if (member.role === "owner" || member.business_admin)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--hm-champagne-100)] px-2.5 py-1 text-xs font-semibold text-[var(--hm-champagne-700)]">
        <FileSignature className="size-3.5" aria-hidden="true" />
        מסמכי לקוחות — תמיד
      </span>
    );
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await hospitalityTeamSetContracts({ data: { userId: member.user_id, enabled } });
      toast.success(
        enabled
          ? `${name} יוכל/תוכל מעכשיו לשלוח חוזים ולראות את הארכיון`
          : `${name} כבר לא יראה/תראה את מסמכי הלקוחות`,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <div
      className="flex min-h-11 items-center gap-2 rounded-lg border px-3"
      data-contracts={member.email}
    >
      <Switch
        id={id}
        checked={member.contracts === true}
        disabled={busy || member.is_blocked}
        onCheckedChange={(v) => void toggle(v)}
      />
      <Label htmlFor={id} className="text-sm">
        מסמכי לקוחות
        <span className="sr-only"> — חוזים לחתימה, הארכיון והקבצים החתומים, ל{name}</span>
      </Label>
    </div>
  );
}

function AddManagerSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteUrl: string;
  onAdded: () => void;
}) {
  const isMobile = useIsMobile();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ who: string; already: boolean } | null>(null);
  const emailError = touched ? managerEmailError(email) : null;
  const nameError = managerNameError(name);
  const manageUrl = `${props.siteUrl}/manage`;
  const shareText = `הוספתי אותך לניהול העסק. נכנסים בכתובת ${manageUrl} — בוחרים "קוד למייל" ומקלידים את כתובת המייל שלך.`;

  const reset = () => {
    setEmail("");
    setName("");
    setTouched(false);
    setError(null);
    setAdded(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (managerEmailError(email) || nameError) return;
    setBusy(true);
    setError(null);
    try {
      const result = await hospitalityAddManager({ data: { email, displayName: name } });
      setAdded({
        who: name.trim() || email.trim().toLowerCase(),
        already: result.status === "already_member",
      });
      props.onAdded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(manageUrl);
      toast.success("הכתובת הועתקה");
    } catch {
      toast.error("ההעתקה נכשלה — אפשר לסמן את הכתובת ולהעתיק ידנית");
    }
  };

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) reset();
        props.onOpenChange(open);
      }}
    >
      <SheetContent side={isMobile ? "bottom" : "left"} className="max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="ps-10 text-start sm:text-start">
          <SheetTitle>{added ? "המנהל נוסף" : "הוספת מנהל"}</SheetTitle>
          <SheetDescription>
            {added
              ? "לא נשלח מייל הזמנה — שתפו את הכתובת עם המנהל."
              : "המנהל ייכנס עם קוד שיישלח למייל שלו, בלי סיסמה."}
          </SheetDescription>
        </SheetHeader>
        {added ? (
          <div className="mt-4 flex flex-col gap-4">
            <p role="status">
              {added.already ? `${added.who} כבר בצוות.` : `${added.who} נוסף/ה לצוות הניהול.`}
            </p>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p>איך נכנסים:</p>
              <ol className="ms-5 mt-1 list-decimal">
                <li>
                  פותחים את <span dir="ltr">{manageUrl}</span>
                </li>
                <li>בוחרים "קוד למייל" ומקלידים את כתובת המייל</li>
                <li>מקלידים את הקוד שמגיע למייל</li>
              </ol>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 gap-2"
                onClick={() => void copy()}
              >
                <Copy className="size-4" aria-hidden="true" />
                העתקת הכתובת
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-muted"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                שליחה ב-WhatsApp
              </a>
              <Button type="button" className="min-h-11" onClick={() => props.onOpenChange(false)}>
                סיום
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-manager-email">אימייל של המנהל</Label>
              <Input
                id="add-manager-email"
                type="email"
                inputMode="email"
                dir="ltr"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "add-manager-email-error" : undefined}
                className="min-h-11 text-start"
              />
              {emailError && (
                <p id="add-manager-email-error" className="text-sm text-destructive">
                  {emailError}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-manager-name">שם (לא חובה)</Label>
              <Input
                id="add-manager-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "add-manager-name-error" : undefined}
                className="min-h-11"
              />
              {nameError && (
                <p id="add-manager-name-error" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <Button type="submit" className="min-h-11 gap-2" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              הוספה לצוות
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
