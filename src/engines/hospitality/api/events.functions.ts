// אירועים במתחם (מיגרציה 63): רשימה, אירוע, בדיקת זמינות, יצירה, עדכון ומצב; ותנאי העסק לחוזים
// ולאירועים. הכללים (50 משתתפים, אין חפיפה, אורחים בצימרים, הרשאות, יומן) — במסד, עם הטוקן של המשתמש.
import { createServerFn } from "@tanstack/react-start";
import type { CustomerUpdateResult } from "../types/customer";
import type {
  BusinessTermsView,
  EventCheck,
  EventDetail,
  EventList,
  StaffEvent,
} from "../types/events";
import {
  parseEventCheck,
  parseEventCreate,
  parseEventId,
  parseEventStatus,
  parseEventUpdate,
  parseEventsQuery,
  parseTermsConfirm,
  parseTermsSave,
} from "../validation/events";
import { parseEventCustomerUpdate } from "../validation/customer";

export const hospitalityEvents = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEventsQuery(input))
  .handler(async ({ data }): Promise<EventList> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<EventList>("staff_events", {
      _tab: data.tab,
      _q: data.q,
      _type: data.type,
      _from: data.from,
      _to: data.to,
      _limit: data.limit,
      _offset: data.offset,
    });
  });

export const hospitalityEventDetail = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEventId(input))
  .handler(async ({ data }): Promise<EventDetail> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<EventDetail>("staff_event_detail", { _id: data.id });
  });

/** בדיקה בלי שמירה — הטופס בודק תוך כדי הקלדה (אירועים חופפים, אורחים בצימרים, שעות הבריכה) */
export const hospitalityEventCheck = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEventCheck(input))
  .handler(async ({ data }): Promise<EventCheck> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<EventCheck>("event_check", { _data: data.data, _exclude: data.exclude });
  });

export const hospitalityEventCreate = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEventCreate(input))
  .handler(async ({ data }): Promise<StaffEvent> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<StaffEvent>("event_create", { _data: data.data });
  });

export const hospitalityEventUpdate = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEventUpdate(input))
  .handler(async ({ data }): Promise<StaffEvent> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<StaffEvent>("event_update", {
      _id: data.id,
      _revision: data.revision,
      _data: data.data,
    });
  });

export const hospitalityEventSetStatus = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEventStatus(input))
  .handler(async ({ data }): Promise<StaffEvent> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<StaffEvent>("event_set_status", {
      _id: data.id,
      _revision: data.revision,
      _status: data.status,
      _reason: data.reason,
      _lodging_ack: data.lodgingAck,
    });
  });

export const hospitalityBusinessTerms = createServerFn({ method: "GET" }).handler(
  async (): Promise<BusinessTermsView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BusinessTermsView>("business_terms_view", {});
  },
);

export const hospitalityBusinessTermsSave = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseTermsSave(input))
  .handler(async ({ data }): Promise<BusinessTermsView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BusinessTermsView>("business_terms_save", {
      _data: data.data,
      _revision: data.revision,
    });
  });

export const hospitalityBusinessTermsConfirm = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseTermsConfirm(input))
  .handler(async ({ data }): Promise<BusinessTermsView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BusinessTermsView>("business_terms_confirm", { _revision: data.revision });
  });

/** מיגרציה 65: תיקון פרטי הלקוח של האירוע — בכרטיס או רק באירוע הזה (בלי קישור ובלי מייל) */
export const hospitalityEventCustomerUpdate = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEventCustomerUpdate(input))
  .handler(async ({ data }): Promise<CustomerUpdateResult> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<CustomerUpdateResult>("event_customer_update", {
      _event_id: data.id,
      _expected_revision: data.revision,
      _data: data.data,
      _scope: data.scope,
    });
  });
