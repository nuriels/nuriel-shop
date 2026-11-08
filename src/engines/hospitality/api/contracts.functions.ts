// מסמכי לקוחות (מיגרציה 64): הצוות — מצב, תצוגה מקדימה, שליחה לחתימה, שליחה חוזרת, ביטול, חוזה
// מתוקן, ארכיון, צפייה / הורדה ועותק חתום; הלקוח — פתיחת החוזה לפי הקישור וחתימה.
// ההרשאות, סוג החוזה מול ההזמנה / האירוע, החתימה החד-פעמית והנעילה — במסד. הקישור נוצר ונשלח בשרת
// בלבד; הדפדפן של הצוות לא מקבל אותו.
import { createServerFn } from "@tanstack/react-start";
import type {
  ContractDetail,
  ContractForSigning,
  ContractList,
  ContractPreview,
  ContractRow,
  ContractSendResult,
  ContractSigned,
  ContractsView,
} from "../types/contracts";
import {
  parseContractCancel,
  parseContractCreate,
  parseContractFile,
  parseContractId,
  parseContractSign,
  parseContractTarget,
  parseContractToken,
  parseContractsQuery,
} from "../validation/contracts";
import { uuid } from "../validation/input";

type SendPrepared = ContractRow & {
  tenant_id: string;
  actor_id: string;
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
};

async function staffLimit(action: "contractSend" | "contractFile"): Promise<void> {
  const [{ guardStaff }, { manageSession }] = await Promise.all([
    import("../security/guard.server"),
    import("../server/manage.server"),
  ]);
  const s = await manageSession();
  await guardStaff(action, { userId: s.userId, siteId: s.siteId });
}

export const hospitalityContractsView = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContractsView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ContractsView>("contracts_view", {});
  },
);

export const hospitalityContractPreview = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractTarget(input))
  .handler(async ({ data }): Promise<ContractPreview> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ContractPreview>("contract_preview", {
      _kind: data.kind,
      _booking_id: data.bookingId,
      _event_id: data.eventId,
      _guest_id: data.guestId,
      _signer: data.signer,
      _options: data.options,
    });
  });

/** יצירה + שליחה: הטיוטה במסד (בשם הצוות), ואז קישור ומייל (בשרת). מייל שנכשל — נשאר "טיוטה" */
export const hospitalityContractSend = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractCreate(input))
  .handler(async ({ data }): Promise<ContractSendResult> => {
    await staffLimit("contractSend");
    const [{ manageRpc }, { sendSignRequest }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/contracts.server"),
    ]);
    const created = await manageRpc<ContractRow>("contract_create", {
      _kind: data.kind,
      _booking_id: data.bookingId,
      _event_id: data.eventId,
      _guest_id: data.guestId,
      _signer: data.signer,
      _options: data.options,
      _supersedes: data.supersedes,
    });
    const prepared = await manageRpc<SendPrepared>("contract_send_prepare", { _id: created.id });
    return sendSignRequest(prepared);
  });

/** שליחה חוזרת (קישור חדש — הקודם מת) — לחוזה שעוד לא נחתם */
export const hospitalityContractResend = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractId(input))
  .handler(async ({ data }): Promise<ContractSendResult> => {
    await staffLimit("contractSend");
    const [{ manageRpc }, { sendSignRequest }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/contracts.server"),
    ]);
    return sendSignRequest(
      await manageRpc<SendPrepared>("contract_send_prepare", { _id: data.id }),
    );
  });

export const hospitalityContractCancel = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractCancel(input))
  .handler(async ({ data }): Promise<ContractRow> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ContractRow>("contract_cancel", { _id: data.id, _reason: data.reason });
  });

export const hospitalityContracts = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractsQuery(input))
  .handler(async ({ data }): Promise<ContractList> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ContractList>("staff_contracts", {
      _q: data.q,
      _kind: data.kind,
      _status: data.status,
      _event_type: data.eventType,
      _from: data.from,
      _to: data.to,
      _limit: data.limit,
      _offset: data.offset,
    });
  });

export const hospitalityContractDetail = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractId(input))
  .handler(async ({ data }): Promise<ContractDetail> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ContractDetail>("staff_contract_detail", { _id: data.id });
  });

export const hospitalityContractsFor = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const i = input ?? {};
    const bookingId = i["bookingId"] ? uuid(i["bookingId"], "ההזמנה") : null;
    const eventId = i["eventId"] ? uuid(i["eventId"], "האירוע") : null;
    return { bookingId, eventId };
  })
  .handler(async ({ data }): Promise<ContractRow[]> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ContractRow[]>("staff_contracts_for", {
      _booking_id: data.bookingId,
      _event_id: data.eventId,
    });
  });

/** צפייה / הורדה של ה-PDF החתום: קישור ל-60 שניות (ביומן) */
export const hospitalityContractFile = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractFile(input))
  .handler(async ({ data }): Promise<{ url: string }> => {
    await staffLimit("contractFile");
    const [{ manageRpc }, { contractFileUrl }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/contracts.server"),
    ]);
    const f = await manageRpc<{ path: string; number: number }>("contract_file_request", {
      _id: data.id,
      _purpose: data.purpose,
    });
    return { url: await contractFileUrl(f.path, f.number, data.purpose === "download") };
  });

/** העותק החתום — שוב ללקוח (במייל, עם ה-PDF) */
export const hospitalityContractCopy = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractId(input))
  .handler(async ({ data }): Promise<{ sent: boolean }> => {
    await staffLimit("contractSend");
    const [{ manageRpc }, { resendSignedCopy }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/contracts.server"),
    ]);
    const p = await manageRpc<{ tenant_id: string; id: string; actor_id: string }>(
      "contract_copy_prepare",
      { _id: data.id },
    );
    return { sent: await resendSignedCopy(p) };
  });

// ---------- הלקוח (בלי חשבון — לפי הקישור האישי) ----------

async function publicClient(action: "contractOpen" | "contractSign") {
  const [{ guardPublic }, { hospitalitySiteId }] = await Promise.all([
    import("../security/guard.server"),
    import("../server/rpc.server"),
  ]);
  return guardPublic(action, await hospitalitySiteId());
}

export const hospitalityContractOpen = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractToken(input))
  .handler(async ({ data }): Promise<ContractForSigning> => {
    const client = await publicClient("contractOpen");
    const [{ callServerRpc }, { tokenHash }] = await Promise.all([
      import("../server/rpc.server"),
      import("../server/contracts.server"),
    ]);
    return callServerRpc<ContractForSigning>(
      "contract_open",
      { _token_hash: tokenHash(data.token), _ip: client.ip, _user_agent: client.userAgent },
      client,
    );
  });

/** חתימה: פעם אחת (במסד), ואז ה-PDF, השמירה בדלי הפרטי והעותק במייל. תקלה אחרי החתימה — משלימים ברקע */
export const hospitalityContractSign = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseContractSign(input))
  .handler(async ({ data }): Promise<ContractSigned> => {
    const client = await publicClient("contractSign");
    const [{ callServerRpc }, { tokenHash, completeSignedContract }] = await Promise.all([
      import("../server/rpc.server"),
      import("../server/contracts.server"),
    ]);
    const signed = await callServerRpc<{ tenant_id: string; id: string; number: number }>(
      "contract_sign",
      {
        _token_hash: tokenHash(data.token),
        _fields: data.fields,
        _signature: data.signature,
        _agreed: data.agreed,
        _ip: client.ip,
        _user_agent: client.userAgent,
      },
      client,
    );
    try {
      const done = await completeSignedContract(signed.tenant_id, signed.id);
      return {
        number: signed.number,
        pdf: done.pdf ? Buffer.from(done.pdf).toString("base64") : null,
        copy_sent: done.copySent,
      };
    } catch (error) {
      console.error(
        "[hospitality/contracts] after signing",
        error instanceof Error ? error.message : error,
      );
      return { number: signed.number, pdf: null, copy_sent: false };
    }
  });
