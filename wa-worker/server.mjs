// wa-worker/server.mjs
// Standalone always-on WhatsApp sender (NOT part of the Vercel app).
// Wraps whatsapp-web.js behind a tiny bearer-auth HTTP API, and runs a slow,
// throttled "drip" that pulls one queued message at a time from the OMS backend.
//
// ⚠ whatsapp-web.js drives a REAL WhatsApp account and breaks WhatsApp's ToS —
// Meta can permanently ban the linked number at any time. Link a DEDICATED,
// disposable SIM the business owns, never the main business number.
//
// Run:  CHROME_PATH=/usr/bin/chromium node --env-file=.env server.mjs   (Node >= 20)
import express from "express";
import qrcode from "qrcode-terminal";
import QR from "qrcode";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth, MessageMedia } = pkg;

// pm2/systemd don't inherit the shell's env — load .env ourselves.
try { process.loadEnvFile(); } catch { /* rely on the real environment */ }

process.on("unhandledRejection", (r) => console.error("unhandledRejection:", r?.message ?? r));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e?.message ?? e));

const PORT = process.env.PORT || 8787;
const SECRET = process.env.WA_WORKER_SECRET || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
if (!SECRET) { console.error("FATAL: WA_WORKER_SECRET not set."); process.exit(1); }

let ready = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./.wwebjs_auth" }),
  authTimeoutMs: 0, // throttled VMs load WhatsApp Web slowly — never time out the auth
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions",
      "--disable-background-networking", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  },
});

client.on("qr", (qr) => {
  ready = false;
  console.log("\n=== Scan this QR with the DEDICATED WhatsApp number ===");
  console.log("(WhatsApp > Settings > Linked Devices > Link a device)\n");
  qrcode.generate(qr, { small: true });
  QR.toFile("qr.png", qr, { width: 512 }).catch((e) => console.error("qr.png:", e.message));
});
client.on("authenticated", () => console.log("Authenticated — session persisted in ./.wwebjs_auth"));
client.on("auth_failure", (m) => console.error("Auth failure:", m));
client.on("ready", () => { ready = true; console.log("WhatsApp client READY."); });
client.on("disconnected", (reason) => {
  ready = false;
  console.log("Disconnected:", reason, "— re-initializing.");
  client.initialize().catch((e) => console.error("Re-init failed:", e?.message || e));
});
client.initialize().catch((e) => console.error("Initialization failed:", e?.message || e));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (req.get("authorization") !== `Bearer ${SECRET}`) return res.status(401).json({ status: "failed", error: "unauthorized" });
  next();
});
app.get("/health", (_req, res) => res.json({ ready }));

async function sendWithRetry(to, text, media) {
  const digits = String(to).replace(/[^\d]/g, "");
  if (!digits) return { error: "invalid number" };
  const transient = /Execution context was destroyed|Protocol error|Target closed|Session closed/i;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const numberId = await client.getNumberId(digits);
      if (!numberId) return { notOnWhatsapp: true };
      const payload = (media && media.data)
        ? new MessageMedia(media.mimetype || "application/pdf", media.data, media.filename || "document.pdf")
        : null;
      const msg = payload
        ? await client.sendMessage(numberId._serialized, payload, { caption: String(text || "") })
        : await client.sendMessage(numberId._serialized, String(text));
      return { providerMessageId: msg?.id?._serialized };
    } catch (e) {
      lastErr = e;
      if (transient.test(String(e?.message || e)) && attempt < 3) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      throw e;
    }
  }
  throw lastErr;
}

app.post("/send", async (req, res) => {
  if (!ready) return res.status(503).json({ status: "failed", error: "client not ready (scan QR / still booting)" });
  const { to, text, media } = req.body || {};
  if (!to || !text) return res.status(400).json({ status: "failed", error: "missing 'to' or 'text'" });
  try {
    const r = await sendWithRetry(to, text, media);
    if (r.error) return res.status(400).json({ status: "failed", error: r.error });
    if (r.notOnWhatsapp) return res.status(422).json({ status: "failed", error: "number not on WhatsApp" });
    return res.json({ status: "sent", providerMessageId: r.providerMessageId });
  } catch (e) {
    return res.status(500).json({ status: "failed", error: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`WA worker listening on :${PORT}`));

// ── Drip sender: poll the OMS backend for one queued message, send, report. ──
// The backend owns the throttle policy (window/cap); this loop is just the clock.
async function reportResult(id, status, error) {
  try {
    await fetch(`${APP_URL}/api/whatsapp/worker/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ id, status, error }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) { console.error("drip: report failed:", e?.message || e); }
}

async function dripTick() {
  try {
    if (ready && APP_URL) {
      const res = await fetch(`${APP_URL}/api/whatsapp/worker/next`, {
        headers: { Authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(15000),
      });
      const m = (await res.json().catch(() => ({}))).message;
      if (m && m.id) {
        try {
          const r = await sendWithRetry(m.to, m.text, m.media);
          if (r.notOnWhatsapp) await reportResult(m.id, "failed", "number not on WhatsApp");
          else if (r.error)    await reportResult(m.id, "failed", r.error);
          else { await reportResult(m.id, "sent"); console.log("drip: sent", m.id); }
        } catch (e) { await reportResult(m.id, "failed", String(e?.message || e)); }
      }
    }
  } catch (e) { console.error("drip: tick error:", e?.message || e); }
  finally { setTimeout(dripTick, (8 + Math.random() * 7) * 60 * 1000); } // 8–15 min, irregular
}

if (APP_URL) { console.log("Drip sender ON — polling", APP_URL); setTimeout(dripTick, 60 * 1000); }
else console.log("Drip sender OFF (set APP_URL to enable).");
