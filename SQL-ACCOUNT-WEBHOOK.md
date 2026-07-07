# SQL Account → OMS: auto-trigger an order from a new invoice

When SQL Account generates a sales invoice, it POSTs the invoice to the OMS and
the order appears instantly in the **Order** column of the kanban board. From
there it flows through the four production stages exactly like a manual order:

```
SQL Account invoice  ──►  POST /api/orders/webhook/sql-account
                          │
                          ├─ creates the order (stage = "order", source = "sql_account")
                          ├─ creates its line items (SKUs)
                          ├─ writes the initial stage_transition  → timing reports
                          ├─ writes an activity_log entry          → audit trail
                          └─ notifies Operations + Admin           → "assign a PIC"
                          │
   Ops assigns PIC ──► Production ──► Packing ──► Ready for Delivery ──► Delivered
```

## Endpoint

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `https://<your-backend-host>/api/orders/webhook/sql-account` |
| **Auth** | Header `x-webhook-secret: <SQL_ACCOUNT_WEBHOOK_SECRET>` |
| **Body** | `application/json` (UTF-8) |

Set `SQL_ACCOUNT_WEBHOOK_SECRET` in the backend env first. If it is blank the
endpoint **rejects every request** (fail-closed) — this is deliberate.

## Payload

| Field | Required | Maps from the invoice | Notes |
|---|---|---|---|
| `invoice_number` | ✅ | Doc No. (e.g. `SI26060059`) | Unique key — a repeat is ignored (409). |
| `customer_name` | ✅ | Billing customer | |
| `customer_contact` | — | Tel | Stored on the order for reference. |
| `delivery_address` | — | Delivery / ship-to address | Shown to dispatch on the Ready-for-Delivery list. Optional — if omitted, staff type it in the app. |
| `items[]` | — | Invoice lines | `{ sku, name, quantity, unit }` — see below. |
| `items[].sku` | — | Item code (e.g. `STK006`) | Defaults to `N/A` if absent. |
| `items[].name` | — | Description | Falls back to the SKU. |
| `items[].quantity` | — | Qty | Defaults to `1`. |
| `items[].unit` | — | UOM (`CTN`, `BOX`, `PACK`…) | Defaults to `pcs`. |
| `required_delivery_date` | — | — | Invoices have none → defaults to order date + `SQL_ACCOUNT_DEFAULT_LEAD_DAYS` (7). Ops edits on the board. |
| `order_date` | — | Doc Date | Defaults to today. |
| `priority` | — | — | `normal` (default) or `urgent`. Bad value → `normal`. |
| `importance` | — | — | `standard` (default) / `priority` / `vip`. |
| `po_ref` | — | Ref 1 / PO no. | Stored in the order's **notes**. |
| `payment_terms` | — | Payment Terms (`C.O.D.`, `30 Days`) | Stored in **notes**. |
| `notes` | — | — | Free text; appended to notes. |
| `skip_production` | — | — | `true` → lands straight in Packing (for ready-stock items). |

> Money (prices, tax, totals) is intentionally **not** sent — it stays in SQL
> Account. The OMS only tracks the operational pipeline.

### Example — real invoice SI26060059

```json
{
  "invoice_number": "SI26060059",
  "customer_name": "PERFECT DESIGN TRADING SDN BHD",
  "customer_contact": "011-10841868",
  "delivery_address": "12 Jalan Mawar 3, Taman Sejahtera, 40000 Shah Alam, Selangor",
  "order_date": "2026-06-06",
  "po_ref": "PO-001652",
  "payment_terms": "C.O.D.",
  "items": [
    { "sku": "STK006", "name": "FIRE CHICKEN FIRESTARTER (40 BIJI) - 72 BOX/CTN", "quantity": 10, "unit": "CTN" },
    { "sku": "STK035", "name": "SERAI LILIN ANTI INSECTS CANDLES - 2PCS/PACK (66 PACKS/CTN)", "quantity": 2, "unit": "CTN" }
  ]
}
```

## Responses

| Status | Meaning |
|---|---|
| `201 Created` | `{ id, invoice_number, stage }` — order created. |
| `409 Conflict` | `invoice_number` already exists — safe to ignore (idempotent re-send). |
| `400 Bad Request` | Missing `invoice_number` or `customer_name`. |
| `401 Unauthorized` | Missing/wrong `x-webhook-secret` (or secret not configured). |

## Test it

PowerShell:

```powershell
$body = Get-Content .\example-invoice.json -Raw   # or paste the JSON above
Invoke-RestMethod -Method Post `
  -Uri "https://<your-backend-host>/api/orders/webhook/sql-account" `
  -Headers @{ "x-webhook-secret" = "<your-secret>" } `
  -ContentType "application/json" -Body $body
```

curl:

```bash
curl -X POST "https://<your-backend-host>/api/orders/webhook/sql-account" \
  -H "x-webhook-secret: <your-secret>" \
  -H "Content-Type: application/json" \
  -d @example-invoice.json
```

A `201` means the order is on the board. Re-run it → `409` (no duplicate). To
remove a test order, delete it from the board (Boss/Ops) or
`DELETE FROM orders WHERE invoice_number = 'SI26060059';`.

## Wiring the SQL Account side

SQL Account has no built-in "fire an HTTP POST on invoice save", so use one of:

1. **Bridge script (recommended).** A small always-on script/Scheduled Task that
   polls SQL Account (its SDK/`DBSetup` SQL view, or the exported invoice table)
   for invoices newer than the last seen Doc No., maps each to the JSON above, and
   POSTs it. Track the last Doc No. so each invoice is sent once; the OMS 409s on
   any accidental repeat, so at-least-once delivery is safe.
2. **SQL Account scripting / report automation** that writes new invoices to a
   watched folder or table, with the bridge above POSTing them.
3. **Manual fallback.** Until the bridge is live, Ops can keep creating orders by
   hand on the board (`+ New order`) — same result, same workflow.

Whichever path: the OMS contract above is the only thing that has to stay stable.
