import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CircleCheck, FileSignature, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { SignaturePad } from "@/components/legal/SignaturePad";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  loadOwnerAgreement,
  signOwnerAgreement,
  type OwnerAgreementForm,
} from "@/lib/owner-agreement.functions";

/**
 * חלק 42: עמוד חתימה על הסכם השירות של הפלטפורמה (בעל חנות).
 * ציבורי אבל אישי: הכל נגזר מהטוקן שנשלח למייל הבעלים. אין כאן כניסה
 * וחנות אחרת אי אפשר לראות או לחתום עבורה.
 */
export const Route = createFileRoute("/owner-agreement/$token")({
  ssr: false,
  head: () => ({
    meta: [{ title: "הסכם שירות" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: OwnerAgreementPage,
});

type Loaded =
  { state: "loading" } | { state: "invalid" } | { state: "ready"; form: OwnerAgreementForm };

/** כותרות "## " בנוסח ההסכם → כותרת; שאר השורות כפסקאות */
function AgreementText({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/).filter((block) => block.trim() !== "");
  return (
    <div className="space-y-3 text-sm leading-7" data-testid="owner-agreement-text">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const first = lines[0] ?? "";
        if (first.startsWith("## ")) {
          const rest = lines.slice(1).join("\n").trim();
          return (
            <div key={index}>
              <h2 className="pt-2 text-base font-bold">{first.slice(3)}</h2>
              {rest && <p className="whitespace-pre-line">{rest}</p>}
            </div>
          );
        }
        if (first.startsWith("# ")) {
          return (
            <h2 key={index} className="text-lg font-bold">
              {first.slice(2)}
            </h2>
          );
        }
        return (
          <p key={index} className="whitespace-pre-line">
            {block}
          </p>
        );
      })}
    </div>
  );
}

function OwnerAgreementPage() {
  const { token } = Route.useParams();
  const load = useServerFn(loadOwnerAgreement);
  const sign = useServerFn(signOwnerAgreement);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    load({ data: { token } })
      .then((form) => alive && setLoaded(form ? { state: "ready", form } : { state: "invalid" }))
      .catch(() => alive && setLoaded({ state: "invalid" }));
    return () => {
      alive = false;
    };
  }, [token, load]);

  const submit = async () => {
    setBusy(true);
    try {
      await sign({ data: { token, signerName: name, accepted, signatureSvg: signature } });
      const form = await load({ data: { token } });
      // הטוקן נשרף בחתימה — אחרי הצלחה מציגים אישור ולא טוענים שוב
      setLoaded(
        form
          ? { state: "ready", form }
          : {
              state: "ready",
              form: {
                status: "signed",
                version: 0,
                title: "",
                content: "",
                storeName: "",
                ownerEmail: "",
                signedAt: new Date().toISOString(),
                signerName: name,
              },
            },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "החתימה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 font-bold">
          <FileSignature className="size-5 text-primary" aria-hidden="true" />
          הסכם שירות
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {loaded.state === "loading" ? (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            טוען…
          </p>
        ) : loaded.state === "invalid" ? (
          <Notice tone="warn" testid="owner-agreement-invalid" title="הקישור אינו תקין">
            ייתכן שהקישור הוחלף בחדש יותר או שהועתק חלקית. אפשר לבקש קישור חדש ממנהל הפלטפורמה.
          </Notice>
        ) : loaded.form.status === "signed" ? (
          <Notice tone="ok" testid="owner-agreement-done" title="ההסכם נחתם — תודה!">
            {loaded.form.signerName ? `נחתם על ידי ${loaded.form.signerName}` : "נחתם"}
            {loaded.form.signedAt
              ? ` ב-${new Date(loaded.form.signedAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}`
              : ""}
            . עותק של הנוסח שנחתם נשמר בתיק הלקוח שלכם. אפשר לסגור את העמוד.
          </Notice>
        ) : loaded.form.status === "expired" || loaded.form.status === "superseded" ? (
          <Notice tone="warn" testid="owner-agreement-expired" title="הקישור כבר אינו בתוקף">
            {loaded.form.status === "expired" ? "תוקף הקישור פג." : "נשלח אליכם קישור חדש יותר."}{" "}
            אפשר לבקש קישור חדש ממנהל הפלטפורמה.
          </Notice>
        ) : (
          <>
            <Card>
              <CardContent className="space-y-3 pt-5">
                <h1 className="text-xl font-bold">{loaded.form.title}</h1>
                <p className="text-sm text-muted-foreground">
                  חנות: <strong>{loaded.form.storeName}</strong> · בעלים:{" "}
                  <span dir="ltr">{loaded.form.ownerEmail}</span> · גרסה {loaded.form.version}
                </p>
                <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border bg-muted/30 p-4">
                  <AgreementText content={loaded.form.content} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-4 pt-5">
                <div className="space-y-2">
                  <Label htmlFor="owner-agreement-name">שם מלא של החותם</Label>
                  <Input
                    id="owner-agreement-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    data-testid="owner-agreement-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>חתימה מצוירת (לא חובה)</Label>
                  <SignaturePad onChange={setSignature} />
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="owner-agreement-accept"
                    checked={accepted}
                    onCheckedChange={(value) => setAccepted(value === true)}
                    data-testid="owner-agreement-accept"
                  />
                  <Label htmlFor="owner-agreement-accept" className="leading-6">
                    קראתי את ההסכם ואני מסכים/ה לתנאיו בשם בעל החנות.
                  </Label>
                </div>
                <p className="text-xs leading-6 text-muted-foreground">
                  מועד החתימה, כתובת ה-IP, הדפדפן והנוסח המלא שנחתם נשמרים כראיה לחתימה.
                </p>
                <Button
                  onClick={() => void submit()}
                  disabled={busy || name.trim().length < 2 || !accepted}
                  data-testid="owner-agreement-submit"
                >
                  {busy && <Loader2 className="ml-2 size-4 animate-spin" aria-hidden="true" />}
                  אישור וחתימה
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function Notice({
  tone,
  title,
  testid,
  children,
}: {
  tone: "ok" | "warn";
  title: string;
  testid: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <Card data-testid={testid}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Icon
          className={tone === "ok" ? "size-10 text-green-600" : "size-10 text-amber-600"}
          aria-hidden="true"
        />
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
}
