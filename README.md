# Wawasan Candle OMS — Backend API

Node.js + Express backend for the Order Management System, backed by **Supabase Postgres** and deployable to **Vercel** (serverless functions).

## Quick Start (local dev)

```bash
npm install
cp .env.example .env        # Fill in DATABASE_URL + SUPABASE_* (see Deployment)
npm run migrate             # Apply schema.sql to your Supabase Postgres
npm run seed                # Seed test users & sample orders
npm run dev                 # Start with auto-reload on http://localhost:3001
```

> The database now lives in **Supabase Postgres**, not a local SQLite file — you
> need a Supabase project (and its `DATABASE_URL`) before running `migrate`/`seed`.

## Default Login Credentials (after seed)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@wawasancandle.com | Admin@123 |
| Operations Controller | reenee@wawasancandle.com | Reenee@123 |
| Production Lead | misha@wawasancandle.com | Misha@123 |
| Production Staff | ali@wawasancandle.com | Staff@123 |
| Packing Staff | siti@wawasancandle.com | Staff@123 |
| Delivery Team | raju@wawasancandle.com | Driver@123 |

## API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login → returns JWT token |
| POST | /api/auth/logout | Logout (logs activity) |
| GET | /api/auth/me | Get current user profile |
| POST | /api/auth/change-password | Change own password |
| POST | /api/auth/forgot-password | Request password reset email |
| POST | /api/auth/reset-password | Reset with token |

### Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/orders | List orders (with filters) |
| GET | /api/orders/kanban | Board grouped by stage |
| GET | /api/orders/:id | Full order detail + timeline |
| POST | /api/orders | Create order |
| PATCH | /api/orders/:id | Edit order fields |
| POST | /api/orders/:id/move | Move to a stage |
| POST | /api/orders/:id/assign-pic | Assign PIC |
| POST | /api/orders/:id/attachments | Upload attachment |
| POST | /api/orders/webhook/sql-account | SQL Account integration webhook |

#### Query params for GET /api/orders
- `stage` — filter by stage
- `priority` — normal / urgent
- `search` — invoice number or customer name
- `week=current` — this ISO week only
- `from`, `to` — date range (YYYY-MM-DD)
- `page`, `limit` — pagination

#### Move order body
```json
{ "to_stage": "production", "reason": "optional note" }
```
Valid stages: `order`, `production`, `packing`, `ready_for_delivery`, `delivered`, `cancelled`, `on_hold`

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users | List all users |
| GET | /api/users/workload | PIC workload per user |
| POST | /api/users | Create user (admin) |
| PATCH | /api/users/:id | Update user (admin) |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/notifications | Get my notifications |
| PATCH | /api/notifications/read-all | Mark all read |
| PATCH | /api/notifications/:id/read | Mark one read |

Add `?unread_only=1` to get only unread.

### Production Remarks (Misha-specific)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/remarks | All remarks history |
| GET | /api/remarks/current | Current week remark |
| POST | /api/remarks | Create/post remark |
| PATCH | /api/remarks/:id | Edit remark |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/reports/dashboard | Boss overview cards |
| GET | /api/reports/production | Production KPIs |
| GET | /api/reports/packing | Packing KPIs |
| GET | /api/reports/delivery | Delivery KPIs |
| GET | /api/reports/audit | Full audit trail (admin) |

Add `?period=daily|weekly|monthly` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

### Delivery
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/delivery | List deliveries |
| POST | /api/delivery | Assign delivery |
| POST | /api/delivery/:id/deliver | Mark as delivered (+ signature) |

## Authentication

All endpoints (except `/api/auth/login`, `/api/health`, and the SQL Account webhook) require:
```
Authorization: Bearer <jwt_token>
```

Session expires after 8 hours.

## Role Permissions Summary

| Action | Super Admin | Ops Controller | Prod Lead | Prod Staff | Pack Staff | Delivery |
|--------|-------------|----------------|-----------|------------|------------|----------|
| Create/Edit Orders | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Move Stages | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mark Delivered | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| View Reports | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage Users | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Post Remarks | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| View Audit Log | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

## SQL Account Webhook

Configure SQL Account to POST to `/api/orders/webhook/sql-account` with header `X-Webhook-Secret: <your-secret>`.

Payload:
```json
{
  "invoice_number": "INV-2024-123",
  "customer_name": "ABC Company",
  "customer_contact": "0123456789",
  "required_delivery_date": "2024-12-31",
  "items": [
    { "sku": "CND-001", "name": "Lavender Candle 200g", "quantity": 100, "unit": "pcs" }
  ]
}
```

## Deployment (Supabase + Vercel)

### 1. Supabase
1. Create a project at https://supabase.com.
2. **Schema** — open the SQL Editor and run the contents of [`schema.sql`](./schema.sql)
   (or run `npm run migrate` locally with `DATABASE_URL` set).
3. **Connection string** — Project Settings → Database → Connection string →
   **Transaction pooler** (port `6543`). Use it as `DATABASE_URL`; the pooler is
   required for serverless so connections don't pile up.
4. **Storage** — create a bucket named `oms-uploads` (Storage → New bucket).
   Make it public if you want attachment/signature URLs to resolve directly.
5. **Service role key** — Project Settings → API → `service_role` secret →
   `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never ship to the browser).

### 2. Vercel
1. Import the **wawasan-oms-backend** GitHub repo as a Vercel project
   (Root Directory: leave as the repo root — the repo already *is* the backend).
2. Add Environment Variables (see `.env.example`): `DATABASE_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `JWT_SECRET`,
   `JWT_EXPIRES_IN`, `FRONTEND_URL` (your deployed frontend origin), and optionally
   SMTP + `SQL_ACCOUNT_WEBHOOK_SECRET`.
3. Deploy. `vercel.json` routes every request to the Express app in `api/index.js`.
4. Seed once locally (with `DATABASE_URL` pointing at Supabase): `npm run seed`.

> The legacy SQLite files under `data/` and the local `uploads/` folder are no
> longer used and are excluded from deploys via `.vercelignore`.

## Tech Stack
- **Runtime**: Node.js 18+
- **Framework**: Express 4
- **Database**: Supabase Postgres (via `pg`, connection pooler)
- **Auth**: JWT (jsonwebtoken) + bcrypt
- **File uploads**: multer (in-memory) → Supabase Storage
- **Hosting**: Vercel serverless functions (`api/index.js`)
- **Session**: Stateless JWT, 8h expiry
