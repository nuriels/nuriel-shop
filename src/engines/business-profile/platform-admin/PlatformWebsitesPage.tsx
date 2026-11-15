// "אתרי אינטרנט" בפאנל הפלטפורמה (Nuriel Websites, /platform/websites, בכתובת הפאנל בלבד):
// פתיחת אתר עסק (שם, כתובת, תבנית, אימייל הבעלים), רשימת האתרים ומצב הפרסום, בדיקת בקשת הפרסום הראשון
// (תצוגה מקדימה של הצילום שנשלח — מחשב / נייד) ואישור או החזרה לתיקון, הסתרת האתר הציבורי, וכניסה לממשק
// הניהול של האתר. בלי חיובים, בלי דומיינים ובלי DNS. ההרשאה (מנהל הפלטפורמה) — במסד.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@/platform/ui";
import { pageBySlug } from "../document/normalize";
import {
  websitesPlatformApprove,
  websitesPlatformOpenSite,
  websitesPlatformReject,
  websitesPlatformReview,
  websitesPlatformSetOwner,
  websitesPlatformSetPublic,
  websitesPlatformSites,
} from "../api/platform-admin.functions";
import { SiteView } from "../site/SiteView";
import { formatDate, StatusBadge } from "../studio/status";
import { AVAILABLE_TEMPLATES } from "../templates/registry";
import type { PlatformSiteRow } from "../types";

const LIST = ["bp", "platform-sites"] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "הפעולה נכשלה");

export function PlatformWebsitesPage() {
  const load = useServerFn(websitesPlatformSites);
  const q = useQuery({ queryKey: LIST, queryFn: () => load() });
  const [reviewing, setReviewing] = useState<PlatformSiteRow | null>(null);
  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">אתרי אינטרנט (Nuriel Websites)</h1>
        <p className="mt-1 text-muted-foreground">
          דפי נחיתה ואתרי תדמית לעסקים. הפרסום הראשון של כל אתר — רק אחרי בדיקה ואישור כאן; אחר כך
          בעל העסק מפרסם עדכונים בעצמו.
        </p>
      </div>
      <OpenSiteCard baseDomain={q.data?.baseDomain ?? null} />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">האתרים</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isPending ? (
            <p className="text-sm text-muted-foreground">טוען…</p>
          ) : q.isError ? (
            <p className="text-sm text-destructive">{errorText(q.error)}</p>
          ) : !q.data.sites.length ? (
            <p className="text-sm text-muted-foreground">עוד לא נפתחו אתרים.</p>
          ) : (
            <ul className="divide-y" data-testid="bp-platform-sites">
              {q.data.sites.map((s) => (
                <SiteRow key={s.id} site={s} onReview={() => setReviewing(s)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <ReviewSheet site={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}

function OpenSiteCard({ baseDomain }: { baseDomain: string | null }) {
  const qc = useQueryClient();
  const open = useServerFn(websitesPlatformOpenSite);
  const [form, setForm] = useState({ name: "", slug: "", ownerEmail: "", template: "elegant" });
  const m = useMutation({
    mutationFn: () => open({ data: form }),
    onSuccess: async (r) => {
      setForm({ name: "", slug: "", ownerEmail: "", template: "elegant" });
      if (r.owner && r.owner.status === "failed")
        toast.warning(`האתר נפתח, אבל שיוך הבעלים נכשל: ${r.owner.message}`);
      else toast.success(`האתר "${r.name}" נפתח כטיוטה`);
      await qc.invalidateQueries({ queryKey: LIST });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">פתיחת אתר חדש</CardTitle>
        <CardDescription>
          האתר נפתח כטיוטה, לא מפורסם ובלי חיוב. הבעלים נכנס בקוד למייל ובונה את האתר.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="bp-open-name">שם העסק</Label>
            <Input
              id="bp-open-name"
              required
              maxLength={120}
              value={form.name}
              onChange={set("name")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-open-slug">כתובת באתר</Label>
            <div className="flex items-center gap-1" dir="ltr">
              <Input
                id="bp-open-slug"
                required
                pattern="[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]"
                value={form.slug}
                onChange={set("slug")}
                aria-describedby="bp-open-slug-hint"
              />
              {baseDomain && <span className="text-sm text-muted-foreground">.{baseDomain}</span>}
            </div>
            <p id="bp-open-slug-hint" className="text-xs text-muted-foreground">
              אותיות באנגלית, ספרות ומקפים
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-open-owner">אימייל בעל העסק (לא חובה)</Label>
            <Input
              id="bp-open-owner"
              type="email"
              dir="ltr"
              value={form.ownerEmail}
              onChange={set("ownerEmail")}
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">תבנית</legend>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_TEMPLATES.map((t) => (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="bp-template"
                    value={t.key}
                    checked={form.template === t.key}
                    onChange={set("template")}
                  />
                  {t.label.he}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="md:col-span-2">
            <Button type="submit" disabled={m.isPending}>
              {m.isPending ? "פותח…" : "פתיחת האתר"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SiteRow({ site, onReview }: { site: PlatformSiteRow; onReview: () => void }) {
  const qc = useQueryClient();
  const setOwner = useServerFn(websitesPlatformSetOwner);
  const setPublic = useServerFn(websitesPlatformSetPublic);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [entering, setEntering] = useState(false);
  const ownerM = useMutation({
    mutationFn: () => setOwner({ data: { tenantId: site.id, email: ownerEmail } }),
    onSuccess: async (r) => {
      if (r.status === "failed") toast.error(r.message);
      else toast.success("בעל העסק שויך לאתר");
      await qc.invalidateQueries({ queryKey: LIST });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const publicM = useMutation({
    mutationFn: (enabled: boolean) => setPublic({ data: { tenantId: site.id, enabled } }),
    onSuccess: async () => {
      toast.success("עודכן");
      await qc.invalidateQueries({ queryKey: LIST });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const enter = async () => {
    setEntering(true);
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await createAdminHandoff({ data: { tenantId: site.id } });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast.error(errorText(e));
    } finally {
      setEntering(false);
    }
  };
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">
            {site.name}{" "}
            <span className="text-sm font-normal text-muted-foreground" dir="ltr">
              {site.slug}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            {site.template ? `תבנית: ${site.template}` : ""} · נפתח {formatDate(site.created_at)}
            {site.state.live_version ? ` · גרסה ${site.state.live_version} באוויר` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge state={site.state} />
          {site.state.status === "pending_review" && (
            <Button size="sm" onClick={onReview}>
              בדיקת בקשת הפרסום
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void enter()} disabled={entering}>
            כניסה לניהול האתר
          </Button>
          {site.state.approved && (
            <Button
              size="sm"
              variant="ghost"
              disabled={publicM.isPending}
              onClick={() => publicM.mutate(!site.state.public_enabled)}
            >
              {site.state.public_enabled ? "הסתרת האתר" : "החזרת האתר לאוויר"}
            </Button>
          )}
          {site.url && site.state.status === "live" && site.state.public_enabled && (
            <a
              className="text-sm underline underline-offset-4"
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              לאתר
            </a>
          )}
        </div>
      </div>
      {!site.has_owner && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ownerM.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`owner-${site.id}`} className="text-xs">
              אין בעלים — אימייל בעל העסק
            </Label>
            <Input
              id={`owner-${site.id}`}
              type="email"
              dir="ltr"
              required
              value={ownerEmail}
              placeholder={site.owner_email ?? ""}
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
          </div>
          <Button size="sm" type="submit" disabled={ownerM.isPending}>
            שיוך
          </Button>
        </form>
      )}
    </li>
  );
}

function ReviewSheet({ site, onClose }: { site: PlatformSiteRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const review = useServerFn(websitesPlatformReview);
  const approve = useServerFn(websitesPlatformApprove);
  const reject = useServerFn(websitesPlatformReject);
  const [note, setNote] = useState("");
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const q = useQuery({
    queryKey: ["bp", "review", site?.id],
    queryFn: () => review({ data: { tenantId: site!.id } }),
    enabled: Boolean(site),
  });
  const done = async (message: string) => {
    toast.success(message);
    setNote("");
    onClose();
    await qc.invalidateQueries({ queryKey: LIST });
  };
  const approveM = useMutation({
    mutationFn: () => approve({ data: { tenantId: site!.id, versionId: q.data!.id } }),
    onSuccess: (r) => done(`אושר: גרסה ${r.version} באוויר`),
    onError: (e) => toast.error(errorText(e)),
  });
  const rejectM = useMutation({
    mutationFn: () => reject({ data: { tenantId: site!.id, versionId: q.data!.id, note } }),
    onSuccess: () => done("הבקשה הוחזרה לבעל העסק עם ההערה"),
    onError: (e) => toast.error(errorText(e)),
  });
  const page = q.data ? pageBySlug(q.data.document, "") : null;
  return (
    <Sheet open={Boolean(site)} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-5xl" dir="rtl">
        <SheetHeader>
          <SheetTitle>בדיקת בקשת פרסום — {site?.name}</SheetTitle>
          <SheetDescription>
            זה בדיוק מה שבעל העסק שלח {q.data ? `(${formatDate(q.data.requestedAt)})` : ""}. שינויים
            שנעשו בטיוטה אחרי השליחה לא מופיעים כאן.
          </SheetDescription>
        </SheetHeader>
        {q.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">טוען…</p>
        ) : !q.data ? (
          <p className="p-4 text-sm text-muted-foreground">אין בקשה פתוחה.</p>
        ) : (
          <div className="space-y-4 p-4">
            {q.data.note && (
              <p className="rounded-md bg-muted p-3 text-sm">
                הערת בעל העסק: <span className="whitespace-pre-line">{q.data.note}</span>
              </p>
            )}
            <div role="group" aria-label="גודל התצוגה" className="flex gap-1">
              <Button
                size="sm"
                variant={width === "desktop" ? "default" : "outline"}
                aria-pressed={width === "desktop"}
                onClick={() => setWidth("desktop")}
              >
                מחשב
              </Button>
              <Button
                size="sm"
                variant={width === "mobile" ? "default" : "outline"}
                aria-pressed={width === "mobile"}
                onClick={() => setWidth("mobile")}
              >
                נייד
              </Button>
              <Badge variant="secondary" className="ms-2">
                תצוגה בלבד
              </Badge>
            </div>
            <div
              className="mx-auto overflow-hidden rounded-lg border"
              style={{ maxWidth: width === "mobile" ? 390 : "100%" }}
            >
              {page && (
                <SiteView doc={q.data.document} media={{}} page={page} mode="preview" embedded />
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t pt-4">
              <Button
                onClick={() => approveM.mutate()}
                disabled={approveM.isPending || rejectM.isPending}
              >
                אישור ופרסום
              </Button>
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor="bp-reject-note">מה צריך לתקן (להחזרה לבעל העסק)</Label>
                <Textarea
                  id="bp-reject-note"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                onClick={() => rejectM.mutate()}
                disabled={!note.trim() || rejectM.isPending}
              >
                החזרה לתיקון
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
