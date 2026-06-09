# WhatsApp auto-messages + morning brief — setup & test

Customer status messages and a daily morning brief, sent over WhatsApp without the
paid Meta API (via `whatsapp-web.js`). Built so it is **fully testable now with no
SIM** — the default `log` provider queues and "sends" to the server log. Flip one
env var to go live.

> ⚠ **Read first.** `whatsapp-web.js` automates a real WhatsApp account and breaks
> WhatsApp's Terms of Service. Meta can **permanently ban the linked number at any
> time.** Link a **dedicated, disposable SIM the business owns — never Wawasan's
> main number.** For official high-volume messaging use the Meta Cloud API instead.

## What got wired

| Piece | Where |
|---|---|
| `message_queue` table | `schema.sql` + `migrations/005_message_queue.sql` (also self-migrates) |
| Send provider (log / real worker) | `src/lib/whatsapp.js` |
| Endpoints | `src/routes/whatsapp.js` mounted at `/api/whatsapp` |
| Daily crons (enqueue + brief) | `vercel.json` |
| Always-on sender | `wa-worker/` (separate box — NOT deployed to Vercel) |

**Customer messages** (auto, idempotent per order): `received` (entered production) →
`out_for_delivery` (delivery scheduled, with courier + tracking) → `delivered`.
**Morning brief**: due-today, overdue, and open-per-stage counts, to `WHATSAPP_ADMIN_TO`.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST | `/api/whatsapp/enqueue` | cron secret **or** Boss/Ops JWT | sweep state → queue customer messages |
| GET/POST | `/api/whatsapp/morning-brief` | cron secret **or** JWT | compute + queue the brief |
| GET/POST | `/api/whatsapp/drip?force=1&max=20` | cron secret **or** JWT | send queued messages via the provider |
| GET | `/api/whatsapp/queue` | Boss/Ops JWT | view recent queue + status counts |
| POST | `/api/whatsapp/test` | Boss/Ops JWT | queue one ad-hoc message `{to,text}` |
| GET | `/api/whatsapp/worker/next` | `WHATSAPP_WORKER_SECRET` | worker claims one message |
| POST | `/api/whatsapp/worker/result` | `WHATSAPP_WORKER_SECRET` | worker reports outcome |

## Test it now (log mode — no SIM, no worker)

With a Boss token (`TOKEN`) against `https://wawasan-oms-backend.vercel.app`:

```bash
# 1) queue customer messages from the current orders/deliveries
curl -X POST "$BASE/api/whatsapp/enqueue"      -H "Authorization: Bearer $TOKEN"
# 2) queue today's morning brief
curl -X POST "$BASE/api/whatsapp/morning-brief" -H "Authorization: Bearer $TOKEN"
# 3) "send" them (force bypasses the daytime window for testing)
curl -X POST "$BASE/api/whatsapp/drip?force=1&max=50" -H "Authorization: Bearer $TOKEN"
# 4) see the result (status should be 'sent', provider 'log')
curl     "$BASE/api/whatsapp/queue"            -H "Authorization: Bearer $TOKEN"
```

In log mode nothing leaves the server — the message text is written to the Vercel
runtime logs and the row is marked `sent`. This proves the whole pipeline.

## Go live (real WhatsApp)

1. **Backend env** (Vercel → project → Settings → Environment Variables):
   - `CRON_SECRET` — any long random string (lets the daily crons authorize).
   - `WHATSAPP_WORKER_SECRET` — long random string (shared with the worker).
   - `WHATSAPP_ADMIN_TO` — phone for the morning brief, e.g. `60123456789`.
   - `WHATSAPP_WORKER_URL` — **leave blank until the worker is up**, then set it to
     the worker's public URL. Setting it switches the provider from `log` → real.
2. **Stand up `wa-worker/`** on any always-on box (a free VM is fine):
   - install Node ≥ 20 + system Chromium; `npm install` in `wa-worker/`.
   - `cp .env.example .env`, set `WA_WORKER_SECRET` (= backend's), `CHROME_PATH`,
     `APP_URL=https://wawasan-oms-backend.vercel.app`.
   - run under pm2: `pm2 start server.mjs --name wa-worker` (auto-restart + boot).
   - **scan `qr.png`** with the dedicated SIM (WhatsApp → Linked Devices). After a
     boot it can take 2–3 min to reach `ready` — normal.
   - expose it with a Tailscale Funnel for a stable HTTPS URL → put that in
     `WHATSAPP_WORKER_URL` on the backend and redeploy.
3. The worker's drip loop polls `/api/whatsapp/worker/next` every 8–15 min and
   sends slowly (daytime window + daily cap enforced by the backend). Customer
   messages get queued by the daily `enqueue` cron.

## Ban recovery (have this ready)

If the number gets banned: get a new dedicated SIM, delete `wa-worker/.wwebjs_auth`,
restart the worker, scan the fresh `qr.png` with the new SIM. Queue + app are
unaffected — only the link changes.

## Notes / gotchas

- Vercel cron needs `CRON_SECRET` set or the scheduled calls are silently
  unauthorized. Cron granularity on Hobby is daily.
- `whatsapp-web.js` ships `puppeteer-core` with **no** browser — you must install
  system Chromium and point `CHROME_PATH` at it.
- Don't hit `/api/whatsapp/worker/next` by hand while the worker runs — it *claims*
  the row (`sending`) and strands it.
- Remove demo customers before a real run, or they'll get test messages.
