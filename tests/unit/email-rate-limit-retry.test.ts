// src/lib/email.server.ts — 429 מ-Resend (מגבלת הקצב לחשבון): ניסיון חוזר אחד, כי המייל לא התקבל.
// בלי זה קוד כניסה שנשלח בדיוק כשתור המיילים שולח כמה מיילים ברצף נכשל ("לא הצלחנו לשלוח את
// הקוד"). שגיאה אחרת (למשל 403 — דומיין לא מאומת) לא נשלחת שוב.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
let replies: Reply[] = [];
let posts: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  replies = [];
  posts = [];
  vi.stubEnv("RESEND_API_KEY", "re_unit_test");
  vi.stubEnv("RESEND_API_URL", "http://resend.test");
  vi.stubEnv("EMAIL_FROM_ADDRESS", "orders@verified.example");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      posts.push({ url, body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> });
      const r = replies.shift() ?? { status: 200, body: { id: "msg-default" } };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const send = async () => {
  const { sendEmail } = await import("@/lib/email.server");
  return sendEmail({
    to: ["customer@example.test"],
    subject: "קוד הכניסה שלך: 123456",
    html: "<p>123456</p>",
    platformSender: { name: "חנות בדיקה" },
  });
};

describe("sendEmail — Resend rate limit (429)", () => {
  it("one 429, then accepted: sent, and the same email was posted twice", async () => {
    replies = [
      { status: 429, body: { name: "rate_limit_exceeded" }, headers: { "retry-after": "1" } },
      { status: 200, body: { id: "msg-2" } },
    ];
    const started = Date.now();
    const r = await send();
    expect(r).toMatchObject({ sent: true, outcome: "accepted", id: "msg-2" });
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual(posts[0]!.body);
    expect(posts[0]!.body["from"]).toBe('"חנות בדיקה" <orders@verified.example>');
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  });

  it("429 twice: rejected with Resend's reason, no third try", async () => {
    replies = [
      { status: 429, body: { name: "rate_limit_exceeded" }, headers: { "retry-after": "0" } },
      { status: 429, body: { name: "rate_limit_exceeded" } },
    ];
    const r = await send();
    expect(r.sent).toBe(false);
    expect(r.outcome).toBe("rejected");
    expect(r.reason).toContain("429");
    expect(posts).toHaveLength(2);
  });

  it("403 (domain not verified) is not retried", async () => {
    replies = [{ status: 403, body: { message: "The verified.example domain is not verified" } }];
    const r = await send();
    expect(r).toMatchObject({ sent: false, outcome: "rejected" });
    expect(r.reason).toContain("not verified");
    expect(posts).toHaveLength(1);
  });

  it("no key: nothing is posted, the skip is explicit", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const r = await send();
    expect(r).toMatchObject({ sent: false, skipped: true, outcome: "skipped" });
    expect(posts).toHaveLength(0);
  });
});
