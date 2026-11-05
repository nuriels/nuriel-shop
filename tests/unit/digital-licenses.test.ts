// מודול הרישיונות הדיגיטליים (פיילוט נוריאל מחשבים) — בדיקות יחידה:
// הצפנה, Tokens, בדיקות תקינות, חתימת קבצים, סטטוסים, תבנית המייל ותוצאת השליחה.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptLicenseKey,
  encryptLicenseKey,
  hashDownloadToken,
  licenseAad,
  licenseCryptoConfigured,
  licenseKeyFingerprint,
  newDownloadToken,
} from "@/lib/license-crypto.server";
import {
  DOWNLOAD_PATH,
  DOWNLOAD_TOKEN_FORMAT,
  LICENSE_DISCLAIMER,
  MAX_EXE_BYTES,
  MAX_PDF_BYTES,
  businessIdProblem,
  cleanCustomerName,
  cleanFileName,
  cleanOrderNumber,
  customerNameProblem,
  downloadUrl,
  emailProblem,
  fileExtensionProblem,
  fileSignatureProblem,
  fileSizeProblem,
  keyTail,
  linkState,
  maskedKey,
  normalizeBusinessId,
  normalizeEmail,
  normalizePhone,
  normalizeProductKey,
  orderNumberProblem,
  phoneProblem,
  productKeyProblem,
  productKeyWarning,
  statusFromProviderEvent,
} from "@/lib/licenses";
import {
  buildLicenseEmailHtml,
  escapeEmailText,
  licenseEmailSubject,
  type LicenseEmailBranding,
} from "@/lib/license-email";
import { nextEmailStatus } from "@/lib/licenses.server";

const SECRET = "unit-test-license-secret-0123456789abcdef0123456789";
const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const DELIVERY = "11111111-2222-4333-8444-555555555555";
const KEY = "BCDFG-HJKMN-PQRTV-WXY23-46789";

/** קובץ PE מינימלי: "MZ", e_lfanew = 0x40, ואז "PE\0\0" */
function tinyPe(size = 512): Uint8Array {
  const b = new Uint8Array(size);
  b[0] = 0x4d;
  b[1] = 0x5a;
  b[0x3c] = 0x40;
  b.set([0x50, 0x45, 0x00, 0x00], 0x40);
  return b;
}
const bytes = (text: string) => new TextEncoder().encode(text);

describe("license crypto", () => {
  beforeEach(() => vi.stubEnv("LICENSE_KEYS_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("is configured only with a long enough secret", () => {
    expect(licenseCryptoConfigured()).toBe(true);
    vi.stubEnv("LICENSE_KEYS_SECRET", "short");
    expect(licenseCryptoConfigured()).toBe(false);
    vi.stubEnv("LICENSE_KEYS_SECRET", "");
    expect(licenseCryptoConfigured()).toBe(false);
    expect(() => encryptLicenseKey(KEY, "x")).toThrow(/LICENSE_KEYS_SECRET/);
  });

  it("round-trips, never stores the plain key, and matches the DB format check", () => {
    const aad = licenseAad(TENANT_A, DELIVERY);
    const payload = encryptLicenseKey(KEY, aad);
    expect(payload).toMatch(/^v1:[A-Za-z0-9+/]+=*$/); // license_deliveries.key_ciphertext CHECK
    expect(payload).not.toContain(KEY);
    expect(payload).not.toContain(KEY.replace(/-/g, ""));
    expect(decryptLicenseKey(payload, aad)).toBe(KEY);
    // IV אקראי: אותו מפתח מוצפן אחרת בכל פעם
    expect(encryptLicenseKey(KEY, aad)).not.toBe(payload);
  });

  it("refuses ciphertext moved to another delivery / store, tampered or under another secret", () => {
    const payload = encryptLicenseKey(KEY, licenseAad(TENANT_A, DELIVERY));
    expect(() => decryptLicenseKey(payload, licenseAad(TENANT_B, DELIVERY))).toThrow();
    expect(() =>
      decryptLicenseKey(payload, licenseAad(TENANT_A, "99999999-2222-4333-8444-555555555555")),
    ).toThrow();
    const raw = Buffer.from(payload.slice(3), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0x01;
    expect(() =>
      decryptLicenseKey(`v1:${raw.toString("base64")}`, licenseAad(TENANT_A, DELIVERY)),
    ).toThrow();
    expect(() => decryptLicenseKey("v2:AAAA", licenseAad(TENANT_A, DELIVERY))).toThrow();
    vi.stubEnv("LICENSE_KEYS_SECRET", `${SECRET}-other`);
    expect(() => decryptLicenseKey(payload, licenseAad(TENANT_A, DELIVERY))).toThrow();
  });

  it("fingerprints per store without revealing the key", () => {
    const a = licenseKeyFingerprint(TENANT_A, KEY);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(licenseKeyFingerprint(TENANT_A, KEY)).toBe(a);
    expect(licenseKeyFingerprint(TENANT_B, KEY)).not.toBe(a);
    expect(licenseKeyFingerprint(TENANT_A, "BCDFG-HJKMN-PQRTV-WXY23-46788")).not.toBe(a);
  });

  it("download tokens: 256 random bits, only the SHA-256 is kept", () => {
    const { token, hash } = newDownloadToken();
    expect(token).toMatch(DOWNLOAD_TOKEN_FORMAT);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashDownloadToken(token));
    expect(hash).not.toContain(token);
    const many = new Set(Array.from({ length: 200 }, () => newDownloadToken().token));
    expect(many.size).toBe(200);
  });
});

describe("customer fields (same checks in the form and on the server)", () => {
  it("name", () => {
    expect(cleanCustomerName("  ישראל   ישראלי ")).toBe("ישראל ישראלי");
    expect(customerNameProblem("י")).not.toBeNull();
    expect(customerNameProblem("ישראל ישראלי")).toBeNull();
    expect(customerNameProblem('<script>"')).not.toBeNull();
    expect(customerNameProblem("א".repeat(121))).not.toBeNull();
  });
  it("email", () => {
    expect(normalizeEmail("  Dana@Example.CO.IL ")).toBe("dana@example.co.il");
    expect(emailProblem("dana@example.co.il")).toBeNull();
    expect(emailProblem("")).not.toBeNull();
    expect(emailProblem("dana@example")).not.toBeNull();
    expect(emailProblem('"x"@y.com')).not.toBeNull();
  });
  it("phone", () => {
    expect(normalizePhone("050-123-4567")).toBe("0501234567");
    expect(normalizePhone("+972 50 123 4567")).toBe("+972501234567");
    expect(phoneProblem("0501234567")).toBeNull();
    expect(phoneProblem("+972501234567")).toBeNull();
    expect(phoneProblem("12345")).not.toBeNull();
    expect(phoneProblem("")).not.toBeNull();
  });
  it("business id (optional, 9 digits with the Israeli check digit)", () => {
    expect(businessIdProblem("")).toBeNull();
    expect(normalizeBusinessId("12345678")).toBe("012345678");
    expect(businessIdProblem("123456782")).toBeNull();
    expect(businessIdProblem("123456789")).not.toBeNull();
    expect(businessIdProblem("12a456789")).not.toBeNull();
  });
  it("order number (optional)", () => {
    expect(cleanOrderNumber("  A-100 ")).toBe("A-100");
    expect(orderNumberProblem("")).toBeNull();
    expect(orderNumberProblem("#1001/24")).toBeNull();
    expect(orderNumberProblem("1; DROP")).not.toBeNull();
    expect(orderNumberProblem("x".repeat(41))).not.toBeNull();
  });
});

describe("license key", () => {
  it("normalizes to 5 groups of 5", () => {
    expect(normalizeProductKey(" bcdfg hjkmn pqrtv wxy23 46789 ")).toBe(KEY);
    expect(normalizeProductKey("BCDFGHJKMNPQRTVWXY2346789")).toBe(KEY);
    expect(productKeyProblem(KEY)).toBeNull();
    expect(productKeyProblem("")).not.toBeNull();
    expect(productKeyProblem("BCDFG-HJKMN")).not.toBeNull();
  });
  it("warns about characters Microsoft keys do not use", () => {
    expect(productKeyWarning(KEY)).toBeNull();
    expect(productKeyWarning("BCDFG-HJKMN-PQRTV-WXY23-4678O")).not.toBeNull();
  });
  it("is masked everywhere except the audited reveal", () => {
    expect(keyTail(KEY)).toBe("46789");
    const masked = maskedKey(keyTail(KEY));
    expect(masked).toBe("•••••-•••••-•••••-•••••-46789");
    expect(masked).not.toContain("BCDFG");
  });
});

describe("files: the real type, not the extension", () => {
  it("PDF signature", () => {
    expect(fileSignatureProblem("guide", bytes("%PDF-1.7\n..."))).toBeNull();
    expect(fileSignatureProblem("receipt", bytes("%PDF-1.4"))).toBeNull();
    expect(fileSignatureProblem("guide", bytes("<html>not a pdf"))).not.toBeNull();
    expect(fileSignatureProblem("guide", tinyPe())).not.toBeNull();
  });
  it("EXE = PE file (MZ + PE header where e_lfanew points)", () => {
    expect(fileSignatureProblem("installer", tinyPe())).toBeNull();
    expect(fileSignatureProblem("installer", bytes("%PDF-1.7 renamed to .exe"))).not.toBeNull();
    const mzOnly = tinyPe();
    mzOnly.set([0, 0, 0, 0], 0x40);
    expect(fileSignatureProblem("installer", mzOnly)).not.toBeNull();
    const pointsOutside = tinyPe(128);
    pointsOutside[0x3c] = 0xf0;
    expect(fileSignatureProblem("installer", pointsOutside)).not.toBeNull();
    expect(fileSignatureProblem("installer", new Uint8Array(10))).not.toBeNull();
  });
  it("extension, size and a safe file name", () => {
    expect(fileExtensionProblem("Guide.PDF", "guide")).toBeNull();
    expect(fileExtensionProblem("setup.exe", "guide")).not.toBeNull();
    expect(fileExtensionProblem("setup.exe", "installer")).toBeNull();
    expect(fileExtensionProblem("setup.msi", "installer")).not.toBeNull();
    expect(fileSizeProblem(0, "guide")).not.toBeNull();
    expect(fileSizeProblem(MAX_PDF_BYTES, "guide")).toBeNull();
    expect(fileSizeProblem(MAX_PDF_BYTES + 1, "receipt")).not.toBeNull();
    expect(fileSizeProblem(MAX_EXE_BYTES + 1, "installer")).not.toBeNull();
    expect(cleanFileName("..\\..\\Windows\\evil.exe", "installer")).toBe("evil.exe");
    expect(cleanFileName('../a"b<c>.pdf', "guide")).toBe("abc.pdf");
    expect(cleanFileName("report.exe", "receipt")).toBe("report.pdf");
    expect(cleanFileName("", "installer")).toBe("installer.exe");
  });
});

describe("statuses: only what the provider confirmed", () => {
  it("maps provider events", () => {
    expect(statusFromProviderEvent("delivered")).toBe("delivered");
    expect(statusFromProviderEvent("opened")).toBe("delivered");
    expect(statusFromProviderEvent("bounced")).toBe("failed");
    expect(statusFromProviderEvent("sent")).toBe("accepted");
    expect(statusFromProviderEvent("delivery_delayed")).toBe("accepted");
    expect(statusFromProviderEvent(null)).toBeNull();
    expect(statusFromProviderEvent("something_new")).toBeNull();
  });
  it("never claims delivery without a delivery event, never regresses a final status", () => {
    expect(nextEmailStatus("accepted", "sent")).toBe("accepted");
    expect(nextEmailStatus("accepted", null)).toBe("accepted");
    expect(nextEmailStatus("accepted", "delivered")).toBe("delivered");
    expect(nextEmailStatus("unknown", "delivered")).toBe("delivered");
    expect(nextEmailStatus("delivered", "sent")).toBe("delivered");
    expect(nextEmailStatus("delivered", "bounced")).toBe("failed");
    expect(nextEmailStatus("failed", "sent")).toBe("failed");
    expect(nextEmailStatus("accepted", "bounced")).toBe("failed");
  });
  it("link state: revoked > expired > exhausted > active", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    const base = {
      expires_at: "2026-11-10T12:00:00Z",
      download_count: 0,
      max_downloads: 3,
      revoked_at: null,
    };
    expect(linkState(base, now)).toBe("active");
    expect(linkState({ ...base, download_count: 3 }, now)).toBe("exhausted");
    expect(linkState({ ...base, expires_at: "2026-11-05T11:59:59Z" }, now)).toBe("expired");
    expect(linkState({ ...base, revoked_at: "2026-11-05T10:00:00Z", download_count: 3 }, now)).toBe(
      "revoked",
    );
  });
  it("download URL keeps the token in the fragment (never sent to the server)", () => {
    const token = "a".repeat(43);
    const url = downloadUrl("https://nuriel-shop.nuri1.fit/", token);
    expect(url).toBe(`https://nuriel-shop.nuri1.fit${DOWNLOAD_PATH}#${token}`);
    expect(new URL(url).search).toBe("");
    expect(new URL(url).hash).toBe(`#${token}`);
  });
});

describe("license email template", () => {
  const branding: LicenseEmailBranding = {
    businessName: "נוריאל מחשבים",
    logoUrl: "https://api-nuriel.nuri1.fit/storage/v1/object/public/branding/logo.png",
    phone: "050-000-0000",
    email: "info@example.com",
    website: "https://nuriel-shop.nuri1.fit",
    address: null,
    accent: "#1F5FD6",
  };
  const link = `https://nuriel-shop.nuri1.fit/license-download#${"t".repeat(43)}`;
  const html = (over: Partial<Parameters<typeof buildLicenseEmailHtml>[0]> = {}) =>
    buildLicenseEmailHtml(
      {
        customerName: "דנה כהן",
        product: "office",
        licenseKey: KEY,
        orderNumber: "A-100",
        downloadUrl: link,
        attachments: ["Nuriel-Office-Install-Guide.pdf"],
        ...over,
      },
      branding,
    );

  it("is RTL Hebrew, branded, with the title, key, disclaimer and download button", () => {
    const out = html();
    expect(out).toContain('<html dir="rtl" lang="he">');
    expect(out).toContain("הרישיון הדיגיטלי שלך מוכן!");
    expect(out).toContain("שלום דנה כהן");
    expect(out).toContain(KEY);
    expect(out).toContain(LICENSE_DISCLAIMER);
    expect(out).toContain("&#11015;&#65039; להורדת תוכנת ההתקנה");
    expect(out).toContain(`href="${link}"`);
    expect(out).toContain("Nuriel-Office-Install-Guide.pdf");
    expect(out).toContain("נוריאל מחשבים");
    expect(out).toContain('href="tel:0500000000"');
    expect(out).toContain("max-width:600px");
    expect(out).toContain("A-100");
  });

  it("subject per product", () => {
    expect(licenseEmailSubject("office")).toBe("הרישיון הדיגיטלי שלך מוכן! — Microsoft Office");
    expect(licenseEmailSubject("windows")).toBe("הרישיון הדיגיטלי שלך מוכן! — Microsoft Windows");
  });

  it("escapes everything that comes from outside", () => {
    const out = html({ customerName: '<img src=x onerror="alert(1)">', orderNumber: "<b>1</b>" });
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(out).not.toContain("<b>1</b>");
    expect(escapeEmailText(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("no download button without a link; never a non-http link", () => {
    expect(html({ downloadUrl: null })).not.toContain("להורדת תוכנת ההתקנה");
    const js = html({ downloadUrl: "javascript:alert(1)" });
    expect(js).not.toContain("javascript:");
    const preview = html({ downloadUrl: null, downloadPlaceholder: true });
    expect(preview).toContain("להורדת תוכנת ההתקנה");
    expect(preview).toContain('href="#"');
  });

  it("without a logo the store name is the header — not repeated under it", () => {
    const withLogo = html();
    const noLogo = buildLicenseEmailHtml(
      {
        customerName: "דנה כהן",
        product: "office",
        licenseKey: KEY,
        downloadUrl: link,
        attachments: [],
      },
      { ...branding, logoUrl: null },
    );
    expect(withLogo).toContain("letter-spacing:1px;margin-top:10px;");
    expect(noLogo).not.toContain("letter-spacing:1px;margin-top:10px;");
    expect(noLogo).toContain(
      '<div style="font-size:22px;font-weight:bold;color:#ffffff;">נוריאל מחשבים</div>',
    );
  });

  it("no attachments block when nothing is attached", () => {
    expect(html({ attachments: [] })).not.toContain("מצורפים למייל");
    expect(html({ attachments: ["guide.pdf", "receipt.pdf"] })).toContain("receipt.pdf");
  });
});

describe("send outcome: accepted ≠ delivered (honest email status)", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_unit_test");
    vi.stubEnv("RESEND_API_URL", "http://resend.invalid");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const send = async () => {
    const { sendEmail } = await import("@/lib/email.server");
    return sendEmail({
      to: ["dana@example.com"],
      subject: "s",
      html: "<p>x</p>",
      platformSender: { name: "נוריאל מחשבים" },
      attachments: [{ filename: "guide.pdf", content: "JVBERi0=" }],
    });
  };

  it("provider accepted → accepted (with id), and the attachment is sent", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "re-123" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await send();
    expect(result).toMatchObject({ sent: true, outcome: "accepted", id: "re-123" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://resend.invalid/emails");
    const body = JSON.parse(String(init?.body)) as { attachments?: unknown };
    expect(body.attachments).toEqual([{ filename: "guide.pdf", content: "JVBERi0=" }]);
  });
  it("provider refused → rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"invalid"}', { status: 422 })),
    );
    expect(await send()).toMatchObject({ sent: false, outcome: "rejected" });
  });
  it("network failure → transport_error (status unknown — the email may have left)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNRESET"))),
    );
    expect(await send()).toMatchObject({ sent: false, outcome: "transport_error" });
  });
  it("no API key → skipped", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await send()).toMatchObject({ sent: false, outcome: "skipped" });
  });
});
