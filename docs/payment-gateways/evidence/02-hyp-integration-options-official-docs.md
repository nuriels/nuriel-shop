# Hyp integration options: a map from the official docs (Hyp Pay and Hyp Enterprise)

**Checked:** 2026-11-27.
**Sources:** only https://developers.hyp.co.il/. This report builds on `docs/payment-gateways/evidence/01-hyp-pay-official-docs.md`. Its Hyp Pay findings are reused here, not redone.

**Coverage:**
- **Hyp Enterprise:** all 86 pages listed in `llms.txt` were downloaded and read. That list equals `enterprise/sitemap-pages.xml`. The read depth is in §5.
- **Hyp Pay:** all 30 pages plus the platform intro were downloaded again. Pages were re-opened only to fill gaps.

**Raw evidence:** one file per page in `(raw page copies kept outside the repo — Hyp's documentation is copyrighted; URLs are listed below) `. Each file is GitBook's `.md` copy, and its name is the URL path with `/` replaced by `__`.

**Constraints I followed:**
- I sent no request to any API, payment or console host: not pay.hyp.co.il, not `*.creditguard.co.il`, not link-uat, not `/xpo/Relay`, not sns.amazonaws.com.
- I did not use the Hyp playground, GitBook's `?ask=` endpoint or its MCP server.
- I used no credentials.
- Sample terminal numbers, MIDs and passwords from the docs are written as `<sample terminal>`. Test cards are cited by page URL only.

**Notation:**
- `P/x` means `https://developers.hyp.co.il/pay/x`.
- `E/x` means `https://developers.hyp.co.il/enterprise/x`.
- Quotes are the rendered text, with Markdown link and bold markup removed.
- "**Inference:**" marks my own reading. Everything else is what the docs say.

---

## 0. Key findings

1. **Server-to-server (S2S) confirmation of a hosted-page payment is documented only for Hyp Enterprise.** There are two mechanisms:
   - Amazon SNS webhooks. They are set up in the Hyp Console per merchant, for all terminals or selected ones, in JSON or XML. Each message is signed and checked the standard AWS SNS way.
   - `inquireTransactions` with `queryName=mpiTransaction` + `mid` + `mpiTransactionId` (the redirect's `txId`). Lookups by `cgUid`, `user` and date ranges also work.
2. **Hyp Pay documents no notification and no transaction lookup.**
   - Its only server-side check is `action=APISign&What=VERIFY`. Your server sends the browser redirect's parameters back to Hyp, so VERIFY only works if the redirect reached you.
   - `payRequest&iCommand=LIST` covers payment links only. It returns the last 500 links with no filter, and the docs' example shows `transId: null` even for status `3` (Paid).
3. **Enterprise's own guidance does not ask for S2S checks on every payment.**
   - Validation is "not required".
   - The redirect MAC is "preferred". It is a local SHA-256 over values the browser delivers, plus the merchant password, so it is not S2S.
   - The inquiry API is "not meant to be performed on a continuous basis".

   **Inference:** a docs-compatible way to meet our rule is webhook-first, with an inquiry only as a targeted fallback. We need Hyp's OK on inquiry volume (Q10).
4. **Return URLs.**
   - **Enterprise:** set per request (`successUrl`, `errorUrl`, `cancelUrl`), and so is `frameAncestorURLs`. Routing each store's return is therefore simple.
   - **Hyp Pay:** set per terminal in the portal only; no per-request parameter is documented. Each store's terminal must be configured with a store-specific platform URL.
5. **Enterprise webhook payloads can be routed to a store.**
   - The decoded example carries `terminalNumber`, `mpiTransactionId` (= `txId`), `cgUid`, `customerData/userDataN`, `total`, `status` and `financialStatus`.
   - SNS `MessageAttributes` repeat `terminalNumber`, `total`, `result` and `userData1`. The example TopicArn names the merchant ID.
   - The catch: the subscription lives in each merchant's own Hyp Console.
6. **Neither product documents a platform, marketplace, sub-merchant or partner model.**
   - **What Enterprise mentions:** undefined "ravMutav" and "ravSapak" modes, `routeCode`, more than one MID per console, refund lookup across terminals, and a cross-merchant token setting it calls "highly dangerous".
   - **Enterprise credentials (per merchant):** username, password, MID and terminal, plus a base URL per environment that "may vary".
   - **Hyp Pay credentials (per terminal):** `Masof`, `KEY` and `PassP`.
7. **Other features in both products.** Both document two-phase commits (J5), tokens, recurring payments, refunds and installments. Two gaps:
   - Hyp Pay's Hyp-managed recurring (`HK`) has **no documented notification or status API** for the later automatic charges.
   - Enterprise has **no** built-in subscription engine.
8. **Test environments.**
   - **Hyp Pay:** same URL as production; test terminals start with `00100`; wallets, bit and 3DS work fully only in production.
   - **Enterprise:** separate base URLs and credentials per environment, and mock transactions. There is no shared sandbox. Test cards come from the card issuers, or you request an "internal approval" terminal. bit has no test environment.
9. **Character encoding, rate limits and IP allow-listing are not documented** for either product.
   - In Hyp Pay, `UTF8`/`UTF8out` appear only on `soft` and on offline invoices.
   - Enterprise code samples use UTF-8.
   - Both require TLS 1.2 or higher.
   - Enterprise idempotency is `mayBeDuplicate` + `requestId`, which needs terminal configuration. Webhook duplicates are spotted with `x-amz-sns-message-id`.

---

## A. Answers to the specific questions

### (a) Is there a documented S2S confirmation of a hosted-page payment?

| Product | Mechanism | Authentication / signing | Configuration | Retries / timing | Source + exact quote |
|---|---|---|---|---|---|
| Hyp Pay | **None documented** (no webhook, notify URL, IPN or lookup by `Id`/`Order`). The only check: your server calls `APISign` `What=VERIFY` with the redirect parameters. | VERIFY uses the `Masof` + `KEY` + `PassP` query string over HTTPS. | `Sign=True` in SIGN, plus the portal setting "Verify by signature in the payment page". | not documented | `P/security/transaction-validation`: "Hyp Pay has an API endpoint that lets you verify the transaction details directly with our servers." A search of all Pay pages for webhook, notif, callback and IPN found nothing. |
| Hyp Pay (links only) | `payRequest` `iCommand=LIST`: a JSON list of recent links with a status. | `Masof` + `PassP` | Feature enabled in "Hyp Market". | not documented | `P/common-use-cases/send-payment-links`: "representing up to the 500 most recent links created on your terminal." |
| Hyp Enterprise | **Webhook (push)** sent by Amazon SNS as HTTPS POST to your endpoint. Message types: `SubscriptionConfirmation`, `Notification`, `UnsubscribeConfirmation` (header `x-amz-sns-message-type`). | SNS message signature (`SignatureVersion`, `Signature`, `SigningCertURL` in the JSON). Hyp points to AWS's verification guide; there is no Hyp-specific HMAC. To confirm the subscription, GET the `SubscribeURL`. | **Per merchant in the Hyp Console**, not per request. Path: Manage → Webhook Service Management → Payment page → New Subscription, with Subscription Name, ENDPOINT Address, Alert Format (JSON/XML), and Terminal Selection (all or specific). Your endpoint needs a certificate from a trusted CA. | "sent asynchronously (usually within seconds with a retry mechanism)". Reply 200–4xx within 15 s, otherwise SNS retries. De-duplicate with `x-amz-sns-message-id`. | `E/payment-page-integration/webhooks`: "Hyp Enterprise push notifications are powered by Amazon SNS"; "Choose whether to receive notifications for All Terminals or select specific terminals from the list."; "Amazon's best practice recommendation is that you verify every SNS message." |
| Hyp Enterprise | **Inquiry (pull)**: `inquireTransactions` with `queryName=mpiTransaction`, `mid`, `mpiTransactionId`=`txId`. Result `row`: `uniqueid`, `amount`, `currency`, `authNumber`, `cardId`, `statusCode`/`statusText`, `errorCode`, `cgGatewayResponseCode`, plus the embedded `doDeal` response. Not found → `result` 689. | API `user`/`password` (or `sessionId`) over TLS | Per request | "not intended for every transaction" | `E/advanced-security-guidelines/transaction-validation`: "`queryName`: must be set to `mpiTransaction`." / "If all the values match, the transaction is valid." / "If you need to validate all transactions, use the MAC validation method instead." |
| Hyp Enterprise | Inquiry by `cgUid`. It returns the `TxnSetup` row and the `AutoComm` row. Other lookups: `tranId`, `user`, `orgUid`, and date ranges (10 days by default, 50 results per page). | same | same | "Use them sparingly" | `E/inquiring-transactions/examples`: "Hyp Enterprise will return two transaction elements in the response: one for the initial payment page request and another for the actual debit transaction." |

### (b) Hyp Pay `payRequest` (payment links) and `iCommand=LIST`

| Item | What the docs say | Source + quote |
|---|---|---|
| CREATE, required | `action=payRequest`, `iCommand=CREATE`, `Masof`, `PassP`, `Amount`, `ClientName`, and `email` and/or `cell`. `KEY` is not listed. | `P/common-use-cases/send-payment-links`: "`iCommand`: Must be set to `CREATE`." |
| CREATE, optional | `PageLang`, `Coin`, `UserId`, `Info`, `ClientLName`, `Fild1`, `Tash`, `FixTash`, `tashType`, `HK`, `freq`, `SendHesh`, `Pritim`, `heshDesc` | same: "`Fild1`: A "free" field you can use for your own reference. It's returned in the response but isn't saved on our servers." |
| CREATE, response | `payRequestId`, `paymentURL`, `Fild1`. On error: `CCode` (e.g. `16`). | `P/reference/actions#create-and-send-a-payment-link`: "`payRequestId` — The unique ID for this payment link. Save this to manage the link later." |
| LIST, parameters | `action=payRequest`, `iCommand=LIST`, `Masof`, `PassP` only. **No filter by id or date.** | `P/reference/actions#get-a-list-of-payment-links` (parameter table) |
| LIST, response | A JSON array. Reference fields: `payRequestId`, `status`, `Amount`, `paymentURL`. The guide's example adds `Info`, `sendTo`, `ClientName`, `ClientLName`, `dateCreated` and `transId`, but `transId` is `null` in both objects, including the one with status `3`. | `P/common-use-cases/send-payment-links`: "representing up to the 500 most recent links created on your terminal." |
| Statuses | 0 Deleted, 1 New, 2 Sent, 3 Paid | same: "`3`: Paid - The customer has successfully completed the payment." |
| DELETE | `PayRequest`=`payRequestId`. Response `CCode`, `status`. Errors: 995 already paid, 250 not found, 901 no permission, 902 authentication. | same: "`995`: The link cannot be deleted because it's already been paid." |
| Usable as a documented S2S status check? | **Only for payment links, and only in part.** LIST is an authenticated S2S call that reports status 3 = Paid. But it is capped at 500 links, has no filter, and no transaction id appears in the examples, so you cannot reconcile amount or transaction from it. It does not cover `APISign` hosted pages. Hyp does not position LIST as a validation mechanism. | (assessment of the quotes above) |
| Can a link return the shopper to a store URL? | **not documented.** CREATE has no success or return URL parameter, and the docs never say whether the terminal's portal success URL applies to links. | `P/reference/actions#create-and-send-a-payment-link` (no such parameter in the table) |

### (c) Hyp Pay `APISign` `What=VERIFY`: what does `CCode=0` assert?

| Question | What the docs say | Source + quote |
|---|---|---|
| Meaning of `CCode=0` | The parameter set and signature are **"valid and authentic"** and match Hyp's records. One page describes VERIFY more broadly, as checking "whether the transaction has indeed occurred". **No page says outright that VERIFY confirms approval or capture.** | `P/reference/actions#validate-a-transaction`: "`0` indicates the transaction is valid and authentic." · `P/security/transaction-validation`: "If everything looks good and the parameters match what we have on file, you'll get a success code" · `P/introduction/what-is-a-payment-page`: "make an additional API call to Hyp that checks whether the transaction has indeed occurred." |
| What VERIFY compares | The `Sign` in the redirect against the transaction | `P/security/transaction-validation`: "you're asking Hyp Pay to confirm that the signature matches the provided transaction." |
| Failure | Bad signature or unknown transaction → error. Listed codes: 200 missing redirect parameters, 902 authentication, 904 missing `What`. | same: "If the validation fails — like if the signature is wrong or the transaction doesn't exist — you'll get an error code." |
| Declined payments | With the default portal setting, declines are shown on Hyp's page and **not redirected**. With an error URL configured, declines are redirected there. **What VERIFY returns for a decline: not documented.** | `P/getting-started/prerequisites-and-initial-setup`: "we recommend configuring only the success URL and keeping the default option to display errors on the Hyp Pay payment page" |
| 600 / 700 / 800 | Without an error URL, a 700 goes to the **success** URL; with one, it goes to the error URL. **What VERIFY returns for 600, 700 or 800: not documented.** | `P/advanced-features/two-phase-commits`: "If you've chosen to display errors on the payment page instead of using a custom error page, Hyp Pay will redirect to the success page." |
| Parameter order | Every redirect parameter, in the original order, appended after `action`, `What`, `Masof`, `KEY` and `PassP`. | `P/security/transaction-validation`: "Every parameter that was sent to your success page URL, in the exact same order." |
| Encoding | **not documented** for VERIFY: no word on raw versus re-encoded values or on charset. The example forwards the values percent-encoded, exactly as they came in the redirect. The general rule for requests is to URL-encode values. | `P/getting-started/creating-a-payment-page`: "Make sure to URL-encode all parameter values before constructing the request URL" |
| Is VERIFY mandatory? | "Recommended"; the docs also call it "not strictly required". | `P/security/transaction-validation`: "We recommend validating every transaction before you ship an order" · `P/getting-started/creating-a-payment-page`: "While it's not strictly required, we definitely recommend validating" |

### (d) Hyp Enterprise, in detail

| Topic | What the docs say | Source + quote |
|---|---|---|
| Contracts | 1. Acquiring agreement giving an "Internet" vendor number. 2. Hyp service agreement. 3. Optional integration agreement. 4. Hyp submits the terminal to Shva. | `E/introduction/prerequisites-and-requirements`: "Hyp Enterprise is currently not a self-service platform" |
| Credentials | Username, password, MID and terminal number for the API; separate credentials for the Console; base URLs for test and production. | `E/introduction/key-concepts-and-terminology`: "API access to Hyp Enterprise requires a combination of username, password, terminal number, and merchant ID." · `E/introduction/authentication-and-security`: "The sets of credentials for the Hyp Console and APIs are not interchangeable" |
| Extra API users | One set per environment is usually enough. More credentials mean another merchant account. | `E/introduction/authentication-and-security`: "If you still require additional API credentials, please reach out to the Hyp sales team to set up another merchant account." |
| Session authentication | `getSessionId` returns a `sessionId` that replaces `user`/`password`. Valid 10 min. It can be scoped to a command, `validation` and `transactionType`. Terminal support is required (otherwise error 455). | `E/api-reference/getsessionid`: "use it in place of username/password by sending `sessionId` as a form parameter" |
| IP allow-listing | **not documented** (in either direction). Webhook receivers must let Amazon SNS through their firewall. | `E/payment-page-integration/webhooks`: "The firewall protecting your receiver application's endpoint must allow traffic from Amazon SNS." |
| Endpoints | `POST https://your-hyp-environment-url/xpo/Relay`. Hyp provides the real base URL per environment; none is published. The examples show test-environment (UAT) page hosts under `*.creditguard.co.il` and `link-uat.hyp.co.il` (not contacted). | `E/api-reference/dodeal`: "The endpoint server may vary by environment (production, sandbox, etc.). Please verify the correct endpoint URL with Hyp support." |
| Hosted page flow | `doDeal` with `validation=TxnSetup` → `mpiHostedPageUrl` (single-use, 10 min) → shopper pays → redirect to `successUrl`, `errorUrl` or `cancelUrl`. A transition page allows up to 3 retries on error. | `E/payment-page-integration/integrating-hyps-payment-page-and-accepting-payment`: "The payment page URL is valid for 10 minutes and can only be used to perform a single payment." |
| Return-URL model | Per request. The API reference marks the URLs "Recommended" with "Valid HTTPS URL"; the validation-types table lists all three as required for `TxnSetup`. **There is no per-request notify URL:** notifications are a Console subscription. | `E/api-reference/dodeal`: "URL to redirect customers after a successful payment." |
| Validation guidance | Optional. The MAC is preferred: SHA-256 hex of password + `txId` + `errorCode` (default `000`) + `cardToken` + `cardExp` + `personalId` + `uniqueId`, in that order. An inquiry is the alternative. A webhook is the reliable fallback. **Inference:** the MAC does not cover the amount, `authNumber` or `cgUid`. | `E/advanced-security-guidelines/transaction-validation`: "Validation is not required" / "Hash the resulting string using SHA-256, encode it as a hexadecimal string, and compare the resulting value with `responseMac`." |
| `inquireTransactions` | See (a). Also: `financialStatus` values `Authorized`, `Rejected`, `Captured`, `Transmitted`, `Pending`, `Cancelled`, `Transferred`, `Error`, `Other`. `transactionDate` is in "IDT". `queryName`/`mpiTransactionId` are missing from the API reference page. | `E/inquiring-transactions/overview`: "Transaction inquiries are not meant to be performed on a continuous basis." |
| Webhooks | **Subscription:** Console form; `SubscriptionConfirmation` → GET `SubscribeURL`; status goes from "Pending Approval" to active. **Format:** `Message` is Base64; once decoded it is XML (same shape as an inquiry `transaction`) or JSON. **Attributes:** `result`, `terminalNumber`, `total`, `jcode`, `posTransaction`, `cardType`, `financialStatus`, `tranCode`, `userData1`, `tranType`. **Unsubscribe:** in the Console or via `UnsubscribeURL`. **Other uses:** payment requests send J112 (link status) and J4 notifications; A2A sends Pending and then a final status, matched on `mpiTransactionId`. | `E/payment-page-integration/webhooks`: "This field contains a Base64-encoded string that you should decode to retrieve the raw transaction data." / "When structured as XML, this document follows the exact same structure as a transaction inquiry response" |
| Test environment | Same as production but with mock transactions; bit has no test environment. Test cards come from the issuers, or you request an "internal approval" terminal; its synthetic card data is on that page (not copied here). Switching to production changes the base URL, user/password, terminal and MID. | `E/introduction/environment-setup`: "It performs mock transactions, not real transactions." / "Hyp doesn't provide test cards directly." |

### (e) Character encoding

| Product | Requests | Redirect to the merchant | Responses | Source + quote |
|---|---|---|---|---|
| Hyp Pay | URL-encode every value. `UTF8=True` is documented **only** for `soft` (token charge, capture, payout) and offline invoices; **not for `APISign` or `payRequest`**. | **not documented.** In the 3DS example the bytes decode only as Windows-1255; that observation is from the earlier research. | `UTF8out=True` (UTF-8 response) documented only for `soft` and offline invoices. Otherwise not documented. | `P/reference/actions#charge-a-saved-token`: "Set to `True` if the request data is encoded in UTF-8." · `P/reference/actions#create-an-invoice-for-an-offline-transaction`: "Set to `True` to ensure Hebrew characters in parameters are processed correctly." |
| Hyp Enterprise | Form POST with a URL-encoded XML `int_in`. **No charset rule in the prose.** Code samples declare `<?xml version="1.0" encoding="UTF-8"?>` and URL-encode as UTF-8. `user` "supports Hebrew". Error 402 is "Invalid characters in XML string". | **not documented** | XML/JSON; charset not documented. The webhook JSON example contains Hebrew `statusText`. | `E/introduction/request-and-response-general-structure`: "include transaction details in the form of a URL-encoded XML payload" · `E/api-reference/inquiretransactions`: "Alphanumeric, 1-19 characters, supports Hebrew" |

### (f) Rate limits, timeouts, retries and idempotency, TLS, IP

| Topic | Hyp Pay | Hyp Enterprise |
|---|---|---|
| Rate limits | not documented | **not documented** as numbers. Inquiries should be used "sparingly" (`E/inquiring-transactions/overview`). Date ranges are capped at 10 days by default: "By default, Hyp Enterprise allows date ranges of up to 10 days" (`E/inquiring-transactions/examples`). Error code 690 is "Too many processes" (`E/api-reference/dodeal#all-response-codes`). |
| Timeouts | not documented for HTTP calls. Business windows: postpone 72 h; cancel until 22:00 on the same business day. | Webhook receiver: "within 15 seconds" (`E/payment-page-integration/webhooks`). Page URL: 10 min. Pay By Link: 10 min. Payment request: 1–240 h. `sessionId` and `sessionCD`: 10 min. bit QR: 9 min. Errors 303 "XPO (Ashrait) did not respond within the defined timeout" and 687 "MPI Transaction has expired (timeout)". A client-side HTTP timeout is **not documented**; the samples use `timeout=30`, an example value only. |
| Retries / idempotency | not documented. The status code list includes 425 "Duplicate record" (`P/reference/response-status-codes`). | `mayBeDuplicate=1` + `requestId` (≤20 chars) replays the completed transaction or finishes the incomplete one. It needs terminal configuration (otherwise error 349): "Using `mayBeDuplicate` requires the merchant to generate and include a unique `requestId` with every transaction" (`E/introduction/request-and-response-general-structure`). `uniqueid` must be unique for ≥24 h. Errors 688 "MPI Transaction already submitted" and 458 "Duplicate transactions". Webhooks: SNS retries, de-duplicated with `x-amz-sns-message-id`. |
| TLS | "We require TLS 1.2 or higher for all connections." (`P/getting-started/authentication-security`); the cipher list is on `P/security/network-security-at-hyp`. | "Ensure that API calls are performed over TLS 1.2 or higher." (`E/introduction/authentication-and-security`). TLS 1.3 is preferred; the suite list is on `E/advanced-security-guidelines/network-security-at-hyp`. The webhook endpoint needs a trusted-CA certificate. |
| IP | not documented | not documented. SNS must be let through your firewall, and the SNS User-Agent may need allowing on Cloudflare. |
| Health | not documented | `performMonitors`/`NOOP` command, plus status pages (`E/advanced-considerations/status-monitoring`): "If `monitorValue` is `0`, the system is healthy." |

---

## 1. Per-option tables

### 1.1 Hosted payment page: redirect and iframe

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| When to use | Collecting new card details on a Hyp-hosted page. `P/introduction/what-is-a-payment-page`: "Payment pages are great for securely taking new card details." | Immediate card payment. `E/introduction/when-to-use`: "Let the customer enter a credit card number and pay immediately." |
| Required parameters | `action=APISign`, `What=SIGN`, `Masof`, `KEY`, `PassP`, `Amount`, plus `Sign=True`, which VERIFY needs. Common optional: `Order`, `ClientName`, `ClientLName`, `UserId`, `email`, `cell`, `PageLang`, `tmp`, `hideBtns`, `MoreData`. The browser then goes to `https://pay.hyp.co.il/p/?` + the SIGN response. `P/getting-started/creating-a-payment-page`: "just append the entire response to `https://pay.hyp.co.il/p/?`." | `doDeal` with `terminalNumber`, `cardNo=CGMPI`, `total` (agorot), `transactionType=Debit`, `creditType=RegularCredit`, `currency`, `transactionCode=Internet`, `validation=TxnSetup`, `mid`, `uniqueid` (≤64 chars), `mpiValidation=AutoComm`, `successUrl`, `errorUrl`, optional `cancelUrl`. `E/payment-page-integration/integrating-hyps-payment-page-and-accepting-payment`: "`validation`: should be set to `TxnSetup` to indicate that this is a payment page request." |
| Terminal / contract | Hyp service agreement, an acquirer "Internet" vendor number, a terminal and portal account per environment, and the portal setting "Verify by signature". `P/getting-started/prerequisites-and-initial-setup`: "By default, you receive one terminal and one Hyp Portal account per environment." | Acquirer agreement, Hyp service agreement and Shva setup. Cards are on by default; other payment methods are per-terminal configuration. `E/available-payment-options/overview`: "Other payment methods must be explicitly configured in the terminal settings." |
| Response | **SIGN:** URL-encoded parameters + `signature`. **Redirect:** `Id`, `CCode`, `Amount`, `ACode`, `Order`, `Fild1`–`Fild3`, `Sign` (with `MoreData`, also `UID`, `Brand`, `L4digit`, `Payments`…). `P/reference/actions#create-a-payment-page-request`: "A successful request returns a URL-encoded string containing all parameters and a `signature`" | **Creation:** `result`, `mpiHostedPageUrl`, `token` (the URL's `txId` in the examples), `cgUid`, `tranId`. **Redirect:** `uniqueID`, `lang`, `authNumber`, `cgUid`, `responseMac`, `cardToken`, `cardExp`, `personalId`, `cardMask`, `txId`, `numberOfPayments`, `firstPayment`, `periodicalPayment` (+`keepCCDetails`). `E/…/integrating-hyps-payment-page-and-accepting-payment`: "For security reasons, the unique transaction ID (`tranId`) is not included in the payment completion redirect." |
| Official verification | VERIFY; see (c) and §1.3. | MAC, inquiry or webhook; see (a) and §1.3. Same page: "we recommend also receiving notifications via webhooks as a reliable server-to-server fallback." |
| Iframe | Allowed. Use a CSP `frame-src` for `https://pay.hyp.co.il`. Wallets need the iframe attributes. For Apple Pay, place a domain file and register **each domain** in the portal. `P/common-use-cases/digital-wallets`: "make sure your `<iframe>` tag includes the `allow="payment"` attribute and the `allowpaymentrequest` property." | Add `paymentPageData/ppsJSONConfig` `{"frameAncestorURLs": "…"}` **per request**: space-separated, no wildcards. Use CSP `https://*.creditguard.co.il`. `redirectTargetParent` breaks out of the iframe. Apple Pay needs an association file, Hyp registration and an environment-specific script. CAPTCHA needs at least 580×400. `E/payment-page-integration/full-page-redirect-vs-iframe-based-integration`: "You cannot use wildcards in URLs" |
| Multi-store fit | **The return URL is per terminal (portal); a per-request URL is not documented.** Each store's terminal must point to a store-specific platform URL. The redirect does not document a terminal field, so the store has to be identified from the URL path or the `Order` value. `P/getting-started/prerequisites-and-initial-setup`: "specify the URL of the success page on your website that will be displayed to the user after a transaction completes." | **Per-request URLs and per-request `frameAncestorURLs`** suit many store domains. Branding is per MID: "The default template is configured per MID" (`E/changing-the-default-payment-page-appearance/templates`), overridable per request. "CAPTCHA is enabled per merchant ID (MID)" (`E/payment-page-integration/captcha`). |

### 1.2 API style ("XML API")

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| What it is | **No XML API.** It is a query-string API using GET (POST mostly equivalent). `P/reference/actions`: "Every API call on this page is made using a standard HTTP GET request. Most calls can also be performed using equivalent HTTP POST requests." | An XML command API ("Ashrait" envelope). `E/introduction/overview`: "this documentation covers Hyp Enterprise's XML API" |
| Endpoints | One: `https://pay.hyp.co.il/p/`. `P/reference/actions`: "All requests are sent to the base URL `https://pay.hyp.co.il/p/`" | One per environment: `POST https://your-hyp-environment-url/xpo/Relay`. `E/introduction/request-and-response-general-structure`: "Every Hyp Enterprise API call involves sending a POST request" |
| Request format | `action=…` plus parameters, URL-encoded. Actions: `APISign` (SIGN, VERIFY, PrintHesh), `CancelTrans`, `commitTrans`, `getToken`, `HKStatus`, `payRequest`, `soft`, `zikoyAPI`. | Form fields `user`, `password` and `int_in`, where `int_in` is URL-encoded XML: `<ashrait><request><version>2000</version><language>HEB/ENG</language><command>X</command><X>…</X>`. Optional `requestId` and `mayBeDuplicate`. Same page: "Current implementations should use `2000`." |
| Response format | A URL-encoded string, or JSON for LIST. HTTP status is always 200; parse `CCode`. HTML means a system error. `P/reference/actions`: "Hyp Pay returns a `200 OK` status code for almost all requests, even when an error occurs." | XML: `command`, `dateTime`, `requestId`, `tranId`, `result` (`000` = OK), `message`, `userMessage`, `additionalInfo`, plus the command element. Same page: "Successful commands return `000`, while errors return a specific code." Backward compatible, so parse defensively (`E/advanced-considerations/backwards-compatibility`). |
| Authentication | `Masof` + `KEY` + `PassP` in the query. Most actions list only `PassP`; payouts add `zPass`. `P/getting-started/authentication-security`: "Hyp uses query string API authentication." | `user` + `password` in the body, or a `sessionId` from `getSessionId`. `E/introduction/authentication-and-security`: "Hyp Enterprise uses basic credential-based API authentication." |
| Commands | listed above | **API reference:** `addCgInvoice`, `cancelDeal`, `doDeal`, `getCardId`, `getCardNo`, `getExternalCardId`, `getSessionId`, `inquireInvoice`, `inquireTransactions`, `refundCgInvoice`, `refundDeal`, `transmitInquire`, `transmitTerminal`. **Guide pages only:** `cancelPaymentLink`, `performMonitors`. |
| Multi-store fit | Per-terminal credentials, retrieved by the store owner in the portal. `P/getting-started/authentication-security`: "anyone who gets into your Hyp Pay account can also see your API credentials." | Per-merchant user, password and MID plus per-terminal numbers. The base URL may vary, so store it per store and environment (**inference**). `getSessionId` scopes allow short-lived, narrow sessions. Platform-level credentials: **not documented**. |

### 1.3 Callback, webhook or notification, and official result verification

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| When to use | Every hosted-page payment, after the redirect. `P/security/transaction-validation`: "We recommend validating every transaction before you ship an order or give a customer access to your service." | Webhooks as the S2S fallback for lost redirects, and mandatory for A2A and payment requests. Inquiry for specific doubtful cases. `E/payment-page-integration/webhooks`: "Webhooks provide a reliable server-to-server fallback" |
| Mechanism and parameters | **VERIFY:** `action=APISign`, `What=VERIFY`, `Masof`, `KEY`, `PassP`, then every redirect parameter in order. **Push: none** (not documented). | **Webhook:** Console subscription, nothing in the request. **Inquiry:** `inquireTransactions` + `terminalNumber`, `queryName=mpiTransaction`, `mid`, `mpiTransactionId`. **MAC:** recompute locally. `E/advanced-security-guidelines/transaction-validation`: "`mpiTransactionId`: the transaction ID that is returned as the `txId` parameter" |
| Prerequisites | `Sign=True` and the portal setting. `P/reference/actions#validate-a-transaction`: "You must have included `Sign=True` in the initial `APISign` request." | An HTTPS receiver with a trusted CA, able to handle `SubscriptionConfirmation` and to answer within 15 s. A2A additionally needs the endpoint URL given to Hyp. `E/available-payment-options/account-to-account`: "you must set up webhook notifications" |
| Response | `CCode=0`, or an error such as 200, 902, 904 | **Webhook:** SNS JSON whose `Message` is Base64 XML or JSON, plus `MessageAttributes`. **Inquiry:** a `row` with amount, status, `errorCode` and the embedded gateway XML; 689 means not found. |
| Signing / authenticity | Hyp's `Sign`, checked by Hyp; the algorithm is **not documented**. | **Webhook:** SNS signature checked by the AWS method (Hyp links AWS's guide). Hyp's official TopicArn or account is **not documented**; the example topic name pattern is `…environment_uat_eventType_mpiTransaction_cgServerId_…_merchantId_…`. **MAC:** SHA-256 with the merchant password. |
| Retries | not applicable (merchant pulls) | "usually within seconds with a retry mechanism". The SNS retry policy applies. Any 200–4xx counts as delivered. |
| Multi-store routing | VERIFY must be signed with **that store's** `KEY` and `PassP`, so the store must be known before verifying: from the per-store URL path or `Order`. No push exists to route. | The payload carries `terminalNumber`, `cgUid`, `mpiTransactionId` and `customerData/userData1..10`, which you set per request as hidden fields. The example has no `uniqueid`. Subscriptions sit in each merchant's Console and can cover all or selected terminals; whether one platform endpoint may serve many merchants is **not documented**. `E/changing-the-default-payment-page-appearance/adding-custom-input-fields`: "Sometimes, you may want to pass a piece of custom data to Hyp without displaying it on the payment page. One example is passing a unique transaction identifier." |

### 1.4 Two-phase commit (J5 authorization + capture)

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| When to use | Final amount unknown, or high value. `P/advanced-features/two-phase-commits`: "You can authorize an estimated maximum amount when the customer starts their journey" | Inventory or high value. `E/two-phase-commits/overview`: "If authorization is granted, the merchant performs the charge. This is called a capture request (J4)." |
| Parameters | **Page:** `J5=True` + `MoreData=True` → redirect `CCode=700`. Save `Id`, `ACode`, `UserId`, `UID`, then call `getToken`. **Capture:** `action=soft`, `Masof`, `PassP`, `UserId`, `ClientName`, `Token=True`, `CC`, `Tmonth`, `Tyear`, `AuthNum`, `Amount` (≤ authorized), `inputObj.originalAmount`, `inputObj.originalUid`, `inputObj.authorizationCodeManpik=7`, `Info`. **Alternatives:** `Postpone=True` → 800, finalize with `commitTrans` within 72 h for the exact amount; `J5=J2` → 600 (card check only). | **Page:** `mpiValidation=Verify` → save `cardToken`, `cardExp`, `cgUid` (+ installment fields). **Capture:** `doDeal` with `cardId`, `cardExpiration`, `total` (≤ authorized), `transactionType=Debit`, `creditType`, `currency`, `transactionCode` (`Phone` in the example), `validation=AutoComm`, `cgUid`. **Alternatives:** `AutoCommHold` (J9), released by `AutoCommRelease` (J109) with `tranId`; card-verification flow (small authorization, later `Verify` on a terminal without CVV). |
| Terminal / contract | Issuer pre-approval; not with bit. `P/advanced-features/two-phase-commits`: "Requires pre-approval from the issuer and may not support all card types." | Charging more than authorized needs terminal configuration and acquirer approval. `E/two-phase-commits/overview`: "this is possible but requires a specific terminal configuration and approval from your acquirer." |
| Validity | "usually around 5 days" (`P/advanced-features/two-phase-commits`) | "A standard limit is 5 days" (`E/two-phase-commits/overview`), **but** `E/api-reference/dodeal#notes` says "Pre-authorizations expire after 7-30 days". |
| Response / verification | The capture returns `CCode=0` synchronously over S2S. The authorization arrives as a 700 redirect; what VERIFY returns for it is **not documented**. `P/advanced-features/two-phase-commits`: "`CCode=0` indicates that the capture was successful and the customer has been charged." | Capture returns `result=000`. Use inquiry `financialStatus` (`Authorized`/`Captured`). A webhook for capture is **not documented**. To cancel a J5, use `cancelDeal`. `E/additional-payment-scenarios/refunds-and-cancellations`: "you should explicitly cancel instead of refunding." |
| Multi-store fit | The capture uses the store's credentials and token. A token works only on its own terminal, or via `tOwner` with the same business ID. | Same store credentials. The token is valid on any terminal of the same merchant. |

### 1.5 Tokenization

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| When to use | Repeat, recurring or J5 capture charges. `P/introduction/what-is-a-payment-page`: "To use these direct calls, you need a token." | Saved card, recurring, two-phase. `E/additional-payment-scenarios/tokenization`: "Tokens are required to implement the following payment scenarios" |
| Parameters | `action=getToken`, `Masof`, `PassP`, `TransId` (the redirect `Id`), optional `allowFalse`. Charge with `soft` (`Token=True`, `CC`, `Tmonth`, `Tyear`, `UserId`, `ClientName`, `Info`, `Amount`). | The token arrives in the redirect as `cardToken` + `cardExp` and is used later as `cardId` + `cardExpiration` (+ `id` if the terminal needs the Israeli ID). `ppsJSONConfig` `keepCCDetails` shows a consent checkbox, and the redirect returns `keepCCDetails=true`. A tokenize-only page uses `mpiValidation=Token` (J102). `getCardNo` returns the masked number. `getCardId`/`doDeal Token` take a raw card number (outside SAQ A). `getExternalCardId` migrates tokens. |
| Terminal / contract | `P/reference/actions#action-gettoken`: "Your terminal must have tokenization permissions." | `E/available-payment-options/saved-card`: "All terminals support saving credit cards by default." But `E/api-reference/dodeal#response-fields` says `cardId` is "Returned when a card-number transaction is performed and the Card ID module is purchased and configured to generate card IDs." |
| Response | `Token` (19 digits; last 4 match the card), `Tokef` (YYMM). Not in the redirect. `P/common-use-cases/tokenization`: "A token is always a 19-digit number where the last four digits match the original card." | 16-digit Luhn token; last 4 match the card. `E/additional-payment-scenarios/tokenization`: "It is never the same across merchants: the same credit card number is converted to a different token for different merchants." |
| Verification | The token charge's synchronous `CCode` | The charge's synchronous `result` |
| Multi-store fit | Tokens are per terminal; `tOwner` is allowed only with the same business ID. **Inference:** store tokens per store. `P/advanced-features/recurring-payments`: "Note that a two-terminal setup only works when both terminals use the same business ID." | Tokens are per merchant: "Yes, as long as the other terminal is registered to the same merchant account." A cross-merchant token setting exists and is called "highly dangerous". Wallet tokens are single-use. Most gift cards cannot be tokenized. A2A has no tokens. |

### 1.6 Recurring payments

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| When to use | **Hyp-managed** for fixed amounts; **merchant-managed** for variable amounts or intervals. `P/advanced-features/recurring-payments`: "Hyp takes care of the scheduling and charging for you." | Merchant-managed only. `E/recurring-payments-and-subscriptions/implementing-recurring-payments`: "Hyp Enterprise does not provide built-in subscription lifecycle management." |
| Parameters | **Hyp-managed:** on `APISign`, `HK=True`, `freq` (months), `Tash` (count or `999`), `OnlyOnApprove=True`, optional `TashFirstPayment` and `FirstPaymentTash`. The redirect adds `HKId`. Stop or resume with `action=HKStatus`, `Masof`, `PassP`, `HKId`, `NewStat` (1 terminate, 2 resume). **Merchant-managed:** `getToken` + `soft`. | **Subscriptions:** `doDeal` with `cardId`, `cardExpiration`, `total`, `validation=AutoComm`. **Hora'at Keva:** setup with `transactionType=RecurringDebit`, `validation=Verify`, `total` 1 or 100, and `ashraitEmvData` `recurringTotalNo` (999 = open-ended), `recurringFrequency` (04 monthly, 01 weekly), `recurringNo=0`. Charges use `RecurringDebit` + `AutoComm` + `authNumber`. |
| Terminal / contract | not documented, beyond the `HK` module. | Hora'at Keva must be enabled by support. `E/recurring-payments-and-subscriptions/horaat-keva`: "contact Hyp support to have this capability enabled on your terminal." |
| Response | `HKStatus` returns `HKId`, `CCode` (906 = agreement does not exist). **The result of each automatic HK charge: not documented** (no notification, no API). | Synchronous `result`. There is no termination command. `E/recurring-payments-and-subscriptions/horaat-keva`: "Hyp Enterprise does not provide a dedicated API command to terminate an active Hora'at Keva agreement." |
| Multi-store fit | **Hyp-managed:** charges happen inside Hyp with no documented signal, so per-store reconciliation needs the portal (gap). **Merchant-managed:** the platform scheduler uses each store's credentials. | The platform scheduler uses each store's credentials and tokens. |

### 1.7 Refunds and cancellations

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| When to use | **Cancel** before transmission; **refund** after settlement. `P/common-use-cases/cancellations`: "You can cancel a transaction up until 22:00 Israel time on the same business day it was made." | `refundDeal` in most cases, because it falls back to a cancel automatically. `E/additional-payment-scenarios/refunds-and-cancellations`: "In most cases, you should perform a refund." |
| Parameters | **`CancelTrans`:** `Masof`, `PassP`, `TransId`. **`zikoyAPI`:** `Masof`, `PassP`, `TransId`, `Amount` (≤ original). `zPass` appears only in the payout table (ambiguous). | **`refundDeal`:** `terminalNumber` plus at least one lookup (`tranId`, `cgUid`, `ashraitEmvData/orgUid`, `user`). Optional `total`, `creditType`, `firstPayment`, `periodicalPayment`, `numberOfPayments`, `allowOnePayment`. **`cancelDeal`:** same lookups, full amount only. **Unpaid payment request:** `cancelPaymentLink` with `terminalNumber`, `mid`, `tranId`. |
| Terminal / contract | not documented, except the `zPass` ambiguity. | Terminal settings: Allow cancel deal, Allow refund deal, Block multiple matches, "Terminal numbers for searching the original transaction", and others. Error 324: "The terminal is not permitted to perform refund transactions." |
| Response | **Cancel:** `CCode=0` + `ReversalStatus=777`; 920 = cannot cancel. **Refund:** new `Id`, `CCode`, `ACode`, `HeshASM`; 33 = amount too high. `P/common-use-cases/refunds`: "a refund creates a brand-new transaction" | A new `tranId`, the same `cgUid`, `transactionType` Cancel or Refund. Errors 310–341. A cancelled refund cannot be refunded again; use a payout instead. A2A transfers: "cannot be canceled or refunded via the Hyp API". Gift cards are refunded per `tranId`, on `mp`- or `ra`-prefixed terminals. |
| Verification | Synchronous `CCode` | Synchronous `result`; inquiry for status |
| Multi-store fit | Per-store credentials | Per-store credentials. `E/additional-payment-scenarios/refunds-and-cancellations` (terminal settings): "This setting allows specifying a different terminal number for searching the original transaction." |

### 1.8 Installments

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| When to use | Splitting a single sale. `P/common-use-cases/installments`: "If you don't include them, the payment will be processed as a single, one-time charge." | `E/payment-page-integration/installments`: "There is no need for you, as a merchant, to handle these installments" |
| Parameters | `Tash` (maximum), `FixTash`, `tashType` (1 regular, 6 credit), `ShowEngTashText` for English pages. The redirect returns `Payments`. `soft` takes `Tash` and `TashFirstPayment`. | **Page:** `creditType=Payments` or `SpecialCredit`, and `numberOfPayments` (the maximum; ≥3 for SpecialCredit). The redirect returns `numberOfPayments`, `firstPayment`, `periodicalPayment`. **Direct or capture:** an exact breakdown, `total = firstPayment + numberOfPayments × periodicalPayment`, or error 037. Defer with `ashraitEmvData/deferMonths`. |
| Terminal / contract | 903 means the terminal's installment limit was exceeded. Credit installments usually need at least 3 payments. | "Newly opened terminals support installments by default." (`E/payment-page-integration/installments`) |
| Limits | bit has no installments. | bit charges the full amount whatever the shopper picks. Refunds mirror the original schedule unless `allowOnePayment=1`. |
| Response / verification | The `MoreData` redirect field `Payments`: "The number of installments used for the transaction." (`P/reference/actions#create-a-payment-page-request`). Verified with the same VERIFY call as any page; nothing installment-specific is documented. | Redirect fields: "`numberOfPayments`: The total number of payments for an installment transaction." (`E/…/integrating-hyps-payment-page-and-accepting-payment`). Verified like any page (MAC, inquiry or webhook); the inquiry and webhook `transaction` also carry `numberOfPayments`, `firstPayment` and `periodicalPayment`. |
| Multi-store fit | Per terminal | Per terminal |

### 1.9 Test, sandbox and production

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| Model | The same URL serves test and production; test terminals start with `00100`. `P/getting-started/testing-environments`: "These terminals are easy to spot because their numbers always start with `00100`." | Separate environments with their own base URL, user/password, terminal and MID. `E/introduction/environment-setup`: "Migrating from the test environment to the production environment requires updating the following configuration information" |
| Test data | Published test cards are on `P/getting-started/testing-environments` (not copied). | No Hyp test cards: get them from the issuers, or request an "internal approval" terminal (synthetic data on `E/introduction/environment-setup`, not copied). 3DS test cards can be requested; gift-card test cards come from the providers. |
| Verification in test | Same URL and calls with test credentials. Whether VERIFY behaves differently on test terminals is not documented. | Test transactions are visible in the test Console: "Mock transactions are still recorded inside the test environment's console, as if they were real transactions" (`E/introduction/environment-setup`). Inquiry and MAC work the same, since the test environment "is exactly the same as the production environment" apart from the listed exceptions. |
| Production-only features | 3DS: "3DS is only available on production terminals." (`P/advanced-features/3ds`). bit: "the full bit payment flow only works in the production environment." (`P/common-use-cases/digital-wallets`). Apple Pay: the full flow works only in production. | bit: "there's no testing environment for bit". Apple Pay testing must be requested from sales. |
| Multi-store fit | Each store needs its own test terminal from Hyp: one per environment by default. | Each store's merchant receives its own test configuration from sales. **Inference:** the example webhook topic names contain `environment_uat`, so webhooks seem to exist in UAT (example only). |

---

## 2. Comparison across options and products

Complexity is my own assessment. PCI scope follows each product's compliance page.

| Option (product) | Confirmation mechanism | S2S? | PCI scope | Per-store fit | Complexity | Prerequisites | Basis |
|---|---|---|---|---|---|---|---|
| Hosted page, redirect (Pay) | Redirect + `APISign` VERIFY | Partly: the merchant pulls, but the browser must deliver the parameters | SAQ A | Weak: success URL per terminal in the portal; must know the store before VERIFY | Low | Terminal, KEY/PassP, `Sign=True`, portal signature setting, portal success URL | §1.1, §1.3, (c) |
| Hosted page, iframe (Pay) | Same | Same | SAQ A, if the site is protected against script attacks | Same, plus Apple Pay domains registered per terminal | Low–Med | Plus CSP and iframe attributes | §1.1 |
| Payment links, `payRequest` (Pay) | LIST status (0–3) | Yes, pull, but links only, last 500, no transaction id in the example | SAQ A | Return URL not documented | Low | "Hyp Market" payment-links feature | (b) |
| `soft` token charge or J4 capture (Pay) | Synchronous `CCode` | Yes | SAQ A (tokens) | Per-store credentials and tokens | Med | Tokenization permission; `UserId` if required | §1.4–1.6 |
| HK recurring, Hyp-managed (Pay) | None for later charges | No | SAQ A | Weak: no signal for later charges | Low (Hyp side) | HK parameters; `HKId` | §1.6 |
| Hosted page + MAC (Enterprise) | Local SHA-256 `responseMac` | **No** (browser-delivered values) | SAQ A | Good (per-request URLs), but needs the store's password | Low | user/password/MID/terminal | (d) |
| Hosted page + webhook (Enterprise) | SNS push, signed | **Yes, push** | SAQ A | Good: terminal and userData in the payload, but a Console subscription per merchant | Med (SNS verification, confirmation) | HTTPS + trusted CA, 15 s response, Console subscription | (a), §1.3 |
| Hosted page + `inquireTransactions` (Enterprise) | Pull by `txId`, `cgUid` or `user` | **Yes, pull** | SAQ A | Good: per-store credentials | Low–Med | API credentials; volume guidance ("sparingly") | (a) |
| Hosted page, iframe (Enterprise) | As above | As above | SAQ A, if the site is protected against script attacks | Good: per-request `frameAncestorURLs` | Med | CSP, frameAncestorURLs; Apple Pay registration per domain | §1.1 |
| Payment request, `apiPaymentLinkSetup` (Enterprise) | J112 link-status + J4 webhooks | Yes, push | SAQ A | Good | Med | Service enabled by support; webhook endpoint required | (d) |
| S2S `doDeal` (capture, token, recurring) (Enterprise) | Synchronous `result`; inquiry | Yes | SAQ A with tokens; SAQ D with raw card data | Good | Med | Tokens, terminal settings | §1.4–1.6 |
| A2A bank transfer (Enterprise) | Webhook `financialStatus` (Pending → final, ≤5 business days) | Yes, push (mandatory) | n/a (no cards) | Per-merchant bank setup | High (contracts) | Hyp + Feezback agreements, webhook | `E/available-payment-options/account-to-account` |

---

## 3. Gaps and contradictions in the docs

**Hyp Pay**

1. **No S2S notification and no lookup API** for hosted pages. If the shopper never returns, there is no documented way to recover: no notify URL, no lookup by `Id` or `Order`. Searched on every Pay page.
2. **What VERIFY asserts is unclear.** `P/reference/actions` says "valid and authentic"; `P/introduction/what-is-a-payment-page` says it "checks whether the transaction has indeed occurred". What it returns for declines and for 600/700/800 is not documented.
3. **VERIFY's importance is stated two ways:** "not strictly required" (`P/getting-started/creating-a-payment-page`) versus "We recommend validating every transaction" (`P/security/transaction-validation`).
4. **The return URL is per terminal only.** No per-request success, error or cancel URL exists, and no terminal field is documented in the redirect.
5. **`payRequest` LIST has no filter and a 500-link cap.** `transId` is `null` in the example even for Paid, and the reference fields omit `transId`. A return URL for links is not documented.
6. **HK (Hyp-managed recurring):** the outcome of later charges is not exposed by any documented API or notification. The page says the `HKId` is needed "to check on the agreement", but no status call is documented.
7. **Charset:** `UTF8`/`UTF8out` are documented only for `soft` and offline invoices. The charset of redirects is not documented.
8. **Test cards versus default settings:** the test page says the failure card "redirects to your error page", while the setup page recommends not configuring an error URL.
9. **The Apple Pay iframe script is served from `pps.creditguard.co.il`** (Enterprise infrastructure) even on Hyp Pay (`P/common-use-cases/digital-wallets`). The relationship between the two platforms is not explained.
10. Earlier-research items still open: the `Sign` algorithm; `KEY` missing from non-SIGN actions; the `zPass` ambiguity; overlapping codes (700, 401/402, 16).

**Hyp Enterprise**

11. **Verification guidance is in tension with itself.** Validation is "not required", the MAC is "preferred", and the inquiry is "not intended for every transaction". Only webhooks are presented as the "reliable server-to-server fallback". No page says whether calling the inquiry on every payment is acceptable.
12. **The MAC covers only** `txId`, `errorCode`, `cardToken`, `cardExp`, `personalId` and `uniqueId`. It leaves out the amount, `authNumber` and `cgUid`. The docs describe `uniqueId` as "(your unique merchant ID)", but it is the per-transaction `uniqueID` redirect parameter (note the different casing). "Merchant password" is not defined; the sample code uses the API password.
13. **The error-redirect parameter list is not documented.** Only `errorCode`, inside the MAC recipe, and the success example are given.
14. **Webhook coverage is unclear.** The docs say "for all transaction results", but the subscription sits under "Payment page" and the topic is `eventType_mpiTransaction`. Whether S2S `doDeal`, `refundDeal` or `cancelDeal` trigger webhooks is not documented.
15. **The webhook docs give no official TopicArn or AWS account to pin.** The numeric codes of the `financialStatus` attribute (e.g. `4`) and of `jcode` have no mapping. A 200–4xx reply counts as delivered. **Inference:** returning 4xx on a processing failure would lose the message.
16. **The webhook example has no `uniqueid`.** For correlation, the docs only point to `txId`/`mpiTransactionId` ("You can match the two notifications using the `mpiTransactionId` (`txId`) value", for A2A), plus `cgUid` and userData.
17. **The `inquireTransactions` API reference omits** the `queryName=mpiTransaction` + `mid` + `mpiTransactionId` lookup that the Transaction Validation and Short-Term Storage pages use.
18. **`orgUid` has two definitions:** "Organization identifier for transaction lookup" (`E/api-reference/inquiretransactions`) versus "the unique transaction ID assigned by Shva" (`E/additional-payment-scenarios/refunds-and-cancellations`).
19. **J5 validity:** "A standard limit is 5 days" (`E/two-phase-commits/overview`) versus "Pre-authorizations expire after 7-30 days (issuer-dependent)" (`E/api-reference/dodeal#notes`).
20. **`deferMonths` range:** "between 1 and 99" (`E/payment-page-integration/deferring-payments`) versus "from `01` to `12`" (`E/api-reference/dodeal`).
21. **Cancelling a J5:** "you should explicitly cancel instead of refunding" (refunds page) versus "with a normal `cancelDeal` or `refundDeal` request" (two-phase FAQ).
22. **Is `terminalNumber` required on `refundDeal`/`cancelDeal`?** The guide says it "must contain" it; the API reference marks it "Optional".
23. **`cancelUrl`:** "Recommended" in the parameter list, but required for `TxnSetup` in the validation-types table, and absent from the examples.
24. **`getSessionId`:** "single-use and valid for 10 minutes" versus the response field `sessionReUse` ("Whether the session can be reused", `1` in the example).
25. **Tokens:** the redirect always returns `cardToken`, yet `cardId` "Returned when … the Card ID module is purchased and configured".
26. **`userDataX` values:** "Letters, digits, and spaces are allowed", but the example contains hyphens.
27. **Command lists disagree.** The API index omits `getCardId`, `getCardNo` and `getExternalCardId`. `cancelPaymentLink` and `performMonitors` appear only on guide pages. `sendNotification` appears in responses but is undocumented.
28. **Not documented at all:**
    - base URLs, IP ranges, rate limits, and charset of redirects and responses;
    - whether success/error URLs need allow-listing or may contain query strings;
    - whether a duplicate `uniqueid` is rejected;
    - a platform or partner model; what "ravMutav" and "ravSapak" mean; how `routeCode` is used.
29. **Two hosted-page servers appear:** CGMPI (JSP) and PPS. The pinpad page says "PPS-based payment pages only - JSP pages are not supported". Which one a terminal uses is not documented. The examples' `mpiHostedPageUrl` values contain whitespace; the sample code calls `.trim()`.
30. **Timezone:** `transactionDate` is "in the IDT timezone", which leaves winter time (IST) unclear.

---

## 4. Questions only Hyp can answer

**Hyp Pay**

1. **Does Hyp Pay have any S2S notification (webhook or IPN), or a lookup by `Id` or `Order`, for `APISign` pages?**
   *Blocks:* whether Hyp Pay can meet "paid only after S2S verification" when the redirect is lost, and whether we need a reconciliation job (and how it would work).
2. **Does VERIFY `CCode=0` prove approval and the redirect's `CCode`/`Amount`, or only that the parameters are authentic? What does VERIFY return for declined, 600, 700 and 800 redirects?**
   *Blocks:* the order state machine (paid / authorized / failed) and whether we must also check the redirect's `CCode` and `Amount` against our order.
3. **Must VERIFY receive the raw percent-encoded query string exactly as received, or decoded and re-encoded values? Which charset (UTF-8 or Windows-1255) do redirects use, and do `UTF8`/`UTF8out` apply to `APISign` and the redirect?**
   *Blocks:* how the return handler is implemented and how Hebrew names, `Info` and `Order` are encoded.
4. **Can success and error URLs be set per request? If not, does the redirect carry the terminal number, and are `Fild1`–`Fild3` accepted as `APISign` inputs so we can carry a store id?**
   *Blocks:* one shared return endpoint versus per-store URLs set in each store's portal, plus the onboarding checklist.
5. **Is there an official integrator or platform model (one integrator, many merchant terminals)? Can a store owner create and rotate `KEY`/`PassP` without exposing their portal login?**
   *Blocks:* how stores connect their credentials and how secrets are stored and rotated.
6. **`payRequest` LIST: can it filter by `payRequestId`? Is `transId` filled in for status 3? Does a link use the terminal's success URL?**
   *Blocks:* whether links can be a second payment channel with server-side status.
7. **For HK (Hyp-managed recurring): how does a merchant learn the result of each automatic charge?**
   *Blocks:* whether we may offer Hyp-managed subscriptions at all.
8. **Rate limits, timeouts and IP allow-listing for `https://pay.hyp.co.il/p/`. Is `https://pay.hyp.co.il/p3/`, which the plugin uses, supported?**
   *Blocks:* client retry and backoff settings, egress planning, and which endpoint to use.

**Hyp Enterprise**

9. **Can a platform hold one set of API credentials (or a partner account) for many store merchants and MIDs, or must each store have its own user, password, MID, terminal and base URL? Do "ravMutav"/"ravSapak" or `routeCode` apply to a multi-store platform?**
   *Blocks:* the credential model, onboarding, and the per-store configuration schema.
10. **Is calling `inquireTransactions` (`queryName=mpiTransaction`) on every completed payment acceptable? Are there rate limits?**
    *Blocks:* whether we confirm payments webhook-first with an inquiry fallback, or inquiry-always.
11. **Webhooks: do they cover S2S `doDeal`, refunds and cancellations, or only payment-page transactions? How long does SNS retry? What is the official TopicArn or AWS account to pin? Can many merchants' Console subscriptions point at one platform endpoint? Can a subscription be created other than by each store logging into its own Console?**
    *Blocks:* the multi-store webhook routing and security design.
12. **Is the webhook payload guaranteed to contain `uniqueid`, `customerData/userDataN`, `terminalNumber` and `mpiTransactionId`? What do the numeric `financialStatus` and `jcode` attributes mean?**
    *Blocks:* how we correlate a notification with a store and order.
13. **MAC: which password is "merchant password"? Is the MAC present and computed the same way on error redirects? Since it does not cover the amount, may it serve as a secondary check?**
    *Blocks:* the return handler.
14. **Are `successUrl`/`errorUrl`/`cancelUrl` restricted (domain allow-list, query strings allowed, maximum length)?**
    *Blocks:* the per-store return URL format.
15. **What happens with a duplicate `uniqueid` within 24 h? Is `mayBeDuplicate` available on our terminals?**
    *Blocks:* idempotency and retry behaviour when creating a payment.
16. **What charset do `int_in`, XML responses and redirect parameters use?**
    *Blocks:* XML building and parsing, and the handling of Hebrew fields.
17. **J5 validity: is it 5 days or 7–30? Is `cancelDeal` mandatory for releasing a J5? Is a `cardId` returned without the "Card ID module"?**
    *Blocks:* the authorize/capture timers and whether tokens are available.
18. **Test environment: can a platform get a UAT environment before any store signs up? Do webhooks work in UAT? Which test cards apply ("internal approval" or issuer cards)?**
    *Blocks:* CI and integration testing in phase 1.

---

## 5. URLs read

**Indexes:**
- https://developers.hyp.co.il/llms.txt
- https://developers.hyp.co.il/sitemap.xml
- https://developers.hyp.co.il/enterprise/sitemap-pages.xml
- https://developers.hyp.co.il/pay/sitemap-pages.xml

The Enterprise sitemap lists the same 86 pages as `llms.txt`, except that its root `/enterprise` stands in for `/enterprise/introduction/overview`.

**Hyp Enterprise, all 86 pages, each fetched as `<url>.md`.** Read depth codes:
- **F** = prose read fully; long XML samples skimmed.
- **S** = skimmed, because the page is out of scope (invoicing) or purely CSS/UI.
- **R** = reference page: parameters, errors and notes read; cURL/Java/Python/Node tabs skimmed.

- E/introduction/overview F · E/introduction/key-concepts-and-terminology F · E/introduction/prerequisites-and-requirements F · E/introduction/environment-setup F · E/introduction/authentication-and-security F · E/introduction/request-and-response-general-structure F · E/introduction/basic-integration-flow-hello-world-with-a-full-working-charge F · E/introduction/when-to-use F · E/introduction/contacts F
- E/payment-page-integration/integrating-hyps-payment-page-and-accepting-payment F · …/full-page-redirect-vs-iframe-based-integration F · …/installments F · …/deferring-payments F · …/captcha F · …/webhooks F
- E/available-payment-options/overview F · …/simple-credit-card F · …/saved-card F · …/digital-wallets F · …/pay-by-link F · …/payment-request F · …/gift-cards F · …/physical-pinpad-terminal F · …/account-to-account F
- E/changing-the-default-payment-page-appearance/overview F · …/changing-the-ui-language F · …/customizing-the-default-text F · …/adding-business-logo-and-custom-images S · …/configuring-field-display-options S · …/modifying-the-default-styles S · …/suggesting-to-save-credit-card-data F · …/showing-saved-credit-cards F · …/managing-payment-methods F · …/israeli-id F · …/hiding-other-elements-from-the-page S · …/configuring-the-transition-page F · …/adding-custom-input-fields F · …/changing-the-redirect-behavior-when-using-bit F · …/templates F
- E/two-phase-commits/overview F · …/payment-page-auth F · …/card-verification-auth F
- E/recurring-payments-and-subscriptions/overview-of-recurring-payments F · …/implementing-recurring-payments F · …/horaat-keva F
- E/additional-payment-scenarios/refunds-and-cancellations F · …/tokenization F · …/installments-direct-charge F · …/short-term-cc-data-storage F · …/payouts F
- E/3-d-secure-integration/introduction-to-3ds F · …/service-registration F · …/3ds-flow-in-payment-page F · …/transaction-identification F
- E/documents-and-invoicing/overview S · …/enabling-invoicing S · …/issuing-invoices S · …/overriding-invoice-account-details-in-the-request S · …/refund-invoices S · …/cancellations-payouts S · …/invoice-inquiries S
- E/inquiring-transactions/overview F · …/examples F · …/inquire-transactions-with-pagination F
- E/advanced-security-guidelines/compliance-and-security-overview F · …/data-privacy F · …/network-security-at-hyp F · …/payment-page-security F · …/transaction-validation F
- E/advanced-considerations/backwards-compatibility F · …/request-validation-methods F · …/status-monitoring F
- E/api-reference/index F · …/dodeal R (parameters, validation tables, response fields, the full response-code table searched, notes) · …/inquiretransactions R · …/refunddeal R · …/canceldeal R · …/getsessionid R · …/getcardid R · …/getcardno R · …/getexternalcardid R · …/transmitterminal S · …/transmitinquire S · …/addcginvoice S · …/inquireinvoice S · …/refundcginvoice S

**Hyp Pay and the platform intro:** all 31 pages were downloaded as `.md` and keyword-searched. These were re-opened to fill gaps:
- https://developers.hyp.co.il/introduction-to-the-hyp-payment-platform
- P/common-use-cases/send-payment-links
- P/security/transaction-validation
- P/reference/actions (intro, `APISign` VERIFY, `payRequest`, prerequisites, `UTF8` tables)
- P/getting-started/creating-a-payment-page (redirect and validation)
- P/getting-started/prerequisites-and-initial-setup
- P/introduction/what-is-a-payment-page
- P/getting-started/testing-environments
- P/getting-started/authentication-security
- P/advanced-features/recurring-payments
- P/advanced-features/two-phase-commits
- P/common-use-cases/refunds
- P/common-use-cases/digital-wallets (Apple Pay iframe, bit)
- P/advanced-features/3ds (production-only line)
- P/reference/response-status-codes (selected codes)
- P/security/compliance-and-security-overview and P/security/payment-page-security (iframe and SAQ lines)

The other Pay pages were taken as covered by the earlier research file.

**Deliberately not requested:**
- every API or payment host shown in the docs: `pay.hyp.co.il/p/…`, the `cgi-bin` Apple Pay file, `*.creditguard.co.il` page and script hosts, `link-uat.hyp.co.il`, `your-hyp-environment-url/xpo/Relay`;
- the AWS SNS documentation and endpoints;
- https://hyp-playground.netlify.app/;
- GitBook's `?ask=` query interface and MCP server;
- Hyp status pages (`smbusiness-status.hyp.co.il`, `thirdparty-status.hyp.co.il`);
- third-party sites and the WordPress plugin.
