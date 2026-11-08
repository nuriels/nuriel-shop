// החוזה של האירוע (חוזה מתחם הבריכה לאירועים): החוזים שנשלחו לאירוע הזה, ושליחה לחתימה —
// במסך "מסמכי לקוחות" (מיגרציה 64). סוג החוזה נקבע לפי האירוע: אירוע → חוזה מתחם הבריכה, תמיד.
import { Link } from "@tanstack/react-router";
import { FileSignature } from "lucide-react";
import type { EventDetail } from "../../types/events";
import { ContractsForLink } from "../client-documents/ContractsForLink";
import { useManagement } from "../shell/management-context";
import { SectionCard } from "../ui/kit";

export function EventContractsCard({ event }: { event: EventDetail }) {
  const ctx = useManagement();
  const allowed = Boolean(ctx.permissions["contracts"]);
  return (
    <SectionCard
      title="החוזה"
      description="חוזה מתחם הבריכה לאירועים — נשלח ללקוח לחתימה במייל"
      className="md:col-span-2"
      actions={
        allowed &&
        event.stored_status !== "cancelled" && (
          <Link
            to="/manage/client-documents"
            search={{ tab: "send", event: event.id }}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            <FileSignature className="size-4" aria-hidden="true" />
            שליחת חוזה לחתימה
          </Link>
        )
      }
    >
      {allowed ? (
        <ContractsForLink eventId={event.id} />
      ) : (
        <p className="text-sm text-muted-foreground">
          צפייה בחוזים — לבעלים ולמנהלים שקיבלו הרשאה.
        </p>
      )}
    </SectionCard>
  );
}
