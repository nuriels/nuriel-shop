
#### Scenario A

| query | role / persona | rows | plan ms | exec ms orig | vs timeout | exec ms rewrite | speed-up | orders index (orig) | helper calls orig → rewrite | buffers hit orig → rewrite |
|---|---|--:|--:|--:|---|--:|--:|---|---|---|
| `a1_cust_orders_nofilter` | authenticated / t1_customer_a | 420 | 2.0 | 2898 | 36% of 8 s | 26 | 112.7x | orders_tenant_created_idx | current_tenant_id×45,063, is_super_admin×22,530, is_admin×22,530 → current_tenant_id×9, is_super_admin×3, is_admin×3 | 164725 → 6984 |
| `a2_cust_orders_filtered` | authenticated / t1_customer_a | 420 | 2.7 | 458 | 6% of 8 s | 24 | 19.3x | orders_customer_idx, orders_tenant_id_idx | current_tenant_id×5,903, is_super_admin×2,950, is_admin×2,950 → current_tenant_id×9, is_super_admin×3, is_admin×3 | 26650 → 5969 |
| `b1_agent_orders` | authenticated / t1_agent | 1000 | 2.3 | 1427 | 18% of 8 s | 52 | 27.4x | orders_tenant_created_idx | current_tenant_id×22,633, is_super_admin×11,315, is_admin×11,315 → current_tenant_id×9, is_super_admin×3, is_admin×3 | 92086 → 12850 |
| `b2_admin_orders` | authenticated / t1_admin | 1000 | 3.4 | 667 | 8% of 8 s | 40 | 16.6x | orders_tenant_created_idx | current_tenant_id×14,087, is_super_admin×7,042, is_admin×7,042 → current_tenant_id×9, is_super_admin×3, is_admin×3 | 54929 → 12643 |
| `b3_admin_profiles` | authenticated / t1_admin | 50 | 1.1 | 10 | 0% of 8 s | 3 | 3.3x | - | current_tenant_id×101, is_super_admin×50, is_admin×50 → current_tenant_id×3, is_super_admin×1, is_admin×1 | 782 → 487 |
| `b4_admin_user_roles` | authenticated / t1_admin | 52 | 1.4 | 8 | 0% of 8 s | 3 | 3.0x | - | current_tenant_id×103, is_super_admin×51, is_admin×51 → current_tenant_id×3, is_super_admin×1, is_admin×1 | 575 → 272 |
| `b5_cust_profiles` | authenticated / t1_customer_a | 1 | 0.9 | 12 | 0% of 8 s | 3 | 4.1x | - | current_tenant_id×149, is_super_admin×49, is_admin×49 → current_tenant_id×5, is_super_admin×1, is_admin×1 | 1064 → 537 |
| `c1_catalog_anon` | anon / anon | 2910 | 0.2 | 283 | 9% of 3 s | 311 | 0.9x | - | buyer_price_tier×23,493, current_tenant_id×43, tenant_is_active×1 → buyer_price_tier×23,493, current_tenant_id×43, tenant_is_active×1 | 18964 → 18992 |
| `c2_catalog_auth` | authenticated / t1_customer_a | 2910 | 0.2 | 1143 | 14% of 8 s | 1016 | 1.1x | - | current_tenant_id×47,257, buyer_price_tier×23,607, tenant_is_active×1 → current_tenant_id×47,257, buyer_price_tier×23,607, tenant_is_active×1 | 207865 → 207893 |
| `c3_catalog_admin` | authenticated / t1_admin | 2910 | 0.2 | 212 | 3% of 8 s | 238 | 0.9x | - | buyer_price_tier×23,493, current_tenant_id×43, tenant_is_active×1 → buyer_price_tier×23,493, current_tenant_id×43, tenant_is_active×1 | 42502 → 42530 |
| `c4_catalog_page_anon` | anon / anon | 1000 | 0.3 | 220 | 7% of 3 s | 233 | 0.9x | - | buyer_price_tier×23,493, current_tenant_id×43, tenant_is_active×1 → buyer_price_tier×23,493, current_tenant_id×43, tenant_is_active×1 | 18699 → 18727 |
| `c5_feed_one_anon` | anon / anon | | | denied (42501) | | denied (42501) | | | | |
| `c6_feed_one_auth` | authenticated / t1_customer_a | | | denied (42501) | | denied (42501) | | | | |
| `c7_feed_one_service` | service_role / service | 1 | 0.3 | 525 | n/a (no limit) | 581 | 0.9x | - | tenant_active_addons×5,820, tenant_subscription_state×2,910, tenant_is_active×2,910 → tenant_active_addons×5,820, tenant_subscription_state×2,910, tenant_is_active×2,910 | 56119 → 56119 |
| `d1_admin_products` | authenticated / t1_admin | 1000 | 1.4 | 313 | 4% of 8 s | 29 | 10.7x | - | current_tenant_id×6,001, is_super_admin×3,000, is_staff×3,000 → current_tenant_id×3, is_super_admin×1, is_staff×1 | 19010 → 1015 |
| `d2_agent_products` | authenticated / t1_agent | 1000 | 1.4 | 653 | 8% of 8 s | 40 | 16.1x | - | current_tenant_id×12,001, is_super_admin×3,000, is_staff×3,000 → current_tenant_id×5, is_super_admin×1, is_staff×1 | 40051 → 1065 |
| `e1_items_one_order` | authenticated / t1_customer_a | 5 | 1.5 | 5 | 0% of 8 s | 3 | 1.7x | - | current_tenant_id×22, is_super_admin×10, is_admin×10 → current_tenant_id×6, is_super_admin×2, is_admin×2 | 652 → 544 |
| `e2_items_count_cust` | authenticated / t1_customer_a | 1 | 1.3 | 2430 | 30% of 8 s | 17 | 138.9x | orders_tenant_id_idx | current_tenant_id×40,842, is_super_admin×20,420, is_admin×20,420 → current_tenant_id×6, is_super_admin×2, is_admin×2 | 145727 → 2745 |
| `e3_items_count_admin` | authenticated / t1_admin | 1 | 1.3 | 3864 | 48% of 8 s | 31 | 125.2x | orders_tenant_id_idx | current_tenant_id×80,002, is_super_admin×40,000, is_admin×40,000 → current_tenant_id×6, is_super_admin×2, is_admin×2 | 242746 → 2702 |

#### Scenario B

| query | role / persona | rows | plan ms | exec ms orig | vs timeout | exec ms rewrite | speed-up | orders index (orig) | helper calls orig → rewrite | buffers hit orig → rewrite |
|---|---|--:|--:|--:|---|--:|--:|---|---|---|
| `a1_cust_orders_nofilter` | authenticated / t1_customer_a | 728 | 2.1 | 15244 | 191% of 8 s **EXCEEDS** | 69 | 221.5x | orders_tenant_created_idx | current_tenant_id×154,485, is_admin×154,482, is_super_admin×154,482 → current_tenant_id×6, is_admin×3, is_super_admin×3 | 1409748 → 22880 |
| `a2_cust_orders_filtered` | authenticated / t1_customer_a | 728 | 2.0 | 594 | 7% of 8 s | 48 | 12.3x | orders_customer_idx, orders_tenant_id_idx | current_tenant_id×5,213, is_admin×5,210, is_super_admin×5,210 → current_tenant_id×6, is_admin×3, is_super_admin×3 | 60177 → 13260 |
| `b1_agent_orders` | authenticated / t1_agent | 1000 | 2.1 | 1253 | 16% of 8 s | 48 | 25.9x | orders_tenant_created_idx | current_tenant_id×11,473, is_admin×11,470, is_super_admin×11,470 → current_tenant_id×6, is_admin×3, is_super_admin×3 | 120208 → 16951 |
| `b2_admin_orders` | authenticated / t1_admin | 1000 | 2.0 | 781 | 10% of 8 s | 51 | 15.3x | orders_tenant_created_idx | current_tenant_id×13,935, is_admin×6,966, is_super_admin×6,966 → current_tenant_id×9, is_admin×3, is_super_admin×3 | 107115 → 16542 |
| `b3_admin_profiles` | authenticated / t1_admin | 200 | 0.8 | 22 | 0% of 8 s | 4 | 6.0x | - | current_tenant_id×401, is_admin×200, is_super_admin×200 → current_tenant_id×3, is_admin×1, is_super_admin×1 | 3081 → 491 |
| `b4_admin_user_roles` | authenticated / t1_admin | 202 | 1.1 | 25 | 0% of 8 s | 2 | 10.2x | - | current_tenant_id×403, is_admin×201, is_super_admin×201 → current_tenant_id×3, is_admin×1, is_super_admin×1 | 2880 → 277 |
| `b5_cust_profiles` | authenticated / t1_customer_a | 1 | 0.8 | 18 | 0% of 8 s | 4 | 4.8x | - | current_tenant_id×201, is_admin×199, is_super_admin×199 → current_tenant_id×3, is_admin×1, is_super_admin×1 | 2915 → 536 |
| `c1_catalog_anon` | anon / anon | 9697 | 0.3 | 760 | 25% of 3 s | 744 | 1.0x | - | buyer_price_tier×78,265, current_tenant_id×43, tenant_is_active×1 → buyer_price_tier×78,265, current_tenant_id×43, tenant_is_active×1 | 57145 → 57171 |
| `c2_catalog_auth` | authenticated / t1_customer_a | 9697 | 0.2 | 3241 | 41% of 8 s | 3023 | 1.1x | - | current_tenant_id×157,329, buyer_price_tier×78,643, tenant_is_active×1 → current_tenant_id×157,329, buyer_price_tier×78,643, tenant_is_active×1 | 1315607 → 1315633 |
| `c3_catalog_admin` | authenticated / t1_admin | 9697 | 0.2 | 1033 | 13% of 8 s | 811 | 1.3x | - | buyer_price_tier×78,265, current_tenant_id×43, tenant_is_active×1 → buyer_price_tier×78,265, current_tenant_id×43, tenant_is_active×1 | 213849 → 213875 |
| `c4_catalog_page_anon` | anon / anon | 1000 | 0.3 | 683 | 23% of 3 s | 660 | 1.0x | - | buyer_price_tier×78,265, current_tenant_id×43, tenant_is_active×1 → buyer_price_tier×78,265, current_tenant_id×43, tenant_is_active×1 | 56880 → 56906 |
| `c5_feed_one_anon` | anon / anon | | | denied (42501) | | denied (42501) | | | | |
| `c6_feed_one_auth` | authenticated / t1_customer_a | | | denied (42501) | | denied (42501) | | | | |
| `c7_feed_one_service` | service_role / service | 1 | 0.3 | 1883 | n/a (no limit) | 2157 | 0.9x | - | tenant_active_addons×19,394, tenant_is_active×9,697, tenant_subscription_state×9,697 → tenant_active_addons×19,394, tenant_is_active×9,697, tenant_subscription_state×9,697 | 182532 → 182532 |
| `d1_admin_products` | authenticated / t1_admin | 1000 | 1.1 | 1034 | 13% of 8 s | 53 | 19.5x | - | current_tenant_id×20,001, is_admin×10,000, is_super_admin×10,000 → current_tenant_id×3, is_admin×1, is_super_admin×1 | 132252 → 2262 |
| `d2_agent_products` | authenticated / t1_agent | 1000 | 1.2 | 1792 | 22% of 8 s | 69 | 26.1x | - | current_tenant_id×30,001, is_admin×10,000, is_super_admin×10,000 → current_tenant_id×4, is_admin×1, is_super_admin×1 | 222293 → 2313 |
| `e1_items_one_order` | authenticated / t1_customer_a | 5 | 1.3 | 4 | 0% of 8 s | 4 | 1.2x | - | current_tenant_id×12, is_admin×10, is_super_admin×10 → current_tenant_id×4, is_admin×2, is_super_admin×2 | 675 → 547 |
| `e2_items_count_cust` | authenticated / t1_customer_a | 1 | 1.2 | 16392 | 205% of 8 s **EXCEEDS** | 89 | 184.5x | orders_tenant_id_idx | current_tenant_id×150,730, is_admin×150,728, is_super_admin×150,728 → current_tenant_id×4, is_admin×2, is_super_admin×2 | 1359644 → 14798 |
| `e3_items_count_admin` | authenticated / t1_admin | 1 | 1.6 | 27806 | 348% of 8 s **EXCEEDS** | 256 | 108.8x | orders_tenant_id_idx | current_tenant_id×600,002, is_admin×300,000, is_super_admin×300,000 → current_tenant_id×6, is_admin×2, is_super_admin×2 | 3911281 → 13235 |

#### Load test (pgbench, 30 s per cell, real API roles; run 2 = quiet machine, run 1 = shared with other jobs)

| scenario | variant | workload | clients | tx (run 2) | TPS run 2 | TPS run 1 | p50 ms run 2 | p50 ms run 1 | p95 ms run 2 | p95 ms run 1 | max ms run 2 |
|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| A | orig | cust_orders | 8 | 48 | 1.4 | 1.3 | 5719 | 5760 | 6046 | 6584 | 6296 |
| A | orig | cust_orders | 16 | 48 | 1.4 | 1.4 | 10937 | 11031 | 11511 | 12105 | 11846 |
| A | orig | cust_orders_flt | 8 | 329 | 10.8 | 10.6 | 729 | 768 | 917 | 986 | 1068 |
| A | orig | cust_orders_flt | 16 | 322 | 10.5 | 11.9 | 1496 | 1334 | 1825 | 1627 | 2549 |
| A | orig | admin_orders | 8 | 161 | 5.2 | 4.5 | 1527 | 1773 | 1772 | 2080 | 1924 |
| A | orig | admin_orders | 16 | 160 | 5.1 | 4.8 | 3082 | 3351 | 3890 | 3698 | 3951 |
| A | orig | agent_orders | 8 | 84 | 2.6 | 2.6 | 2975 | 3047 | 3467 | 3541 | 3529 |
| A | orig | agent_orders | 16 | 84 | 2.6 | 3.0 | 6031 | 5280 | 6604 | 5761 | 6755 |
| A | rewrite | cust_orders | 8 | 5661 | 188.5 | 167.9 | 40 | 45 | 59 | 73 | 95 |
| A | rewrite | cust_orders | 16 | 5418 | 180.3 | 175.1 | 86 | 90 | 124 | 125 | 189 |
| A | rewrite | cust_orders_flt | 8 | 6249 | 208.2 | 190.0 | 37 | 40 | 53 | 64 | 97 |
| A | rewrite | cust_orders_flt | 16 | 5868 | 195.3 | 183.9 | 79 | 85 | 114 | 118 | 166 |
| A | rewrite | admin_orders | 8 | 2631 | 87.5 | 76.0 | 87 | 102 | 122 | 148 | 175 |
| A | rewrite | admin_orders | 16 | 2555 | 84.8 | 83.9 | 183 | 186 | 256 | 252 | 327 |
| A | rewrite | agent_orders | 8 | 2581 | 85.8 | 82.7 | 88 | 92 | 127 | 132 | 210 |
| A | rewrite | agent_orders | 16 | 2524 | 83.8 | 81.0 | 184 | 193 | 259 | 264 | 397 |
| B | orig | cust_orders | 8 | 8 | 0.2 | 0.2 | 33403 | 35759 | 33598 | 36095 | 33598 |
| B | orig | cust_orders | 16 | 16 | 0.2 | 0.2 | 77377 | 69191 | 78042 | 70017 | 78042 |
| B | orig | cust_orders_flt | 8 | 176 | 5.7 | 6.4 | 1370 | 1271 | 1827 | 1609 | 2035 |
| B | orig | cust_orders_flt | 16 | 180 | 5.8 | 6.6 | 2694 | 2402 | 3584 | 2759 | 3827 |
| B | orig | admin_orders | 8 | 143 | 4.6 | 4.8 | 1684 | 1676 | 2229 | 1999 | 2282 |
| B | orig | admin_orders | 16 | 145 | 4.5 | 5.1 | 3541 | 3115 | 4192 | 3436 | 4440 |
| B | orig | agent_orders | 8 | 88 | 2.8 | 2.8 | 2784 | 2844 | 3521 | 3259 | 3795 |
| B | orig | agent_orders | 16 | 96 | 2.9 | 2.9 | 5568 | 5392 | 6256 | 6092 | 6761 |
| B | rewrite | cust_orders | 8 | 1717 | 57.1 | 55.5 | 133 | 141 | 184 | 195 | 251 |
| B | rewrite | cust_orders | 16 | 1725 | 57.2 | 56.5 | 274 | 278 | 356 | 368 | 490 |
| B | rewrite | cust_orders_flt | 8 | 2643 | 88.0 | 81.1 | 87 | 95 | 122 | 141 | 183 |
| B | rewrite | cust_orders_flt | 16 | 2662 | 88.4 | 88.8 | 176 | 177 | 239 | 244 | 390 |
| B | rewrite | admin_orders | 8 | 2384 | 79.3 | 82.5 | 95 | 91 | 136 | 139 | 208 |
| B | rewrite | admin_orders | 16 | 2311 | 76.8 | 85.3 | 202 | 183 | 280 | 248 | 404 |
| B | rewrite | agent_orders | 8 | 2326 | 77.3 | 83.4 | 96 | 91 | 139 | 132 | 221 |
| B | rewrite | agent_orders | 16 | 2353 | 78.1 | 83.2 | 200 | 188 | 272 | 256 | 419 |
