import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type StoreAdminCredentials = { email: string; tempPassword: string; loginUrl: string };

/** פרטי הכניסה של מנהל חנות חדש — מוצגים פעם אחת בלבד */
export function StoreCredentials({ credentials }: { credentials: StoreAdminCredentials }) {
  const text = `כניסה: ${credentials.loginUrl}\nאימייל: ${credentials.email}\nסיסמה זמנית: ${credentials.tempPassword}`;
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => toast.success("פרטי הכניסה הועתקו"),
      () => toast.error("ההעתקה נכשלה — העתיקו ידנית"),
    );

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">כניסה</dt>
        <dd dir="ltr" className="text-left">
          <a href={credentials.loginUrl} target="_blank" rel="noreferrer" className="underline">
            {credentials.loginUrl}
          </a>
        </dd>
        <dt className="text-muted-foreground">אימייל</dt>
        <dd dir="ltr" className="text-left font-mono">
          {credentials.email}
        </dd>
        <dt className="text-muted-foreground">סיסמה זמנית</dt>
        <dd dir="ltr" className="text-left font-mono font-semibold">
          {credentials.tempPassword}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          <Copy className="size-4" /> העתקת פרטי הכניסה
        </Button>
        <span className="text-xs text-muted-foreground">
          הסיסמה מוצגת פעם אחת בלבד; בכניסה הראשונה המנהל יתבקש לקבוע סיסמה חדשה.
        </span>
      </div>
    </div>
  );
}
