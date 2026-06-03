# Wawasan Candle OMS — Backend API

Node.js + Express + SQLite backend for the Order Management System.

## Quick Start

```bash
npm install
cp .env.example .env        # Edit with your settings
node src/utils/migrate.js   # Create database schema
node src/utils/seed.js      # Seed test users & sample orders
npm run dev                 # Start with auto-reload
```

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

## Tech Stack
- **Runtime**: Node.js 18+
- **Framework**: Express 4
- **Database**: SQLite via better-sqlite3 (easy to migrate to PostgreSQL)
- **Auth**: JWT (jsonwebtoken) + bcrypt
- **File uploads**: multer
- **Session**: Stateless JWT, 8h expiry
