// מסמכים ומדיניות האתר (מיגרציה 60) — לצוות: הרשימה והטיוטות, שמירה, פרסום (השרת ממלא את המשתנים
// מפרטי העסק של האתר הזה בלבד ושולח למסד את הטקסט המלא — הגרסה שנשמרת היא בדיוק מה שמוצג), הסרה
// מהאתר, סימון "נבדק על ידי", פרטי העסק למסמכים; הסדרי הנגישות במתחם (catalog); ומה שהאורח אישר
// בהזמנה (bookings). המסד בודק הרשאה, גרסה וקלט; כל שינוי נרשם ביומן הפעולות.
import { createServerFn } from "@tanstack/react-start";
import { renderDocument, buildVars } from "../documents/render";
import type { BookingDocument, DocumentsView, PropertyAccessibility } from "../types/documents";
import {
  parseDocumentKind,
  parseDocumentPublish,
  parseDocumentReview,
  parseDocumentSave,
  parseLegalProfile,
  parsePropertyAccessibility,
} from "../validation/documents";
import { InputError, uuid } from "../validation/input";

/** כתובת האתר ותאריך היום (אזור הזמן של ישראל) — למילוי {{site_url}} ו-{{today}} */
async function renderContext(): Promise<{ siteUrl: string; today: string }> {
  const { currentSiteAddresses } = await import("@/platform/tenancy/current-site.server");
  const a = await currentSiteAddresses();
  const today = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(new Date());
  return { siteUrl: a.primary ?? a.subdomain ?? "", today };
}

export const hospitalityDocuments = createServerFn({ method: "GET" }).handler(
  async (): Promise<DocumentsView & { context: { siteUrl: string; today: string } }> => {
    const { manageRpc } = await import("../server/manage.server");
    const [view, context] = await Promise.all([
      manageRpc<DocumentsView>("site_documents_view", {}),
      renderContext(),
    ]);
    return { ...view, context };
  },
);

export const hospitalityDocumentSave = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseDocumentSave(input))
  .handler(async ({ data }): Promise<{ kind: string; revision: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("site_document_save", {
      _kind: data.kind,
      _title: data.title,
      _body: data.body,
      _expected_revision: data.expectedRevision,
    });
  });

/**
 * פרסום הטיוטה השמורה: הטקסט ממולא כאן בפרטים של האתר הזה, ורק אם אין משתנה חסר או פרט להשלמה —
 * נשלח למסד כגרסה חדשה וקבועה. מה שחסר — חוזר לבעל העסק ברשימה ברורה.
 */
export const hospitalityDocumentPublish = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseDocumentPublish(input))
  .handler(
    async ({ data }): Promise<{ version: number; published_at: string; body_hash: string }> => {
      const { manageRpc } = await import("../server/manage.server");
      const [view, ctx] = await Promise.all([
        manageRpc<DocumentsView>("site_documents_view", {}),
        renderContext(),
      ]);
      const draft = view.documents.find((d) => d.kind === data.kind);
      if (!draft) throw new InputError("שמרו את המסמך לפני הפרסום");
      if (draft.revision !== data.expectedRevision)
        throw new InputError("המסמך השתנה בינתיים — רעננו ונסו שוב");
      const r = renderDocument(
        draft.draft_body,
        buildVars(view, ctx),
        view.profile?.coordinator_required === true,
      );
      if (r.missing.length > 0)
        throw new InputError(`חסרים פרטים חיוניים: ${r.missing.join(", ")}`);
      if (r.placeholders.length > 0)
        throw new InputError(`יש במסמך ${r.placeholders.length} פרטים להשלמה (מסומנים בצהוב)`);
      return manageRpc("site_document_publish", {
        _kind: data.kind,
        _title: draft.draft_title,
        _body: r.text,
        _expected_revision: draft.revision,
      });
    },
  );

export const hospitalityDocumentUnpublish = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseDocumentKind(input))
  .handler(async ({ data }): Promise<{ kind: string }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("site_document_unpublish", { _kind: data.kind });
  });

export const hospitalityDocumentReview = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseDocumentReview(input))
  .handler(async ({ data }): Promise<{ review_kind: string | null }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("site_document_review", {
      _kind: data.kind,
      _version: data.version,
      _review_kind: data.reviewKind,
      _reviewed_by: data.reviewedBy,
      _reviewed_on: data.reviewedOn,
    });
  });

export const hospitalityLegalProfileSave = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseLegalProfile(input))
  .handler(async ({ data }): Promise<{ revision: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("site_legal_profile_save", {
      _profile: data.profile,
      _expected_revision: data.expectedRevision,
    });
  });

export const hospitalityPropertyAccessibility = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    propertyId: uuid(input?.["propertyId"], "המתחם"),
  }))
  .handler(async ({ data }): Promise<PropertyAccessibility | null> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("property_accessibility_view", { _property_id: data.propertyId });
  });

export const hospitalityPropertyAccessibilitySave = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parsePropertyAccessibility(input))
  .handler(async ({ data }): Promise<PropertyAccessibility> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("property_accessibility_save", {
      _property_id: data.propertyId,
      _items: data.items,
      _confirmed: data.confirmed,
      _additional: data.additional,
      _contact_name: data.contactName,
      _contact_phone: data.contactPhone,
      _contact_email: data.contactEmail,
      _expected_revision: data.expectedRevision,
    });
  });

/** עמוד ההזמנה בניהול: אילו מסמכים האורח אישר (בלי מיגרציה 60 — רשימה ריקה) */
export const hospitalityBookingDocuments = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    bookingId: uuid(input?.["bookingId"], "ההזמנה"),
  }))
  .handler(async ({ data }): Promise<BookingDocument[]> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BookingDocument[]>("staff_booking_documents", {
      _booking_id: data.bookingId,
    }).catch((e: unknown) => {
      // מסד בלי מיגרציה 60 — אין מה להציג; כל שגיאה אחרת — כרגיל
      if (e instanceof Error && /staff_booking_documents/.test(e.message)) return [];
      throw e;
    });
  });
