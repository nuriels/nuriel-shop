import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMailSink, htmlToText } from "../../deploy/demo/mail-sink.mjs";

// שרת הדמה למיילים של שרת ה-DEMO (deploy/demo/mail-sink.mjs): מקבל את הבקשות של האפליקציה
// לפי הצורה של Resend, שומר בזיכרון בלבד, ולא שולח כלום לשום מקום.
const lines: string[] = [];
const { server, messages } = createMailSink({ log: (line: string) => lines.push(line) });
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = (body: unknown, auth = "Bearer demo-mail-sink") =>
  fetch(`${base}/emails`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("DEMO mail sink", () => {
  it("keeps an email in the shape the app sends and answers like Resend", async () => {
    const response = await post({
      from: '"חנות בדיקה" <orders@demo.invalid>',
      to: ["owner@demo.invalid"],
      subject: "קוד אימות",
      html: "<p>הקוד: <b>123456</b></p><p>תוקף 10 דקות &amp; שימוש אחד</p>",
    });
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(id).toMatch(/^demo_\d+_[0-9a-f]{8}$/);

    const status = await fetch(`${base}/emails/${encodeURIComponent(id)}`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ id, last_event: "delivered" });

    const list = (await (await fetch(`${base}/__mail?to=owner@demo.invalid&limit=1`)).json()) as {
      messages: { subject: string; text: string; to: string[] }[];
    };
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0]!.text).toContain("123456");
    expect(list.messages[0]!.text).toContain("תוקף 10 דקות & שימוש אחד");
    expect(list.messages[0]!.text).not.toContain("<");
  });

  it("logs only the id and the number of recipients — never addresses, subject or content", () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^\[mail-sink\] kept demo_\d+_[0-9a-f]{8} \(\d+ recipients?\)$/);
      expect(line).not.toContain("@");
      expect(line).not.toContain("123456");
    }
  });

  it("refuses a request without an API key, invalid JSON and a missing recipient", async () => {
    expect((await post({ to: ["a@demo.invalid"], subject: "x" }, "")).status).toBe(401);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ to: [], subject: "x" })).status).toBe(422);
  });

  it("does not keep attachment content, only the file name and size", async () => {
    const content = Buffer.from("x".repeat(3000)).toString("base64");
    const response = await post({
      to: "a@demo.invalid",
      subject: "contract",
      html: "<p>see attached</p>",
      attachments: [{ filename: "contract.pdf", content }],
    });
    expect(response.status).toBe(200);
    const last = messages.at(-1)!;
    expect(last.attachments).toEqual([{ filename: "contract.pdf", bytes: 3000 }]);
    expect(JSON.stringify(last)).not.toContain(content.slice(0, 40));
  });

  it("keeps only the last 200 messages", async () => {
    for (let i = 0; i < 205; i += 1) {
      const response = await post({ to: ["bulk@demo.invalid"], subject: `n${i}`, html: "" });
      expect(response.status).toBe(200);
    }
    expect(messages.length).toBe(200);
    expect(messages.at(-1)!.subject).toBe("n204");
  });

  it("answers the domains list (empty) and 404 for anything else", async () => {
    expect(await (await fetch(`${base}/domains`)).json()).toEqual({ object: "list", data: [] });
    expect((await fetch(`${base}/emails/unknown`)).status).toBe(404);
    expect((await fetch(`${base}/anything`)).status).toBe(404);
    expect((await fetch(`${base}/__health`)).status).toBe(200);
  });

  it("turns HTML into readable text", () => {
    expect(htmlToText("<style>.a{}</style><div>שורה 1</div><div>שורה&nbsp;2</div>")).toBe(
      "שורה 1\nשורה 2",
    );
  });
});
