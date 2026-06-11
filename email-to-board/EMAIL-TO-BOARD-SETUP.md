# Email-to-Board — automatic invoices → order board

The **free, all-cloud, automated** way to fill the order board from SQL Account,
with **nothing installed on the factory PC**.

```
SQL Account ──emails invoice CSV──▶ Gmail inbox ──Apps Script (every 5 min)──▶
   POST /api/orders/webhook/sql-account-csv ──▶ orders on the board (dupes skipped)
```

Three free pieces: a Gmail inbox, a Google Apps Script (runs on Google's cloud),
and the backend webhook (already deployed). No AI, no per-invoice cost.

---

## What you need to switch it on

### 1. A dedicated free inbox
Create a Gmail address just for this, e.g. `wawasanorders@gmail.com`.
(Any Gmail works; a dedicated one keeps the inbox clean.)

### 2. SQL Account emails each invoice **as CSV** to that inbox
This is the one piece on your side — ask your SQL Account person:

- **Best:** set SQL Account to **auto-email** each sales invoice to the inbox on
  save, attaching the invoice as **CSV** (the export with `DocNo, CompanyName,
  ItemCode, Description, Qty, UOM …` columns — same as the file you'd drop into
  the Import screen).
- **If it can only email on a button-press:** still fine — staff clicks "Email"
  per batch. Still free, still all-cloud.
- **If it can only attach PDF, not CSV:** this path won't read it (reading a PDF
  needs the paid AI route). Get a **CSV** out of SQL Account for the free path.

> The column names don't have to be exact — the importer matches common
> aliases automatically. It needs at least a **Doc No** and a **Customer** column.

### 3. The Apps Script (the watcher)
1. Go to **script.google.com** → **New project**.
2. Delete the sample, paste the contents of **`email-to-board.gs`**.
3. Set **`WEBHOOK_SECRET`** to the same value as the backend's
   `SQL_ACCOUNT_WEBHOOK_SECRET` env var.
4. (Optional) tighten **`SEARCH_QUERY`** so only invoice mail matches, e.g.
   `is:unread has:attachment filename:csv from:accounts@yourcompany.com`.
5. Run the **`installTrigger`** function once. Google asks you to authorise
   Gmail access — approve it (your account, your inbox).
6. Done. It now checks the inbox every 5 minutes, forever, on Google's servers.

Handled mails get an **`OMS-Imported`** label; anything that errored gets
**`OMS-Error`** (and stays visible) so nothing is silently lost.

---

## Test it safely first

Before going live, confirm the pipe works without creating real orders:

```bash
# dry run — parses + checks duplicates, creates NOTHING
curl -X POST https://wawasan-oms-backend.vercel.app/api/orders/webhook/sql-account-csv \
  -H "x-webhook-secret: <SQL_ACCOUNT_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d "{\"dry_run\":true,\"csv\":\"DocNo,DocDate,CompanyName,ItemCode,Description,Qty,UOM\nTEST-001,11/06/2026,Demo Customer Sdn Bhd,STK006,FIRE CHICKEN FIRESTARTER,3,CTN\"}"
```

Expect `{"mode":"dry_run","total":1,"new_count":1, ...}`. Drop `"dry_run":true`
to actually create. In the Apps Script editor, `runOnce()` processes the inbox
immediately so you can watch one real email flow through.

---

## How it behaves

- **Duplicates** (same Doc No already on the board) are skipped automatically —
  re-sending or a double email never double-creates.
- Each new invoice lands in the **Order** column, `source = sql_account`, and
  pings the routers (Boss / Admin / Production Lead) to assign a PIC — exactly
  like the live SQL Account webhook.
- **Money stays in SQL Account** — only Doc No, customer, dates, PO/terms and the
  line items (code, description, qty, unit) are imported.

## Endpoint
`POST /api/orders/webhook/sql-account-csv` — header `x-webhook-secret`, body
`{ "csv": "<file text>", "dry_run"?: true }`. Returns
`{ created, duplicate, failed, results }`.
