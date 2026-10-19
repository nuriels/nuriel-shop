import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Download,
  FilePlus2,
  Loader2,
  Mail,
  PenLine,
  RefreshCw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { platformBillingHistory } from "@/lib/billing.functions";
import {
  getGrowSettings,
  saveGrowSettings,
  testGrowConnection,
  type GrowSettings,
} from "@/lib/platform-grow.functions";
import {
  MAX_DOC_BYTES,
  PLATFORM_DOCS_BUCKET,
  archiveDocument,
  createDocumentUpload,
  getDocumentUrl,
  loadCustomerFile,
  publishAgreementVersion,
  registerDocument,
  sendOwnerAgreement,
  type CustomerFileData,
  type DocKind,
} from "@/lib/platform-files.functions";
import {
  BILLING_METHOD_LABELS,
  PLAN_LABELS,
  STATUS_LABELS,
  type BillingEntry,
  type SubscriptionState,
} from "@/lib/subscription";

const ACCEPTANCE_STATUS: Record<string, string> = {
  pending: "ממתין לחתימה",
  signed: "נחתם",
  superseded: "הוחלף בקישור חדש",
  expired: "פג תוקף",
};

const EMAIL_STATUS: Record<string, string> = {
  sent: "נמסר לספק השליחה",
  failed: "נכשל",
  skipped: "לא נשלח",
};

const DOC_KIND_LABELS: Record<string, string> = {
  invoice: "חשבונית",
  receipt: "קבלה",
  agreement: "הסכם",
  other: "אחר",
};

const EMAIL_KIND_LABELS: Record<string, string> = {
  agreement: "הסכם שירות",
  support_reply: "מענה תמיכה",
  addon: "תוסף",
  admin_seats: "מנהלים נוספים",
  other: "אחר",
};

const AUDIT_LABELS: Record<string, string> = {
  agreement_sent: "נשלח הסכם לחתימה",
  agreement_signed: "הבעלים חתם על ההסכם",
  agreement_version_published: "פורסמה גרסה חדשה של ההסכם",
  document_uploaded: "הועלה מסמך",
  document_viewed: "נצפה מסמך",
  document_archived: "מסמך הועבר לארכיון",
  document_restored: "מסמך שוחזר מהארכיון",
  trial_extended: "הוארך ניסיון",
  payment_recorded: "תועד תשלום",
  addon_approved: "אושר תוסף",
  admin_entered_store: "מנהל-על נכנס לניהול החנות",
  grow_credentials_saved: "הוזנו פרטי מסוף Grow",
  grow_credentials_replaced: "הוחלפו פרטי מסוף Grow",
  grow_settings_changed: "שונו הגדרות הסליקה",
  grow_enabled: "הסליקה הופעלה לחנות",
  grow_disabled: "הסליקה כובתה לחנות",
  grow_connection_tested: "נבדק החיבור ל-Grow",
  grow_payment_received: "התקבל תשלום דרך Grow",
  grow_payment_after_cancel: "תשלום Grow הגיע אחרי שההזמנה בוטלה (דורש טיפול ידני)",
  grow_webhook_rejected: "התראת Grow נדחתה (טוקן / סכום לא תואמים)",
};

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "—";
const dateOnly = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }) : "—";
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))}KB`;

export function CustomerFile({ tenantId }: { tenantId: string }) {
  const load = useServerFn(loadCustomerFile);
  const [file, setFile] = useState<CustomerFileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFile(await load({ data: { tenantId } }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת התיק נכשלה");
    }
  }, [load, tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <p className="text-destructive" role="alert" data-testid="customer-file-error">
        {error}
      </p>
    );
  }
  if (!file) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען תיק לקוח…
      </p>
    );
  }

  const signed = file.acceptances.find((a) => a.status === "signed");
  return (
    <div className="space-y-4" data-testid="customer-file">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/platform" className="mb-1 flex items-center gap-1 text-sm text-primary">
            <ArrowRight className="size-4" aria-hidden="true" /> חזרה לחנויות
          </Link>
          <h2 className="text-xl font-bold">תיק לקוח · {file.tenant.name}</h2>
          <p className="text-sm text-muted-foreground" dir="ltr">
            {file.tenant.ownerEmail ?? "—"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="size-4" aria-hidden="true" /> רענון
        </Button>
      </div>

      <Tabs defaultValue="overview" dir="rtl">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">סקירה</TabsTrigger>
          <TabsTrigger value="agreements" data-testid="tab-agreements">
            הסכמים וחתימות
          </TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">
            מסמכים
          </TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices">
            חשבוניות וקבלות
          </TabsTrigger>
          <TabsTrigger value="emails" data-testid="tab-emails">
            מיילים
          </TabsTrigger>
          <TabsTrigger value="grow" data-testid="tab-grow">
            סליקה
          </TabsTrigger>
          <TabsTrigger value="subscription" data-testid="tab-subscription">
            מנוי וניסיון
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">
            היסטוריית פעולות
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardContent className="grid gap-3 pt-5 text-sm sm:grid-cols-2" data-testid="overview">
              <Field label="שם החנות" value={file.tenant.name} />
              <Field label="כתובת" value={`${file.tenant.slug}`} ltr />
              <Field label="דומיין פרטי" value={file.tenant.domain ?? "—"} ltr />
              <Field label="ח.פ / ע.מ" value={file.tenant.taxId ?? "—"} ltr />
              <Field label="חבילה" value={file.tenant.plan} />
              <Field
                label="סטטוס חנות"
                value={file.tenant.status === "suspended" ? "מוקפאת" : "פעילה"}
              />
              <Field label="נפתחה" value={dateOnly(file.tenant.createdAt)} />
              <Field label="מזהה חנות" value={file.tenant.id} ltr />
              <Field
                label="מנהלי חנות"
                value={file.owners.map((o) => o.email).join(", ") || "—"}
                ltr
              />
              <Field
                label="הסכם שירות"
                value={
                  signed
                    ? `נחתם (גרסה ${signed.version}) · ${dateOnly(signed.signedAt)}`
                    : "לא נחתם"
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agreements">
          <AgreementsTab file={file} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab file={file} onChanged={refresh} kinds={null} />
        </TabsContent>
        <TabsContent value="invoices">
          <DocumentsTab file={file} onChanged={refresh} kinds={["invoice", "receipt"]} />
        </TabsContent>
        <TabsContent value="emails">
          <Card>
            <CardContent className="space-y-2 pt-5" data-testid="emails-list">
              <p className="text-xs text-muted-foreground">
                מיילים שהפלטפורמה שלחה לבעל החנות. נשמר נושא, סטטוס ומזהה אצל ספק השליחה — בלי תוכן,
                קודים או סיסמאות. "נמסר לספק" אינו אישור קריאה או מסירה לתיבה (דורש webhook של ספק
                המייל).
              </p>
              {file.emails.length === 0 && (
                <p className="text-sm text-muted-foreground">אין מיילים.</p>
              )}
              {file.emails.map((email) => (
                <div
                  key={email.id}
                  className="rounded-md border p-3 text-sm"
                  data-testid="email-row"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{email.subject}</strong>
                    <Badge variant={email.status === "sent" ? "secondary" : "destructive"}>
                      {EMAIL_STATUS[email.status] ?? email.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span dir="ltr">{email.toEmail}</span> ·{" "}
                    {EMAIL_KIND_LABELS[email.kind] ?? email.kind} · {dateTime(email.createdAt)}
                    {email.providerMessageId && (
                      <>
                        {" "}
                        · מזהה ספק: <span dir="ltr">{email.providerMessageId}</span>
                      </>
                    )}
                  </div>
                  {email.error && <div className="text-xs text-destructive">{email.error}</div>}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="grow">
          <GrowTab tenantId={tenantId} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="subscription">
          <SubscriptionTab tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="activity">
          <Card>
            <CardContent className="space-y-2 pt-5" data-testid="audit-list">
              {file.audit.length === 0 && (
                <p className="text-sm text-muted-foreground">אין פעולות.</p>
              )}
              {file.audit.map((row) => (
                <div key={row.id} className="rounded-md border p-3 text-sm" data-testid="audit-row">
                  <strong>{AUDIT_LABELS[row.action] ?? row.action}</strong>
                  <div className="text-xs text-muted-foreground">
                    {dateTime(row.createdAt)} · {row.actorEmail ?? "הבעלים / מערכת"}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-all font-medium" dir={ltr ? "ltr" : undefined}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- הסכמים
function AgreementsTab({
  file,
  onChanged,
}: {
  file: CustomerFileData;
  onChanged: () => Promise<void>;
}) {
  const send = useServerFn(sendOwnerAgreement);
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const current = file.versions.find((v) => v.isCurrent);
  const signedCurrent = file.acceptances.some(
    (a) => a.status === "signed" && a.version === current?.version,
  );

  const doSend = async () => {
    setBusy(true);
    try {
      const result = await send({ data: { tenantId: file.tenant.id } });
      if (result.emailSent) toast.success("ההסכם נשלח לבעל החנות");
      else toast.warning(`הבקשה נפתחה אך המייל לא נשלח: ${result.reason ?? ""}`);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "השליחה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          הסכם שירות {current ? `· גרסה נוכחית ${current.version}` : ""}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void doSend()}
            disabled={busy || signedCurrent}
            data-testid="send-agreement"
            title={signedCurrent ? "הגרסה הנוכחית כבר נחתמה" : undefined}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {file.acceptances.some((a) => a.status === "pending") ? "שליחה מחדש" : "שליחה לחתימה"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPublishOpen(true)}
            data-testid="publish-version"
          >
            <PenLine className="size-4" /> גרסה חדשה של ההסכם
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2" data-testid="acceptances-list">
        <p className="text-xs text-muted-foreground">
          חתימה היא אישור בלחיצה (שם מוקלד + סימון הסכמה, ואופציונלית חתימה מצוירת) מקישור אישי
          שנשלח למייל הבעלים. נשמרים: מועד, IP, דפדפן, והנוסח המלא שנחתם עם טביעת SHA-256. הסכם חתום
          לא נמחק ולא משתנה. זו אינה "חתימה אלקטרונית מאובטחת" לפי חוק חתימה אלקטרונית — דורש בדיקה
          משפטית.
        </p>
        {file.acceptances.length === 0 && (
          <p className="text-sm text-muted-foreground">לא נשלח הסכם לבעל החנות הזה.</p>
        )}
        {file.acceptances.map((a) => (
          <div
            key={a.id}
            className="rounded-md border p-3 text-sm"
            data-testid="acceptance-row"
            data-status={a.status}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>גרסה {a.version}</strong>
              <Badge variant={a.status === "signed" ? "default" : "secondary"}>
                {ACCEPTANCE_STATUS[a.status] ?? a.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              נשלח ל-<span dir="ltr">{a.ownerEmail}</span> · {dateTime(a.createdAt)}
              {a.status === "pending" && a.tokenExpiresAt && (
                <> · תקף עד {dateTime(a.tokenExpiresAt)}</>
              )}
            </div>
            {a.status === "signed" && (
              <div className="mt-1 text-xs">
                נחתם על ידי <strong>{a.signerName}</strong> · {dateTime(a.signedAt)}
                {a.hasSignature ? " · כולל חתימה מצוירת" : ""} · IP{" "}
                <span dir="ltr">{a.signerIp ?? "—"}</span>
                <div className="break-all text-muted-foreground" dir="ltr">
                  SHA-256: {a.contentSha256}
                </div>
              </div>
            )}
          </div>
        ))}
        <h3 className="pt-3 text-sm font-bold">גרסאות הנוסח</h3>
        {file.versions.map((v) => (
          <div key={v.version} className="text-xs text-muted-foreground">
            גרסה {v.version} · {v.title} · {dateOnly(v.createdAt)} {v.isCurrent ? "· נוכחית" : ""}
          </div>
        ))}
      </CardContent>
      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} onDone={onChanged} />
    </Card>
  );
}

function PublishDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const publish = useServerFn(publishAgreementVersion);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>גרסה חדשה של הסכם השירות</DialogTitle>
          <DialogDescription>
            הגרסה הקודמת וחתימות שנחתמו עליה נשמרות כמות שהן. כותרות בשורה שמתחילה ב-"## ". אפשר
            להשתמש ב-{"{{store_name}}"} וב-{"{{owner_email}}"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pv-title">כותרת</Label>
            <Input
              id="pv-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="pv-title"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-content">נוסח</Label>
            <Textarea
              id="pv-content"
              rows={12}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              data-testid="pv-content"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
          <Button
            disabled={busy}
            data-testid="pv-submit"
            onClick={() => {
              setBusy(true);
              publish({ data: { title, content } })
                .then(async () => {
                  toast.success("פורסמה גרסה חדשה");
                  setTitle("");
                  setContent("");
                  onClose();
                  await onDone();
                })
                .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "הפרסום נכשל"))
                .finally(() => setBusy(false));
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />} פרסום
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- מסמכים
function DocumentsTab({
  file,
  onChanged,
  kinds,
}: {
  file: CustomerFileData;
  onChanged: () => Promise<void>;
  kinds: DocKind[] | null;
}) {
  const getUrl = useServerFn(getDocumentUrl);
  const archive = useServerFn(archiveDocument);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const docs = file.documents.filter(
    (d) => (kinds === null || kinds.includes(d.kind as DocKind)) && (showArchived || !d.isArchived),
  );
  const testid = kinds ? "invoices-list" : "documents-list";

  const open = async (id: string) => {
    // החלון נפתח מיד (בתגובה ללחיצה) ורק אחר כך מקבל את הקישור החתום —
    // אחרת חוסמי חלונות קופצים (ובעיקר Safari) חוסמים אותו
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await getUrl({ data: { documentId: id } });
      if (tab) tab.location.href = url;
      else window.location.href = url;
      await onChanged();
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error ? e.message : "פתיחת המסמך נכשלה");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{kinds ? "חשבוניות וקבלות" : "מסמכים"}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            הצג ארכיון
          </label>
          <Button size="sm" onClick={() => setUploadOpen(true)} data-testid={`${testid}-upload`}>
            <FilePlus2 className="size-4" /> העלאת PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2" data-testid={testid}>
        <p className="text-xs text-muted-foreground">
          קבצי PDF בלבד (עד 10MB), באחסון פרטי. הצפייה בקישור חתום שפג אחרי דקה, וכל צפייה נרשמת.
          מסמכים לא נמחקים — רק מועברים לארכיון. חיבור לספק חשבוניות מאושר: בהמשך.
        </p>
        {docs.length === 0 && <p className="text-sm text-muted-foreground">אין מסמכים.</p>}
        {docs.map((d) => (
          <div key={d.id} className="rounded-md border p-3 text-sm" data-testid="document-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{d.title}</strong>
              <div className="flex gap-1">
                <Badge variant="secondary">{DOC_KIND_LABELS[d.kind] ?? d.kind}</Badge>
                {d.isArchived && <Badge variant="outline">בארכיון</Badge>}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {d.fileName} · {kb(d.sizeBytes)}
              {d.docDate ? ` · תאריך מסמך ${dateOnly(d.docDate)}` : ""} · הועלה{" "}
              {dateTime(d.createdAt)}
              {d.uploadedByEmail ? ` ע"י ${d.uploadedByEmail}` : ""}
            </div>
            {d.note && <div className="text-xs">{d.note}</div>}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void open(d.id)}
                data-testid="document-open"
              >
                <Download className="size-4" /> צפייה / הורדה
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void archive({ data: { documentId: d.id, archived: !d.isArchived } })
                    .then(onChanged)
                    .catch((e: unknown) =>
                      toast.error(e instanceof Error ? e.message : "הפעולה נכשלה"),
                    )
                }
              >
                {d.isArchived ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )}
                {d.isArchived ? "שחזור" : "לארכיון"}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
      <UploadDialog
        open={uploadOpen}
        tenantId={file.tenant.id}
        defaultKind={kinds ? "invoice" : "other"}
        onClose={() => setUploadOpen(false)}
        onDone={onChanged}
      />
    </Card>
  );
}

function UploadDialog({
  open,
  tenantId,
  defaultKind,
  onClose,
  onDone,
}: {
  open: boolean;
  tenantId: string;
  defaultKind: DocKind;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const createUpload = useServerFn(createDocumentUpload);
  const register = useServerFn(registerDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocKind>(defaultKind);
  const [title, setTitle] = useState("");
  const [docDate, setDocDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const picked = inputRef.current?.files?.[0];
    if (!picked) {
      toast.error("נא לבחור קובץ PDF");
      return;
    }
    if (picked.size > MAX_DOC_BYTES) {
      toast.error("הקובץ גדול מדי (עד 10MB)");
      return;
    }
    setBusy(true);
    try {
      const { path, token } = await createUpload({
        data: { tenantId, fileName: picked.name, size: picked.size },
      });
      const { error } = await supabase.storage
        .from(PLATFORM_DOCS_BUCKET)
        .uploadToSignedUrl(path, token, picked, { contentType: "application/pdf" });
      if (error) throw new Error(error.message);
      await register({
        data: {
          tenantId,
          path,
          fileName: picked.name,
          size: picked.size,
          kind,
          title,
          docDate: docDate || null,
          note: note || null,
        },
      });
      toast.success("המסמך נשמר בתיק");
      setTitle("");
      setNote("");
      setDocDate("");
      if (inputRef.current) inputRef.current.value = "";
      onClose();
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ההעלאה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>העלאת מסמך לתיק</DialogTitle>
          <DialogDescription>קובץ PDF בלבד, עד 10MB.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="up-kind">סוג</Label>
            <select
              id="up-kind"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as DocKind)}
              data-testid="upload-kind"
            >
              <option value="invoice">חשבונית</option>
              <option value="receipt">קבלה</option>
              <option value="agreement">הסכם</option>
              <option value="other">אחר</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="up-title">כותרת</Label>
            <Input
              id="up-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="upload-title"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="up-date">תאריך המסמך (לא חובה)</Label>
            <Input
              id="up-date"
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="up-note">הערה (לא חובה)</Label>
            <Textarea
              id="up-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="up-file">קובץ PDF</Label>
            <input
              id="up-file"
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              data-testid="upload-file"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
          <Button disabled={busy} onClick={() => void submit()} data-testid="upload-submit">
            {busy && <Loader2 className="size-4 animate-spin" />} העלאה ושמירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- מנוי
function SubscriptionTab({ tenantId }: { tenantId: string }) {
  const loadBilling = useServerFn(platformBillingHistory);
  const [data, setData] = useState<{
    subscription: SubscriptionState;
    history: BillingEntry[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBilling({ data: { tenantId } })
      .then((result) => setData({ subscription: result.subscription, history: result.history }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "הטעינה נכשלה"));
  }, [loadBilling, tenantId]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Loader2 className="size-4 animate-spin" aria-label="טוען" />;
  const { subscription: sub, history } = data;
  return (
    <Card>
      <CardContent className="space-y-3 pt-5" data-testid="subscription-tab">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="חבילה" value={PLAN_LABELS[sub.plan]} />
          <Field label="סטטוס" value={STATUS_LABELS[sub.status]} />
          <Field label="סוף ניסיון" value={dateOnly(sub.trialEndsAt)} />
          <Field label="סוף תקופה נוכחית" value={dateOnly(sub.currentPeriodEnd)} />
          <Field
            label="ימים שנותרו"
            value={sub.daysLeft === null ? "ללא תפוגה" : String(sub.daysLeft)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          הארכת ניסיון ותיעוד תשלום: מטבלת החנויות, "ניהול מנוי".
        </p>
        <h3 className="text-sm font-bold">היסטוריית חיובים והארכות</h3>
        {history.length === 0 && <p className="text-sm text-muted-foreground">אין רשומות.</p>}
        {history.map((h) => (
          <div key={h.id} className="rounded-md border p-3 text-sm" data-testid="billing-row">
            <strong>
              {h.kind === "payment"
                ? `תשלום ₪${h.amount}`
                : h.kind === "trial_extension"
                  ? `הארכת ניסיון ${h.days ?? ""} ימים`
                  : h.kind === "addon"
                    ? `תוסף ₪${h.amount}`
                    : "שינוי חבילה"}
            </strong>
            <div className="text-xs text-muted-foreground">
              {dateTime(h.createdAt)} · {PLAN_LABELS[h.plan]}
              {h.method ? ` · ${BILLING_METHOD_LABELS[h.method]}` : ""}
              {h.recordedBy ? ` · ${h.recordedBy}` : ""}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- סליקה (Grow)
const GROW_TYPES: { id: number; label: string }[] = [
  { id: 1, label: "כרטיס אשראי" },
  { id: 6, label: "Bit" },
  { id: 13, label: "Apple Pay" },
  { id: 14, label: "Google Pay" },
];

function GrowTab({ tenantId, onChanged }: { tenantId: string; onChanged: () => Promise<void> }) {
  const loadSettings = useServerFn(getGrowSettings);
  const save = useServerFn(saveGrowSettings);
  const test = useServerFn(testGrowConnection);
  const [settings, setSettings] = useState<GrowSettings | null>(null);
  const [userId, setUserId] = useState("");
  const [pageCode, setPageCode] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [maxPayments, setMaxPayments] = useState(1);
  const [types, setTypes] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const apply = useCallback((next: GrowSettings) => {
    setSettings(next);
    setSandbox(next.sandbox);
    setEnabled(next.enabled);
    setMaxPayments(next.maxPayments);
    setTypes(next.transactionTypes);
  }, []);

  useEffect(() => {
    loadSettings({ data: { tenantId } })
      .then(apply)
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "הטעינה נכשלה"));
  }, [loadSettings, tenantId, apply]);

  const submit = async () => {
    setBusy(true);
    try {
      const next = await save({
        data: {
          tenantId,
          userId,
          pageCode,
          apiKey,
          sandbox,
          enabled,
          maxPayments,
          transactionTypes: types,
        },
      });
      apply(next);
      // הפרטים נמחקים מהמסך מיד אחרי השמירה — לא נשארים בדפדפן
      setUserId("");
      setPageCode("");
      setApiKey("");
      toast.success("נשמר");
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <Loader2 className="size-4 animate-spin" aria-label="טוען" />;
  const saved = settings.configured;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">סליקה דרך Grow (מסוף פרטי של הלקוח)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="grow-tab">
        <p className="text-xs text-muted-foreground">
          הפרטים נשמרים מוצפנים בשרת ולא מוצגים שוב לאף אחד — גם לא לך. להחלפה מקלידים מחדש. הלקוח
          (בעל החנות) לא רואה את המסך הזה. עד שמסמנים "פעיל", הסליקה לא מופיעה בחנות.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="grow-status">
          <Badge variant={saved ? "default" : "secondary"}>
            {saved ? "פרטי מסוף נשמרו ✓" : "פרטי מסוף לא הוגדרו"}
          </Badge>
          {saved && settings.hasApiKey && <Badge variant="secondary">apiKey נשמר ✓</Badge>}
          <Badge variant={settings.enabled ? "default" : "outline"}>
            {settings.enabled ? "פעיל בחנות" : "כבוי"}
          </Badge>
          {settings.updatedAt && (
            <span className="text-xs text-muted-foreground">
              עודכן {dateTime(settings.updatedAt)}
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["userId", userId, setUserId, "grow-user-id"],
            ["pageCode", pageCode, setPageCode, "grow-page-code"],
            ["apiKey (אם נדרש)", apiKey, setApiKey, "grow-api-key"],
          ].map(([label, value, setter, testid]) => (
            <div key={testid as string} className="space-y-1">
              <Label htmlFor={testid as string}>{label as string}</Label>
              <Input
                id={testid as string}
                type="password"
                dir="ltr"
                autoComplete="new-password"
                spellCheck={false}
                value={value as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                placeholder={saved ? "•••••• נשמר — להחלפה הקלד מחדש" : ""}
                data-testid={testid as string}
              />
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sandbox}
              onChange={(e) => setSandbox(e.target.checked)}
              data-testid="grow-sandbox"
            />
            סביבת בדיקות (sandbox) — לא לייצור
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              data-testid="grow-enabled"
            />
            פעיל — להציג תשלום מקוון בקופה של החנות
          </label>
          <div className="space-y-1">
            <Label htmlFor="grow-max">מספר תשלומים מקסימלי</Label>
            <select
              id="grow-max"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={maxPayments}
              onChange={(e) => setMaxPayments(Number(e.target.value))}
              data-testid="grow-max-payments"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "ללא תשלומים" : `עד ${n}`}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-1 text-sm">
            <legend className="text-sm font-medium">אמצעי תשלום (ריק = הכל)</legend>
            <div className="flex flex-wrap gap-3">
              {GROW_TYPES.map((t) => (
                <label key={t.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={types.includes(t.id)}
                    onChange={(e) =>
                      setTypes(
                        e.target.checked ? [...types, t.id] : types.filter((x) => x !== t.id),
                      )
                    }
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => void submit()} data-testid="grow-save">
            {busy && <Loader2 className="size-4 animate-spin" />} שמירה
          </Button>
          <Button
            variant="outline"
            disabled={busy || !saved}
            data-testid="grow-test"
            onClick={() => {
              setBusy(true);
              setTestResult(null);
              test({ data: { tenantId } })
                .then(setTestResult)
                .catch((e: unknown) =>
                  setTestResult({
                    ok: false,
                    message: e instanceof Error ? e.message : "הבדיקה נכשלה",
                  }),
                )
                .finally(() => setBusy(false));
            }}
          >
            בדיקת חיבור (ללא חיוב)
          </Button>
          {testResult && (
            <span
              className={testResult.ok ? "text-sm text-green-700" : "text-sm text-destructive"}
              data-testid="grow-test-result"
              role="status"
            >
              {testResult.message}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
