import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  FileSignature,
  FolderOpen,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShoppingCart,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderDocumentButton } from "@/components/OrderDocumentButton";
import { OrdersByYear } from "@/components/OrdersByYear";
import { getCustomerFile, sendManualMessage } from "@/lib/crm.functions";
import { sendAgreementLink } from "@/lib/agreement.functions";
import { formatIls } from "@/lib/catalog";
import { ORDER_STATUS_LABEL, formatOrderDate, type OrderStatus } from "@/lib/orders";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";

type CustomerFile = Awaited<ReturnType<typeof getCustomerFile>>;

const TIER_LABEL: Record<string, string> = { "1": "דרג 1", "2": "דרג 2", "3": "דרג 3" };

const EMAIL_KIND_LABEL: Record<string, string> = {
  order: "אישור הזמנה",
  quote: "בקשת הצעת מחיר",
  password_reset: "קישור סיסמה",
  temp_password: "פרטי כניסה",
  password_changed: "אישור שינוי סיסמה",
  agreement: "טופס הצטרפות",
  manual: "הודעה ידנית",
  other: "אחר",
};

/**
 * תיק לקוח: פרטי העסק, העגלה שהלקוח אוסף כרגע, הזמנות פתוחות,
 * היסטוריה, טופס תנאי השירות החתום ושליחת מייל אישי.
 */
export function CustomerFileDialog({ userId, label }: { userId: string; label: string }) {
  const tiersEnabled = usePriceTiersEnabled();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<CustomerFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [openEmail, setOpenEmail] = useState<string | null>(null);

  const loadFile = useServerFn(getCustomerFile);
  const sendEmail = useServerFn(sendManualMessage);
  const sendAgreement = useServerFn(sendAgreementLink);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFile(await loadFile({ data: { userId } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טעינת התיק נכשלה");
    } finally {
      setLoading(false);
    }
  }, [loadFile, userId]);

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cartTotal = (file?.cart.items ?? []).reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  const submitEmail = async () => {
    setBusy(true);
    try {
      const result = await sendEmail({ data: { userId, subject, body } });
      toast.success(`ההודעה נשלחה אל ${result.sentTo}`);
      setSubject("");
      setBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת ההודעה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const resendAgreement = async () => {
    setBusy(true);
    try {
      await sendAgreement({ data: { userId } });
      toast.success("טופס החתימה נשלח ללקוח");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת הטופס נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const orderRow = (order: CustomerFile["openOrders"][number]) => (
    <div key={order.id} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="numeric min-w-0 flex-1 truncate text-left text-sm font-bold">
          {order.orderNumber}
        </span>
        {order.kind === "quote" && <Badge variant="outline">הצעת מחיר</Badge>}
        <Badge variant="secondary">
          {ORDER_STATUS_LABEL[order.status as OrderStatus] ?? order.status}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatOrderDate(order.createdAt)} · {order.itemCount} פריטים
      </p>
      <ul className="space-y-0.5 text-sm">
        {order.items.slice(0, 4).map((item, index) => (
          <li key={index} className="truncate text-muted-foreground">
            {item.name} × {item.quantity}
          </li>
        ))}
        {order.items.length > 4 && (
          <li className="text-xs text-muted-foreground">ועוד {order.items.length - 4} פריטים...</li>
        )}
      </ul>
      <div className="flex items-center justify-between gap-2">
        {order.kind === "quote" ? (
          <span className="text-sm text-muted-foreground">ללא מחירים</span>
        ) : (
          <span className="numeric font-bold text-accent">{formatIls(order.total)}</span>
        )}
        <OrderDocumentButton orderId={order.id} variant="ghost" label="PDF" />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FolderOpen className="size-4" />
          תיק לקוח
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">{label}</DialogTitle>
          <DialogDescription>כל המידע על הלקוח במסך אחד</DialogDescription>
        </DialogHeader>

        {loading && file === null ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            טוען את התיק...
          </p>
        ) : file === null ? null : (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-secondary p-4 text-sm sm:grid-cols-2">
              {[
                ["שם העסק", file.profile.businessName],
                ["ח.פ / עוסק מורשה", file.profile.taxId],
                ["כתובת", file.profile.businessAddress],
                ["איש קשר", file.profile.contactName],
                ["טלפון", file.profile.phone],
                ["אימייל", file.account.email],
                ["שם משתמש", file.account.username],
                [
                  "קבוצת מחיר",
                  // דרגים רדומים — השורה מוסתרת (ערך ריק מסונן למטה)
                  !tiersEnabled
                    ? ""
                    : file.profile.priceTier
                      ? TIER_LABEL[String(file.profile.priceTier)]
                      : "ללא קבוצה",
                ],
                ["סוכן מטפל", file.profile.agentLabel ?? "ללא סוכן"],
              ]
                .filter(([, value]) => String(value ?? "").trim() !== "")
                .map(([term, value]) => (
                  <div key={String(term)} className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">{term}:</dt>
                    <dd className="min-w-0 truncate font-medium">{value}</dd>
                  </div>
                ))}
            </dl>

            <Tabs defaultValue="cart" dir="rtl">
              <TabsList className="flex-wrap">
                <TabsTrigger value="cart">עגלה חיה</TabsTrigger>
                <TabsTrigger value="open">בטיפול ({file.openOrders.length})</TabsTrigger>
                <TabsTrigger value="history">היסטוריה ({file.pastOrders.length})</TabsTrigger>
                <TabsTrigger value="docs">מסמכים</TabsTrigger>
                <TabsTrigger value="emails">מיילים ({file.emails.length})</TabsTrigger>
                <TabsTrigger value="email">שליחת מייל</TabsTrigger>
              </TabsList>

              <TabsContent value="cart" className="space-y-3 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ShoppingCart className="size-4" />
                    {file.cart.updatedAt
                      ? `עודכן ${formatOrderDate(file.cart.updatedAt)}`
                      : "הלקוח עוד לא אסף פריטים"}
                  </p>
                  <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
                    <RefreshCw className="size-4" />
                    רענון
                  </Button>
                </div>
                {file.cart.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    העגלה ריקה כרגע
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1 text-sm">
                      {file.cart.items.map((item) => (
                        <li
                          key={item.productId}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="min-w-0 truncate">
                            {item.name} × {item.quantity}
                          </span>
                          <span className="numeric shrink-0 text-muted-foreground">
                            {formatIls(item.price * item.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="flex items-center justify-between border-t border-border pt-2 text-sm">
                      <span className="font-medium">סה״כ בעגלה</span>
                      <span className="numeric font-bold text-accent">{formatIls(cartTotal)}</span>
                    </p>
                  </>
                )}
              </TabsContent>

              <TabsContent value="open" className="space-y-3 pt-3">
                <OrdersByYear
                  items={file.openOrders}
                  getDate={(order) => order.createdAt}
                  renderItem={orderRow}
                  emptyText="אין הזמנות בטיפול"
                />
              </TabsContent>

              <TabsContent value="history" className="space-y-3 pt-3">
                {/* היסטוריה מלאה, מקובצת לפי שנה עם מיון לפי תאריך */}
                <OrdersByYear
                  items={file.pastOrders}
                  getDate={(order) => order.createdAt}
                  renderItem={orderRow}
                  emptyText="עדיין אין היסטוריית הזמנות"
                />
              </TabsContent>

              <TabsContent value="docs" className="space-y-3 pt-3">
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <FileSignature className="size-4 text-accent" />
                    טופס הצטרפות ותנאי שירות
                  </p>
                  {file.agreement.signedAt ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        נחתם על ידי {file.agreement.signerName} בתאריך{" "}
                        {formatOrderDate(file.agreement.signedAt)}
                      </p>
                      {file.agreement.signatureSvg && (
                        <div
                          className="max-w-64 rounded-md border border-border bg-card p-2 text-foreground"
                          // החתימה נוצרת ונשמרת ע"י המערכת עצמה (path בלבד),
                          // ולכן ההצגה הזו לא חושפת תוכן חופשי של המשתמש.
                          dangerouslySetInnerHTML={{ __html: file.agreement.signatureSvg }}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {file.agreement.sentAt
                          ? `הטופס נשלח ${formatOrderDate(file.agreement.sentAt)} וטרם נחתם.`
                          : "הטופס עוד לא נשלח."}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void resendAgreement()}
                      >
                        <Send className="size-4" />
                        {file.agreement.sentAt ? "שליחה מחדש" : "שליחת הטופס"}
                      </Button>
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="emails" className="space-y-3 pt-3">
                {file.emails.length === 0 ? (
                  <p className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    <Inbox className="size-6" />
                    עדיין לא נשלחו מיילים ללקוח הזה
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {file.emails.map((email) => (
                      <li key={email.id} className="rounded-lg border border-border">
                        <button
                          type="button"
                          className="flex w-full flex-wrap items-center gap-2 p-3 text-right"
                          onClick={() => setOpenEmail(openEmail === email.id ? null : email.id)}
                          aria-expanded={openEmail === email.id}
                        >
                          {email.sent ? (
                            <CheckCircle2 className="size-4 shrink-0 text-accent" />
                          ) : (
                            <XCircle className="size-4 shrink-0 text-destructive" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {email.subject}
                          </span>
                          <Badge variant="outline">
                            {EMAIL_KIND_LABEL[email.kind] ?? email.kind}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatOrderDate(email.createdAt)}
                          </span>
                        </button>
                        {openEmail === email.id && (
                          <div className="space-y-2 border-t border-border p-3">
                            <p dir="ltr" className="text-right text-xs text-muted-foreground">
                              אל: {email.toEmail}
                            </p>
                            {!email.sent && email.error && (
                              <p className="rounded-md bg-destructive/5 p-2 text-xs text-destructive">
                                השליחה נכשלה: {email.error}
                              </p>
                            )}
                            {/* תצוגת המייל כפי שנשלח: iframe ב-sandbox, בלי סקריפטים ובלי גישה לדף */}
                            <iframe
                              title={`תצוגת מייל: ${email.subject}`}
                              srcDoc={email.html}
                              sandbox=""
                              className="h-96 w-full rounded-md border border-border bg-white"
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="email" className="space-y-3 pt-3">
                <div className="space-y-2">
                  <Label htmlFor="crm-subject">נושא</Label>
                  <Input
                    id="crm-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="עדכון לגבי ההזמנה שלך"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="crm-body">תוכן ההודעה</Label>
                  <Textarea
                    id="crm-body"
                    rows={6}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={busy || subject.trim() === "" || body.trim() === ""}
                  onClick={() => void submitEmail()}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                  שליחה אל {file.account.email}
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
