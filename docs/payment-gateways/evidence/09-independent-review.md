# Independent review: MAX-HYP-REPORT.md (Phase A)

> **Lead's note:** this review covers the first version of the report (`77de048`). Every finding was checked by the lead against the code, the live test DB or the DDL, and fixed in version 2 — see MAX-HYP-REPORT.md, appendix א.4. Line numbers below refer to version 1.


**Reviewed:** `docs/payment-gateways/MAX-HYP-REPORT.md` and `evidence/01–08` plus `06b`, at commit `77de048` on `payments/max-hyp`. Two lines (§0.4 line 95 and A.1 line 1073, the review's own status) changed while I was reviewing; every other line I cite matches `77de048`.

**Sources used:**
- the repo, read only;
- `shop_test`, with `default_transaction_read_only=on` and catalog or SELECT queries only;
- the 30 saved Hyp Pay pages and 86 Enterprise pages. Live `llms.txt` and four live pages, fetched as documentation `.md` only, are byte-identical to the saved copies.

**What I did not do:**
- I sent nothing to any payment or API host.
- I modified no file.
- I did not open `ISTORES-COMPARISON.md`.
- I did not repeat the plugin's test terminal or password, or any sample terminal or test card.

## Findings

| id | severity | report location | the claim | what the primary source says | suggested correction |
|---|---|---|---|---|---|
| H1 | **high** | §0.2 dec. 13 (l.67); §4.8 (l.437); §6.3 (l.729); §6.4 step 8.3 (l.783); §8.1 #2 (l.959); R7 (l.1032); §4.2 (l.305) | Test mode is for "designated test users who are not staff" (dec. 13, §4.8), **and** "test mode only for a platform admin" (§6.3, §6.4: "only platform admins see the payment"). "settle refuses to mark a real order paid from a test attempt"; "the order is marked 'test'". | **(1) The two rules contradict each other, and the DB version cannot work.**<br>• Live `orders_default_payment` returns `offline` for staff before any payment branch: `IF NEW.kind <> 'order' OR public.is_staff(auth.uid()) THEN RETURN NEW;` (`remove_hyp.sql:67-69`).<br>• `is_staff → is_admin → is_super_admin` includes `public.is_platform_admin(_user_id) AND public.current_tenant_id() IS NOT NULL` (live DB). So a platform admin is staff on every store host.<br>• DDL `06b:1088-1101` inserts the MAX branch after that early return. `max_payments_active` allows test mode only `OR public.is_platform_admin(_actor)` (`06b:415`).<br>• Result: in test mode nobody can place a MAX order. Platform admins get an offline order; everyone else gets "not available". Evidence 05 saw this: "Staff orders are forced offline (remove_hyp.sql:67-69), so testers must be non-staff accounts" (`05-architecture.md:650`).<br>**(2) The claimed control does not exist.**<br>• `max_attempt_mark_paid` (`06b:621-736`) never looks at `mode`.<br>• No test-user allow-list exists in the DDL.<br>• The order-level test marker (`payment_live`, `05:398,650`) was removed by the §6.3 choice "no provider columns on `orders`". | Choose one rule. Dec. 13 is the workable one.<br>• Add a test-user allow-list (table or column). Check it in `max_payments_active` and `orders_default_payment`.<br>• Define a durable TEST marker: `payment_attempts.mode` shown on order screens, emails and exports, or an order column.<br>• Either add a mode check to settle, or delete the sentence that settle refuses.<br>• Then fix §4.8, §6.3 item 2, §6.4 step 8.3, §8.1 #2 and R7 to agree. |
| M1 | medium | §0.1 (l.47); §1.4 #1 (l.166); §8.2 (l.990); R1 (l.1026) | "In Hyp Pay **there is no** server-to-server notification and no transaction lookup" / "there is no Callback in Hyp Pay". | **The docs support "not documented", not "there is none".**<br>• No word "webhook", "notification", "IPN" or "callback" appears on any of the 30 Pay pages. The only webhook page is `enterprise/payment-page-integration/webhooks`. So "not documented" is correct.<br>• The plugin registers a `…_webhook` endpoint (`class-wc-gateway-yaadpay.php:275`).<br>• The removed NURIEL code had `/api/webhooks/hyp`, commented "(Webhook / IPN) — מוגדרת במסוף" (`git show b83bb3c`).<br>• Evidence 02 §0 says it precisely: "Hyp Pay documents no notification and no transaction lookup." | Write "לא מתועדת" everywhere this limitation is stated as fact. Keep Q1 as the first question to Hyp. |
| M2 | medium | §1.1 (l.119); §3 reason 1 (l.212) | Hyp Pay onboarding is a "self-service portal", in contrast to Enterprise, which is "not a self-service platform". | **Hyp Pay onboarding is not self-service.** `pay/getting-started/prerequisites-and-initial-setup` requires all of these:<br>• "register… a Hyp sales representative will contact you";<br>• "you will need to sign a **service agreement** with Hyp";<br>• "you must **sign an acquiring agreement** with one or more credit card companies… This step is mandatory before Hyp can configure a terminal for you";<br>• "A Hyp representative will: Register one or more terminal numbers… Create one or more accounts… on the Hyp Portal".<br>The Enterprise steps are the same, plus Shva setup (`enterprise/introduction/prerequisites-and-requirements`). | Say that both products need acquirer and Hyp agreements and a terminal created by Hyp. The real differences are the API style and the credential model.<br>Add to §9 that every additional store needs its own agreements and terminal. |
| M3 | medium | dec. 8 (l.62); dec. 10 (l.64); dec. 14 (l.68); §6.3 `payment_returns` (l.695); §6.2 nginx row (l.656); §8.2 row 1 (l.983); D3 (l.918) | "No card detail is stored except the last 4 digits". "`Tmonth`, `Tyear`, `bincard` and ID are not stored anywhere". The return query holds "name, email and last 4 digits". | **Decisions 8 + 14 store exactly these fields.**<br>• With `MoreData=True` the redirect carries `Tmonth`, `Tyear`, `bincard` ("first six digits"), `L4digit`, `UserId` ("Israeli ID"), `street`, `city`, `zip` and `cell` (`pay/reference/actions`, MoreData table).<br>• The `UserId` parameter appears "if your terminal is set up to require an Israeli ID", and "Israeli ID numbers are considered sensitive personal data" (`pay/common-use-cases/tokenization`).<br>• VERIFY needs "Every parameter… in the exact same order" (`pay/security/transaction-validation`), so the raw return cannot be stripped.<br>• Decision 14 keeps that raw query, encrypted (`return_enc`, `05:377`), for up to 7 days.<br>No PAN and no CVV are involved, but the report's claim as written is false, and decision 10's reason for not prefilling the ID is undercut. | Either use `MoreData=False` in phase 1, or state the cost plainly.<br>• With `MoreData=False`: `Tash` is 1 so `Payments` does not matter; `Coin` is fixed in the signed SIGN request; the cost is losing the `L4digit` display and the second currency check.<br>• With `MoreData=True` + dec. 14: rewrite dec. 8, §8.2 row 1 and the D3 pass condition, and list every MoreData field in finding 6 and in the nginx row. |
| M4 | medium | §4.3 step 3 (l.341); §4.5 (l.381); §8.2 (l.989, l.992); §8.1 #4 (l.961); §4.4 (l.371); §6.3 (l.708-709) | Opening a new attempt "cancels the previous attempt". "At most **10** attempts, at least **5 s** apart". "**Only the current attempt** can mark paid". "A return for an old attempt after a new one gets `needs_review`". | **The DDL does something else on each point.**<br>• It **reuses** a still-valid attempt (`06b:454-466`). Otherwise it sets the old one to `expired` (`06b:467-469`).<br>• Cap: `attempt_no BETWEEN 1 AND 5` and `_n >= 5` (`06b:87`, `06b:472-475`). There is no spacing rule.<br>• An expired or superseded attempt **still pays** while the order awaits the same amount (`06b:701-705`). This matches §4.4 l.371, but contradicts §8.1 #4, §8.2 and `08-security.md` SR-11 ("A payment on a superseded attempt → needs_review").<br>• When two pages are both paid, the second attempt has already been set to `cancelled` (`06b:733-734`). It is reviewed as `late` (`06b:705`), not as a duplicate (§4.5 l.381). | Pick one rule and state it everywhere. The DDL's "an old attempt may pay while the order still awaits the same amount" is kinder to customers.<br>Also choose one cap (5 or 10), state reuse or supersede consistently, and give the second charge the reason `duplicate_charge`. |
| M5 | medium | §4.5 (l.385); §4.3 (l.334, l.342); dec. 14 | VERIFY is retried at 1, 2, 5, 10 and 30 min before `needs_review`. Decision 14 exists "so a transient failure doesn't lose the payment". | **The retries can outlast the order.**<br>• The attempt ends at `LEAST(now()+30 min, payment_due_at − 15 min)` (`06b:477`), and nothing extends the order's due time.<br>• Live `expire_unpaid_orders()` cancels **any** `awaiting` order past `payment_due_at` and releases stock. It does not look at the payment method.<br>• The retries add up to about 48 min, but the grace is only 15 min. So a short Hyp outage cancels an order that was paid. It then becomes `late`, needs review, and its stock has been released.<br>• Evidence 05 had the fix, and the report dropped it without a decision: "Extends the order's due time when approved" (`05:409`); D5 "+2 h on an approved return; cap 24 h" (`05:684`). | Add the extension to the plan, or make it a numbered decision. The alternative is for the expiry job to skip orders that have a `returned` attempt. |
| M6 | medium | dec. 15 (l.69); §6.3 reconciliation (l.747); §4.6 (l.397); §6.3 `payment_attempts` FK (l.693) | Keeping payment records when a store is deleted "requires a fix in the exclusion list of `platform_delete_tenant`". | **The exclusion list is not enough.**<br>• Every DDL table has `tenant_id … REFERENCES tenants ON DELETE CASCADE` (`06b:23,65,85,152,183`). These rows would vanish at the final `DELETE FROM public.tenants`.<br>• `payment_attempts (tenant_id, order_id) → orders ON DELETE RESTRICT` (`06b:127-128`) would stop `platform_delete_tenant` from ever deleting the store's orders. That function retries only FK errors and then raises "המחיקה נעצרה" (live definition).<br>• `billing_history` survives only because it has no FK to `tenants`. `platform_audit_log` survives because migration `20261106170000:25` dropped its FK. | List the real work for decision 15:<br>• exclude the tables;<br>• drop the tenant FKs;<br>• replace the RESTRICT FK to orders;<br>• add a store label to orphaned rows.<br>Then update §4.6 and §6.3. |
| M7 | medium | §0.1 (l.44); §4.3 steps 7–8 (l.350-360); §6.3 (l.717-719); R2 (l.1027) | The order is marked paid "after the amount, currency, **terminal** and order ID match". R2's mitigations: an exact amount, a unique transaction ID, one paid attempt per order. | **Some of these checks are weaker than the summary says.**<br>• The return carries no terminal number (the docs example; §1.4 #5; §5.6.5). The DDL's `_terminal IS DISTINCT FROM a.terminal_number` (`06b:693`) compares a value the server supplies, so it cannot fail.<br>• Amount, currency and `Order` come from the browser. They are only as strong as VERIFY's coverage, which is undocumented (Q2).<br>• R2's mitigations do not stop someone from copying the return of a cheap paid order on the same terminal, rewriting `Order` and `Amount`, and replaying it. Only Hyp's answer or D6 settles that.<br>• §4.3 and §6.3 never mention checking the redirect's **own** `CCode=0` (that the transaction was approved). The DDL has it (`06b:678-687`). | In §0.1, say the terminal binding is "VERIFY with this store's credentials". Mark the field checks as conditional on Q2 and Q4.<br>State in §4.3 step 8 that the redirect's `CCode=0` is required.<br>In R2, say that only D6 or Hyp's answer mitigates the swap. D6 already blocks stage E. |
| L1 | low | §5.3 (l.490) | "Every table with `tenant_id`" has a RESTRICTIVE `tenant_isolation` policy. | 23 of the 89 public tables with `tenant_id` have no such policy (`pg_policies`). They include the two Grow tables in the row just above it, plus `coupon_grants`, `shared_carts`, `license_*`, `ai_*` and `platform_audit_log`. 18 of these 23 have no `anon` or `authenticated` grants. | Write "most tables", and mention the "service_role only, no policy" pattern. |
| L2 | low | §6.3 (l.701, l.704) | All 22 functions are SECURITY DEFINER, executable only by `service_role`, and take `_tenant` and `_actor`. Ciphertext comes only from `max_account_secrets`. | Not quite:<br>• `payment_attempts_guard`, `payment_rows_append_only`, `payment_store_settings_guard` and `max_event_summary` are not DEFINER (`06b:230,278,294,393`).<br>• 7 functions are revoked even from `service_role` (`06b:1031-1035`).<br>• Many functions have no `_actor`, and `max_attempts_expire()` has neither `_tenant` nor `_actor`.<br>• `platform_max_check_secrets` also returns the ciphertext (`06b:531-544`). | Correct the description of the functions. |
| L3 | low | §6.3 (l.702) | `anon` today has `SELECT`, `INSERT` and `TRUNCATE` on `orders`. | `anon` has all seven privileges, including `UPDATE` and `DELETE`. Default ACLs give `anon=arwdDxt` on tables **and** `anon=X` (EXECUTE) on new functions (`pg_default_acl`). | List all seven privileges. Add explicit function `REVOKE`s to the post-deploy check, which the DDL already does. |
| L4 | low | §8.1 #11 (l.968) | The platform audit log also cascades when a store is deleted. | **No cascade.** `20261106170000_sec_m5_keep_platform_records.sql:25` dropped the FK. `platform_delete_tenant` excludes `platform_audit_log`. The live table has no FK. `UPDATE` is blocked, but `DELETE` by `service_role` is allowed. | Drop "cascade". Keep "delete allowed". |
| L5 | low | §8.1 #5 (l.962); §4.5 (l.387) | "The locked store **and the Shabbat window** block the return". "Starting a payment in a locked store is blocked". | **The Shabbat window does not block the return.** The only DB use of `store_rest_state` is `orders_require_open_storefront`, which runs BEFORE INSERT on `orders`. `requireStoreOpen` is attached only to `checkout.functions.ts:101` and `orders.functions.ts:20`.<br>**The lock check cannot rely on `storeGate`.** `storeGate` lets `/_serverFn` through on a locked store (`src/server.ts:81`), and DDL `max_payments_active` does not check the lock. | Rephrase the Shabbat point as a rule: "do not attach `requireStoreOpen` to the return".<br>Enforce the lock inside `startOnlinePayment` or in SQL. |
| L6 | low | §4.1 diagram (l.273-274); §4.3 (l.340); §4.8 (l.434-435); §4.7 (l.417); §8.2 (l.994); §6.1 (l.633-634) vs §6.4 (l.752,755); §4.6 (l.398) | Names should match the DDL. | They differ in six places:<br>• `payment_attempt_settle` vs `max_attempt_mark_paid`;<br>• `public_ref` vs `reference`;<br>• flags `online_payments_max` and `_live` vs DDL `max_payments`;<br>• `credentials_updated_at/by` do not exist (the DDL has `updated_at/by`);<br>• the audit row names `platform_audit_log`, but §6.3 chose `payment_config_audit`;<br>• the migration file is `_online_payments_max.sql`, `_online_payments_foundation.sql` or `_max_payments_foundation.sql` depending on where you look. The AAD is also described three ways (report l.398, `06b:28`, `05:377`). | Use one name for each object throughout. |
| L7 | low | §3 (l.220) | An expired, unverified attempt moves to "`unverified`" and opens a task, "as it works today in Grow (`paid_late`)". | No attempt state `unverified` exists (§4.4; `06b:97-99`). The DDL sets `expired` (`06b:757`). Grow's `paid_late` means Grow's webhook arrived **after** expiry (`grow_mark_paid`; `grow-webhook.server.ts:76-85`). It is not "never returned". | Use `expired` plus the reconciliation list (§4.5, last row). Drop the Grow analogy. |
| L8 | low | §7.3 (l.898); §9 stage C (l.1048); dec. 12 (l.66) vs D14 (l.929); §6.4 step 1 (l.751) | Cross-references. | Four references point to the wrong place:<br>• The error-URL decision is no. 9, not no. 4.<br>• The admin screens are §4.7, not §4.6.<br>• D14 checks that **no** installments are offered, so passing D14 cannot unlock installments.<br>• No question in §1.6 asks about the format of the transaction ID (`Id`). Q8 is about `Order`. | Fix all four. Add a sandbox scenario that actually tests installments before they are enabled. |
| L9 | low | §6.2 (l.657) | `ecommerce-engine-guard` goes "from 40 to 42". | The DB proposal classifies three tables as ecommerce: attempts, events and store settings (`06-db-rls.md:429`). That makes 43, or 44 with `payment_returns`.<br>The test also requires the `ecommerce_rows_guard` and `ecommerce_row_move_guard` triggers on every listed table (`ecommerce-engine-guard.test.sql:54-65`). The DDL adds neither. | Reconcile the count, and add the guard triggers to the DDL. |
| L10 | low | §4.4 (l.373); §4.5 (l.382, 385, 388); §4.7 (l.427); dec. 11; §8.2 (l.988) | Statements the DDL does not support. | The DDL has none of these:<br>• a `review_reason` for "VERIFY retries exhausted" or "credentials replaced". Without one, the CHECK at `06b:118-120,132` blocks `needs_review`;<br>• a "force" option or pending-returns guard in `platform_max_account_save`;<br>• a VERIFY lease;<br>• storage for the guest token hash;<br>• a note column for "handled";<br>• a unique "one paid attempt per order" index. | List these as gaps in §6.3, or add them. |
| L11 | low | D2 (l.917); §1.2 (l.140); §7.3 (l.934); dec. 7 (l.61); R7/§6.3 (l.744, l.1032); §5.6.5 (l.598) | Smaller statements about Hyp. | Six of them are inaccurate:<br>• `904` = "Missing `What` parameter" (`pay/reference/actions`); only `902` is the authentication error.<br>• Production-only is documented for Apple Pay ("the full payment workflow only works in production"), bit and 3DS. It is **not** documented for Google Pay.<br>• "No public terminal" and "one per merchant" are inferences. The docs say "one terminal and one Hyp Portal account per environment".<br>• `hideBtns` hides "the payment method selection buttons". Wallets are off unless enabled in the portal.<br>• The docs' sample terminals are not labelled as test terminals, so they do not "contradict" the `00100` rule.<br>• `Masof` is in every payment-page URL the browser receives, so it cannot be "not shown publicly". | Correct each statement. For wallets, say "don't enable them in the portal" (documented), and keep `hideBtns` as a second layer. |
| L12 | low | §8.1 #1 MAX remedy (l.958) vs §6.3 (l.731-735) | A trigger blocks changes to items, shipping, coupon and discount in an online order "**awaiting or paid**". | The DDL lock fires only while an attempt is `created`, `redirected` or `returned` (`06b:315-316,356-359`). After payment, staff can still change lines and the total. | Write "while an attempt is active; after payment, staff only". |
| L13 | low | §4.5 (l.384); §6.3 (l.722) | A failed VERIFY changes nothing, so a forged return can neither pay nor fail the attempt. | `max_attempt_record_return` moves the attempt to `returned` **before** VERIFY (`06b:609-611`). `max_attempt_open` then refuses a new page until the attempt expires (`06b:458-460`). Doing this needs the 128-bit reference. | Either move to `returned` only after VERIFY succeeds, or state the limit. |
| L14 | low | §2 (l.199); §3 reason 3 (l.214) vs R6 (l.1031) | The redirect is SAQ A with no condition. | Hyp attaches the script-protection condition to the iframe only, and points to the PCI SSC "SAQ A eligibility criteria" (`pay/security/compliance-and-security-overview`). R6 already says eligibility must be confirmed with the acquirer. | Put the R6 caveat in §2 and §3 as well. |
| L15 | low / info | §0.1 (l.44); §6.3 (l.715-717) | The DB "requires VERIFY with `CCode=0`". | `_verify_ccode` is a parameter that any `service_role` caller supplies (`06b:622,658`). The DB cannot prove that VERIFY actually ran. | Add an architecture test: the only caller of `max_attempt_mark_paid` is the VERIFY path. |
| L16 | low | §5.6.5 (l.597) | "In phase 1 we don't send Hebrew in `Fild1–3`". | `Fild1–3` are not documented inputs to APISign. In Hyp's example, `Fild1` holds the customer's name and `Fild2` their email (`pay/getting-started/creating-a-payment-page`). Decision 10 prefills the name, which is often Hebrew. | Say that Hebrew may come back anyway, and that D10 decides the encoding. |
| W1 | wording | §5.4 (l.501) | `current_tenant_id()` gives a logged-in user the store "only if they are a member". | A user with **no** memberships gets the store from the header (`multi_store_members.sql:126-139`). | Make the statement precise. |
| W2 | wording | §5.5 (l.521) | The integration "waited for the credit card company's approval". | `remove_hyp.sql:4-8` says only "never opened (card_clearing_live = false)" and "decision: remove everything". `b83bb3c` says "hidden until approval" and does not say whose. | Write "waited for approval" and cite `b83bb3c`. |
| W3 | wording | §6.2 (l.670) | For example, no "payment intent". | The forbidden pattern is `payment_intent`, with an underscore (`remove-hyp.test.sql:63`). With a space it does not match. | Quote the pattern exactly. |
| W4 | wording | §7.1 (l.797) | The newest migration is re-run in the second pass. | Both clean passes re-apply it (`run.sh:62-67`). Pass 3 applies it twice over existing data (`run.sh:70-74`). | Describe the three passes correctly. |
| W5 | wording | §6.3 (l.682); §5.1 (l.451) | The DDL has "1,126 lines". `orders_default_payment` is at `remove_hyp.sql:46-100`. | The evidence file has 1,129 lines, because of the lead's 3-line header. The live trigger function is that base plus the Grow patch (`grow_payments.sql:134-170`). | Correct the line count and cite both sources. |
| W6 | wording | §8.1 #1 (l.958) | "300 → 400 after 'paid'". | The probe **simulated** "paid" with a direct `UPDATE` under `kobi.payment_update` (`04:41-44`). That update is faithful: `grow_mark_paid` changes the same columns and leaves `status='pending'`. | Add "simulated". |

## Claims I checked and found correct

**Hyp Pay (against the saved pages and four live copies):**
- `APISign`, `What=SIGN` and `What=VERIFY` on `https://pay.hyp.co.il/p/` (`pay/reference/actions`). VERIFY sends "All parameters from the redirect URL, in their original order".
- VERIFY `CCode=0` = "the transaction is valid and authentic". The second quote, "checks whether the transaction has indeed occurred", is on `pay/introduction/what-is-a-payment-page`.
- "Most calls can also be performed using equivalent HTTP POST requests". HTTP 200 on errors; an HTML body means a system error.
- The success URL is set in the portal, and the docs recommend configuring only the success URL. No per-request URL is documented.
- The return parameters are `Id, CCode, Amount, ACode, Order, Fild1–3, Sign`.
- `Coin` values 1–4 (creating-a-payment-page). `Coin` is also in the MoreData return table.
- Test terminals "always start with `00100`". The URL is the same for test and production. "around 10 ILS or USD".
- 3DS only on production terminals.
- Iframe: Google Pay needs `allow="payment"`; Apple Pay needs domain registration.
- TLS 1.2+. "query string API authentication". "Only call Hyp APIs from your backend". Mask `KEY` and `PassP` in logs.
- `PassP` is different from the portal password.
- SAQ A.
- `payRequest` LIST: last 500 links, statuses 0–3, `transId: null` even at status 3.
- CancelTrans until 22:00, with `ReversalStatus=777`.
- `zikoyAPI` parameters; `zPass` is ambiguous.
- J5: `CCode=700`, capture with `inputObj.*` and `authorizationCodeManpik=7`. Postpone: `800`, 72 h.
- `getToken` "must have tokenization permissions". Tokens have 19 digits. `tOwner` needs the same business ID.
- 903 = too many installments.
- The Israeli ID is "sensitive personal data".
- No page mentions webhook, notification, IPN or callback.
- 30 Pay pages and 86 Enterprise pages; live `llms.txt` is identical.

**Hyp Enterprise:**
- "not a self-service platform".
- "The endpoint server may vary by environment…"
- SNS webhooks per Console, all or selected terminals, 15 s, `x-amz-sns-message-id`.
- `inquireTransactions` is "not meant to be performed on a continuous basis… Use them sparingly".
- Validation is "not required". The MAC is "preferred" and covers `txId, errorCode, cardToken, cardExp, personalId, uniqueId`, but not the amount.
- `mpiHostedPageUrl` is valid for 10 minutes and for one payment.
- "Hyp doesn't provide test cards directly". Error 324. "5 days" vs "7-30".

**Code (all citations at the stated lines):**
- `order_integrity.sql:151-157`.
- `grow-webhook.server.ts:35-56` (production, then sandbox), `:76-85`, `:148-150`.
- `grow_payments.sql:66,70-74,236`.
- `server.ts:71-89` (`storeGate`, 403) and `:145-226`.
- `blocked-pages.ts:30-31`.
- `start.ts:25-27` (CSRF on server functions only).
- `tests.yml:9-13` (push on `hospitality/**` only).
- `playwright.config.ts:55` (`stdout: "ignore"`).
- `checkout.functions.ts:51`, `:99-163`; `checkout.ts:157`; `checkout.tsx:842-848`.
- `order-emails.server.ts:82-97` ("💳 שולם אונליין (Grow)" regardless of status) and `order-email-data.server.ts:104` (only the `awaiting` gate). Resends are limited to 5 per 10 min (`order-email-limit.server.ts:11`).
- `marketing.ts:197-198` (no `checkout`); `url-normalize.ts:12-30` (308, public, keeps the query).
- `grow-crypto.server.ts:12-27`; `ai/secrets.server.ts:65-75`; `license-crypto.server.ts` (HKDF and a tenant AAD).
- `platform-files.server.ts:36-58`; `rate-limit.server.ts:12-37`; `grow-payments.functions.ts:10,31-91`; `platform-grow.functions.ts:36-43`; `grow.server.ts:98-106`.
- `vite.config.ts:28-31`; `error-capture.ts:16-33`; `security-headers.ts:25-27` (`payment=()`, `form-action 'self'`).
- nginx overwrites `X-Forwarded-Host`.
- 113 unit-test files.
- Grow's mock returns 503. Grow SQL tests call `grow_mark_paid` as the superuser.
- `PRV-9`, `F18` and `S-2` exist.

**DB (read-only):**
- `grow_mark_paid` checks the token hash, `status_code '2'`, and the amount ±0.01 against the process only. It leaves `status='pending'`.
- The "order items insert" policy checks only `o.status = 'pending'`.
- The Grow tables have RLS, no policies, and `service_role`-only grants.
- `current_tenant_id()` falls back to the default store (`multi_store_members.sql:141-144`).
- `service_role` has BYPASSRLS. `orders` has `UNIQUE (tenant_id, id)`.
- VAT is overridden on insert (`orders_vat_from_settings`).
- Each of the three patch anchors appears exactly once in the live definitions. `place_order` (INVOKER) and `place_guest_order` (DEFINER) have no overloads.
- `expire_unpaid_orders` ignores the payment method.
- `tests.results`: 3,651 rows, 0 failed, 0 `probe:%` rows.
- No `payment_*` tables exist, so the DDL was not run.
- 207 migrations; the latest columns are present. The `supabase/` and `scripts/db-tests/` diff against `platform/crawl-parity` is empty.
- `remove-hyp.test.sql`: column `hyp\_%`, the function-body regex, the `credit_card` CHECKs, two functions, `e1`'s order counts, the trigger-order rule. The DDL text has 0 matches for the forbidden regex.
- Probe logic in evidence 04: it runs as `authenticated` through `tests.run` (`SET LOCAL ROLE`). The browser's `unit_price=1` was replaced by the product price.
- The DDL has 5 tables and 22 functions.

**Honesty and constraints:**
- Base `910b1f9` → `77de048` adds 10 docs files only. Grow and all other code are unchanged. The working tree is clean.
- The plugin's test terminal is absent from `docs/payment-gateways`, the tracked repo and all of git history.
- There are no doc sample terminals, no test cards and no secret-like strings in the report or evidence.
- The plugin's test password does not appear in any credential context.
- Every migration, deploy, sandbox, charge or refund step is gated on the owner's approval.
- The commits that touch `ISTORES-COMPARISON.md` are `f077fa8`, `6e1c7da` and `910b1f9`, and all are on remote branches, as stated. I did not open the file.
- Evidence 08 has 20 findings, 34 requirements and 40 threat rows.

**Not independently verified:**
- the 1,581 Vitest count;
- the 23.8-minute E2E duration;
- the seroval run;
- the 829-file and 1,056-file scan counts (`.output` now has 1,187 files);
- the per-agent counts of checked claims.

## Overall verdict

**Suitable as a Phase-A basis, but not ready to approve as-is.**

The recommendation follows from the evidence: a Hyp Pay hosted page with a full redirect, server-side SIGN and VERIFY, and "paid" set only by one DB function. The Hyp facts are largely accurate. Code and DB citations hold up. No secrets leaked, and no unapproved action is recommended. The paid-but-never-returned limit is stated honestly.

Fix the following before stage B:
- the test-mode design (H1);
- the contradictions created by the §6.3 reconciliation (M3, M4, M5, M6);
- the onboarding and notification overstatements (M1, M2);
- the summary's description of what is actually verified (M7).

The other items are low or wording.
