# Hyp Pay (formerly Yaad Sarig / YaadPay) hosted payment page: what the official documentation says

Checked on 2026-11-27. This was read-only. I sent **no request** to any API path (`/p/`, `/p3/`, `cgi-bin`) and used no "try it" console. I did not search for or use any credentials.

## Key findings
1. **The current official docs are https://developers.hyp.co.il/pay** (a GitBook site). The overview page says "Formerly known as "YaadPay"". Two old Apiary sites, both owned by the account `yaadpay`, now contain only one notice: "This documentation has moved to Hyp Pay Developer Docs. Please use that site for the latest information." Their blueprints show `HOST: https://pay.hyp.co.il/p/`, and the Apiary metadata gives `lastUpdated` 2026-06-03. The two sites are https://yaadpay.docs.apiary.io/ and https://hypay.docs.apiary.io/.
2. **The current endpoint is `https://pay.hyp.co.il/p/`**, for test and production alike. `icom.yaad.co.il` does not appear anywhere in the current docs, not even as deprecated.
3. **The documented flow:**
   - Your server calls `action=APISign&What=SIGN`.
   - You redirect the browser to `https://pay.hyp.co.il/p/?` followed by the response string.
   - Hyp redirects the browser to the success URL set in the Hyp portal.
   - Your server calls `action=APISign&What=VERIFY` with every redirect parameter in the same order, and expects `CCode=0`.
4. **Not documented for Hyp Pay:**
   - a server-to-server notification or notify URL;
   - an API to look up a transaction by `Id` or `Order`;
   - IP addresses to allow-list;
   - the signature algorithm;
   - a return URL set per request.

   Webhooks (via Amazon SNS) and `inquireTransactions` exist only for **Hyp Enterprise** (formerly CreditGuard). It is a separate XML API documented on the same site, so don't mix the two.
5. **Approved means `CCode=0`.** The codes `600` (J2), `700` (J5) and `800` (Postpone) are listed as "success codes", but in those cases nothing has been charged yet.
6. **Sandbox:** test terminals "always start with `00100`", and two test cards are published. There is no shared public test terminal or credentials; Hyp issues a test terminal to each merchant.
7. **WooCommerce plugin v2.2.14:** no changelog line mentions pay.hyp.co.il or APISign.
   - Its code moved from `https://icom.yaad.net/cgi-bin/yaadpay/yaadpay3ds.pl` to `https://pay.hyp.co.il/p3/` in version 2.2.11, whose changelog says only "Plugin maintenance".
   - It signs and verifies redirects locally with HMAC-SHA256. No official page describes this.

## Method and access notes
- I read all 30 Hyp Pay pages, using GitBook's Markdown copies (page URL + `.md`). The list comes from https://developers.hyp.co.il/llms.txt and matches https://developers.hyp.co.il/pay/sitemap-pages.xml. Quotes below are the rendered text with link markup removed, and each was checked against the downloaded pages.
- The WebFetch tool could not resolve developers.hyp.co.il or wordpress.org. Fetching through the session's HTTPS proxy with curl worked, so no network change is needed.
- Some sources could not be retrieved:
  - web.archive.org reset the connection, so I have no archived copy of the old Apiary content.
  - https://yaadpay.yaad.net/developers/article.php?id=48 returned HTTP 415.
  - plugins.trac.wordpress.org returned HTTP 429.
- **Status labels used in the tables:**
  - **documented**: stated on an official Hyp page (a Hyp domain or Hyp's Apiary).
  - **only in plugin code**: found only in the source code of the WordPress.org plugin "Yaad Sarig Payment Gateway For WC" v2.2.14, whose header reads "Author: YAAD-PAY & 10Bit". This is code, not documentation; treat it as third-party and unverified.
  - **not found**: absent from every official page I read.

## 1. Hosted payment page request

| parameter/action | meaning | source URL | short exact quote | status |
|---|---|---|---|---|
| Base endpoint | Every Hyp Pay call | https://developers.hyp.co.il/pay/reference/actions | "All requests are sent to the base URL `https://pay.hyp.co.il/p/`, followed by specific URL parameters." | documented (current) |
| Test vs production URL | Same URL for both; only the credentials differ | https://developers.hyp.co.il/pay/getting-started/testing-environments | "The URL stays the same (`https://pay.hyp.co.il/p/`), but it will only process real transactions when you use your production credentials." | documented |
| Old Apiary docs | Superseded | https://jsapi.apiary.io/apis/yaadpay.apib and https://jsapi.apiary.io/apis/hypay.apib | "HOST: https://pay.hyp.co.il/p/" … "This documentation has moved to Hyp Pay Developer Docs. Please use that site for the latest information." | documented (moved notice) |
| `icom.yaad.co.il` | Old host | all 30 Hyp Pay pages searched | — | not found (neither listed nor declared deprecated) |
| `https://pay.hyp.co.il/p3/`; `https://icom.yaad.net/cgi-bin/yaadpay/yaadpay3ds.pl` | URLs used by the plugin (p3 from v2.2.11; icom.yaad.net up to v2.2.10) | https://downloads.wordpress.org/plugin/yaad-sarig-payment-gateway-for-wc.2.2.14.zip (file `woocommerce-gateway-yaadpay.php`) | `define('YAAD_GATEWAY_URL', 'https://pay.hyp.co.il/p3/');` | only in plugin code |
| HTTP method | GET; POST mostly equivalent | https://developers.hyp.co.il/pay/reference/actions | "Every API call on this page is made using a standard HTTP GET request. Most calls can also be performed using equivalent HTTP POST requests." | documented |
| `action=APISign` | Create a signed payment page | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "Must be set to `APISign`." | documented |
| `What=SIGN` | Request a new page | same | "Must be set to `SIGN` to request a new payment page." | documented |
| `Masof` | Terminal number, 10 digits | same | "Your terminal number." | documented |
| `KEY` | API key | same | "Your terminal API key." | documented |
| `PassP` | API password (not the portal login password) | same; https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup | "Your terminal API password." / "Your API password is different from the password you use to log in to the Hyp Portal." | documented |
| `Amount` | Amount; marked Required = Yes | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "This can be a decimal number with up to two fractional digits (for example, `10.00`, `10.5`, or `10`)." | documented (but the guide's minimal request leaves it out) |
| `Sign=True` | Ask for the signature that VERIFY needs | same | "Set to `True` to receive a security signature that is required for transaction validation." | documented |
| `Coin` | Currency (see Table 7) | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page#create-a-payment-page-request | "Supported values: `1` for ILS (used by default), `2` for USD, `3` for Euro, `4` for GBP." | documented (guide list only; not in the APISign reference table) |
| `Order` | Your order ID | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "An internal order ID for your records." | documented |
| `Info` | Free description | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page | "Any extra info you want to include with the transaction." | documented (guide list only) |
| `ClientName` / `ClientLName` | First / last name | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "The customer's first name." / "The customer's last name." | documented |
| `UserId` | Israeli ID, 9 digits | same | "The customer's Israeli ID." | documented |
| `street` / `city` | Address | same | "The customer's street address." / "The customer's city." | documented |
| `email` | Email | same | "The customer's email address." | documented |
| `cell` | Mobile phone | same | "The customer's mobile phone number." | documented |
| `phone` | Landline; listed only for `action=soft` | https://developers.hyp.co.il/pay/reference/actions#charge-a-saved-token | "The customer's landline phone number." | documented for `soft` only; not found for APISign |
| `zip` | Listed only as a MoreData output and a `soft` input | https://developers.hyp.co.il/pay/reference/actions | "The customer's zip code." | not found as an APISign input (the plugin sends it) |
| `PageLang` | `HEB` (default) or `ENG` | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "The UI language for the payment page. `HEB` (Hebrew) is the default." | documented |
| `tmp` | Template number (1 is default; 2–15 also exist) | same; https://developers.hyp.co.il/pay/common-use-cases/customizing-payment-page-design | "The template number to use for the page's layout." / "If you don't send the `tmp` parameter (or if you set it to `1`), your payment page will use the first template by default" | documented |
| `hideBtns` | Hide the wallet buttons | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "Set to `True` to hide the payment method selection buttons on the payment page." | documented |
| `MoreData=True` | Extra parameters in the redirect (see Table 3) | same | "Set to `True` to receive additional parameters like `UID` and `UserId` in the redirect (required for two-phase commits)." | documented |
| `Tash`, `FixTash`, `tashType`, `ShowEngTashText` | Installments (see Table 7) | same | — | documented |
| `J5`, `Postpone` | Authorization-only / hold (see Table 5) | same | — | documented |
| `HK`, `freq`, `TashFirstPayment`, `FirstPaymentTash`, `OnlyOnApprove` | Recurring payments managed by Hyp | same; https://developers.hyp.co.il/pay/advanced-features/recurring-payments | "Set to `True` to enable recurring payments." | documented |
| `sendemail` | Email the customer a confirmation | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page | "Set this to `True` to send the customer an email confirmation of the transaction." | documented (guide list only) |
| `SendHesh` | Email an invoice; needs `email` | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request; https://developers.hyp.co.il/pay/invoicing/basic-invoicing | "Set to `True` to automatically email an invoice to the customer." / "For this to work, you'll also need to provide the customer's email address in the `email` parameter." | documented |
| `sendHeshSMS`, `Pritim`, `heshDesc`, `EZ.lang`, `EZ.comment`, `EZ.description`, `EZ.cc_emails`, `EZ.vat`, `EZ.customer_crn` (plus `EZ.email_text` in the guide) | Invoice options | same two pages | `heshDesc` format: "`[item_code~description~quantity~price_including_vat]`" | documented |
| `UTF8` | Request data is UTF-8 | https://developers.hyp.co.il/pay/reference/actions#charge-a-saved-token | "Set to `True` if the request data is encoded in UTF-8." | documented for `soft` and offline invoices only; not listed for APISign (the plugin sends `UTF8=True` on the payment page) |
| `UTF8out` | Response in UTF-8 | same | "Set to `True` to receive the response encoded in UTF-8." | documented for `soft` and offline invoices only; not found for APISign or the redirect |
| `Fild1`–`Fild3` as inputs | Your own custom fields | same; https://developers.hyp.co.il/pay/common-use-cases/send-payment-links | "A custom field for your own use. This value is returned in the response but not saved by Hyp Pay." | documented for `soft` (and `Fild1` for `payRequest`); not found as APISign inputs |
| Success / error URL | Set in the portal; no per-request parameter | https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup#configure-success-and-error-pages | "we recommend **configuring only the success URL** and keeping the default option to display errors on the Hyp Pay payment page" | documented (portal setting); per-request URL not found |
| APISign response | `action` becomes `pay` and a `signature` is added | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page | "you'll notice the `action` parameter has changed to `pay` and a `signature` parameter has been added." | documented |
| Payment page URL | Append the response unchanged | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page#redirect-to-the-secure-payment-page-on-the-frontend | "just append the entire response to `https://pay.hyp.co.il/p/?`." | documented |
| URL-encoding | Encode every value | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page | "Make sure to URL-encode all parameter values before constructing the request URL" | documented |
| Iframe | Allowed; wallets need iframe attributes | https://developers.hyp.co.il/pay/common-use-cases/digital-wallets | "make sure your `<iframe>` tag includes the `allow="payment"` attribute and the `allowpaymentrequest` property." | documented |
| `BOF`, `blockItemValidation`, `source=Woo` | Sent by the plugin | plugin zip, `classes/class-wc-gateway-yaadpay.php` | `'BOF'         => 'True',` | only in plugin code |

## 2. Request signing and response verification

| parameter/action | meaning | source URL | short exact quote | status |
|---|---|---|---|---|
| APISign `What=SIGN` | Server-side GET that returns a signed parameter string | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page#create-a-payment-page-request | "To get things started, you'll send an initial GET request to the Hyp Pay API from your application's backend. We call this an APISign request." | documented |
| Minimum parameters | `action`, `What`, `Sign=True`, `Masof`, `KEY`, `PassP` | same | "That's the bare minimum you need to get a payment page up and running." | documented |
| SIGN success | URL-encoded string with `signature` (64 hex characters in the example); KEY and PassP are not echoed back | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "A successful request returns a URL-encoded string containing all parameters and a `signature`" | documented |
| SIGN failure | Example `CCode=904`; listed codes 0, 902, 904 | same | "Authentication failure: wrong `PassP`." / "Missing `What` parameter." | documented |
| `What=VERIFY` | Server-side check of the redirect | https://developers.hyp.co.il/pay/reference/actions#validate-a-transaction | "All parameters from the redirect URL, in their original order." | documented |
| VERIFY parameters | `action=APISign`, `What=VERIFY`, `Masof`, `KEY`, `PassP`, then every redirect parameter | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page#validate-the-transaction | "All parameters passed to your success page URL, in the same order." | documented |
| VERIFY success | `CCode=0` | https://developers.hyp.co.il/pay/reference/actions#validate-a-transaction | "`0` indicates the transaction is valid and authentic." | documented |
| VERIFY failure | Example `CCode=200`; listed codes 200, 902, 904 | same | "Missing one or more parameters from the payment completion redirect." | documented |
| Prerequisites | `Sign=True` plus a portal setting | https://developers.hyp.co.il/pay/security/transaction-validation | "make sure **אימות על ידי חתימה בעמודי התשלום** (**Verify by signature in the payment page**) is enabled." | documented |
| How validation works | Hyp checks it; you don't compute anything | same | "Instead of doing complex math to calculate a signature yourself, you just send the parameters you got from the redirect back to us." | documented |
| Signature algorithm and covered fields | — | — | — | not found |
| Local HMAC | The plugin computes HMAC-SHA256 with KEY over `Id,CCode,Amount,ACode,Order,Fild1,Fild2,Fild3` (prefixed by `HKId` when present) to check `Sign`. It also generates `signature` itself over the sorted parameters with `action=pay`, instead of calling SIGN. | plugin zip, `classes/class-wc-gateway-yaadpay.php` lines 622 and 370 | `$verify 	 = hash_hmac('sha256', $args_string, $secret);` | only in plugin code (do not rely on it without Hyp's confirmation) |
| Invoice-link signing | `ACTION=PrintHesh`, `type=EZCOUNT`, `TransId` or `asm` | https://developers.hyp.co.il/pay/reference/actions#generate-a-link-to-an-invoice | "The operation to be signed." | documented |

## 3. Return parameters and CCode values

| parameter/action | meaning | source URL | short exact quote | status |
|---|---|---|---|---|
| Redirect | Browser GET to your success page with a query string | https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page#handle-the-redirect-back-to-your-website | "Hyp Pay passes a query string with several parameters — we usually call this a **payment completion redirect**." | documented |
| Base set | `Id, CCode, Amount, ACode, Order, Fild1, Fild2, Fild3, Sign` | same | "success.html?Id=408941655&CCode=0&Amount=10&ACode=0505293&Order=12345678910&Fild1=Jenny%20Parkington&Fild2=jennyp%40example.co.il&Fild3=&Sign=a84b…" | documented (example) |
| `Id` | Hyp transaction ID; later passed as `TransId` | https://developers.hyp.co.il/pay/common-use-cases/tokenization | "this is the unique ID for that transaction on our end." | documented |
| `CCode` | Status code | https://developers.hyp.co.il/pay/getting-started/testing-environments | "A successful payment will return the `CCode` parameter set to `0` in the redirect URL." | documented |
| `Amount` | Amount | https://developers.hyp.co.il/pay/reference/actions#charge-a-saved-token | "The final amount charged." (definition given for the `soft` response) | documented (redirect: example only) |
| `ACode` | Authorization code; becomes `AuthNum` for a J5 capture | same | "The authorization code returned by the card company." | documented (`soft` table) |
| `Order`, `Fild1`–`Fild3` | Echoed back; in the example Fild1 = name, Fild2 = email | creating-a-payment-page (example above) | — | example only; meaning on the payment page not defined |
| `Sign` | Signature for this transaction | https://developers.hyp.co.il/pay/security/transaction-validation | "This is a unique signature Hyp Pay creates for that specific transaction." | documented |
| `Bank` (MoreData) | Acquirer | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "The name of the acquiring bank." | documented (the 3DS example shows `Bank=6`) |
| `TransType` | Transaction type | same | "The type of transaction (for example, `Internet-Secure`, `ApplePay`, or `GooglePay`)." | documented |
| `Payments` | Number of installments used | same | "The number of installments used for the transaction." | documented |
| `Brand` / `Issuer` | Card brand / issuer | same | "The brand of the credit card used (for example, `Visa` or `MasterCard`)." / "The entity that issued the card." | documented (the example shows numeric `Brand=1`, `Issuer=1`) |
| `L4digit` | Last 4 digits | same | "The last four digits of the credit card." | documented |
| `UserId`, `street`, `city`, `zip`, `cell`, `Coin`, `Tmonth`, `Tyear` | Echo / card data | same | "The currency used for the transaction." (`Coin`) | documented (the example shows `Tyear=2032`, 4 digits) |
| `Hesh` | Invoice | same; https://developers.hyp.co.il/pay/reference/actions#charge-a-saved-token | "The invoice number, if an invoice was generated." vs "The type of invoice or receipt generated." | documented but inconsistent (examples show `Hesh=EZ`) |
| `UID` | Unique transaction ID for J5 and other flows | https://developers.hyp.co.il/pay/reference/actions | "A unique transaction identifier used for two-phase commits and other advanced flows." | documented |
| `spType` / `bincard` | Special card type / BIN | same | "The first six digits of the card (Bank Identification Number)." | documented (the example spells them `SpType`, `BinCard`) |
| `ECI` | 3DS result | https://developers.hyp.co.il/pay/advanced-features/3ds | "`ECI` is a two-digit code that tells you the result of the 3DS authentication." | documented |
| `errMsg`, `Info` in the redirect | Appear in the 3DS example | same | "Info=%EC%EC%E0%20%FA%E9%E0%E5%F8&ECI=02&errMsg=%FA%F7%E9%EF%20(0)" | example only, not defined. These decode only as Windows-1255 ("ללא תיאור", "תקין (0)"); that decoding is mine, and the docs never state the encoding |
| `HKId` | Recurring agreement ID | https://developers.hyp.co.il/pay/advanced-features/recurring-payments | "you'll also see an `HKId` in the URL." | documented |
| `MULTI` | Split across gift cards | https://developers.hyp.co.il/pay/advanced-features/gift-cards | "look for a `MULTI` parameter that contains information about each transaction." | documented |
| `Token` | Not in the redirect | https://developers.hyp.co.il/pay/common-use-cases/tokenization | "it isn't included in the payment completion redirect. You'll need to ask for it specifically." | documented |

**CCode values.** The source for all of these is https://developers.hyp.co.il/pay/reference/response-status-codes unless another page is named.

| CCode | meaning | short exact quote | approved? / status |
|---|---|---|---|
| 0 | Approved | "`0`: Approved transaction." | **Yes.** The only code that means approved and charged for a normal immediate (J4) charge. documented |
| 600 | J2 card check | "Transaction details received (J2) — This code indicates that the card information was checked and found to be valid without checking the credit frame." | Successful step, no charge. documented |
| 700 | J5 authorization | "Authorization — This code is used for the first step of a two-phase commit, where you authorize a credit line without an immediate charge (J5)." | Successful step; a capture is still needed. The same table also lists 700 from Shva as "Transaction declined by PinPad device". documented |
| 800 | Postponed | "Postponed transaction — This code indicates that the transaction has been scheduled for a later date." | Successful step; `commitTrans` is needed within 72 h. documented |
| 902 | Credential error | "Authentication error" | No. documented |
| 901 | Not permitted / wrong zPass | "Terminal is not permitted to use this method or a wrong `zPass` is provided" | No |
| 903 | Too many installments | "The number of payments configured in the terminal has been exceeded" | No |
| 904 | Missing `What` | "Missing `What` parameter" | No |
| 200 | VERIFY was missing redirect parameters | "Missing one or more parameters from the payment completion redirect" | No |
| 250 | Not found | "Transaction or payment link not found" | No |
| 920 | Cannot cancel | "Transaction cannot be cancelled (it was already transmitted or it does not exist)" | No |
| 33 | Refund amount too high | "You can credit the entire transaction or a small amount of the transaction amount only" | No |
| 4 / 6 (Shva) | Declines | "Transaction not approved" / "Transaction declined: incorrect CVV2 (May also indicate a missing Israeli ID number)" | No |
| 401 / 402 | Two meanings each | Hyp Pay: "First or last name is required" / "Transaction information is required". Shva: "Number of installments is too high" / "Number of installments is too low" | No (ambiguous) |
| 990, 996, 997, 998, 999 | Hyp Pay errors | e.g. "Token is not valid" (997), "Transaction cancelled" (998), "Communication error" (999) | No |
| 777 (Shva) | Returned as `ReversalStatus` on a successful cancel | "OK, you can proceed" | not applicable |
| Error-URL behaviour | Effect of setting an error URL in the portal (source: https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup) | "If an error URL is configured, Hyp Pay treats these non-zero codes as failures and redirects the user to your error page, even though they represent successful steps in your payment flow." | documented |

## 4. Server-side confirmation, notifications and IP addresses

| parameter/action | meaning | source URL | short exact quote | status |
|---|---|---|---|---|
| VERIFY after the redirect | The only documented server-side check | https://developers.hyp.co.il/pay/introduction/what-is-a-payment-page | "This is to make sure that no one malicious has attempted to feed you fake transaction data." | documented |
| Recommendation | Validate every transaction | https://developers.hyp.co.il/pay/security/transaction-validation | "We **recommend validating every transaction** before you ship an order or give a customer access to your service." | documented (another page calls it "not strictly required") |
| Look up a transaction by `Id` / `Order` | — | https://developers.hyp.co.il/pay/reference/actions (actions listed: APISign, CancelTrans, commitTrans, getToken, HKStatus, payRequest, soft, zikoyAPI) | — | not found |
| `payRequest` with `iCommand=LIST` | Payment links only (statuses 0–3, where 3 = Paid) | https://developers.hyp.co.il/pay/common-use-cases/send-payment-links | "representing up to the 500 most recent links created on your terminal." | documented (not a general transaction query) |
| Server-to-server notify / webhook / IPN for Hyp Pay | — | all Hyp Pay pages searched for "notif", "callback", "webhook", "IPN" | — | not found |
| Hyp Enterprise webhooks | Different product | https://developers.hyp.co.il/enterprise/payment-page-integration/webhooks | "Hyp Enterprise push notifications are powered by Amazon SNS (Simple Notification Service)." | Enterprise only; not applicable to pay.hyp.co.il |
| Hyp Enterprise inquiry | Different product | https://developers.hyp.co.il/enterprise/inquiring-transactions/overview | "Hyp Enterprise provides a transaction inquiry API." | Enterprise only |
| Return URL | Set per terminal in the portal | https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup | "specify the URL of the success page on your website that will be displayed to the user after a transaction completes." | documented |
| IPs to allow-list | — | https://developers.hyp.co.il/pay/security/network-security-at-hyp (lists only cipher suites) | "Here's the current list of supported cipher suites:" | not found |
| TLS | TLS 1.2 or higher; TLS 1.3 preferred | https://developers.hyp.co.il/pay/getting-started/authentication-security | "We require **TLS 1.2 or higher** for all connections." | documented |
| Plugin `_webhook` endpoint | The plugin registers a second endpoint that handles the same GET parameters; nothing says how Hyp would call it | plugin zip, `class-wc-gateway-yaadpay.php` line 275 | `add_action('woocommerce_api_wc_gateway_' . $this->id . '_webhook', array($this, 'yaadpay_webhook'));` | only in plugin code |

## 5. Refunds, cancellations, J5 and postpone, tokens

| parameter/action | meaning | source URL | short exact quote | status |
|---|---|---|---|---|
| `CancelTrans` with `Masof`, `PassP`, `TransId` | Cancel before transmission | https://developers.hyp.co.il/pay/reference/actions#action-canceltrans | "The `CancelTrans` command is used to cancel a transaction before it has been transmitted to the card company for settlement." | documented |
| Cancel cutoff | Same business day | https://developers.hyp.co.il/pay/common-use-cases/cancellations | "You can cancel a transaction up until 22:00 Israel time on the same business day it was made." | documented |
| CancelTrans result | `TransId, CCode, Hesh, ReversalStatus`; 920 = cannot cancel | same | "If the cancellation works, the system returns `CCode=0` and `ReversalStatus=777`." | documented |
| `zikoyAPI` with `Masof`, `PassP`, `TransId`, `Amount` | Full or partial refund of a settled transaction | https://developers.hyp.co.il/pay/reference/actions#action-zikoyapi | "The `zikoyAPI` command is used to perform a refund for a transaction that has already been settled." | documented |
| Refund semantics | A new transaction; amount ≤ original | https://developers.hyp.co.il/pay/common-use-cases/refunds | "a **refund creates a brand-new transaction**" / "This can be equal to or less than the original transaction's amount." | documented |
| Refund result | New `Id`, `CCode`, `ACode`, `HeshASM`; 33 = amount too high | same | "The response includes a new `Id`, which is the unique identifier for the refund itself." | documented |
| `zPass` | Second password | https://developers.hyp.co.il/pay/reference/actions#perform-a-payout | "A secondary password specifically for payouts and refunds." | ambiguous: appears only in the payout table; the zikoyAPI table omits it |
| `Postpone=True` | Hold up to 72 h; redirect returns `CCode=800` | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "Set to `True` to postpone the transaction for up to 72 hours." | documented |
| Postpone rules | Exact amount only | https://developers.hyp.co.il/pay/common-use-cases/postponing-transactions | "With postponing, you must commit the exact amount you initially requested." | documented |
| `commitTrans` with `Masof`, `PassP`, `TransId` | Finalize a postponed transaction; returns `Id, CCode, Fild1–3, HeshASM`; 250 = not found | https://developers.hyp.co.il/pay/reference/actions#action-committrans | "The finalization must occur within 72 hours of the original request." | documented |
| Not committing | Leave it uncharged | https://developers.hyp.co.il/pay/common-use-cases/postponing-transactions | "you can simply leave the transaction in its `800` status, and it won't be charged." | documented |
| `J5=True` with `MoreData=True` | Authorization only; redirect returns `CCode=700` | https://developers.hyp.co.il/pay/advanced-features/two-phase-commits | "a `CCode=700` means success — the authorization was granted and the funds are being held." | documented |
| What to keep after J5 | | same | "**save the values for `Id`, `ACode`, `UserId`, and `UID`**" | documented |
| J5 validity | Approximate | same | "Provides a longer window, usually around 5 days." | documented (approximate) |
| Capture (J4): `action=soft` with `AuthNum`, `inputObj.originalAmount`, `inputObj.originalUid`, `inputObj.authorizationCodeManpik=7`, `Amount`, `Token=True`, `CC`, `Tmonth`, `Tyear`, `UserId`, `ClientName`, `Info` | Capture a J5 authorization | https://developers.hyp.co.il/pay/reference/actions#capture-j4-after-j5-authorization | "The original amount authorized in the J5 step, in currency subunits (like agurot or cents)." / "This must be less than or equal to the original authorized amount." | documented |
| `J5=J2` | Card check only; returns `CCode=600` | https://developers.hyp.co.il/pay/reference/actions | "or `J2` to perform card verification without charge." | documented |
| `getToken` with `Masof`, `PassP`, `TransId`, optional `allowFalse` | Get a token after a transaction; returns `Token` (19 digits) and `Tokef` (YYMM); errors 901, 902, 910 | https://developers.hyp.co.il/pay/reference/actions#action-gettoken | "Your terminal must have tokenization permissions." | documented |
| Token properties | | https://developers.hyp.co.il/pay/common-use-cases/tokenization | "A token is always a 19-digit number where **the last four digits match the original card**." | documented |
| `soft` token charge: required `Masof, PassP, ClientName, Info, Token=True, CC, Amount, Tmonth, Tyear, UserId` | Merchant-initiated charge | https://developers.hyp.co.il/pay/reference/actions#charge-a-saved-token | "If your terminal doesn't require one, use `000000000`." | documented |
| `tOwner` | Use a token on another terminal | https://developers.hyp.co.il/pay/advanced-features/recurring-payments | "Note that a two-terminal setup only works when both terminals use the same business ID." | documented |
| `HKStatus` with `HKId`, `NewStat` | Stop or resume a recurring agreement | https://developers.hyp.co.il/pay/reference/actions#action-hkstatus | "The new status for the agreement: `1` (Terminate), `2` (Resume)." | documented |
| Wallets and bit | Limits | https://developers.hyp.co.il/pay/common-use-cases/digital-wallets | "Advanced features like two-phase commits (J5) or postponed transactions aren't supported with bit." | documented |
| `KEY` on these calls | The parameter tables for CancelTrans, zikoyAPI, commitTrans, getToken and soft list `PassP` but not `KEY` | https://developers.hyp.co.il/pay/reference/actions | — | documented by omission (confirm with Hyp) |

## 6. Sandbox / test environment

| parameter/action | meaning | source URL | short exact quote | status |
|---|---|---|---|---|
| Test terminal numbers | Recognisable by prefix | https://developers.hyp.co.il/pay/getting-started/testing-environments | "These terminals are easy to spot because their numbers always start with `00100`." | documented |
| Test cards | Published by Hyp for the test environment | https://developers.hyp.co.il/pay/getting-started/testing-environments | (not copied here; see the official page) | documented |
| Test cards | Published by Hyp for the test environment | https://developers.hyp.co.il/pay/getting-started/testing-environments | (not copied here; see the official page) | documented |
| Going live | Change `Masof`, `KEY` and `PassP` | same | "Update your terminal number (`Masof`) to the production terminal number Hyp gave you." | documented |
| Getting a test account | Register at https://lp.hyp.co.il/api/, sign the agreements, then contact ipos@hyp.co.il | https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup | "By default, you receive one terminal and one Hyp Portal account per environment." | documented |
| Shared public test terminal or credentials | Examples use sample terminals such as `<sample terminal>` and `<sample terminal>` with placeholder passwords. They are never called test terminals, and `<sample terminal>` does not start with `00100`. | https://developers.hyp.co.il/pay/reference/actions | — | not found |
| Production-only features | Wallets, bit and 3DS | https://developers.hyp.co.il/pay/common-use-cases/digital-wallets; https://developers.hyp.co.il/pay/advanced-features/3ds | "remember that the full payment workflow only works in production." / "3DS is only available on production terminals." | documented |
| Hyp Enterprise test rules (do not apply here) | Different product | https://developers.hyp.co.il/enterprise/introduction/environment-setup | "Hyp doesn't provide test cards directly." | Enterprise only |

## 7. Currency codes and installments

| parameter/action | meaning | source URL | short exact quote | status |
|---|---|---|---|---|
| `Coin` | 1 ILS (default), 2 USD, 3 EUR, 4 GBP | https://developers.hyp.co.il/pay/reference/actions#charge-a-saved-token | "The currency of the transaction: `1` for ILS (default), `2` for USD, `3` for EUR, `4` for GBP." | documented |
| Terminal currency | Configured per terminal | https://developers.hyp.co.il/pay/introduction/key-concepts-and-terminology | "Each terminal has its own configuration for things like currency and transaction types." | documented |
| bit | ILS only | https://developers.hyp.co.il/pay/common-use-cases/digital-wallets | "bit payments only work with Israeli New Shekels (NIS)." | documented |
| Currency decline (Shva 16) | | https://developers.hyp.co.il/pay/reference/response-status-codes | "Declined: no permission for currency type" | documented |
| `Tash` (payment page) | Maximum installments | https://developers.hyp.co.il/pay/reference/actions#create-a-payment-page-request | "The maximum number of installments allowed." | documented |
| `Tash` (`soft`) / `Tash` (HK) | Number of installments / number of charges, 999 = no end | same; https://developers.hyp.co.il/pay/advanced-features/recurring-payments | "The number of installments for the transaction." / "If you want the charges to keep rolling indefinitely, set this to `999`." | documented |
| `FixTash` | Exact number only | https://developers.hyp.co.il/pay/reference/actions | "If set to `True`, the customer must use the exact number of installments specified in `Tash`." | documented |
| `tashType` | 1 = regular, 6 = credit | https://developers.hyp.co.il/pay/common-use-cases/installments | "Just a heads-up: credit installments usually require at least 3 payments." | documented |
| `ShowEngTashText` | Installment labels on English pages | same | "If your payment page is in English (`PageLang=ENG`), set this to `True` to display the installment labels, which aren't shown by default." | documented |
| Default | Single charge | same | "If you don't include them, the payment will be processed as a single, one-time charge." | documented |
| `Payments` (redirect) / 903 | Installments used / over the terminal limit | https://developers.hyp.co.il/pay/reference/response-status-codes | "The number of payments configured in the terminal has been exceeded" | documented |
| `TashFirstPayment` (`soft`) | Different first payment | https://developers.hyp.co.il/pay/reference/actions#charge-a-saved-token | "A different amount for the first installment." | documented |
| bit and installments | Not supported | https://developers.hyp.co.il/pay/common-use-cases/digital-wallets | "bit doesn't support installments." | documented |

## 8. Official security guidance

| parameter/action | meaning | source URL | short exact quote | status |
|---|---|---|---|---|
| HTTPS / TLS | Plain HTTP is rejected | https://developers.hyp.co.il/pay/getting-started/authentication-security | "Any API calls made over plain HTTP will be automatically rejected." | documented |
| Backend only | Credentials travel in the query string | same | "**Only call Hyp APIs from your backend**." / "Hyp uses **query string API authentication**." | documented |
| Secrets | Secret manager, no hardcoding, rotation | same | "You should never hardcode them directly into your source code." / "have a plan for **rotating your credentials**" | documented |
| Logs | Mask secrets and customer data | same | "masks the values** of `KEY`, `PassP`, and any customer-related parameters" | documented |
| Test hygiene | Keep TLS checks on | same | "Avoid the temptation to skip TLS validation with "insecure" flags" | documented |
| Portal access | Exposes the API credentials | same | "anyone who gets into your Hyp Pay account can also see your API credentials." | documented |
| Iframe CSP | Allow Hyp in `frame-src` | same | "Content-Security-Policy: frame-src 'self' https://pay.hyp.co.il;" | documented |
| `Sign=True` and VERIFY | Don't trust the redirect alone | https://developers.hyp.co.il/pay/introduction/what-is-a-payment-page | "This is to make sure that no one malicious has attempted to feed you fake transaction data." | documented |
| Parse `CCode`, not the HTTP status | | https://developers.hyp.co.il/pay/reference/actions | "Hyp Pay returns a `200 OK` status code for almost all requests, even when an error occurs." / "If the response contains HTML instead of a URL-encoded string or JSON, it indicates a system error." | documented |
| Error page | Treat 700 and 800 as success | https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup | "**Handle status codes 700 and 800 as success**." | documented |
| Personal data | Israeli ID numbers and wallet card numbers | https://developers.hyp.co.il/pay/common-use-cases/tokenization; https://developers.hyp.co.il/pay/common-use-cases/digital-wallets | "Israeli ID numbers are considered sensitive personal data under privacy laws like the GDPR" / "You should avoid storing digital wallet card numbers" | documented |
| PCI | SAQ A; keep Hyp's AOC on file (certificate: https://hyp.co.il/pci-certificates/) | https://developers.hyp.co.il/pay/security/compliance-and-security-overview | "you qualify for the simplest possible compliance level: **SAQ A**." | documented |
| Hosted page controls | reCAPTCHA v2, SecTrans token, CSP | https://developers.hyp.co.il/pay/security/payment-page-security | "When a payment page is created, our server generates a `SecTrans` token that's tied to that specific transaction." | documented |
| Check redirect `Amount`/`Order` against your own order; replay / idempotency | The plugin does this (`validate_callback_amount`, `_yaadpay_processed_ids`) | — | — | not found in the docs (only in plugin code) |

## 9. WordPress.org plugin "Yaad Sarig Payment Gateway For WC"

- **Pages:** https://wordpress.org/plugins/yaad-sarig-payment-gateway-for-wc/, plus the WordPress.org plugins API record for the same slug.
- **Identity:** slug `yaad-sarig-payment-gateway-for-wc`. Byline "By yaadsarig" (https://profiles.wordpress.org/yaadsarig/). The API lists contributor 10BIT; the readme says "Contributors: Yaad Sarig, 10bit"; the code header says "Author: YAAD-PAY & 10Bit".
- **Status:** **version 2.2.14**, last updated 2026-11-02 07:34 GMT, first added 2020-05-17. Requires WordPress 6.0+ and PHP 5.4+; tested up to 7.1.5 (the readme says 7.1). 2,000+ active installations.
- **Changelog lines relevant to the API** (verbatim):
  - "2.1.50 – modification of J5 transaction"
  - "2.1.53 – refund without password"
  - "2.2.2- support hyp invoice"
  - "2.2.7 – J5 postpone + HPOS fix"
  - "2.2.8 – fix HPOS, add blockItemValidation"
  - "2.2.11 – Plugin maintenance"
  - "2.2.13 – Plugin security fixed + Tested up to: 7.1"
  - "2.2.14 – Fixed security issues and vulnerabilities"

  **No line mentions pay.hyp.co.il, APISign or a change of domain.**
- **Code history** (from WordPress.org SVN tags, labelled "only in plugin code"):
  - 2.1.34 used `https://icom.yaad.net/cgi-bin/yaadpay/yaadpay3ds.pl`; 2.1.45 used `https://icom.yaad.net/p/`.
  - 2.1.50 through 2.2.10 used `icom.yaad.net/cgi-bin/yaadpay/yaadpay3ds.pl` again.
  - From **2.2.11** onward it uses `https://pay.hyp.co.il/p3/`.
  - The code links to https://hypay.docs.apiary.io/, which now points to the new docs.
- **Plugin description, vendor text rather than API docs:** refunds "(מחייב הרשאה לזיכוי ללא cvv מחברת האשראי )". In English: a refund requires permission from the card company to credit without CVV.

## Open questions that only Hyp can answer
1. Are `icom.yaad.co.il` and `icom.yaad.net` still served, and is there a sunset date? Is `https://pay.hyp.co.il/p3/`, used by the plugin, a supported path, and how does it differ from `/p/`?
2. Does Hyp Pay have any server-to-server notification, like Enterprise's webhooks? If not, how should a merchant recover when the customer never reaches the success URL?
3. Is there a Hyp Pay API to query a transaction by `Id` or `Order`, including its status, amount and 700/800 state?
4. Does VERIFY `CCode=0` prove only that the parameter set is authentic, or also that the payment was approved? What does VERIFY return for declined redirects and for 600, 700 and 800?
5. What is the algorithm behind `Sign`/`signature`, and which fields does it cover? Does it bind `Amount`, `Coin` and `Order`? Is local HMAC verification or self-signing (as the plugin does) officially supported?
6. What is the character encoding of redirect values? The 3DS example looks like Windows-1255. Do `UTF8`/`UTF8out` apply to APISign, the payment page, the redirect and VERIFY? Must VERIFY get the raw percent-encoded values unchanged?
7. Are `Coin`, `Info` and `sendemail` official APISign inputs? They appear only in the guide list. Are `UTF8`, `UTF8out`, `phone`, `zip` and `Fild1`–`Fild3` accepted on APISign, which doesn't list them? What fills `Fild1`–`Fild3` when you don't send them?
8. Is `Amount` mandatory on APISign? The reference says yes, but the guide's "bare minimum" request omits it. Is `Sign=True` mandatory?
9. Does `zikoyAPI` need `zPass`? Does any server action need `KEY` besides APISign? Do refunds and token charges need an acquirer "no-CVV" permission?
10. Is there a shared public test terminal? Is the "starts with `00100`" rule exact, given the example `<sample terminal>`?
11. Are there Hyp source IPs to allow-list, or IP restrictions on merchant API calls?
12. What do the numeric `Brand`, `Issuer`, `Bank` and `spType` values mean? Does `Hesh` mean the invoice number or the document type? Are parameter names case-sensitive (`spType` vs `SpType`, `bincard` vs `BinCard`)?
13. How should the overlapping codes be told apart: `700` (J5 success vs PinPad decline) and `401`/`402` (Hyp Pay meaning vs Shva meaning)?
14. What is the exact J5 validity per acquirer? Does the 22:00 cancellation cutoff apply on weekends and holidays?
15. Is there a per-request success, failure or cancel URL, or only the one portal setting per terminal?
16. Does Hyp deduplicate by `Order`, or offer any idempotency for repeated payment pages or redirects?

## URLs read
**Official, developers.hyp.co.il (read as `.md`):**
- https://developers.hyp.co.il/llms.txt
- https://developers.hyp.co.il/sitemap.xml
- https://developers.hyp.co.il/sitemap-pages.xml
- https://developers.hyp.co.il/pay/sitemap-pages.xml
- https://developers.hyp.co.il/introduction-to-the-hyp-payment-platform
- https://developers.hyp.co.il/pay/introduction/index
- https://developers.hyp.co.il/pay/introduction/key-concepts-and-terminology
- https://developers.hyp.co.il/pay/introduction/what-is-a-payment-page
- https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup
- https://developers.hyp.co.il/pay/getting-started/authentication-security
- https://developers.hyp.co.il/pay/getting-started/testing-environments
- https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page
- https://developers.hyp.co.il/pay/common-use-cases/credit-cards
- https://developers.hyp.co.il/pay/common-use-cases/customizing-payment-page-design
- https://developers.hyp.co.il/pay/common-use-cases/installments
- https://developers.hyp.co.il/pay/common-use-cases/digital-wallets
- https://developers.hyp.co.il/pay/common-use-cases/send-payment-links
- https://developers.hyp.co.il/pay/common-use-cases/tokenization
- https://developers.hyp.co.il/pay/common-use-cases/postponing-transactions
- https://developers.hyp.co.il/pay/common-use-cases/cancellations
- https://developers.hyp.co.il/pay/common-use-cases/refunds
- https://developers.hyp.co.il/pay/advanced-features/recurring-payments
- https://developers.hyp.co.il/pay/advanced-features/two-phase-commits
- https://developers.hyp.co.il/pay/advanced-features/gift-cards
- https://developers.hyp.co.il/pay/advanced-features/payouts
- https://developers.hyp.co.il/pay/advanced-features/3ds
- https://developers.hyp.co.il/pay/invoicing/basic-invoicing
- https://developers.hyp.co.il/pay/security/compliance-and-security-overview
- https://developers.hyp.co.il/pay/security/network-security-at-hyp
- https://developers.hyp.co.il/pay/security/transaction-validation
- https://developers.hyp.co.il/pay/security/payment-page-security
- https://developers.hyp.co.il/pay/security/data-privacy
- https://developers.hyp.co.il/pay/security/certifications
- https://developers.hyp.co.il/pay/reference/actions
- https://developers.hyp.co.il/pay/reference/response-status-codes

**Hyp Enterprise pages, for contrast:**
- Read:
  - https://developers.hyp.co.il/enterprise/introduction/overview
  - https://developers.hyp.co.il/enterprise/introduction/environment-setup
  - https://developers.hyp.co.il/enterprise/payment-page-integration/webhooks
  - https://developers.hyp.co.il/enterprise/inquiring-transactions/overview
  - https://developers.hyp.co.il/enterprise/advanced-considerations/backwards-compatibility
- Keyword-searched only:
  - https://developers.hyp.co.il/enterprise/advanced-security-guidelines/transaction-validation
  - https://developers.hyp.co.il/enterprise/advanced-security-guidelines/network-security-at-hyp
  - https://developers.hyp.co.il/enterprise/advanced-considerations/request-validation-methods

**Old Apiary docs (owner `yaadpay`):**
- https://yaadpay.docs.apiary.io/
- https://jsapi.apiary.io/apis/yaadpay.apib
- https://jsapi.apiary.io/apis/yaadpay/blueprint
- https://yaadpay.docs.apiary.io/feed
- https://hypay.docs.apiary.io/
- https://jsapi.apiary.io/apis/hypay.apib
- https://jsapi.apiary.io/apis/hypay/blueprint
- https://hypay.docs.apiary.io/feed

**Other Hyp sites:**
- https://hyp.co.il/
- https://hyp.co.il/?p=4657 (redirects to https://hyp.co.il/about-hyp/)
- https://lp.hyp.co.il/api/ (a contact form only)
- https://yaadpay.yaad.net/developers/article.php?id=48 (HTTP 415, unreadable)

**WordPress.org:**
- https://wordpress.org/plugins/yaad-sarig-payment-gateway-for-wc/
- https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=yaad-sarig-payment-gateway-for-wc&request[fields][sections]=1
- https://downloads.wordpress.org/plugin/yaad-sarig-payment-gateway-for-wc.2.2.14.zip (source read, not executed)
- https://plugins.svn.wordpress.org/yaad-sarig-payment-gateway-for-wc/tags/
- `…/tags/{2.1.34, 2.1.45, 2.1.50, 2.1.55, 2.1.59, 2.2.0, 2.2.2, 2.2.4, 2.2.6, 2.2.8, 2.2.10, 2.2.11, 2.2.12, 2.2.13}/woocommerce-gateway-yaadpay.php`
- `…/tags/2.2.12/readme.txt`
- plugins.trac.wordpress.org log (HTTP 429, not read)

**Third-party, unverified (no claim above relies on these):**
- https://documentation.ixopay.com/adapters/hyp-yaad-pay-pci (read; it covers only IXOPAY's own adapter parameters)
- Seen in search results only, not read:
  - https://www.pkgstats.com/pkg:@hypay/typescript-sdk (a community SDK)
  - https://help.guesty.com/hc/en-gb/articles/9365557631773-Connecting-a-Hyp-account-to-Guesty
  - https://www.creditguard.co.il/staticmedia/CG_Documents/CG-Gateway-Redirect-API.pdf (CreditGuard, i.e. Hyp Enterprise)

**Unreachable:** the web.archive.org CDX index (connection reset).

**Deliberately not requested,** because they are API-host paths linked from the docs:
- https://pay.hyp.co.il/p/?action=login
- https://pay.hyp.co.il/cgi-bin/yaadpay/applepay_main.pl?action=DownloadVerFile