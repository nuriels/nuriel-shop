// "אירוע חדש" (/manage/events/new) — הטופס, ואחרי השמירה: עמוד האירוע
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { hospitalityEventCreate, hospitalityEvents } from "../../api/events.functions";
import type { EventInput } from "../../types/events";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { useManagement } from "../shell/management-context";
import { PageHeader } from "../ui/kit";
import { EventForm } from "./EventForm";
import { EVENTS_KEY } from "./model";

export function NewEventPage() {
  const ctx = useManagement();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // המתחמים ותנאי העסק (אותה קריאה כמו הרשימה)
  const base = useQuery({
    queryKey: [...EVENTS_KEY, "base"],
    queryFn: () => hospitalityEvents({ data: { tab: "upcoming", limit: 1, offset: 0 } }),
  });
  const create = useMutation({
    mutationFn: (data: EventInput) => hospitalityEventCreate({ data: { data } }),
    onSuccess: (e) => {
      toast.success(`אירוע #${e.number} נשמר`);
      void qc.invalidateQueries({ queryKey: EVENTS_KEY });
      void navigate({ to: "/manage/events/$eventId", params: { eventId: e.id } });
    },
    onError: (e) => setError(errorText(e)),
  });
  if (!ctx.permissions["bookings"]) return <p className="p-4">אין לכם הרשאה להוסיף אירועים.</p>;
  if (base.isError) return <LoadError error={base.error} />;
  if (!base.data) return <PageSkeleton label="טוען…" />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="אירוע חדש"
        description="אירוע במתחם הבריכה, בלי לינה. המסד בודק שאין אירוע אחר באותו זמן באותו מתחם."
        back={{ to: "/manage/events", label: "חזרה לאירועים" }}
      />
      {base.data.properties.length === 0 ? (
        <p className="text-muted-foreground">קודם מוסיפים מתחם ב"יחידות ומתחמים".</p>
      ) : (
        <EventForm
          properties={base.data.properties}
          terms={base.data.terms}
          event={null}
          busy={create.isPending}
          error={error}
          onSubmit={(data) => {
            setError(null);
            create.mutate(data);
          }}
        />
      )}
    </div>
  );
}
