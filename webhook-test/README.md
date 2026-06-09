# Webhook test kit — create an order with NO manual typing

Prove that a brand-new invoice creates an order on the OMS board automatically,
the same way SQL Account will. Each run sends a fresh invoice, so it never clashes
with a real one.

## Quick start (Windows)

1. Double-click **`Run-Test.cmd`**.
2. First time only: paste the **webhook secret** when asked
   (Vercel → backend project → Settings → Environment Variables →
   `SQL_ACCOUNT_WEBHOOK_SECRET`). Choose **y** to remember it on this PC.
3. You'll see **SUCCESS** and a test invoice number like `TEST-20260609-143501`.
4. Open the OMS board — it's the newest card in the **Order** column.

That's it. Run it again any time for another test order (a new number each run).

## Clean up test orders

Open the test order on the board and use **Cancel order** (Boss/Ops). It leaves the
board and keeps the history clean.

## What it sends

A sample invoice with two real STK lines (STK006, STK035). To change the customer
or items, edit the `$payload` block near the top of `run-test.ps1`.

## Prefer Postman / curl?

Use `example-invoice.json` as the body. **Change `invoice_number` to something new
each time** (a repeat returns `409 Duplicate` and is ignored on purpose).

```bash
curl -X POST "https://wawasan-oms-backend.vercel.app/api/orders/webhook/sql-account" \
  -H "x-webhook-secret: <your-secret>" \
  -H "Content-Type: application/json" \
  -d @example-invoice.json
```

## Good to know

- **Every run = a new invoice number**, so you never create a duplicate.
- `201` = created · `409` = duplicate (ignored) · `401` = wrong secret · `400` = missing field.
- This tests the **webhook** directly. For the real "read invoices from SQL Account
  and send them automatically" flow, see [`../sql-account-bridge`](../sql-account-bridge)
  (CSV export works today).
- The secret stays in `webhook-test.env`, which is git-ignored — it never leaves this PC.
- Full reference: [`../SQL-ACCOUNT-WEBHOOK.md`](../SQL-ACCOUNT-WEBHOOK.md).
