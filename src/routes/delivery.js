// src/routes/delivery.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { query, withTransaction } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { uploadBuffer, publicUrl } = require('../lib/supabaseClient');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
});

// Self-migration: per-delivery address (additive, idempotent).
let _delSchemaReady = false;
async function ensureDeliverySchema() {
  if (_delSchemaReady) return;
  await query('ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS address text');
  await query(`CREATE TABLE IF NOT EXISTS deliverers (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    phone      text,
    is_active  boolean not null default true,
    created_at timestamptz not null default now()
  )`);
  await query('ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS deliverer_id uuid REFERENCES deliverers(id)');
  // When a Delivery Order was last printed — lets a mass print skip already-printed notes.
  await query('ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS do_printed_at timestamptz');
  // Proof-of-delivery photos live on the order as attachments tagged kind='pod';
  // ensure the tag column exists so the has_pod flag below can read it.
  await query("ALTER TABLE order_attachments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'file'");
  _delSchemaReady = true;
}

// Ping the PIC + Boss/Ops/Admin when a delivery completes or is reopened, so a
// completion/undo isn't silent. (Notification insert is inlined here — delivery.js
// has no access to the notify helper in orders.js.)
async function notifyDelivered(q, orderId, actorId, actorName, kind, noProof = false) {
  const ord = (await q('SELECT invoice_number, pic_id FROM orders WHERE id = $1', [orderId])).rows[0];
  if (!ord) return;
  const recips = (await q("SELECT id FROM users WHERE role IN ('super_admin','admin') AND is_active = true")).rows.map((r) => r.id);
  if (ord.pic_id) recips.push(ord.pic_id);
  const reopened = kind === 'reopened';
  // A delivery with no proof attached is pushed to Boss/Ops/Admin with a ⚠ so it's
  // caught even if nobody is watching the "no proof" column — no admin chase needed.
  const title = reopened ? `Order ${ord.invoice_number} reopened — back to Ready`
    : noProof ? `Order ${ord.invoice_number} delivered — ⚠ NO PROOF`
    : `Order ${ord.invoice_number} delivered`;
  const type = reopened ? 'order_reopened' : 'order_delivered';
  const message = (!reopened && noProof) ? `By ${actorName} · no proof of delivery attached — please verify` : `By ${actorName}`;
  // A normal delivered update is quiet (informational); a no-proof delivery and a reopen are loud.
  const loud = reopened ? true : noProof;
  for (const uid of [...new Set(recips)]) {
    if (uid === actorId) continue;
    await q(`INSERT INTO notifications (id, user_id, type, title, message, order_id, loud) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv4(), uid, type, title, message, orderId, loud]);
  }
}

// Production-floor roles must not see the customer — mirror the scrub in orders.js.
const CUSTOMER_HIDDEN_ROLES = ['production_lead', 'production_staff', 'packing_staff'];

// GET /api/delivery — list deliveries
router.get('/', authenticate, asyncHandler(async (req, res) => {
  await ensureDeliverySchema();
  const { status, delivery_man_id, date, order_id } = req.query;
  const where = ['1=1'];
  const params = [];

  if (status) { where.push(`d.status = $${params.push(status)}`); }
  if (delivery_man_id) { where.push(`d.delivery_man_id = $${params.push(delivery_man_id)}`); }
  if (date) { where.push(`d.scheduled_date = $${params.push(date)}`); }
  if (order_id) { where.push(`d.order_id = $${params.push(order_id)}`); }

  const deliveries = (await query(`
    SELECT d.*, o.invoice_number, o.customer_name, o.required_delivery_date,
      COALESCE(dl.name, u.name) AS delivery_man_name, dl.name AS deliverer_name,
      EXISTS(SELECT 1 FROM order_attachments a WHERE a.order_id = d.order_id AND a.kind = 'pod') AS has_pod,
      (SELECT a.filename FROM order_attachments a WHERE a.order_id = d.order_id AND a.kind = 'pod' ORDER BY a.uploaded_at DESC LIMIT 1) AS pod_file
    FROM deliveries d
    JOIN orders o ON d.order_id = o.id
    LEFT JOIN deliverers dl ON d.deliverer_id = dl.id
    LEFT JOIN users u ON d.delivery_man_id = u.id
    WHERE ${where.join(' AND ')}
    ORDER BY d.scheduled_date ASC, o.required_delivery_date ASC
  `, params)).rows;

  // Attach a viewable URL for the proof photo so it can be previewed straight from
  // the delivery list — no need to open the order detail. pod_file stays internal.
  const out = deliveries.map((d) => {
    const { pod_file, ...rest } = d;
    return { ...rest, pod_url: pod_file ? publicUrl(pod_file) : null };
  });
  const hideCustomer = CUSTOMER_HIDDEN_ROLES.includes(req.user.role);
  res.json(hideCustomer ? out.map((d) => ({ ...d, customer_name: null, address: null })) : out);
}));

// POST /api/delivery — assign delivery
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['super_admin', 'delivery_team', 'admin'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();

  const { order_id, deliverer_id, scheduled_date, address, notes } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const order = (await query("SELECT id, delivery_address FROM orders WHERE id = $1 AND stage = 'ready_for_delivery'", [order_id])).rows[0];
  if (!order) return res.status(400).json({ error: 'Order not found or not ready for delivery' });

  // A deliverer (if chosen) must be a real, active one. Deliverers don't log in.
  if (deliverer_id) {
    const dl = (await query('SELECT id, is_active FROM deliverers WHERE id = $1', [deliverer_id])).rows[0];
    if (!dl || !dl.is_active) return res.status(400).json({ error: 'Deliverer must be active' });
  }

  const id = uuidv4();
  await withTransaction(async (q) => {
    await q(`
      INSERT INTO deliveries (id, order_id, deliverer_id, scheduled_date, address, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, order_id, deliverer_id || null, scheduled_date || null, address || order.delivery_address || null, notes || null]);

    await q(`INSERT INTO activity_log (id, order_id, user_id, action, details)
             VALUES ($1, $2, $3, 'delivery_scheduled', $4)`,
      [uuidv4(), order_id, req.user.id, `Delivery scheduled${scheduled_date ? ' for ' + scheduled_date : ''}`]);

    // Dispatch usually books this — tell the PIC + managers the order now has a slot.
    const ord = (await q('SELECT invoice_number, pic_id FROM orders WHERE id = $1', [order_id])).rows[0];
    if (ord) {
      const recips = new Set((await q("SELECT id FROM users WHERE role IN ('super_admin','admin') AND is_active = true")).rows.map((r) => r.id));
      if (ord.pic_id) recips.add(ord.pic_id);
      const title = `Order ${ord.invoice_number} scheduled for delivery${scheduled_date ? ' · ' + scheduled_date : ''}`;
      for (const uid of recips) {
        if (uid === req.user.id) continue;
        await q(`INSERT INTO notifications (id, user_id, type, title, message, order_id, loud) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uuidv4(), uid, 'order_stage_entered', title, `By ${req.user.name}`, order_id, false]);
      }
    }
  });

  res.status(201).json({ id });
}));

// POST /api/delivery/:id/deliver — mark delivered
router.post('/:id/deliver', authenticate, upload.single('signature'), asyncHandler(async (req, res) => {
  const delivery = (await query('SELECT * FROM deliveries WHERE id = $1', [req.params.id])).rows[0];
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  // Guard against double-completion (would write a duplicate delivered transition).
  if (delivery.status === 'delivered') return res.status(409).json({ error: 'This delivery is already completed' });

  // Boss, Ops, or the Delivery Coordinator may mark a delivery complete.
  const allowed = ['super_admin', 'delivery_team', 'admin'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  // Proof gate: a completed delivery needs a POD photo on the order, unless the
  // caller explicitly delivers without one (no_proof) — then Boss/Ops are notified.
  await ensureDeliverySchema();
  const hasPod = !!(await query("SELECT 1 FROM order_attachments WHERE order_id = $1 AND kind = 'pod' LIMIT 1", [delivery.order_id])).rows[0];
  if (!hasPod && !req.body.no_proof) return res.status(428).json({ error: 'no_proof' });

  let signatureFile = null;
  if (req.file) {
    try { const { path: storedPath } = await uploadBuffer(req.file, 'signatures/'); signatureFile = storedPath; }
    catch (e) { return res.status(502).json({ error: `Signature upload failed: ${e.message}` }); }
  }

  const result = await withTransaction(async (q) => {
    // Lock the row and re-check inside the tx: the pre-check above is racy, so two
    // concurrent completions (double-tap / lost-response retry) must not both write
    // a 'delivered' transition. The second waits on the lock, then sees 'delivered'.
    const locked = (await q("SELECT status FROM deliveries WHERE id = $1 FOR UPDATE", [delivery.id])).rows[0];
    if (!locked || locked.status === 'delivered') return { already: true };

    await q(`
      UPDATE deliveries SET status = 'delivered', delivered_at = now(),
        signature_file = $1, updated_at = now() WHERE id = $2
    `, [signatureFile, delivery.id]);

    // Move order to delivered
    await q("UPDATE orders SET stage = 'delivered', updated_at = now() WHERE id = $1", [delivery.order_id]);

    await q('INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), delivery.order_id, 'ready_for_delivery', 'delivered', req.user.id]);

    // Audit log (was previously missing on delivery completion).
    await q(`INSERT INTO activity_log (id, order_id, user_id, action, details)
             VALUES ($1, $2, $3, 'delivery_completed', $4)`,
      [uuidv4(), delivery.order_id, req.user.id, hasPod ? 'Marked delivered' : 'Marked delivered — no proof']);
    await notifyDelivered(q, delivery.order_id, req.user.id, req.user.name, 'delivered', !hasPod);
    return { already: false };
  });

  if (result.already) return res.status(409).json({ error: 'This delivery is already completed' });
  res.json({ message: 'Marked as delivered' });
}));

// POST /api/delivery/quick-deliver — one-tap "Delivered" straight from the Ready
// list, no Schedule step. Completes an existing active delivery if there is one,
// else creates a delivery already marked delivered (carrying the order's address).
// Same end state as Schedule → Mark delivered, so reports/audit are unchanged.
router.post('/quick-deliver', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['super_admin', 'delivery_team', 'admin'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();

  const { order_id, no_proof } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  const order = (await query("SELECT id, stage, delivery_address FROM orders WHERE id = $1", [order_id])).rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Lost-response retry / double-tap from the field: it's already delivered — report
  // success, not a confusing "not ready" error.
  if (order.stage === 'delivered') return res.json({ message: 'Already delivered', already: true });
  if (order.stage !== 'ready_for_delivery') return res.status(400).json({ error: 'Order is not ready for delivery' });

  // Proof gate: need a POD photo on the order unless the caller delivers without one
  // (then Boss/Ops get a ⚠ no-proof ping). ensureDeliverySchema() above made kind exist.
  const hasPod = !!(await query("SELECT 1 FROM order_attachments WHERE order_id = $1 AND kind = 'pod' LIMIT 1", [order_id])).rows[0];
  if (!hasPod && !no_proof) return res.status(428).json({ error: 'no_proof' });

  const result = await withTransaction(async (q) => {
    // Lock the order row and re-check inside the tx so two simultaneous one-taps
    // can't both write a 'delivered' transition.
    const o = (await q("SELECT stage FROM orders WHERE id = $1 FOR UPDATE", [order_id])).rows[0];
    if (!o || o.stage !== 'ready_for_delivery') return { already: true };

    const active = (await q("SELECT id FROM deliveries WHERE order_id = $1 AND status IN ('pending','in_transit') ORDER BY created_at DESC LIMIT 1", [order_id])).rows[0];
    if (active) {
      await q("UPDATE deliveries SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = $1", [active.id]);
    } else {
      await q("INSERT INTO deliveries (id, order_id, address, status, delivered_at) VALUES ($1, $2, $3, 'delivered', now())",
        [uuidv4(), order_id, order.delivery_address || null]);
    }
    await q("UPDATE orders SET stage = 'delivered', updated_at = now() WHERE id = $1", [order_id]);
    await q("INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by) VALUES ($1, $2, 'ready_for_delivery', 'delivered', $3)",
      [uuidv4(), order_id, req.user.id]);
    await q(`INSERT INTO activity_log (id, order_id, user_id, action, details)
             VALUES ($1, $2, $3, 'delivery_completed', $4)`,
      [uuidv4(), order_id, req.user.id, hasPod ? 'Marked delivered (one-tap)' : 'Marked delivered (one-tap) — no proof']);
    await notifyDelivered(q, order_id, req.user.id, req.user.name, 'delivered', !hasPod);
    return { already: false };
  });

  if (result.already) return res.json({ message: 'Already delivered', already: true });
  res.json({ message: 'Marked as delivered' });
}));

// POST /api/delivery/:id/reopen — undo an accidental delivery: order goes back to
// Ready for Delivery. Removes the delivery record and the (mistaken) delivered
// transition so throughput/cycle reports stay clean; the reversal is logged.
router.post('/:id/reopen', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['super_admin', 'delivery_team', 'admin'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const delivery = (await query('SELECT * FROM deliveries WHERE id = $1', [req.params.id])).rows[0];
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  if (delivery.status !== 'delivered') return res.status(409).json({ error: 'Only a delivered order can be reopened' });

  await withTransaction(async (q) => {
    await q('DELETE FROM deliveries WHERE id = $1', [delivery.id]);
    await q(`DELETE FROM stage_transitions WHERE id = (
               SELECT id FROM stage_transitions WHERE order_id = $1 AND to_stage = 'delivered'
               ORDER BY created_at DESC LIMIT 1)`, [delivery.order_id]);
    await q("UPDATE orders SET stage = 'ready_for_delivery', updated_at = now() WHERE id = $1", [delivery.order_id]);
    await q(`INSERT INTO activity_log (id, order_id, user_id, action, details)
             VALUES ($1, $2, $3, 'delivery_reopened', $4)`,
      [uuidv4(), delivery.order_id, req.user.id, 'Reopened — order returned to Ready for Delivery']);
    await notifyDelivered(q, delivery.order_id, req.user.id, req.user.name, 'reopened');
  });

  res.json({ message: 'Reopened' });
}));

// PATCH /api/delivery/:id — update a scheduled delivery, or cancel it (status: 'failed')
router.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['super_admin', 'delivery_team', 'admin'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();

  const delivery = (await query('SELECT * FROM deliveries WHERE id = $1', [req.params.id])).rows[0];
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  if (delivery.status === 'delivered') return res.status(409).json({ error: 'A completed delivery cannot be changed' });

  const { deliverer_id, scheduled_date, address, notes, status } = req.body;
  if (deliverer_id) {
    const dl = (await query('SELECT id, is_active FROM deliverers WHERE id = $1', [deliverer_id])).rows[0];
    if (!dl || !dl.is_active) return res.status(400).json({ error: 'Deliverer must be active' });
  }
  if (status !== undefined && !['pending', 'in_transit', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const sets = [], vals = [];
  if (deliverer_id !== undefined) sets.push(`deliverer_id = $${vals.push(deliverer_id || null)}`);
  if (scheduled_date !== undefined) sets.push(`scheduled_date = $${vals.push(scheduled_date || null)}`);
  if (address !== undefined) sets.push(`address = $${vals.push(address || null)}`);
  if (notes !== undefined) sets.push(`notes = $${vals.push(notes || null)}`);
  if (status !== undefined) sets.push(`status = $${vals.push(status)}`);
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  sets.push('updated_at = now()');

  const idIdx = vals.push(req.params.id);
  await withTransaction(async (q) => {
    await q(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = $${idIdx}`, vals);
    await q(`INSERT INTO activity_log (id, order_id, user_id, action, details)
             VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), delivery.order_id, req.user.id,
       status === 'failed' ? 'delivery_cancelled' : 'delivery_updated',
       status === 'failed' ? 'Delivery cancelled — order returned to Ready for Delivery' : 'Delivery details updated']);
  });

  res.json({ message: 'Delivery updated' });
}));

// ─── Deliverers (no-login driver list, managed by Boss / Ops / Coordinator) ───
const DELIVERER_MANAGERS = ['super_admin', 'delivery_team', 'admin'];

// GET /api/delivery/deliverers — list (any authenticated user who can reach Delivery)
router.get('/deliverers', authenticate, asyncHandler(async (req, res) => {
  await ensureDeliverySchema();
  const rows = (await query('SELECT * FROM deliverers ORDER BY is_active DESC, name ASC')).rows;
  res.json(rows);
}));

// POST /api/delivery/deliverers — add a deliverer
router.post('/deliverers', authenticate, asyncHandler(async (req, res) => {
  if (!DELIVERER_MANAGERS.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();
  const { name, phone } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const id = uuidv4();
  await query('INSERT INTO deliverers (id, name, phone) VALUES ($1, $2, $3)', [id, name.trim(), phone || null]);
  res.status(201).json({ id, name: name.trim(), phone: phone || null, is_active: true });
}));

// PATCH /api/delivery/deliverers/:id — rename / set phone / enable-disable
router.patch('/deliverers/:id', authenticate, asyncHandler(async (req, res) => {
  if (!DELIVERER_MANAGERS.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();
  const sets = [], vals = [];
  if (req.body.name !== undefined) sets.push(`name = $${vals.push(req.body.name)}`);
  if (req.body.phone !== undefined) sets.push(`phone = $${vals.push(req.body.phone || null)}`);
  if (req.body.is_active !== undefined) sets.push(`is_active = $${vals.push(!!req.body.is_active)}`);
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  const idIdx = vals.push(req.params.id);
  await query(`UPDATE deliverers SET ${sets.join(', ')} WHERE id = $${idIdx}`, vals);
  res.json({ message: 'Deliverer updated' });
}));

// DELETE /api/delivery/deliverers/:id — remove a DISABLED driver. Past deliveries keep
// their record but lose the driver name (set NULL), so only a disabled driver can go.
router.delete('/deliverers/:id', authenticate, asyncHandler(async (req, res) => {
  if (!DELIVERER_MANAGERS.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();
  const dl = (await query('SELECT id, is_active FROM deliverers WHERE id = $1', [req.params.id])).rows[0];
  if (!dl) return res.status(404).json({ error: 'Driver not found' });
  if (dl.is_active) return res.status(409).json({ error: 'Disable the driver before deleting it' });
  await query('UPDATE deliveries SET deliverer_id = NULL WHERE deliverer_id = $1', [req.params.id]);
  await query('DELETE FROM deliverers WHERE id = $1', [req.params.id]);
  res.json({ message: 'Driver deleted' });
}));

// POST /api/delivery/mark-do-printed — flag deliveries whose Delivery Order was printed,
// so a mass print can skip duplicates. Body: { ids: [deliveryId, …] }.
router.post('/mark-do-printed', authenticate, asyncHandler(async (req, res) => {
  await ensureDeliverySchema();
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.json({ updated: 0 });
  const r = await query('UPDATE deliveries SET do_printed_at = now() WHERE id = ANY($1::uuid[])', [ids]);
  res.json({ updated: r.rowCount });
}));

module.exports = router;
