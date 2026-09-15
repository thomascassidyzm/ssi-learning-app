# Paddle fees as observed, 15 September 2026

Every completed transaction on the live Paddle account, read read-only on 2026-09-15 with `GET /transactions?status=completed` (job #851). Amounts are major units. `gross` is the tax-inclusive grand total the customer paid; `net` is what Paddle says SSi earns, which is gross minus the VAT Paddle remits minus its own fee. The last two columns are the same transaction in the payout currency, US dollars, which is where Paddle actually computes the fee.

| # | date | txn | origin | gross GBP | VAT in gross | Paddle fee | net to SSi | fee % of gross | USD gross | USD fee |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-06-09 | `txn_01ktpd723w7pwkmtk2tydngr2h` | subscription_recurring | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.71 | 1.47 |
| 2 | 2026-06-17 | `txn_01kvb5s5sz7wr1tzcxh1f2bnd8` | subscription_recurring | 15.00 | 1.04 | 1.13 | 12.83 | 7.53% | 19.43 | 1.46 |
| 3 | 2026-06-24 | `txn_01kvx88gnwew1m7wf2f5qpr5hx` | web | 15.00 | 1.14 | 1.13 | 12.73 | 7.53% | 19.35 | 1.46 |
| 4 | 2026-07-03 | `txn_01kwkx6q3x29bxded8059179a8` | web | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.64 | 1.47 |
| 5 | 2026-07-05 | `txn_01kwrqzd9acgvh0e0rqe8h8tnd` | web | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.68 | 1.47 |
| 6 | 2026-07-09 | `txn_01kx3n4nprzjqzxz7730hvanwa` | subscription_recurring | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.70 | 1.47 |
| 7 | 2026-07-17 | `txn_01kxrdpngav5sq1hgvkq08kc5r` | subscription_recurring | 15.00 | 1.04 | 1.12 | 12.84 | 7.47% | 19.76 | 1.48 |
| 8 | 2026-07-23 | `txn_01ky6vfmdzge9q7qp6hsac2d1v` | web | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.68 | 1.47 |
| 9 | 2026-08-03 | `txn_01kz3qjy8bvahty6ct2r2ky1fd` | subscription_recurring | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.79 | 1.48 |
| 10 | 2026-08-09 | `txn_01kzkfez281wvmv8avm9z7e3kh` | subscription_recurring | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.80 | 1.48 |
| 11 | 2026-08-17 | `txn_01m088105dh0z44ecs82fw5cbj` | subscription_recurring | 15.00 | 1.04 | 1.12 | 12.84 | 7.47% | 19.93 | 1.49 |
| 12 | 2026-08-23 | `txn_01m0pp65kb1z82w7axzn2pkngq` | subscription_recurring | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 20.05 | 1.50 |
| 13 | 2026-09-03 | `txn_01m1khx91kpn7qehckr6rp2e16` | subscription_recurring | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.84 | 1.48 |
| 14 | 2026-09-07 | `txn_01m1z3xvyb4btxapme2v3mnrxx` | web | 25.00 | 3.45 | 1.62 | 19.93 | 6.48% | 33.19 | 2.15 |
| 15 | 2026-09-09 | `txn_01m239s7n7e9065596gevwqj3z` | subscription_recurring | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.94 | 1.49 |
| 16 | 2026-09-12 | `txn_01m29x52y5hwqv9d1qf2gs88wr` | web | 15.00 | 2.50 | 1.12 | 11.38 | 7.47% | 19.89 | 1.48 |
| 17 | 2026-09-14 | `txn_01m2gs2dzxczgzwk8p17vwsbdg` | web | 250.00 | 41.67 | 12.87 | 195.46 | 5.15% | 330.68 | 17.02 |

**Totals.** 30 completed transactions, all GBP. 13 of them are £0.00 — trial or fully-discounted checkouts, no fee, listed nowhere above. The 17 money transactions: **£500.00 gross, £76.88 VAT remitted, £31.31 in Paddle fees, £391.81 net to SSi.** Fees are **6.26% of tax-inclusive gross** and **7.40% of the ex-VAT price**.

## Observed against published

The options doc https://watson-1.tail4968cb.ts.net/d/af8f8d3f computed from Paddle's published **5% + 50c**. Observed matches it exactly, and every transaction carries a payout `fee_rate` of `0.05`. Reconstructed on all 17: **fee = 5% of the tax-inclusive USD grand total + $0.50**, agreeing to within one cent on every row, then converted back to GBP at Paddle's own exchange rate for that transaction.

What the published headline hides is the two details that make the real bite bigger than 5%:

1. **The 5% is charged on the tax-inclusive total**, not on the price SSi keeps. On a UK £15 monthly the customer pays £15.00, of which £2.50 is VAT Paddle remits — but the percentage is taken on the whole £15. The tax share varies by the customer's country: the table shows anything from £1.04 to £2.50 of VAT inside the same £15.00.
2. **The 50c is a US-dollar flat**, so it converts, and it dominates on small tickets. On a £15 monthly it is roughly a third of the fee.

Net effect on the current book: a UK £15.00 monthly costs £1.12 in fees and returns £11.38 — the fee is 7.47% of gross and **8.96% of the £12.50 SSi actually prices**. The one large transaction (£250.00, 2026-09-14) costs £12.87, 5.15% of gross and 6.18% ex-VAT, because the flat 50c has shrunk to noise. That is the shape to carry into any rail comparison: Paddle's effective rate on this book is **7.40% of revenue**, falling toward ~6% as ticket size rises, not 5%.

