import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

/** הדגל בכתובת החזרה — מסך ההתחברות יודע שחזרנו מ-Google */
export const GOOGLE_RETURN_FLAG = "google";

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/**
 * "המשך עם Google" — ישירות מול שרת ההתחברות של קובי (GoTrue ב-api-kobi).
 * משתמש קיים עם אותו אימייל מתחבר לחשבון שלו; חדש מקבל חשבון לקוח **ממתין לאישור מנהל** (כמו כל הרשמה) ומשלים
 * פרטים במסך "השלמת פרטים". חשבון כפול לאותו אימייל נחסם במסד.
 */
export function GoogleSignInButton({ label = "המשך עם Google" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/login?${GOOGLE_RETURN_FLAG}=1`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      console.error("[google-login] start failed", error);
      toast.error("לא הצלחנו לפתוח את ההתחברות עם Google. נסו שוב.");
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full gap-2 bg-card"
      disabled={busy}
      onClick={() => void start()}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <GoogleMark />}
      {label}
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      או
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
