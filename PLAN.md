# Wawasan OMS — Factory Production Refactor Plan

Spans both repos: `oms-backend` + `wawasan-oms-frontend`. Locked 2026-06.
Live on Vercel + Supabase — **never push to main without owner OK** (auto-deploys).

---

## 1. Role model

7 roles. Keep existing DB values where possible to minimise churn; relabel in UI.

| Label (UI) | DB `users.role` value | Login? | Notes |
|---|---|---|---|
| Boss | `super_admin` (relabel) | yes | Superuser / owner — does everything |
| Admin | `admin` (**NEW**) | yes | System only — users, settings, passwords, audit |
| Ops | `operations_controller` | yes | Office / planner — orders, invoices, users, delivery |
| Production Lead | `production_lead` | yes | Floor supervisor (full — see matrix) |
| Production Staff | `production_staff` | yes | Worker — production column |
| Packing Staff | `packing_staff` | yes | Worker — packing column |
| Delivery Coordinator | `delivery_team` (relabel) | yes | New dedicated account; manages no-login deliverers |
| _(deliverers)_ | — `deliverers` table | **no** | Driver names only, tracked not logging in |

### Permission matrix (FINAL)

| Capability | Boss | Admin | Ops | Prod Lead | Prod Staff | Pack Staff | Coord |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Create order / key invoice | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Edit order / PIC | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Advance stage | ✓ | ✗ | ✓ | prod+pack | prod | pack | ✗ |
| Send back (rework) | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Item status | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Flags (hold / stock) | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Reports | all | ✗ | all | prod+pack | ✗ | ✗ | delivery |
| Dashboard | ✓ | ✗ | ✓ | ✗ (privacy) | ✗ | ✗ | ✗ |
| Users + passwords | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Settings | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Audit | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Delivery schedule + confirm | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |

Lead/Staff overlap is intentional (Lead = fallback + sign-off, Staff = the daily doers).
Privacy: Lead is customer-hidden → gets Reports (aggregate) but NOT Dashboard (lists customer names).

---

## 2. Passwords — centralized

Collapse 3 paths → 1. Only Boss / Ops / Admin set passwords via User Management.
- ❌ Remove self-service Change Password (frontend modal + button + `POST /auth/change-password`).
- ❌ Remove email forgot/reset flow (`POST /auth/forgot-password`, `/auth/reset-password`) — already dead.
- ✅ Keep `PATCH /users/:id` password set, gated Boss+Ops+Admin.
- `password_reset_tokens` table left in DB, unused.

---

## 3. Items — 3-state status (replaces made_qty)

> Reverses the earlier "don't touch items" guardrail — owner approved.

- New `order_items.status` ∈ `not_started` / `in_progress` / `done` (default `not_started`).
- Backfill: `made=true`→done · `made_qty>0`→in_progress · else→not_started.
- Stop using `made_qty` (column left in DB, unused).
- Colours: grey / amber / green. Per-SKU 3-state control (items tab + advance modal).
- Kanban card + floor display: drop unit numbers → "X/Y SKUs done".

---

## 4. Delivery — coordinator model

- New `deliverers` table (name, phone, is_active) — no-login driver names.
- `deliveries.deliverer_id` → `deliverers`.
- Coordinator (`delivery_team`) schedules + confirms + manages deliverer list. Drivers don't log in; drop driver self-view filter.
- 🔴 Fix: delivery confirm writes no `activity_log` row — add it.
- Reports "by delivery person" → group by deliverer.

---

## 5. Reports #3 — per-order detail

Today reports are aggregate-only. Add:
1. Per-order progress table — invoice · customer · stage · % SKUs done · days in stage · cycle time · on-time/late · PIC. Filter + CSV.
2. Per-order stage timeline — hours in each stage (from `stage_transitions`).
3. Per-SKU status breakdown per order.
4. (optional/later) by customer / period rollups.
Plus: surface already-captured `stage_transitions` in Order Detail.
No new schema beyond the `status` column.

---

## Schema deltas
1. `users.role` CHECK — add `'admin'`.
2. `order_items.status` enum + backfill.
3. new table `deliverers`.
4. `deliveries.deliverer_id`.

Apply via `schema.sql` update + migration SQL run in Supabase SQL editor.

---

## Build order
1. **Roles + passwords** ✅ done
2. **Items 3-state status** ✅ done
3. **Delivery coordinator + deliverers + audit-log fix** ✅ done
4. **Breakdown reports** ✅ done

## Migration / rollout
- Add `admin` to role CHECK on live DB.
- Existing `delivery_team` user (Raju) → copy name into `deliverers`; new dedicated Coordinator account.
- Update `seed.js`: add Admin + Coordinator accounts, sample deliverers, relabel Boss.
