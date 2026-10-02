import { Ban, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import logo from "@/assets/logo";

/** מסך חסימה מלא — לחשבון ממתין לאישור מנהל או לחשבון חסום */
export function AccountNotice({
  variant,
  email,
  onSignOut,
}: {
  variant: "pending" | "blocked";
  email: string;
  onSignOut: () => void;
}) {
  const { settings, logoUrl } = useSiteSettings();
  const isBlocked = variant === "blocked";

  return (
    <div className="flex w-full flex-1 items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center shadow-soft">
        <CardContent className="flex flex-col items-center gap-4 pt-8">
          <img src={logoUrl ?? logo.url} alt={settings?.site_title ?? ""} className="h-16 w-auto" />
          <div
            className={`flex size-14 items-center justify-center rounded-full ${
              isBlocked ? "bg-destructive/10 text-destructive" : "bg-secondary text-primary"
            }`}
          >
            {isBlocked ? <Ban className="size-7" /> : <Clock className="size-7" />}
          </div>
          <h1 className="text-xl font-bold text-foreground">
            {isBlocked ? "החשבון נחסם" : "החשבון ממתין לאישור מנהל"}
          </h1>
          <p className="text-sm text-muted-foreground">
            החשבון <span dir="ltr" className="font-medium text-foreground">{email}</span>{" "}
            {isBlocked
              ? "נחסם לגישה למערכת. לבירור נא ליצור קשר עם הסוכן/ת המטפל/ת או עם מנהל המערכת."
              : "נרשם בהצלחה וממתין לאישור מנהל. ניתן להמשיך ולעיין בקטלוג המוצרים בינתיים."}
          </p>
          <Button variant="outline" onClick={onSignOut} className="mt-2">
            התנתקות
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
