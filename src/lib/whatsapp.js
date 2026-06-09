// src/lib/whatsapp.js
// WhatsApp send provider + throttle policy.
//
// DEFAULT provider is 'log': it records the message and reports success WITHOUT
// contacting WhatsApp, so the whole queue → drip pipeline is testable with NO SIM
// and NO worker. Set WHATSAPP_WORKER_URL (+ WHATSAPP_WORKER_SECRET) to switch to
// the real always-on whatsapp-web.js worker (see wa-worker/ + WHATSAPP-SETUP.md).
//
// ⚠ whatsapp-web.js drives a real WhatsApp account and breaks WhatsApp's ToS —
// the linked number can be banned at any time. Always link a DEDICATED, disposable
// SIM the business owns, never their main number.

const WORKER_URL = (process.env.WHATSAPP_WORKER_URL || '').replace(/\/$/, '');
const WORKER_SECRET = process.env.WHATSAPP_WORKER_SECRET || '';

function providerName() {
  return WORKER_URL ? 'wwebjs' : 'log';
}

// Normalise a Malaysian phone to a WhatsApp MSISDN: drop punctuation, turn a
// leading 0 into 60 (Malaysia), leave an existing 60… alone.
function toMsisdn(phone) {
  let d = String(phone || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('60')) return d;
  if (d.startsWith('0')) return '60' + d.slice(1);
  return d;
}

// Send one message. Returns { ok, providerMessageId?, error? }.
async function sendMessage(to, text, media) {
  if (!WORKER_URL) {
    // LOG provider — safe default for testing. Accepts any recipient.
    console.log(`[whatsapp:log] -> ${to}: ${String(text).replace(/\s+/g, ' ').slice(0, 140)}${media ? ' (+PDF ' + media.filename + ')' : ''}`);
    return { ok: true, providerMessageId: 'log-' + Date.now() };
  }
  const digits = String(to || '').replace(/[^\d]/g, '');
  if (!digits) return { ok: false, error: 'invalid recipient number' };
  try {
    const res = await fetch(`${WORKER_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WORKER_SECRET}` },
      body: JSON.stringify({ to: digits, text: String(text), media: media || undefined }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.status === 'sent') return { ok: true, providerMessageId: body.providerMessageId };
    return { ok: false, error: body.error || `worker HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Throttle policy — keep auto-sends slow + daytime so the number isn't flagged.
const TZ_MS = Number(process.env.WHATSAPP_TZ_OFFSET_MIN || 480) * 60 * 1000; // default UTC+8 (Malaysia)
const POLICY = {
  dailyCap: Number(process.env.WHATSAPP_DAILY_CAP || 60),
  windowStartHour: Number(process.env.WHATSAPP_WINDOW_START || 9),
  windowEndHour: Number(process.env.WHATSAPP_WINDOW_END || 21),
};
function localDate() { return new Date(Date.now() + TZ_MS).toISOString().slice(0, 10); }
function localHour() { return +new Date(Date.now() + TZ_MS).toISOString().slice(11, 13); }
function withinWindow() { const h = localHour(); return h >= POLICY.windowStartHour && h < POLICY.windowEndHour; }

module.exports = { sendMessage, providerName, toMsisdn, POLICY, withinWindow, localDate };
