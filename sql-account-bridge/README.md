# SQL Account → OMS bridge

Standalone poller: reads **new SQL Account sales invoices** and POSTs each to the
OMS webhook, so the order auto-appears on the board (Order column → production
flow). **Not** part of the Vercel app — it runs on a PC at the office that can see
the invoices (or the DB) and reach the internet.

The OMS side is already done and idempotent; this is the **only** piece that
depends on how your SQL Account exposes invoices. **If it isn't ready, nothing is
blocked** — Ops keys invoices by hand (`+ New order`), identical workflow. Treat
the bridge as an enhancement, not a launch dependency.

## Run

Needs **Node ≥ 20** (uses built-in `--env-file` and `fetch`; the CSV path has
**no `npm install`**).

```sh
cp .env.example .env          # set WEBHOOK_URL + WEBHOOK_SECRET (= the backend secret)
node --env-file=.env bridge.mjs --dry-run   # parse + map + print JSON, sends NOTHING
node --env-file=.env bridge.mjs             # send for real
```

- **Run once** (`POLL_SECONDS=0`) on a schedule — simplest. **Windows Task
  Scheduler** → run `node --env-file=.env bridge.mjs` every N minutes.
- Or `POLL_SECONDS=300` to loop in-process (keep alive with `pm2` / `nssm`).

Idempotent: each Doc No is sent once (tracked in `state.json`) **and** the webhook
`409`s duplicates — safe to run as often as you like, and safe to re-run.

## Sources — set `SOURCE`

| `SOURCE` | Status | Needs |
|---|---|---|
| `csv` | **works now** | an exported Sales Invoice CSV (one file `CSV_FILE`, or a folder `CSV_DIR`). Zero DB/SDK access. |
| `firebird` | stub | the `.FDB` path / DBServer host+port + a read-only user/pass. `npm i node-firebird`, then fill `fromFirebird()`. |
| `sdk` | stub | SQL Account installed on this PC + an SDK licence + a login. Fill `fromSdk()` (shell out to a PowerShell SDK script that prints invoice JSON). |

**CSV is the last-minute-proof path** — SQL Account can always export an invoice
listing, no DB/SDK access needed. The parser groups one-row-per-line exports by
Doc No and **auto-detects common column names**. If it can't find Doc No or
Customer it tells you the headers it saw — set `CSV_MAP` in `.env` to map them,
then re-run `--dry-run` until the JSON looks right.

## What it sends

Per invoice: `invoice_number, customer_name, customer_contact, order_date, po_ref,
payment_terms, items[{ sku, name, quantity, unit }]`. **No prices / tax** — money
stays in SQL Account. Full webhook contract: [`../SQL-ACCOUNT-WEBHOOK.md`](../SQL-ACCOUNT-WEBHOOK.md).

## When you get access, hand over one of:

- **CSV:** a sample export → the column mapping gets confirmed/locked.
- **Firebird:** `.FDB` path (or host/port) + read-only creds + the invoice
  table/view names.
- **SDK:** confirmation it's licensed + a login.

Plus: **which PC stays always-on** (it needs the invoices/DB + internet).
