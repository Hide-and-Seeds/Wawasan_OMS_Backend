# Wawasan OMS — Project Handover

**System:** Wawasan LTS Order Management System (OMS) — a kanban-style order-tracking app for a candle / firestarter factory.
**Rebrand note:** originally "Wawasan Candle"; rebranded to **WAWASAN LTS**. Code/repos still carry the `wawasan-candle` / `wawasancandle` naming.
**Doc date:** 2026-07-07 · **Maintainer handing over:** Leoric Kingdom
**Live URL:** https://oms.wawasancandle.com
**Repos:** GitHub org `Hide-and-Seeds` — `Wawasan_OMS_Backend` + `Wawasan_OMS_Frontend` (transferred from `leorickingdom-source`).
**Ownership status (2026-07-07):** mid-transfer to the **Hide & Seeds** studio — GitHub + Supabase already moved to studio accounts; the Vercel projects are still on the developer's personal team (the one piece left). Full state in [§15](#15-external-accounts--resources).

> This is the single source of truth for the handover. Where it disagrees with older docs (e.g. `oms-backend/README.md`), **trust this document** — see [§14 Known gotchas](#14-known-gotchas--footguns) for the specific drifts.

---

## How to read this

- **Part A — Operations** (§1–§3): non-technical. What the system is, who uses it, how to keep it running and recover when it breaks. Read this even if you never touch the code.
- **Part B — Technical** (§4–§16): for whoever maintains or extends the code.

### Table of contents

**Part A — Operations**
1. [What the system does](#1-what-the-system-does)
2. [Who uses it (roles)](#2-who-uses-it-roles)
3. [Operations runbook — non-technical](#3-operations-runbook--non-technical)

**Part B — Technical**
4. [Architecture at a glance](#4-architecture-at-a-glance)
5. [Repositories & layout](#5-repositories--layout)
6. [Local development setup](#6-local-development-setup)
7. [Environment variables & secrets](#7-environment-variables--secrets)
8. [Database (Supabase Postgres)](#8-database-supabase-postgres)
9. [Backend — API & auth](#9-backend--api--auth)
10. [Frontend (React/Vite)](#10-frontend-reactvite)
11. [Integrations](#11-integrations)
12. [Deployment (Vercel)](#12-deployment-vercel)
13. [Developer runbook — common tasks](#13-developer-runbook--common-tasks)
14. [Known gotchas & footguns](#14-known-gotchas--footguns)
15. [External accounts & resources](#15-external-accounts--resources)
16. [Glossary & doc maintenance](#16-glossary--doc-maintenance)

---
---

# PART A — OPERATIONS

## 1. What the system does

Wawasan OMS tracks a customer order from the moment it arrives until it is delivered. Each order is a card that moves left-to-right across a board through four work stages:

```
  ORDER  →  PRODUCTION  →  PACKING  →  READY FOR DELIVERY  →  (Delivered)
```

- **Order** — order has arrived, not yet started. Office assigns who is in charge (the **PIC**) and sends it to production.
- **Production** — items are being made. Production staff tick off each item (STK) as it is made.
- **Packing** — made items are being boxed. Packing staff tick off each item as packed.
- **Ready for Delivery** — fully packed; the Delivery team schedules a driver, delivers, and captures proof.

Orders can also be put **On Hold** (e.g. waiting for stock) or **Cancelled** (orders are never hard-deleted — see [§14](#14-known-gotchas--footguns)).

**Where orders come from:**
1. **SQL Account (wholesale / B2B)** — when the office issues an `SI…` invoice in SQL Account, it flows into the board automatically (see [§11.1](#111-sql-account--oms)).
2. **Manual entry** — marketplace orders (Lazada / Shopee / TikTok, `L…` prefix) and any others are typed into the board by the office.

**Money is intentionally NOT in this system.** All financials live in SQL Account. The OMS is operational only.

**Extra surfaces:**
- **Floor Display** — a big read-only TV/kiosk view of the board for the factory floor.
- **Reports** — production / packing / delivery KPIs, exportable to Excel & PDF.

---

## 2. Who uses it (roles)

There are **6 login roles**. The name shown in the app (the "Department" label) differs from the internal role code:

| Department (shown in app) | Internal role code   | What they do |
|---------------------------|----------------------|--------------|
| **Boss**                  | `super_admin`        | Full control. Create/move/cancel orders, manage users, see everything. |
| **Admin**                 | `admin`              | Back-office deputy. Most things the Boss can do **except** move/hold/cancel/create orders. Assigns PIC & priority, manages users, sees Dashboard/Reports/Audit. |
| **Production Head**       | `production_lead`    | Runs the floor. Advances Production & Packing, assigns PIC, posts production remarks, sees Reports + Delivery. |
| **Production Department** | `production_staff`   | Ticks off items in Production only. |
| **Packing Department**    | `packing_staff`      | Ticks off items in Packing only. |
| **Delivery Department**   | `delivery_team`      | Works the Delivery workspace: schedule, deliver, capture proof. |

**Login:** everyone logs in at the live URL with their email + a **shared password** (currently `wawasan123`). See [§3](#3-operations-runbook--non-technical) and [§9.2](#92-roles--rbac).

The current list of real staff accounts lives in the app under **User Management** (Boss/Admin only). Don't rely on a hard-coded list — it changes.

---

## 3. Operations runbook — non-technical

**"Someone can't log in."**
- Check the email is spelled right and the password is the shared password (`wawasan123`).
- Boss/Admin → **User Management** → confirm the account is **Active** (deactivated accounts can't log in).
- Need a password reset? Boss/Admin edits the user in **User Management** and sets a new password. There is no "forgot password" email — it was removed.

**"An order is wrong / stuck."**
- Only **Boss** can move an order backwards, put it on hold, or cancel it. Ask the Boss.
- Cancelling is safe and reversible-ish (the order is kept, just marked Cancelled). **Never delete.**

**"A wholesale invoice didn't show up on the board."**
- The link from SQL Account is a small program running **on the office PC** (the "Factory Sync"). If invoices stop appearing:
  1. Make sure that office PC is on and SQL Account is open.
  2. Run **`SYNC-NOW.bat`** in the `WawasanOMS-FactorySync` folder on that PC to push immediately.
  3. If still nothing, this is a technical issue — see [§11.1](#111-sql-account--oms).

**"Marketplace order (Lazada/Shopee/TikTok)."**
- These are **typed in by hand** on the board. They are not automatic by design.

**"The whole site is down."**
- This is hosted on Vercel + Supabase (cloud). Check https://www.vercel-status.com and the Supabase status page.
- If only the OMS is down (not the internet), contact the technical maintainer. Diagnostics: [§12](#12-deployment-vercel) / [§13](#13-developer-runbook--common-tasks).

**Who to call / where things live:** see [§15 External accounts & resources](#15-external-accounts--resources).

---
---

# PART B — TECHNICAL

## 4. Architecture at a glance

Three deployed pieces plus one optional on-prem helper:

```
                        ┌─────────────────────────────┐
   Browser (staff) ───► │  FRONTEND  (React 19 + Vite) │  Vercel static hosting
                        │  wawasan-oms-frontend         │  oms.wawasancandle.com
                        └──────────────┬──────────────┘
                                       │  fetch  Bearer <JWT>   (VITE_API_URL → /api)
                                       ▼
                        ┌─────────────────────────────┐
                        │  BACKEND  (Node + Express)   │  Vercel serverless fn
                        │  oms-backend  api/index.js    │  region: icn1 (Seoul)
                        └──────────────┬──────────────┘
                                       │  pg (transaction pooler :6543)
                                       ▼
                        ┌─────────────────────────────┐
                        │  Supabase Postgres + Storage │  project ref: thoanddicghbjchomhra
                        │  + pg_cron scheduled jobs     │  region: Seoul
                        └─────────────────────────────┘

   On-prem helper (optional):
   • SQL Account → OMS relay   runs on the office Windows PC (reads Firebird .FDB) → POSTs webhook
```

**Key facts**
- **Code:** GitHub org **`Hide-and-Seeds`** — repos `Wawasan_OMS_Backend` + `Wawasan_OMS_Frontend` (both **public** since the 2026-07-07 move; old `leorickingdom-source` URLs still redirect). **Push to `main` = auto-deploy** via Vercel's Git integration.
- **Hosting:** both apps on **Vercel** (frontend = static, backend = serverless fn). ⚠ The Vercel projects still sit on the developer's **personal team `leorickingdom-source`** — the only piece not yet moved to the studio (blocked on a studio Pro plan). See [§15](#15-external-accounts--resources).
- **DB:** Supabase Postgres, Seoul region. Backend function is pinned to **`icn1` (Seoul)** to sit next to the DB (fixed a Pacific-crossing latency problem).
- **Auth:** stateless **JWT bearer tokens** (not cookies). Token stored in browser `localStorage` under `oms_token`.
- **No money data** anywhere in the OMS — financials stay in SQL Account.

---

## 5. Repositories & layout

Both repos are checked out locally under `C:\Users\Z\Downloads\files\` and are **each their own git repo on `main`**. **Edit the live folders directly** (`oms-backend/`, `wawasan-oms-frontend/`) — not anything under `backups/`.

### 5.1 `oms-backend/` — Node/Express API

```
oms-backend/
├── api/index.js              # Vercel serverless entry — wraps the Express app
├── src/
│   ├── index.js              # Express app: CORS, JSON, route mounting, /api/health
│   ├── middleware/auth.js    # authenticate, authorize(...roles), canMoveOrders
│   ├── routes/
│   │   ├── auth.js           # login / logout / me / refresh
│   │   ├── orders.js         # orders, items, attachments, move, PIC, webhooks  (largest)
│   │   ├── users.js          # user CRUD + workload
│   │   ├── notifications.js  # in-app bell
│   │   ├── remarks.js        # production remarks (weekly/monthly)
│   │   ├── reports.js        # dashboard + production/packing/delivery/audit/trend...
│   │   ├── delivery.js       # deliveries, deliverers, proof, DO print
│   │   └── settings.js       # system_settings + holidays
│   ├── lib/
│   │   ├── supabaseClient.js # Supabase JS client (Storage)
│   │   └── sqlAccountCsv.js  # CSV invoice parsing
│   └── utils/
│       ├── db.js             # pg Pool + query() helper
│       ├── migrate.js        # runs schema.sql
│       ├── seed.js           # seeds users + sample orders (SHARED_PASSWORD = 'wawasan123')
│       ├── reset-passwords.js
│       └── asyncHandler.js
├── schema.sql                # base Postgres schema (see §8 — live DB has drifted past this)
├── demo-seed.sql             # demo data for showcasing
├── migrations/               # 001..008 incremental migrations (see §8.3)
├── reference-skus.md         # finished-goods STK reference
├── sql-account-bridge/       # on-prem SQL Account → OMS relay (see §11.1)
├── webhook-test/             # local webhook testers + client-facing preview
├── email-to-board/           # Google Apps Script email → board
├── README.md  PLAN.md  INTEGRATION-NOTES.md  SQL-ACCOUNT-WEBHOOK.md
└── vercel.json               # rewrites all → /api
```

### 5.2 `wawasan-oms-frontend/` — React + Vite SPA

```
wawasan-oms-frontend/
├── index.html
├── src/
│   ├── main.jsx              # React root
│   ├── App.jsx               # THE WHOLE APP — ~4,900 lines, single file (see §10)
│   ├── App.css  index.css    # styling (mostly inline styles + theme object `C`)
│   └── assets/               # logo, hero
├── public/
│   ├── logo.png  favicon.png
│   ├── invoice-preview.html       # client-facing "invoice → board" demo
│   ├── invoice-import.html        # manual invoice import helper
│   └── split-order-preview.html
├── vite.config.js            # plain Vite + @vitejs/plugin-react
└── vercel.json               # SPA rewrite (all → /index.html)
```

> **Note on `App.jsx`:** the entire frontend is one ~4,900-line file. It is organized top-to-bottom: API client → theme/constants → small helpers → components → page screens → root `App`. Search by the constant names in [§10.2](#102-key-constants--feature-flags).

### 5.3 Other top-level folders (workspace root)

- `WawasanOMS-FactorySync/` + `.zip` — the deployable on-prem relay package handed to the client.
- `backups/` — JSON/SQL backups (e.g. demo purge backups). **Do not edit/deploy.**
- `*.html` (root) — UX prototypes/mockups built during design (priority, floor, delivery, rbac-matrix, etc.). Not shipped.
- `_make_*.py` — Python generators for the `.docx` guides (this env has no Word tooling; docs are hand-built OOXML — see [§16](#16-glossary--doc-maintenance)).
- Existing handover/guide docs: `Wawasan OMS - Simple Guide.docx`, `Wawasan OMS - Staff Guide.docx`, `Wawasan LTS - SQL Account Integration Handover.docx`.

---

## 6. Local development setup

**Prerequisites:** Node.js ≥ 18 (a no-admin Node 24 LTS is installed at `C:\Users\Z\nodejs\node-v24.16.0-win-x64`; tool shells don't auto-inherit PATH — call node by full path or prepend `$env:Path`).

### Backend
```bash
cd oms-backend
npm install
cp .env.example .env          # fill DATABASE_URL + SUPABASE_* + JWT_SECRET (see §7)
npm run migrate               # apply schema.sql to the Supabase DB
npm run seed                  # seed users (shared pw 'wawasan123') + sample orders
npm run dev                   # nodemon → http://localhost:3001
```
Health check: `GET http://localhost:3001/api/health` → `{ status: "ok" }`.

### Frontend
```bash
cd wawasan-oms-frontend
npm install
# .env: VITE_API_URL=http://localhost:3001/api
npm run dev                   # Vite → http://localhost:5173
npm run build                 # production build (dist/)
npm run lint
```

> Running against the **live** DB locally is possible (point `DATABASE_URL` at Supabase) but be careful — `npm run seed` / `reset-passwords` mutate real data. Prefer a separate Supabase project or branch for experiments.

---

## 7. Environment variables & secrets

**Secrets are NOT in the repos.** They live in **Vercel project env vars** (per repo) and the on-prem `.env` files. The `.env.example` files document every key.

### 7.1 Backend (`oms-backend`)

| Var | Purpose |
|-----|---------|
| `PORT`, `NODE_ENV` | Server basics (local only; Vercel ignores PORT). |
| `JWT_SECRET` | Signs login tokens. **Long random string.** Rotating it logs everyone out. |
| `JWT_EXPIRES_IN` | Fallback token lifetime (default `8h`). Overridden per-login by the `session_timeout_hours` setting. |
| `DATABASE_URL` | Supabase **Transaction pooler** string (port **6543**) — required for serverless. |
| `DATABASE_SSL` | `true` in prod. |
| `PG_POOL_MAX` | pg pool size (default 5). |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage (file uploads). **Service role = server-only, never ship to browser.** |
| `SUPABASE_STORAGE_BUCKET` | `oms-uploads`. |
| `MAX_FILE_SIZE` | Upload cap (bytes). |
| `SMTP_*`, `EMAIL_FROM` | SMTP (legacy; self-service reset flow was removed — largely unused now). |
| `FRONTEND_URL` | Comma-separated allowed CORS origins (prod frontend URL). |
| `SQL_ACCOUNT_WEBHOOK_SECRET` | Shared secret SQL Account relay must send as `x-webhook-secret`. **Blank = endpoint rejects everything (fail-closed).** |
| `SQL_ACCOUNT_DEFAULT_LEAD_DAYS` | New webhook orders' delivery date = order date + this (default 7). |

### 7.2 Frontend (`wawasan-oms-frontend`)

| Var | Purpose |
|-----|---------|
| `VITE_API_URL` | Backend base URL **including `/api`, no trailing slash**. Local `http://localhost:3001/api`; prod `https://<backend>.vercel.app/api`. |

### 7.3 Other `.env`s
- `oms-backend/sql-account-bridge/.env` and `windows-*/config.ps1` — relay target URL + webhook secret (on the office PC).

---

## 8. Database (Supabase Postgres)

**Project ref:** `thoanddicghbjchomhra` · **Region:** Seoul · Inspect/seed/verify live via the Supabase SQL editor or the Supabase MCP `execute_sql`.

### 8.1 Tables (from `schema.sql`)

| Table | Purpose / notes |
|-------|-----------------|
| `users` | Accounts. `role` CHECK ∈ the 6 roles. `is_active` gates login. `password` = bcrypt hash. |
| `sessions`, `password_reset_tokens` | Present in schema; the app is **stateless JWT**, so `sessions` is largely vestigial and the reset flow was removed. |
| `orders` | Core. `stage` ∈ order/production/packing/ready_for_delivery/delivered/cancelled/on_hold. `priority` normal/urgent. `importance` standard/priority/vip (**kept but unused** — tiers removed). `pic_id` = production PIC. `source` sql_account/manual. `skip_production`, `on_hold`, `waiting_stock`, `expiry_date`. |
| `order_items` | Per-SKU lines. Tracks **two independent tracks**: production (`status`, `made`, `made_qty`, `made_by`) and packing (`pack_status`, `pack_made`, `pack_made_by`). This dual-track is what powers the split board. |
| `order_attachments` | Files in Supabase Storage (`filename` = object path). |
| `activity_log` | Audit trail. Monthly pg_cron archives + trims (see §8.4). |
| `stage_transitions` | Stage move history (powers timing reports). |
| `production_remarks` | Weekly remarks (Production Head/Boss). Auto-archived (see §8.4). |
| `notifications` | In-app bell. `type` deliberately **not** CHECK-constrained (open category). `loud` = toast vs quiet. |
| `deliverers` | In-house driver roster. |
| `deliveries` | Delivery schedule/proof. `signature_file` = Storage path. `status` pending/in_transit/delivered/failed. |
| `system_settings` | Key/value app config (e.g. `session_timeout_hours`, `order_intake_enabled`, shared-password reveal). |
| `holidays` | Working-calendar holidays (bulk-importable via CSV/Excel). |

### 8.2 Schema drift ⚠ (important for handover)

`schema.sql` is the **original** schema. The **live DB has drifted past it** via migrations + direct edits. Notably, columns that exist live but are **not** in `schema.sql` include the **per-track packing PIC (`packing_pic_id`)** and split-order fields (e.g. `held_in_order`). **Always confirm the live shape** with `list_tables` / `\d orders` against Supabase before writing migrations — don't trust `schema.sql` alone.

### 8.3 Migrations (`oms-backend/migrations/`)
`001_add_admin_role` · `002_item_status` · `003_deliverers` · `004_delivery_tracking` · `005_message_queue` · `006_purge_activity_log` · `007_purge_notifications` · `008_drop_message_queue`. Applied in the Supabase SQL editor. Later schema changes (per-track PIC, split fields) were applied directly and may not all have a numbered file — reconcile against live.
> `005` created `message_queue` for the old WhatsApp feature; `008` drops it again after WhatsApp was removed. Run `008` in the Supabase SQL editor if it hasn't been applied.

### 8.4 Scheduled jobs (Supabase `pg_cron`)
- **`purge-activity-log`** — monthly; **archives** `activity_log` rows > 1 month into an archive table, then trims (migration 006). Owner wanted a saved copy for audit.
- **`purge-notifications`** — monthly; **hard-deletes** notifications > 30 days (migration 007).
- **Remarks archive** — weekly (Mon 00:30, past weeks → archive) + quarterly (monthly summaries > 3 months). Reads UNION of live + archive so history still displays.

> ⚠ **Regression gap:** any code path that lazily creates monthly/archive tables (`ensureMonthly`/`ensureArchives`) creates them **without RLS enabled**. New tables should have `alter table … enable row level security;` added. See RLS note below.

### 8.5 Row-Level Security (RLS)
As of the last audit: **all public tables RLS-enabled (0 ERROR-level advisories).** The backend connects as the Supabase pooler `postgres` role which is **BYPASSRLS**, so RLS doesn't block the API — it's defense-in-depth against direct DB access. The remaining `rls_enabled_no_policy` advisories are **INFO-level and intended** — do not "fix" them by adding permissive policies. There are stale `*_bak_20260616` backup tables left in place by the owner's request — leave them.

### 8.6 Backups & demo data
- `demo-seed.sql` rebuilds demo data from real SKU master + sample invoices.
- All demo/test data was **purged from live** on 2026-06-15; full backups saved under `backups/oms-demo-backup-20260615.json` for future showcasing.

---

## 9. Backend — API & auth

### 9.1 Auth model
- **Login** (`POST /api/auth/login`): email + password → bcrypt compare → signs a JWT `{ userId, role }`. Token lifetime = `system_settings.session_timeout_hours` (fallback `JWT_EXPIRES_IN` or 8h). Login is logged to `activity_log`.
- **Every other endpoint** (except `/api/health` and the two `/webhook/*` routes) requires header `Authorization: Bearer <token>`. `authenticate` verifies the token and reloads the user (so a deactivated account is rejected immediately).
- **`/api/auth/refresh`** with body `{ kiosk: true }` issues a **30-day** token — used only by the Floor Display TV so it never logs out.
- **No self-service password change and no forgot-password email** — both removed. Boss/Admin set passwords via `PATCH /api/users/:id`. (The README still lists the old endpoints — it is stale.)

`src/middleware/auth.js` exports three guards:
- `authenticate` — requires a valid token.
- `authorize(...roles)` — 403 unless `req.user.role` is in the list.
- `canMoveOrders` — **super_admin only** ("Only the Boss can move orders"); used to gate add/remove item + delete attachment.

### 9.2 Roles & RBAC
The 6 DB roles and their app labels are in [§2](#2-who-uses-it-roles). Exact per-endpoint membership lives in the `const *_ROLES` arrays at the top of each route file (`ADMIN_ROLES`, `DASHBOARD_ROLES`, `PROD_REPORT_ROLES`, `DELIVERY_REPORT_ROLES`, `USER_VIEWERS`, `USER_MANAGERS`, `READ_ROLES`, `WRITE_ROLES`). The frontend mirrors these gates so staff don't see buttons that would only 403 (see `canAdvanceStage` / `canMarkStage` / `visibleStages` / `NAV` in `App.jsx`).

**Shared password:** `seed.js` and `reset-passwords.js` set **one shared password `wawasan123`** for all accounts ("for now", per the owner). A per-role restore map exists if individual passwords are wanted again. **Recommend rotating + moving off a shared password at handover.**

### 9.3 API reference (current — supersedes README)

Base path `/api`. Access column: **auth** = any logged-in user; named roles = `authorize(...)`; **Boss** = super_admin only; **secret** = webhook secret header.

**Auth** (`routes/auth.js`)
| Method | Path | Access |
|---|---|---|
| POST | `/auth/login` | public |
| POST | `/auth/logout` | auth |
| GET | `/auth/me` | auth |
| POST | `/auth/refresh` | auth (`{kiosk:true}`→30d) |

**Orders** (`routes/orders.js`)
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/orders` | auth | filters: `stage, priority, search, week=current, from, to, page, limit` |
| GET | `/orders/kanban` | auth | board grouped by stage; returns `items[]` for split board |
| GET | `/orders/stats` | auth | |
| GET | `/orders/skus` | auth | STK autofill source |
| GET | `/orders/check-invoice` | Boss | |
| GET | `/orders/:id` | auth | full detail + timeline |
| POST | `/orders` | auth | create (internal role logic) |
| POST | `/orders/import` | Boss | CSV import |
| PATCH | `/orders/:id` | auth | edit fields |
| POST | `/orders/:id/move` | auth | `{ to_stage, reason? }` (internal gating) |
| POST | `/orders/:id/assign-pic` | auth | production + packing PIC |
| POST | `/orders/reorder` | super_admin, admin, production_lead | board drag order |
| PATCH | `/orders/:id/flags` | super_admin, production_lead, admin | hold / urgent / waiting-stock |
| PATCH | `/orders/:id/items/:itemId` | auth | mark made/packed (`track` param) |
| POST | `/orders/:id/items` | Boss | add line |
| DELETE | `/orders/:id/items/:itemId` | Boss | remove line |
| POST | `/orders/:id/attachments` | auth | upload |
| DELETE | `/orders/:id/attachments/:attId` | Boss | |
| POST | `/orders/webhook/sql-account` | secret | JSON invoice → order |
| POST | `/orders/webhook/sql-account-csv` | secret | CSV invoice → order |

**Users** (`routes/users.js`): `GET /users`, `GET /users/workload` (USER_VIEWERS); `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` (USER_MANAGERS).
**Notifications** (`routes/notifications.js`): `GET /notifications` (`?unread_only=1`), `PATCH /notifications/read-all`, `PATCH /notifications/:id/read` (auth).
**Remarks** (`routes/remarks.js`): `GET /remarks`, `GET /remarks/current`, `GET /remarks/monthly` (READ_ROLES); `POST /remarks`, `PATCH /remarks/:id` (WRITE_ROLES); `POST /remarks/monthly` (Boss).
**Reports** (`routes/reports.js`): `dashboard` (DASHBOARD_ROLES); `production`, `packing`, `staff`, `staff/:id`, `pic`, `efficiency` (PROD_REPORT_ROLES); `delivery`, `delivery/carrier` (DELIVERY_REPORT_ROLES); `orders`, `mistakes`, `trend` (ADMIN_ROLES); `audit` (super_admin, admin); `scorecard` (auth). Add `?period=` or `?from=&to=`.
**Delivery** (`routes/delivery.js`): `GET /delivery`, `POST /delivery`, `POST /delivery/:id/deliver` (+signature upload), `POST /delivery/quick-deliver`, `POST /delivery/:id/reopen`, `PATCH /delivery/:id`, deliverer CRUD (`/delivery/deliverers…`), `POST /delivery/mark-do-printed` (auth).
**Settings** (`routes/settings.js`): `GET /settings`, `GET /settings/holidays` (auth); `PUT /settings`, holiday create/delete/bulk (super_admin, admin).
**Health:** `GET /api/health` (public).

### 9.4 Order lifecycle specifics
- **Split board** (live, `SPLIT_BOARD_ENABLED=true`): an order shows in every stage column where it still has work — a line can be in Packing while a sibling line is still in Production, so tracks run in parallel instead of the whole order waiting at its slowest line. A line's column is **derived** from its two completion flags (`made`/`status` and `pack_made`/`pack_status`).
- **Per-track PIC:** Production PIC = `pic_id`, Packing PIC = `packing_pic_id`; persists across moves.
- **SQL Account webhook** lands the order in the **Order** column (`source=sql_account`), writes the initial stage transition + audit row, and notifies Ops to assign a PIC. Re-sending the same `invoice_number` → **409** (idempotent).

---

## 10. Frontend (React/Vite)

### 10.1 Stack & shape
React 19 + Vite 8. Charts via `recharts`; exports via `xlsx` (Excel) and `jspdf` + `jspdf-autotable` (PDF). **Everything is in `src/App.jsx` (~4,900 lines)** — one file, organized top-to-bottom. Styling is mostly inline styles driven by a theme object `C` (dark "candle" palette) plus `App.css`/`index.css`.

API client (top of `App.jsx`): `api(method, path, body, isFormData)` reads `VITE_API_URL`, attaches `Bearer` from `localStorage.oms_token`, throws on non-2xx with the server's `error` string.

### 10.2 Key constants & feature flags
At the top of `App.jsx`:
- `STAGES` / `BOARD_STAGES` — the 4 board columns. `FORWARD_STAGE`, `ADVANCE_LABEL` — stage progression + button text.
- `ROLE_LABELS` — role code → app label (the Department names).
- `NAV` — the page list + which roles see each (board, dashboard, delivery, floor, reports, remarks, audit, users, settings).
- `canAdvanceStage` / `canMarkStage` / `visibleStages` / `canMarkTrack` — client-side mirrors of the backend RBAC.
- `itemPlace` / `lineCol` / `splitByCol` — split-board column derivation.

**Feature flags (flip, don't rebuild):**
| Flag | Value | Gates |
|---|---|---|
| `SPLIT_BOARD_ENABLED` | **true (live)** | Per-line parallel board. When false the board is byte-identical to the old whole-order board. |
| `REWARD_SYSTEM_ENABLED` | false (parked) | Reports "Scoreboard" tab, Floor scoreboard toggle, settings weight editor. Components + backend `/reports/scorecard` stay in place. |
| `STAFF_RANKING_ENABLED` | false (parked) | Reports Staff / PIC ranking tabs. Components + backend `/reports/staff`, `/reports/pic` stay in place. |

> **Customer importance tiers were removed** (2026-06-11). The board sorts by delivery date + manual drag/`▲▼` reorder. The `importance` column is kept (defaults `standard`) but unused — **don't rebuild tiers.**

### 10.3 Static pages (`public/`)
`invoice-preview.html` (client-facing "invoice → board" demo; live at `<frontend>.vercel.app/invoice-preview.html`), `invoice-import.html`, `split-order-preview.html`. Served as static assets; not part of the React app.

---

## 11. Integrations

### 11.1 SQL Account → OMS

**Goal:** wholesale/B2B `SI…` invoices created in SQL Account appear on the board automatically. Marketplace `L…` invoices are **excluded** (they're entered manually and also exist in SQL Account — importing them would duplicate manual orders).

**Webhook contract** (`POST /api/orders/webhook/sql-account`, header `x-webhook-secret`): only `invoice_number` + `customer_name` required; items carry `sku/name/quantity/unit`; no money. Full contract, response codes, and a test command are in **`oms-backend/SQL-ACCOUNT-WEBHOOK.md`**; developer parity notes in **`oms-backend/INTEGRATION-NOTES.md`**.

**On-prem relay** (SQL Account is embedded Firebird on the office PC — no TCP server). Three variants under `oms-backend/sql-account-bridge/`:
- **`windows-firebird-auto/`** — the shipped solution. Polls the live `.FDB` mtime, runs FB5 `isql` → CSV → POSTs the webhook. Auto-detects the newest-mtime DB (client live DB = `ACC-0009.FDB`), excludes `L%`. Includes `Install.ps1`, `RUN-ME.bat`, **`SYNC-NOW.bat`** (force a sync), `TURN-OFF.bat`. Packaged for the client as `WawasanOMS-FactorySync.zip` (workspace root).
- **`windows-no-node/`** — no-Node PowerShell CSV relay (interim).
- **`bridge.mjs`** — Firebird-direct poll route (`fromFirebird`, stubbed) — the eventual "instant, no export" path; needs Node + `node-firebird` + the live `.FDB` table names on-prem.

**Schema reference** (reverse-engineered): sales invoices = `SL_IV` + `SL_IVDTL` joined on `DOCKEY` (NOT `IV`/`IVDTL`; `AR_IV` is financial). `SL_IV` has `COMPANYNAME`, `DADDRESS1-4`, `CANCELLED`, `LASTMODIFIED`.

**Kill switch:** Boss can pause order intake via `system_settings.order_intake_enabled`.

> PowerShell relay gotchas that bit this before: `Get-Content -Raw` strings carry note-properties → `ConvertTo-Json` emits an object not a bare string (cast `[string]`); `.ps1` ship scripts must be ASCII (PS 5.1 misreads no-BOM UTF-8). See [§14](#14-known-gotchas--footguns).

### 11.2 Email → board (optional)
`oms-backend/email-to-board/email-to-board.gs` — a Google Apps Script that turns inbound emails into board orders. See `EMAIL-TO-BOARD-SETUP.md`.

> **Removed:** the OMS previously had a WhatsApp auto-message feature (customer notifications + a daily "morning brief") built on `whatsapp-web.js` + an outbound `message_queue` + a GCP worker. It was **removed entirely** (2026-07). If customer messaging is ever wanted again, prefer the official WhatsApp Cloud API rather than reviving the unofficial worker.

---

## 12. Deployment (Vercel)

**Both repos auto-deploy on push to `main`** (GitHub org `Hide-and-Seeds` — `Wawasan_OMS_Backend` / `Wawasan_OMS_Frontend`). Confirm before pushing — push *is* the ship action. ⚠ The **Vercel projects are still on the developer's personal team `leorickingdom-source`** (transfer pending); the Git integration already points at the studio-org repos, so pushes deploy normally.

- **Frontend:** Vite framework preset; SPA rewrite all→`/index.html`. Set `VITE_API_URL` to the backend `/api` URL.
- **Backend:** `vercel.json` rewrites all→`/api` (the Express app in `api/index.js`). Function **pinned to region `icn1` (Seoul)** to colocate with the DB (set in the Vercel dashboard, not the repo).
- **CORS** (`src/index.js`): allows the explicit `FRONTEND_URL` list, any `*.vercel.app` host (prod + every preview deploy), `localhost`, and `*.wawasancandle.com`. CORS isn't the auth boundary (JWT bearer is), so allowing Vercel hosts is safe and avoids chasing preview URLs.
- **Custom domain:** `oms.wawasancandle.com` — Hostinger **CNAME → Vercel**.

**Verify a deploy:** check `state: READY` via `list_deployments` (trust this over the branch-alias `get_deployment`, which lags). Diagnose prod 500s with `get_runtime_logs`.

> ⚠ **Two Vercel footguns:**
> 1. The deploy webhook can **silently miss a push** → tell the owner to click **Redeploy** in the dashboard (an empty commit does *not* reliably retrigger).
> 2. The `deploy_to_vercel` MCP tool, run from this workspace, publishes the **Hide & Seeds** site (`hns-preview`), **NOT** the OMS. To ship OMS, push to the repo.

---

## 13. Developer runbook — common tasks

**Ship a code change**
1. Edit the live folder (`oms-backend/` or `wawasan-oms-frontend/`).
2. Build/verify locally (`npm run build` for FE; hit `/api/health` + the changed route for BE).
3. **Ask the owner before pushing.** Stage only your own paths (`git add <paths>` — never `git add -A`; parallel sessions may be editing the same repos). Commit (ASCII / `-F file` to avoid PS quoting breakage). Push to `main` → auto-deploy.
4. After push, reply with one terse line (commit range → main, deploying). Then verify `READY` via `list_deployments`.

**Add / edit a user, reset a password**
- UI: **User Management** (Boss/Admin). Or API `POST/PATCH /api/users/:id`.
- Bulk reset to the shared password: `npm run reset-passwords` (backend, with `DATABASE_URL` set).

**Seed / reset for a showcase**
- `npm run seed` (users + sample orders) or run `demo-seed.sql` in Supabase. Demo purge backups are in `backups/`.

**Remove test orders** (Rock leaves `test*` junk)
- **Back up first** (export the rows to JSON), then FK-safe delete (loop over the order_id-referencing tables) via Supabase MCP. `orders` uses `stage`, not `status`.

**Diagnose a prod 500**
- `get_runtime_logs` (Vercel) for the backend function; check `get_advisors` / `get_logs` (Supabase) for DB issues.

**Rotate secrets**
- Update in the Vercel dashboard (backend project) + the on-prem `.env`. Rotating `JWT_SECRET` logs everyone out.

**Avoid:** hard deletes (owner finds them dangerous — prefer Cancel/deactivate); rebuilding removed features (importance tiers, board VIP/priority tiers, 3rd-party courier hand-off, WhatsApp auto-messages — all deliberately removed).

---

## 14. Known gotchas & footguns

- **Stale `oms-backend/README.md`** — lists removed endpoints (`change-password`, `forgot-password`, `reset-password`), an old "Ops Controller" role, `Admin@123`-style seed creds, and a fixed "8h" session. **This handover is current; the README is not.**
- **Schema drift** — `schema.sql` ≠ live DB (missing `packing_pic_id`, split fields). Confirm live before migrating (§8.2).
- **RLS regression gap** — lazily-created monthly/archive tables (`ensureMonthly`/`ensureArchives`) come up **without RLS** (§8.4). Add `enable row level security` to new tables.
- **`rls_enabled_no_policy` is intended** — don't add permissive policies to "fix" the INFO advisories (§8.5).
- **Vercel deploy webhook can miss a push** → click Redeploy, not an empty commit (§12).
- **`deploy_to_vercel` tool ≠ OMS** — it ships Hide & Seeds; push to the repo to ship OMS (§12).
- **PowerShell commit quoting** — here-strings with embedded `"` break (pathspec error, commit lost). Use plain text or `git commit -F file`.
- **PowerShell `Get-Content -Raw` → JSON object trap** — note-props make `ConvertTo-Json` emit `{value,PSPath…}` not a bare string; cast `[string]` / use `[IO.File]::ReadAllText`. Broke the CSV relay once.
- **`.ps1` ship scripts must be ASCII** — PS 5.1 misreads no-BOM UTF-8 as ANSI; smart quotes/em-dashes throw a fake "Missing closing '}'" on an unrelated line.
- **Vite CJS default-export trap** — prod bundle may hand a CJS lib's default as `{default: fn}`; unwrap before calling (broke `jspdf-autotable` PDFs).
- **Relay must exclude `L%`** — marketplace invoices are manual; importing them duplicates orders + explains "missing addresses".
- **Parallel sessions** — another agent/session may have these repos open; stage only your own paths, serialize edits to a shared file.

---

## 15. External accounts & resources

| What | Where | Notes |
|---|---|---|
| **GitHub** ✅ moved | org **`Hide-and-Seeds`** — `Wawasan_OMS_Backend`, `Wawasan_OMS_Frontend` (public) | Moved + renamed 2026-07-07. Push to `main` auto-deploys. Old `leorickingdom-source` URLs still redirect. |
| **Vercel** ⏳ pending | 2 projects still on personal team `leorickingdom-source` (`team_6tkLqHfcYqXNydc83vifWgqg`) | Backend region `icn1`. **Env vars live here** (the secrets home). Custom domain attached to the frontend. The one piece not yet transferred — blocked on a studio Pro plan. |
| **Supabase** ✅ moved | project ref `thoanddicghbjchomhra` (Seoul), now under the studio org | Ref unchanged by the move → **no env rewiring**. Postgres + Storage (`oms-uploads`) + pg_cron. SQL editor for schema/seed. |
| **Domain / DNS** | Hostinger | `oms.wawasancandle.com` CNAME → Vercel. CORS also allows `*.wawasancandle.com`. |
| **SQL Account** | client office Windows PC | Embedded Firebird; live DB `ACC-0009.FDB`. Runs the `WawasanOMS-FactorySync` relay. |
| **Existing docs** | `oms-backend/*.md` + root `.docx` | README, PLAN, INTEGRATION-NOTES, SQL-ACCOUNT-WEBHOOK; Simple Guide / Staff Guide / SQL Account Integration Handover. |

---

## 16. Glossary & doc maintenance

**Glossary**
- **OMS** — Order Management System (this app).
- **STK** — stock code (the UI label for a SKU; the DB field is still `sku`).
- **PIC** — Person In Charge. Split into Production PIC (`pic_id`) and Packing PIC (`packing_pic_id`).
- **Stage** — board column: order → production → packing → ready_for_delivery → delivered (+ on_hold, cancelled).
- **Split board** — showing one order in multiple columns by line, so tracks run in parallel.
- **Send to production** — advancing an order out of the Order column (office sets expiry; PIC nudge follows).
- **Floor Display** — read-only kiosk/TV board for the factory floor (30-day kiosk token).

**Regenerating the Word copies**
This environment has no Word/pandoc/`python-docx`. The `.docx` files are hand-built as OOXML via Python `zipfile`. To regenerate the Word versions of the handover + transfer docs:
```bash
python _make_handover.py        # → "Wawasan OMS - Technical Handover.docx" + "Wawasan OMS - Account Transfer Runbook.docx"
```
Keep `HANDOVER.md` / `TRANSFER.md` as the source of truth; regenerate the `.docx` from them when they change.

---

*End of handover. Questions during transition → the outgoing maintainer (leoric.kingdom@gmail.com).*
