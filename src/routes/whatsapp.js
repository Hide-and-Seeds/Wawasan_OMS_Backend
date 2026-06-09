// src/routes/whatsapp.js
// Outbound WhatsApp pipeline: a message_queue, an enqueue sweep, a daily morning
// brief, and a throttled drip sender. Sends go through the provider in
// ../lib/whatsapp (log by default → testable with no SIM; real worker when
// WHATSAPP_WORKER_URL is set).
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendMessage, providerName, toMsisdn, POLICY, withinWindow, localDate } = require('../lib/whatsapp');

const ADMIN_ROLES = ['super_admin', 'operations_controller'];
const BRAND = 'Wawasan Candle';

// ── self-migrating table (idempotent, runs once per process) ────────────────
let _ready = false;
async function ensureQueue() {
  if (_ready) return;
  await query(`CREATE TABLE IF NOT EXISTS message_queue (
    id         uuid primary key default gen_random_uuid(),
    channel    text not null default 'whatsapp',
    recipient  text not null,
    body       text not null,
    order_id   uuid references orders(id) on delete set null,
    kind       text not null,
    status     text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
    attempts   int  not null default 0,
    provider   text,
    error      text,
    created_at timestamptz not null default now(),
    sent_at    timestamptz
  )`);
  await query('CREATE UNIQUE INDEX IF NOT EXISTS uq_mq_order_kind ON message_queue(order_id, kind)');
  await query('CREATE INDEX IF NOT EXISTS idx_mq_status ON message_queue(status, created_at)');
  _ready = true;
}

// ── auth helpers ────────────────────────────────────────────────────────────
// Cron + admin: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`; a Boss/
// Ops JWT also works (handy for manual testing). `?secret=` is accepted too.
function cronOrAdmin(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const auth = req.get('authorization') || '';
  if (secret && (auth === `Bearer ${secret}` || req.query.secret === secret)) return next();
  return authenticate(req, res, () => authorize(...ADMIN_ROLES)(req, res, next));
}
// Worker endpoints: only the always-on worker (shared secret) may pull/report.
function workerAuth(req, res, next) {
  const secret = process.env.WHATSAPP_WORKER_SECRET || '';
  if (secret && req.get('authorization') === `Bearer ${secret}`) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
// Register a handler for both GET (Vercel cron) and POST (manual/admin).
function cronRoute(path, handler) { router.get(path, cronOrAdmin, handler); router.post(path, cronOrAdmin, handler); }

// ── message templates ───────────────────────────────────────────────────────
const tpl = {
  received: (o) => `Hi ${o.customer_name}, thank you! Your ${BRAND} order ${o.invoice_number} is confirmed and now in production.${o.required_delivery_date ? ` Expected delivery: ${o.required_delivery_date}.` : ''} We'll keep you posted as it progresses.`,
  ready: (o) => `Hi ${o.customer_name}, your ${BRAND} order ${o.invoice_number} is packed and quality-checked — we're arranging delivery now.`,
  out_for_delivery: (o) => `Hi ${o.customer_name}, good news — your ${BRAND} order ${o.invoice_number} is on the way${o.courier ? ' via ' + o.courier : ''}.${o.tracking_no ? ' Tracking: ' + o.tracking_no + '.' : ''}`,
  delivered: (o) => `Hi ${o.customer_name}, your ${BRAND} order ${o.invoice_number} has been delivered. Thank you for choosing us!`,
  delayed: (o) => `Hi ${o.customer_name}, a quick update on your ${BRAND} order ${o.invoice_number}: it's briefly on hold${o.waiting_stock ? ' (awaiting materials)' : ''} so it may take a little longer. We'll message you the moment it moves — thanks for your patience.`,
};

// ── enqueue sweep: derive customer messages from current state (idempotent) ──
async function enqueueCustomerMessages() {
  let enqueued = 0;
  const ins = async (recipient, body, orderId, kind) => {
    const r = await query(
      `INSERT INTO message_queue (recipient, body, order_id, kind) VALUES ($1,$2,$3,$4)
       ON CONFLICT (order_id, kind) DO NOTHING`,
      [recipient, body, orderId, kind]
    );
    enqueued += r.rowCount;
  };

  // "received / in production" — any order that has left the Order column.
  for (const o of (await query(
    `SELECT id, invoice_number, customer_name, customer_contact, required_delivery_date FROM orders
     WHERE stage IN ('production','packing','ready_for_delivery','delivered')
       AND customer_contact IS NOT NULL AND customer_contact <> ''`
  )).rows) await ins(toMsisdn(o.customer_contact), tpl.received(o), o.id, 'received');

  // "packed / ready" — order reached Ready for Delivery.
  for (const o of (await query(
    `SELECT id, invoice_number, customer_name, customer_contact FROM orders
     WHERE stage = 'ready_for_delivery' AND customer_contact IS NOT NULL AND customer_contact <> ''`
  )).rows) await ins(toMsisdn(o.customer_contact), tpl.ready(o), o.id, 'ready');

  // "out for delivery" — a delivery is scheduled / in transit.
  for (const o of (await query(
    `SELECT o.id, o.invoice_number, o.customer_name, o.customer_contact,
            COALESCE(dl.name, u.name) AS courier, d.tracking_no
     FROM deliveries d JOIN orders o ON d.order_id = o.id
     LEFT JOIN deliverers dl ON d.deliverer_id = dl.id
     LEFT JOIN users u ON d.delivery_man_id = u.id
     WHERE d.status IN ('pending','in_transit') AND o.customer_contact IS NOT NULL AND o.customer_contact <> ''`
  )).rows) await ins(toMsisdn(o.customer_contact), tpl.out_for_delivery(o), o.id, 'out_for_delivery');

  // "delivered" confirmation.
  for (const o of (await query(
    `SELECT o.id, o.invoice_number, o.customer_name, o.customer_contact
     FROM deliveries d JOIN orders o ON d.order_id = o.id
     WHERE d.status = 'delivered' AND o.customer_contact IS NOT NULL AND o.customer_contact <> ''`
  )).rows) await ins(toMsisdn(o.customer_contact), tpl.delivered(o), o.id, 'delivered');

  // "delay notice" — order on hold or waiting stock.
  for (const o of (await query(
    `SELECT id, invoice_number, customer_name, customer_contact, waiting_stock FROM orders
     WHERE (on_hold = true OR waiting_stock = true) AND stage NOT IN ('delivered','cancelled')
       AND customer_contact IS NOT NULL AND customer_contact <> ''`
  )).rows) await ins(toMsisdn(o.customer_contact), tpl.delayed(o), o.id, 'delayed');

  return enqueued;
}

// POST/GET /api/whatsapp/enqueue
cronRoute('/enqueue', asyncHandler(async (req, res) => {
  await ensureQueue();
  const enqueued = await enqueueCustomerMessages();
  res.json({ ok: true, enqueued, provider: providerName() });
}));

// POST/GET /api/whatsapp/morning-brief — compute the digest + queue it to admin.
cronRoute('/morning-brief', asyncHandler(async (req, res) => {
  await ensureQueue();
  const dueToday = (await query(
    `SELECT invoice_number FROM orders WHERE required_delivery_date = CURRENT_DATE
       AND stage NOT IN ('delivered','cancelled') ORDER BY priority DESC, invoice_number`
  )).rows;
  const overdue = (await query(
    `SELECT invoice_number FROM orders WHERE required_delivery_date < CURRENT_DATE
       AND stage NOT IN ('delivered','cancelled') ORDER BY required_delivery_date`
  )).rows;
  const byStage = (await query(
    `SELECT stage, COUNT(*)::int c FROM orders WHERE stage NOT IN ('delivered','cancelled') GROUP BY stage`
  )).rows;
  const s = Object.fromEntries(byStage.map((r) => [r.stage, r.c]));
  const list = (arr) => (arr.length ? ': ' + arr.map((x) => x.invoice_number).join(', ') : '');
  const body =
    `☀️ ${BRAND} OMS — Morning brief (${localDate()})\n` +
    `Due today: ${dueToday.length}${list(dueToday)}\n` +
    `Overdue: ${overdue.length}${list(overdue)}\n` +
    `Open now — Order ${s.order || 0} · Production ${s.production || 0} · Packing ${s.packing || 0} · Ready ${s.ready_for_delivery || 0}`;

  const to = toMsisdn(process.env.WHATSAPP_ADMIN_TO || '') || 'admin';
  const r = await query(
    `INSERT INTO message_queue (recipient, body, kind) VALUES ($1,$2,'morning_brief') RETURNING id`,
    [to, body]
  );
  res.json({ ok: true, queued_id: r.rows[0].id, recipient: to, due_today: dueToday.length, overdue: overdue.length, body });
}));

// Shared send step used by the test drip (claims a row, sends, records result).
async function sendOne(m) {
  const claim = await query(`UPDATE message_queue SET status='sending', attempts=attempts+1 WHERE id=$1 AND status='queued'`, [m.id]);
  if (claim.rowCount === 0) return null; // raced
  const r = await sendMessage(m.recipient, m.body);
  if (r.ok) {
    await query(`UPDATE message_queue SET status='sent', sent_at=now(), provider=$2, error=NULL WHERE id=$1`, [m.id, providerName()]);
    return 'sent';
  }
  const st = (m.attempts || 0) >= 2 ? 'failed' : 'queued';
  await query(`UPDATE message_queue SET status=$2, provider=$3, error=$4 WHERE id=$1`, [m.id, st, providerName(), r.error]);
  return 'failed';
}

// POST/GET /api/whatsapp/drip — send up to `max` queued (oldest first).
// Honours the daytime window + daily cap unless ?force=1 (admin testing only).
cronRoute('/drip', asyncHandler(async (req, res) => {
  await ensureQueue();
  const force = req.query.force === '1' || req.query.force === 'true';
  const max = Math.min(50, Math.max(1, parseInt(req.query.max, 10) || 10));
  if (!force && !withinWindow()) return res.json({ sent: 0, failed: 0, skipped: 'outside-window', provider: providerName() });
  if (!force) {
    const sentToday = (await query(`SELECT COUNT(*)::int c FROM message_queue WHERE status='sent' AND sent_at::date = CURRENT_DATE`)).rows[0].c;
    if (sentToday >= POLICY.dailyCap) return res.json({ sent: 0, failed: 0, skipped: 'daily-cap', provider: providerName() });
  }
  const rows = (await query(`SELECT id, recipient, body, attempts FROM message_queue WHERE status='queued' ORDER BY created_at ASC LIMIT $1`, [max])).rows;
  let sent = 0, failed = 0;
  for (const m of rows) { const r = await sendOne(m); if (r === 'sent') sent++; else if (r === 'failed') failed++; }
  res.json({ ok: true, sent, failed, provider: providerName() });
}));

// GET /api/whatsapp/queue — recent rows + status counts (admin; testing visibility).
router.get('/queue', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  await ensureQueue();
  const counts = (await query(`SELECT status, COUNT(*)::int c FROM message_queue GROUP BY status`)).rows;
  const messages = (await query(
    `SELECT id, recipient, kind, status, attempts, provider, left(body, 160) AS preview, order_id, created_at, sent_at, error
     FROM message_queue ORDER BY created_at DESC LIMIT 50`
  )).rows;
  res.json({ provider: providerName(), counts, messages });
}));

// POST /api/whatsapp/test — enqueue one arbitrary message (admin). { to, text }
router.post('/test', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  await ensureQueue();
  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ error: 'to and text are required' });
  const r = await query(`INSERT INTO message_queue (recipient, body, kind) VALUES ($1,$2,'test') RETURNING id`, [toMsisdn(to) || String(to), text]);
  res.json({ ok: true, queued_id: r.rows[0].id });
}));

// POST /api/whatsapp/cancel — stop pending messages (the "undo"). Optional { id }
// for a single row, otherwise cancels every queued/sending message.
router.post('/cancel', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  await ensureQueue();
  const { id } = req.body || {};
  const r = id
    ? await query(`UPDATE message_queue SET status='cancelled', error='cancelled by user' WHERE id=$1 AND status IN ('queued','sending')`, [id])
    : await query(`UPDATE message_queue SET status='cancelled', error='cancelled by user' WHERE status IN ('queued','sending')`);
  res.json({ ok: true, cancelled: r.rowCount });
}));

// POST /api/whatsapp/redirect — point queued messages at a different number
// (demo helper, so a viewer can watch them arrive on their own phone).
// { to } = all queued | { id, to } = one. Only affects 'queued' rows.
router.post('/redirect', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  await ensureQueue();
  const { id, to } = req.body || {};
  if (!to || !String(to).trim()) return res.status(400).json({ error: 'to is required' });
  const recipient = toMsisdn(to) || String(to).trim();
  const r = id
    ? await query(`UPDATE message_queue SET recipient = $1 WHERE id = $2 AND status = 'queued'`, [recipient, id])
    : await query(`UPDATE message_queue SET recipient = $1 WHERE status = 'queued'`, [recipient]);
  res.json({ ok: true, updated: r.rowCount, recipient });
}));

// ── always-on worker drip (production path; matches the wa-worker loop) ──────
// GET /api/whatsapp/worker/next — claim one queued message to send.
router.get('/worker/next', workerAuth, asyncHandler(async (req, res) => {
  await ensureQueue();
  if (!withinWindow()) return res.json({ message: null, reason: 'outside-window' });
  const sentToday = (await query(`SELECT COUNT(*)::int c FROM message_queue WHERE status='sent' AND sent_at::date = CURRENT_DATE`)).rows[0].c;
  if (sentToday >= POLICY.dailyCap) return res.json({ message: null, reason: 'daily-cap' });
  const row = (await query(`SELECT id, recipient, body FROM message_queue WHERE status='queued' ORDER BY random() LIMIT 1`)).rows[0];
  if (!row) return res.json({ message: null, reason: 'empty' });
  const claim = await query(`UPDATE message_queue SET status='sending', attempts=attempts+1 WHERE id=$1 AND status='queued'`, [row.id]);
  if (claim.rowCount === 0) return res.json({ message: null, reason: 'raced' });
  res.json({ message: { id: row.id, to: row.recipient, text: row.body } });
}));

// POST /api/whatsapp/worker/result — worker reports send outcome.
router.post('/worker/result', workerAuth, asyncHandler(async (req, res) => {
  await ensureQueue();
  const { id, status, error } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  if (status === 'sent') {
    await query(`UPDATE message_queue SET status='sent', sent_at=now(), provider='wwebjs', error=NULL WHERE id=$1`, [id]);
  } else {
    const row = (await query(`SELECT attempts FROM message_queue WHERE id=$1`, [id])).rows[0];
    const st = row && row.attempts >= 3 ? 'failed' : 'queued';
    await query(`UPDATE message_queue SET status=$2, error=$3 WHERE id=$1`, [id, st, error || 'send failed']);
  }
  res.json({ ok: true });
}));

module.exports = router;
