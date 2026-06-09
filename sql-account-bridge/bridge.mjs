// sql-account-bridge/bridge.mjs
// Standalone poller: read NEW SQL Account sales invoices and POST each to the OMS
// webhook (POST /api/orders/webhook/sql-account). NOT part of the Vercel app.
//
// Source is pluggable (SOURCE env): 'csv' works today; 'sdk' / 'firebird' are
// stubs to fill in once you have that access. Idempotent end to end — the webhook
// 409s duplicates and we also track processed Doc Nos in a local state file, so
// re-running (or a cron every N minutes) never double-creates an order.
//
//   node --env-file=.env bridge.mjs              run once (use Task Scheduler/cron)
//   node --env-file=.env bridge.mjs --dry-run    print mapped JSON, send nothing
//   POLL_SECONDS=300 …                            loop in-process every N seconds
//
// Needs Node >= 20 (built-in --env-file + fetch). No npm install for the CSV path.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

try { process.loadEnvFile(); } catch { /* rely on the real environment */ }

const DRY = process.argv.includes("--dry-run");
const SOURCE = (process.env.SOURCE || "csv").toLowerCase();
const WEBHOOK_URL = (process.env.WEBHOOK_URL || "").trim();
const SECRET = process.env.WEBHOOK_SECRET || "";
const POLL = parseInt(process.env.POLL_SECONDS || "0", 10);
const STATE_FILE = process.env.STATE_FILE || "./state.json";

if (!DRY && (!WEBHOOK_URL || !SECRET)) {
  console.error("FATAL: WEBHOOK_URL and WEBHOOK_SECRET must be set (see .env.example).");
  process.exit(1);
}

// ── column mapping ──────────────────────────────────────────────────────────
// SQL Account invoice exports vary; match a list of common header aliases
// (case/space/punctuation-insensitive) per field so it usually works with no
// config. Override any field via CSV_MAP, e.g. CSV_MAP={"docNo":"My Doc Column"}.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES = {
  docNo:    ["docno", "invoiceno", "invoicenumber", "documentno", "billno"],
  customer: ["companyname", "customer", "customername", "debtorname", "debtor", "billto", "company"],
  contact:  ["phone", "phone1", "tel", "telephone", "mobile", "hp", "contact", "contactno"],
  date:     ["docdate", "date", "invoicedate", "transdate"],
  po:       ["pono", "ponumber", "po", "yourref", "custpono", "ref", "ref1"],
  terms:    ["terms", "paymentterms", "term", "creditterms"],
  sku:      ["itemcode", "code", "stockcode", "sku", "productcode", "item"],
  name:     ["description", "itemdescription", "desc", "productname", "itemname", "name", "detail"],
  qty:      ["qty", "quantity", "qtyorder", "orderqty", "invqty"],
  uom:      ["uom", "unit", "units", "uomname"],
};
const OVERRIDE = (() => { try { return JSON.parse(process.env.CSV_MAP || "{}"); } catch { return {}; } })();

function buildResolver(headers) {
  const normed = headers.map(norm);
  const idx = {};
  for (const field of Object.keys(ALIASES)) {
    if (OVERRIDE[field]) {                                   // explicit header text wins
      const j = headers.findIndex((h) => norm(h) === norm(OVERRIDE[field]));
      if (j >= 0) { idx[field] = j; continue; }
    }
    idx[field] = normed.findIndex((h) => ALIASES[field].includes(h)); // -1 if absent
  }
  return idx;
}

// ── tiny CSV parser (quotes, "" escapes, CRLF, BOM) ──────────────────────────
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip UTF-8 BOM
  const rows = [];
  let row = [], field = "", i = 0, inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function toIsoDate(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                       // YYYY-MM-DD
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);                     // D/M/YYYY (Malaysia)
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return undefined;                                                  // unknown → webhook defaults it
}

const num = (s) => { const n = parseFloat(String(s ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 1; };

// ── group flat invoice-line rows into invoices ───────────────────────────────
function rowsToInvoices(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const ix = buildResolver(headers);
  if (ix.docNo < 0 || ix.customer < 0) {
    throw new Error(`CSV missing a Doc-No or Customer column. Headers seen: [${headers.join(", ")}]. Set CSV_MAP in .env to map them.`);
  }
  const get = (r, f) => (ix[f] >= 0 ? (r[ix[f]] ?? "").trim() : "");
  const byDoc = new Map();
  for (const r of rows.slice(1)) {
    const docNo = get(r, "docNo");
    if (!docNo) continue;
    if (!byDoc.has(docNo)) {
      byDoc.set(docNo, {
        invoice_number: docNo,
        customer_name: get(r, "customer"),
        customer_contact: get(r, "contact") || undefined,
        order_date: toIsoDate(get(r, "date")),
        po_ref: get(r, "po") || undefined,
        payment_terms: get(r, "terms") || undefined,
        items: [],
      });
    }
    const name = get(r, "name"), sku = get(r, "sku");
    if (name || sku) {
      byDoc.get(docNo).items.push({
        sku: sku || "N/A",
        name: name || sku || "Item",
        quantity: num(get(r, "qty")),
        unit: get(r, "uom") || "pcs",
      });
    }
  }
  return [...byDoc.values()];
}

// ── sources ──────────────────────────────────────────────────────────────────
async function fromCsv() {
  const file = process.env.CSV_FILE, dir = process.env.CSV_DIR;
  let files = [];
  if (file) files = [file];
  else if (dir) files = (await readdir(dir)).filter((f) => /\.csv$/i.test(f)).map((f) => path.join(dir, f));
  else throw new Error("Set CSV_FILE or CSV_DIR for SOURCE=csv.");
  const invoices = [];
  for (const f of files) {
    if (!existsSync(f)) { console.warn(`skip (missing): ${f}`); continue; }
    invoices.push(...rowsToInvoices(parseCsv(await readFile(f, "utf8"))));
  }
  return invoices;
}

async function fromFirebird() {
  // TODO: read SQL Account's Firebird DB directly. `npm i node-firebird`, connect
  // with { host: FB_HOST, port: 3050, database: FB_DATABASE (.FDB path), user, password },
  // SELECT new invoices + their lines since the last Doc No, and return the same
  // shape rowsToInvoices() produces. See README "Sources".
  throw new Error("SOURCE=firebird not implemented yet — fill in fromFirebird() (see README).");
}

async function fromSdk() {
  // TODO: SQL Account SDK (SQLAcc.BizApp COM). Node can't drive COM directly —
  // shell out to a PowerShell script that logs into the SDK and emits invoice JSON
  // to stdout (child_process), then JSON.parse it here. Needs SQL Account installed
  // on this PC + an SDK licence + a login. See README "Sources".
  throw new Error("SOURCE=sdk not implemented yet — fill in fromSdk() (see README).");
}

const SOURCES = { csv: fromCsv, firebird: fromFirebird, sdk: fromSdk };

// ── state (which Doc Nos were already sent) ──────────────────────────────────
async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")); } catch { return { processed: {} }; }
}
const saveState = (s) => writeFile(STATE_FILE, JSON.stringify(s, null, 2));

async function post(inv) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": SECRET },
    body: JSON.stringify(inv),
  });
  return { status: res.status, body: await res.text() };
}

async function runOnce() {
  const src = SOURCES[SOURCE];
  if (!src) throw new Error(`Unknown SOURCE='${SOURCE}' (use csv | firebird | sdk).`);
  const invoices = await src();
  console.log(`${new Date().toISOString()}  ${SOURCE}: ${invoices.length} invoice(s) found`);

  if (DRY) {
    console.log(JSON.stringify(invoices, null, 2));
    console.log("\n(dry-run — nothing sent. Check the field mapping above, then drop --dry-run.)");
    return;
  }

  const state = await loadState();
  let sent = 0, dup = 0, failed = 0, skipped = 0;
  for (const inv of invoices) {
    if (!inv.invoice_number || !inv.customer_name) { console.warn("skip (no docNo/customer):", inv); continue; }
    if (state.processed[inv.invoice_number]) { skipped++; continue; }
    try {
      const { status, body } = await post(inv);
      if (status === 201) { state.processed[inv.invoice_number] = new Date().toISOString(); sent++; console.log(`  201  ${inv.invoice_number} → board`); }
      else if (status === 409) { state.processed[inv.invoice_number] = new Date().toISOString(); dup++; console.log(`  409  ${inv.invoice_number} (already exists)`); }
      else { failed++; console.error(`  ${status}  ${inv.invoice_number}: ${body}`); } // leave unprocessed → retried next run
    } catch (e) { failed++; console.error(`  ERR  ${inv.invoice_number}: ${e.message}`); }
  }
  await saveState(state);
  console.log(`done: ${sent} created, ${dup} duplicate, ${failed} failed, ${skipped} already-processed`);
}

async function main() {
  if (POLL > 0 && !DRY) {
    console.log(`bridge: SOURCE=${SOURCE}, polling every ${POLL}s → ${WEBHOOK_URL}`);
    for (;;) {
      try { await runOnce(); } catch (e) { console.error("run error:", e.message); }
      await new Promise((r) => setTimeout(r, POLL * 1000));
    }
  } else {
    await runOnce();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
