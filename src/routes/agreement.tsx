import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Eraser, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { RichContent } from "@/components/legal/RichContent";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadAgreementForm, submitAgreement } from "@/lib/agreement.functions";

type Search = { token?: string | undefined };

export const Route = createFileRoute("/agreement")({
  ssr: false,
  head: () => ({ meta: [{ title: "טופס הצטרפות ותנאי שירות" }] }),
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search["token"] === "string" ? { token: search["token"] } : {},
  component: AgreementPage,
});

type FormData = Awaited<ReturnType<typeof loadAgreementForm>>;

/** לוח חתימה: אוסף את קווי העכבר/המגע ושומר אותם כ-SVG */
function SignaturePad({ onChange }: { onChange: (svg: string | null) => void }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  const point = (event: React.PointerEvent) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * 600);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * 200);
    return `${x},${y}`;
  };

  const emit = (allStrokes: string[]) => {
    if (allStrokes.length === 0) {
      onChange(null);
      return;
    }
    const paths = allStrokes.map(
      (d) =>
        `<path d="${d}" fill="none" stroke="#12211F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    onChange(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">${paths.join("")}</svg>`,
    );
  };

  return (
    <div className="space-y-2">
      <div
        ref={areaRef}
        role="application"
        aria-label="אזור חתימה"
        className="relative h-40 touch-none rounded-lg border-2 border-dashed border-border bg-card"
        onPointerDown={(event) => {
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          const p = point(event);
          if (p) setCurrent(`M${p}`);
        }}
        onPointerMove={(event) => {
          if (current === null) return;
          const p = point(event);
          if (p) setCurrent(`${current} L${p}`);
        }}
        onPointerUp={() => {
          if (current === null) return;
          const next = [...strokes, current];
          setStrokes(next);
          setCurrent(null);
          emit(next);
        }}
      >
        <svg viewBox="0 0 600 200" className="pointer-events-none absolute inset-0 size-full">
          {[...strokes, ...(current ? [current] : [])].map((d, index) => (
            <path
              key={index}
              d={d}
              fill="none"
              stroke="currentColor"
              className="text-foreground"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        {strokes.length === 0 && current === null && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            חתמו כאן באצבע או בעכבר
          </span>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setStrokes([]);
          setCurrent(null);
          onChange(null);
        }}
      >
        <Eraser className="size-4" />
        ניקוי החתימה
      </Button>
    </div>
  );
}

function AgreementPage() {
  const { token } = Route.useSearch();
  const loadForm = useServerFn(loadAgreementForm);
  const submitForm = useServerFn(submitAgreement);

  const [form, setForm] = useState<FormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("הקישור חסר או אינו תקין.");
      return;
    }
    void (async () => {
      try {
        const result = await loadForm({ data: { token } });
        setForm(result);
        setSignerName(result.contactName);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "טעינת הטופס נכשלה");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await submitForm({ data: { token: token ?? "", signerName, signatureSvg: signature } });
      setDone(true);
      toast.success("הטופס נחתם ונשמר");
    } catch (submitError) {
      toast.error(submitError instanceof Error ? submitError.message : "שמירת החתימה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={null} email={null} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Card className="shadow-soft">
          <CardContent className="space-y-6 pt-6">
            <div>
              <h1 className="font-display text-2xl text-foreground">טופס הצטרפות ותנאי שירות</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {form?.companyName ? `הסכם התקשרות מול ${form.companyName}` : "הסכם התקשרות"}
              </p>
            </div>

            {error ? (
              <div className="space-y-4">
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  {error}
                </p>
                <Button asChild>
                  <Link to="/">חזרה לקטלוג</Link>
                </Button>
              </div>
            ) : form === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                טוען את הטופס...
              </p>
            ) : done || form.alreadySigned ? (
              <div className="space-y-4">
                <p className="flex items-center gap-2 rounded-lg border border-border bg-secondary p-3 text-sm">
                  <Check className="size-4 text-accent" />
                  הטופס נחתם ונשמר בתיק הלקוח
                  {form.signedAt && !done
                    ? ` בתאריך ${new Date(form.signedAt).toLocaleDateString("he-IL")}`
                    : ""}
                  .
                </p>
                <Button asChild size="lg">
                  <Link to="/">מעבר לקטלוג</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-6">
                <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-secondary p-4 text-sm sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">שם העסק:</dt>
                    <dd className="font-medium">{form.businessName}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">ח.פ:</dt>
                    <dd dir="ltr" className="numeric font-medium">
                      {form.taxId}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">כתובת:</dt>
                    <dd className="font-medium">{form.businessAddress}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">טלפון:</dt>
                    <dd dir="ltr" className="numeric font-medium">
                      {form.phone}
                    </dd>
                  </div>
                </dl>

                <div className="space-y-2">
                  <h2 className="font-display text-lg text-foreground">תנאי השירות</h2>
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border p-4 text-sm leading-7">
                    {form.terms.trim() === "" ? (
                      "טרם הוזנו תנאי שירות במערכת. יש לפנות אלינו לקבלת הנוסח לפני החתימה."
                    ) : (
                      // חלק 37: התקנון נשמר כ-HTML (עורך הטקסט) — מוצג מעוצב ומנוקה
                      <RichContent content={form.terms} />
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signer-name">שם החותם</Label>
                  <Input
                    id="signer-name"
                    required
                    minLength={2}
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>חתימה</Label>
                  <SignaturePad onChange={setSignature} />
                </div>

                <p className="text-xs leading-6 text-muted-foreground">
                  בחתימה אני מאשר/ת שקראתי את תנאי השירות ואני מסכים/ה להם בשם העסק. מועד החתימה
                  וכתובת ה-IP נשמרים יחד עם הנוסח שנחתם.
                </p>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={busy || signature === null}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {busy ? "שומר..." : "חתימה ושליחה"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
      <AppFooter />
    </div>
  );
}
