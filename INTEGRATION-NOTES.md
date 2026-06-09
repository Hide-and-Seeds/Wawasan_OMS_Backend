# Integration & data notes

Developer notes on how orders get *into* the OMS, the product data behind the
line items, and how the demo + deploys are verified. The customer-facing webhook
contract (payload, test command, SQL-Account-side wiring) lives in
[`SQL-ACCOUNT-WEBHOOK.md`](./SQL-ACCOUNT-WEBHOOK.md); this file is the "why" and
the conventions to keep when extending it.

## The order-creation parity rule (most important)

Orders enter two ways: **manual** `POST /api/orders` (Ops/Admin) and the
**machine** `POST /api/orders/webhook/sql-account`. They must produce the **same
artifacts** or the board, the timing reports and the audit trail diverge. Any new
creation path must, inside one `withTransaction` (see `src/routes/orders.js`):

1. insert `orders` — `stage='order'` (or `'packing'` when `skip_production`), `source`;
2. insert `order_items`;
3. insert an **initial `stage_transitions` row** (`from_stage=NULL → first stage`) —
   the timing/throughput reports read this table; omit it and the order is
   invisible to cycle-time reporting even though it shows on the board;
4. `logActivity('order_created', …)`;
5. **webhook only:** `notify(...)` every `operations_controller` + `super_admin`
   (type `order_stage_entered`) so a human routes it (assigns a PIC). The manual
   path skips this — the human is already there.

If you add a third creation path, copy the manual handler's shape; don't reinvent.

## Webhook internals (`POST /api/orders/webhook/sql-account`)

- **Auth:** header `x-webhook-secret` must equal `SQL_ACCOUNT_WEBHOOK_SECRET`.
  **Fail closed** — if the env var is unset, reject every call (a naive
  `secret !== env` lets `undefined !== undefined` through and opens the endpoint).
- **Required** `invoice_number`, `customer_name`; everything else optional
  (`customer_contact, order_date, required_delivery_date, expiry_date, priority,
  importance, po_ref, payment_terms, notes, skip_production, items[]`).
- **Idempotent:** duplicate `invoice_number` → `409` (also a DB unique
  constraint), so a bridge can deliver at-least-once safely.
- **Robust for a machine caller — sanitise, don't reject:** bad `priority`→`normal`,
  bad `importance`→`standard`; item fallbacks `name ← sku ← 'Item'`,
  `quantity ← 1`, `unit ← 'pcs'`. One stray field must never drop an invoice.
- **`required_delivery_date` is `NOT NULL` but invoices have no delivery date**
  (they carry payment terms). Default it:
  `COALESCE($n::date, CURRENT_DATE + SQL_ACCOUNT_DEFAULT_LEAD_DAYS::int)`
  (lead days env, default 7). Ops adjusts on the board.
- **No money/PO/tax columns** — money stays in SQL Account; the OMS is operational
  only. Park `po_ref` + `payment_terms` in `orders.notes` (`"PO 001652 · C.O.D."`).

## Product / SKU data model

- The real product master is the client's **MONTHLY STOCKLIST** xlsx. Sellable
  **finished goods = the `STK` sheet** (codes `STKnnn`, UOM CTN/PACK/BOX/UNIT);
  **ready-stock aroma candles = the `RS` sheet** (codes `ST00nnn`). The other ~11
  sheets are **raw materials — never order line items**.
- An invoice line → an `order_item`: code→`sku`, description→`name`, qty→`quantity`,
  UOM→`unit`. UI item entry is **free-text and locked to the invoice** after
  creation, so use the real codes. Generated catalogue:
  [`reference-skus.md`](./reference-skus.md) (rebuild from the stocklist with
  `openpyxl`).
- Real invoice shape (SQL Account "SI" docs): Doc No `SI`+YY+MM+seq; billing +
  delivery customer; per-line tax 5/10/0%; terms C.O.D./30 Days; PO in Ref 1.
  Only the operational subset maps into the OMS.

## Demo / showcase data

- [`demo-seed.sql`](./demo-seed.sql) is the showcase loader: a re-runnable
  `DO $$` block keyed on `invoice_number LIKE 'WC-DEMO-%'` (deletes its own rows
  first; real orders untouched). It spreads ~12 orders across **all** stages with
  one rework loop, one `waiting_stock`, one `on_hold` so every report/badge has
  data.
- Build it from **real customers + real STK SKUs + real UOM**. Escape apostrophes
  in product names for SQL (`6'S` → `6''S`). It depends on the seeded users +
  deliverers existing (`npm run seed` first).
- Load via the **Supabase SQL editor** (or the Supabase MCP). `npm run seed` is the
  minimal bootstrap (users/deliverers/settings + a few sample orders);
  `demo-seed.sql` is the realistic layer on top.

## Deploy + verify loop

- Backend and frontend are **separate Vercel projects**; **push to `main` = ship**
  (auto-deploy). Never push without owner OK (see `PLAN.md`). Region `icn1` (Seoul),
  colocated with the Supabase DB.
- After a push, confirm the deploy reached **`READY`** (Vercel dashboard, or the
  Vercel MCP `list_deployments`/`get_deployment`). `ERROR` = build failed and the
  previous deploy keeps serving.
- **Vercel env changes only take effect on a redeploy** — after setting/rotating
  `SQL_ACCOUNT_WEBHOOK_SECRET`, redeploy before testing.
- **Smoke-test the webhook** against the public clean alias
  `https://wawasan-oms-backend.vercel.app` (per-deploy and `*-git-main-*` URLs are
  SSO-protected). POST the sample invoice with the secret → expect `201`; verify
  the order + items + `NULL→order` transition + `order_created` activity + the two
  notifications; then delete the test order.
