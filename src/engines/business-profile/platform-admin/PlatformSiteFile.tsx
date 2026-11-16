// "תיק האתר" בפאנל הפלטפורמה (Nuriel Websites, /platform/websites/<id>, בכתובת הפאנל בלבד — מיגרציה 197):
// כתובת האתר, מצב, תבנית, דומיין, תאריכי עדכון ופרסום, הבעלים; כניסה לניהול / תצוגה מקדימה / עריכת תוכן דרך
// קוד כניסה חד-פעמי של מנהל הפלטפורמה (בלי החשבון או הסיסמה של בעל העסק — נרשם ביומן); בדיקת בקשת הפרסום
// (אישור / החזרה לתיקונים); ויומן הפעולות המשולב — מי עשה מה ומתי, ומנהל הפלטפורמה מסומן.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createAdminHandoff } from "@/platform/auth/admin-handoff";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/platform/ui";
import { websitesPlatformSiteFile } from "../api/platform-admin.functions";
import { OwnerInviteCard } from "./OwnerInviteCard";
import { formatDate, StatusBadge } from "../studio/status";
import type { PlatformSiteFile as SiteFile } from "../types";
import { ReviewSheet } from "./PlatformWebsitesPage";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "הפעולה נכשלה");

const DOC_PARTS: Record<string, string> = {
  business: "פרטי העסק",
  theme: "עיצוב (צבעים, גופנים)",
  pages: "מקטעים ותוכן",
  collections: "שירותים / תיק עבודות / המלצות",
  accessibility: "הצהרת נגישות",
  template: "תבנית",
};

const DOMAIN_STATUS: Record<string, string> = {
  pending: "ממתין לבדיקת חיבור",
  verified: "אומת — ממתין ל-SSL",
  active: "פעיל עם SSL",
  error: "החיבור לא הושלם",
};

const INVITE_FAIL: Record<string, string> = {
  unknown: "קישור לא מוכר",
  malformed: "קישור לא תקין",
  wrong_site: "קישור של אתר אחר",
  expired: "פג תוקף",
  revoked: "בוטל",
  used: "כבר נוצל",
  owner_exists: "לאתר כבר יש בעלים",
  email_exists: "המייל כבר רשום",
  account_has_roles: "חשבון קיים עם שיוך",
  platform_admin_account: "חשבון מנהל פלטפורמה",
  no_account: "אין חשבון",
};

/** תיאור קצר של פעולה ביומן (בלי תוכן אישי — כך היא נרשמת) */
export function auditLabel(action: string, d: Record<string, string>): string {
  const parts = () => {
    try {
      const list = JSON.parse(d["changed"] ?? "[]") as string[];
      return list.length ? `: ${list.map((k) => DOC_PARTS[k] ?? k).join(", ")}` : "";
    } catch {
      return "";
    }
  };
  switch (action) {
    case "draft.saved":
      return `שמירת טיוטה (גרסת עבודה ${d["revision"] ?? ""})${parts()}`;
    case "site.opened":
    case "bp_site_opened":
      return "פתיחת האתר";
    case "admin_entered_store":
      return "כניסה לניהול האתר מפאנל הפלטפורמה";
    case "site.address_changed":
    case "bp_site_address_changed":
      return `שינוי כתובת: ${d["from"] ?? ""} ← ${d["to"] ?? ""}`;
    case "site.custom_domain_set":
      return `חיבור דומיין אישי: ${d["domain"] ?? ""}`;
    case "site.custom_domain_removed":
      return `הסרת הדומיין האישי ${d["domain"] ?? ""}`;
    case "site.custom_domain_checked":
      return `בדיקת דומיין ${d["domain"] ?? ""}: ${d["ok"] === "true" ? "תקין" : "לא הושלם"}`;
    case "media.added":
      return "העלאת תמונה";
    case "media.deleted":
      return "מחיקת תמונה";
    case "media.font_added":
      return "הוספת גופן";
    case "publish.requested":
    case "bp_publish_requested":
      return "בקשת פרסום ראשון";
    case "publish.request_cancelled":
      return "ביטול בקשת הפרסום";
    case "publish.approved":
    case "bp_publish_approved":
      return "אישור פרסום";
    case "publish.rejected":
    case "bp_publish_rejected":
      return "הבקשה הוחזרה לתיקונים";
    case "publish.published":
      return `פרסום גרסה ${d["version"] ?? ""}`;
    case "versions.restored":
      return "שחזור גרסה לטיוטה";
    case "site.owner_set":
    case "bp_owner_set":
      return d["via"] === "invite" ? "שיוך בעלת האתר (דרך הזמנה)" : "שיוך בעל העסק";
    case "owner_invite.created":
    case "bp_owner_invite_created":
      return "יצירת קישור הזמנה לבעלת האתר";
    case "owner_invite.revoked":
    case "bp_owner_invite_revoked":
      return d["reason"] === "replaced" ? "קישור ההזמנה הוחלף בחדש" : "ביטול קישור ההזמנה";
    case "owner_invite.redeemed":
    case "bp_owner_invite_redeemed":
      return "פתיחת חשבון דרך קישור ההזמנה";
    case "owner_invite.failed":
    case "bp_owner_invite_failed":
      return `ניסיון שימוש בקישור ההזמנה שנדחה (${INVITE_FAIL[d["reason"] ?? ""] ?? d["reason"] ?? ""})`;
    case "owner.email_verified":
    case "bp_owner_email_verified":
      return "אימות כתובת המייל של בעלת האתר";
    case "site.public_set":
    case "bp_public_set":
      return d["enabled"] === "true" ? "האתר הוחזר לאוויר" : "האתר הוסתר";
    default:
      return action.startsWith("inquiry.") ? "פעולה בפניות מלקוחות" : action;
  }
}

export function PlatformSiteFile({ tenantId }: { tenantId: string }) {
  const load = useServerFn(websitesPlatformSiteFile);
  const q = useQuery({
    queryKey: ["bp", "site-file", tenantId],
    queryFn: () => load({ data: { tenantId } }),
    retry: false,
  });
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto max-w-6xl space-y-6 px-4 py-6 outline-none"
      dir="rtl"
    >
      <nav aria-label="פירורי לחם" className="text-sm">
        <Link
          to="/platform/websites"
          className="text-muted-foreground underline underline-offset-4"
        >
          אתרי אינטרנט
        </Link>{" "}
        › תיק האתר
      </nav>
      {q.isPending ? (
        <p role="status">טוען…</p>
      ) : q.isError ? (
        <p role="alert" className="text-destructive">
          {errorText(q.error)}
        </p>
      ) : !q.data ? (
        <p role="alert">האתר לא נמצא.</p>
      ) : (
        <FileView file={q.data} onChanged={() => void q.refetch()} />
      )}
    </main>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm font-medium">{children}</dd>
    </div>
  );
}

function FileView({ file, onChanged }: { file: SiteFile; onChanged: () => void }) {
  const [entering, setEntering] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const a = file.address;
  const enter = async (then: "studio" | "preview" | "editor" | "settings") => {
    setEntering(then);
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await createAdminHandoff({ data: { tenantId: file.id } });
      const target = then === "studio" ? url : `${url}&then=${then}`;
      if (tab) {
        tab.opener = null;
        tab.location.href = target;
      } else window.location.assign(target);
    } catch (e) {
      tab?.close();
      toast.error(errorText(e));
    } finally {
      setEntering(null);
    }
  };
  const live = file.state.status === "live" && file.state.public_enabled;
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{file.name}</h1>
          <p className="text-sm text-muted-foreground">
            תיק האתר · נפתח {formatDate(file.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge state={file.state} />
          {file.status === "suspended" && <Badge variant="destructive">מושעה</Badge>}
          {!file.state.public_enabled && file.state.approved && (
            <Badge variant="secondary">מוסתר מהציבור</Badge>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">פעולות</CardTitle>
          <CardDescription>
            הכניסה היא בהרשאות מנהל הפלטפורמה — בלי החשבון או הסיסמה של בעל העסק. קוד הכניסה חד-פעמי
            (2 דקות), צמוד לאתר הזה בלבד, וכל כניסה ופעולת עריכה נרשמות ביומן למטה.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => void enter("studio")} disabled={entering !== null}>
            כניסה לניהול האתר
          </Button>
          <Button
            variant="outline"
            onClick={() => void enter("preview")}
            disabled={entering !== null}
          >
            תצוגה מקדימה
          </Button>
          <Button
            variant="outline"
            onClick={() => void enter("editor")}
            disabled={entering !== null}
          >
            עריכת תוכן
          </Button>
          <Button
            variant="ghost"
            onClick={() => void enter("settings")}
            disabled={entering !== null}
          >
            כתובת ודומיין
          </Button>
          {file.state.status === "pending_review" && (
            <Button variant="secondary" onClick={() => setReviewing(true)}>
              בדיקת בקשת הפרסום (אישור / החזרה לתיקונים)
            </Button>
          )}
          {live && file.publicOrigin && (
            <a
              className="self-center text-sm underline underline-offset-4"
              href={file.publicOrigin}
              target="_blank"
              rel="noopener noreferrer"
            >
              לאתר הציבורי
            </a>
          )}
        </CardContent>
      </Card>

      <OwnerInviteCard tenantId={file.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">פרטי האתר</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="כתובת האתר">
              <span dir="ltr">{(file.publicOrigin ?? "").replace(/^https?:\/\//, "") || "—"}</span>
            </Detail>
            <Detail label="כתובת בפלטפורמה (והניהול)">
              <span dir="ltr">{(file.slugOrigin ?? "").replace(/^https?:\/\//, "")}</span>
            </Detail>
            <Detail label="דומיין אישי">
              {a.custom_domain ? (
                <>
                  <span dir="ltr">{a.custom_domain}</span>{" "}
                  <span className="font-normal text-muted-foreground">
                    ({a.custom_domain_status ? DOMAIN_STATUS[a.custom_domain_status] : "—"})
                  </span>
                </>
              ) : (
                "אין — כתובת של Nuriel"
              )}
            </Detail>
            <Detail label="סטטוס האתר">{file.status === "active" ? "פעיל" : "מושעה"}</Detail>
            <Detail label="סטטוס פרסום">
              {file.state.status === "live"
                ? `גרסה ${file.state.live_version} באוויר (${formatDate(file.state.live_published_at)})`
                : file.state.status === "pending_review"
                  ? `ממתין לאישור (${formatDate(file.state.pending?.requested_at)})`
                  : "טיוטה — לא פורסם"}
            </Detail>
            <Detail label="תבנית">{file.draft?.template ?? "—"}</Detail>
            <Detail label="עדכון אחרון של הטיוטה">
              {file.draft
                ? `${formatDate(file.draft.updated_at)}${file.draft.updated_by ? ` · ${file.draft.updated_by}` : ""}`
                : "—"}
            </Detail>
            <Detail label="בעל העסק">
              {file.owner ? <span dir="ltr">{file.owner.email}</span> : "עוד לא שויך"}
            </Detail>
            <Detail label="תמונות וגופנים בספרייה">
              {file.media.count} קבצים · {(file.media.bytes / 1048576).toFixed(1)}MB
            </Detail>
            {a.old_slugs.length > 0 && (
              <Detail label="כתובות קודמות (מפנות)">
                {a.old_slugs.map((o) => (
                  <span key={o.name} dir="ltr" className="block">
                    {o.name}
                  </span>
                ))}
              </Detail>
            )}
          </dl>
          <p className="mt-4 text-sm">
            <Link
              to="/platform/customers/$tenantId"
              params={{ tenantId: file.id }}
              className="underline underline-offset-4"
            >
              תיק הלקוח המלא (הסכמים, מסמכים, מיילים, מנוי)
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">יומן פעולות</CardTitle>
          <CardDescription>
            80 הפעולות האחרונות באתר ובפאנל: מי, מה ומתי. פעולות של מנהל הפלטפורמה מסומנות.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm" data-testid="bp-site-audit">
              <caption className="sr-only">יומן הפעולות של האתר</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-2 text-start font-medium">
                    מתי
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    מי
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    פעולה
                  </th>
                </tr>
              </thead>
              <tbody>
                {file.audit.map((e, i) => (
                  <tr key={`${e.at}-${i}`} className="border-b last:border-0">
                    <td className="py-2 whitespace-nowrap tabular-nums">{formatDate(e.at)}</td>
                    <td className="py-2">
                      <span dir="ltr">{e.actor ?? "המערכת"}</span>
                      {e.platform_admin && (
                        <Badge variant="outline" className="ms-2">
                          מנהל פלטפורמה
                        </Badge>
                      )}
                    </td>
                    <td className="py-2">{auditLabel(e.action, e.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ReviewSheet
        site={reviewing ? { id: file.id, name: file.name } : null}
        onClose={() => {
          setReviewing(false);
          onChanged();
        }}
      />
    </>
  );
}
