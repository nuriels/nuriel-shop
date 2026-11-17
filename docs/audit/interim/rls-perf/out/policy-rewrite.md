| table | policy | cmd | type |
|---|---|---|---|
| customer_profiles | `customer profile admin delete` | DELETE | permissive |
| customer_profiles | `customer profile self insert` | INSERT | permissive |
| customer_profiles | `customer profile select` | SELECT | permissive |
| customer_profiles | `customer profile admin update` | UPDATE | permissive |
| customer_profiles | `customer profile agent update` | UPDATE | permissive |
| customer_profiles | `customer profile self update` | UPDATE | permissive |
| global_products | `products managed by admin` | ALL | permissive |
| global_products | `products readable by staff` | SELECT | permissive |
| inquiries | `tenant_isolation` | ALL | restrictive |
| inquiry_notes | `tenant_isolation` | ALL | restrictive |
| inquiry_settings | `tenant_isolation` | ALL | restrictive |
| order_items | `order items delete by staff` | DELETE | permissive |
| order_items | `order items insert` | INSERT | permissive |
| order_items | `order items select` | SELECT | permissive |
| order_items | `order items update by staff` | UPDATE | permissive |
| orders | `orders delete by admin` | DELETE | permissive |
| orders | `orders insert by customer or staff` | INSERT | permissive |
| orders | `tenant_active_for_new_orders` | INSERT | restrictive |
| orders | `orders select` | SELECT | permissive |
| orders | `orders update by staff` | UPDATE | permissive |
| user_roles | `admin deletes roles` | DELETE | permissive |
| user_roles | `self register pending customer` | INSERT | permissive |
| user_roles | `role readable by self staff or agent of customer` | SELECT | permissive |
| user_roles | `admin updates roles` | UPDATE | permissive |
| user_roles | `self updates own username` | UPDATE | permissive |

**customer_profiles.`customer profile select`** (SELECT)

- USING before: `((user_id = auth.uid()) OR is_admin(auth.uid()) OR (is_agent(auth.uid()) AND (agent_id = auth.uid())))`
- USING after:  `((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin(auth.uid()) AS is_admin) OR (( SELECT is_agent(auth.uid()) AS is_agent) AND (agent_id = ( SELECT auth.uid() AS uid))))`

**global_products.`products managed by admin`** (ALL)

- USING before: `is_admin(auth.uid())`
- USING after:  `( SELECT is_admin(auth.uid()) AS is_admin)`
- WITH CHECK before: `is_admin(auth.uid())`
- WITH CHECK after:  `( SELECT is_admin(auth.uid()) AS is_admin)`

**global_products.`products readable by staff`** (SELECT)

- USING before: `is_staff(auth.uid())`
- USING after:  `( SELECT is_staff(auth.uid()) AS is_staff)`

**inquiries.`tenant_isolation`** (ALL)

- USING before: `(tenant_id = current_tenant_id())`
- USING after:  `(tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))`
- WITH CHECK before: `(tenant_id = current_tenant_id())`
- WITH CHECK after:  `(tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))`

**order_items.`order items select`** (SELECT)

- USING before: `(EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND can_view_order(o.customer_id, o.agent_id))))`
- USING after:  `(EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND (( SELECT is_admin(auth.uid()) AS is_admin) OR (o.customer_id = ( SELECT auth.uid() AS uid)) OR ((o.agent_id IS NOT NULL) AND (o.agent_id = ( SELECT auth.uid() AS uid)))))))`

**orders.`orders insert by customer or staff`** (INSERT)

- WITH CHECK before: `((customer_id = auth.uid()) OR is_admin(auth.uid()) OR (is_agent(auth.uid()) AND is_agent_of_customer(auth.uid(), customer_id)))`
- WITH CHECK after:  `((customer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin(auth.uid()) AS is_admin) OR (( SELECT is_agent(auth.uid()) AS is_agent) AND is_agent_of_customer(( SELECT auth.uid() AS uid), customer_id)))`

**orders.`orders select`** (SELECT)

- USING before: `can_view_order(customer_id, agent_id)`
- USING after:  `(( SELECT is_admin(auth.uid()) AS is_admin) OR (customer_id = ( SELECT auth.uid() AS uid)) OR ((agent_id IS NOT NULL) AND (agent_id = ( SELECT auth.uid() AS uid))))`

**orders.`orders update by staff`** (UPDATE)

- USING before: `(is_admin(auth.uid()) OR (agent_id = auth.uid()))`
- USING after:  `(( SELECT is_admin(auth.uid()) AS is_admin) OR (agent_id = ( SELECT auth.uid() AS uid)))`
- WITH CHECK before: `(is_admin(auth.uid()) OR (agent_id = auth.uid()))`
- WITH CHECK after:  `(( SELECT is_admin(auth.uid()) AS is_admin) OR (agent_id = ( SELECT auth.uid() AS uid)))`

**user_roles.`role readable by self staff or agent of customer`** (SELECT)

- USING before: `((user_id = auth.uid()) OR is_admin(auth.uid()) OR (is_agent(auth.uid()) AND is_agent_of_customer(auth.uid(), user_id)))`
- USING after:  `((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin(auth.uid()) AS is_admin) OR (( SELECT is_agent(auth.uid()) AS is_agent) AND is_agent_of_customer(( SELECT auth.uid() AS uid), user_id)))`

