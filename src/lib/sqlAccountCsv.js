// src/lib/sqlAccountCsv.js
// Parse a SQL Account sales-invoice CSV export into invoice objects the order
// webhook/import understands. Same column-alias logic as the standalone
// sql-account-bridge, but running server-side so the cloud import endpoint
// (POST /orders/import) does the parsing — nothing runs on the client's PC.
//
// SQL Account exports vary, so each field matches a list of common header
// aliases (case/space/punctuation-insensitive). Flat invoice-line rows are
// grouped back into invoices by Doc No.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES = {
  docNo: ['docno', 'invoiceno', 'invoicenumber', 'documentno', 'billno'],
  customer: ['companyname', 'customer', 'customername', 'debtorname', 'debtor', 'billto', 'company'],
  contact: ['phone', 'phone1', 'tel', 'telephone', 'mobile', 'hp', 'contact', 'contactno'],
  date: ['docdate', 'date', 'invoicedate', 'transdate'],
  po: ['pono', 'ponumber', 'po', 'yourref', 'custpono', 'ref', 'ref1'],
  terms: ['terms', 'paymentterms', 'term', 'creditterms'],
  sku: ['itemcode', 'code', 'stockcode', 'sku', 'productcode', 'item'],
  name: ['description', 'itemdescription', 'desc', 'productname', 'itemname', 'name', 'detail'],
  qty: ['qty', 'quantity', 'qtyorder', 'orderqty', 'invqty'],
  uom: ['uom', 'unit', 'units', 'uomname'],
};

// RFC-style CSV parse: handles quotes, "" escapes, CRLF and a UTF-8 BOM.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
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
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function buildResolver(headers) {
  const normed = headers.map(norm);
  const idx = {};
  for (const field of Object.keys(ALIASES)) {
    idx[field] = normed.findIndex((h) => ALIASES[field].includes(h));
  }
  return idx;
}

function toIsoDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);            // YYYY-MM-DD
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);          // D/M/YYYY (Malaysia)
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;                                            // unknown → caller defaults it
}

const num = (s) => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 1; };

// Parse CSV text → [{ invoice_number, customer_name, customer_contact, order_date,
// po_ref, payment_terms, items: [{ sku, name, quantity, unit }] }]. Throws a
// human-readable Error if the Doc-No or Customer column can't be found.
function parseInvoicesFromCsv(text) {
  const rows = parseCsv(String(text || ''));
  if (rows.length < 2) return [];
  const headers = rows[0];
  const ix = buildResolver(headers);
  if (ix.docNo < 0 || ix.customer < 0) {
    throw new Error(`Could not find a Doc-No or Customer column. Columns seen: ${headers.join(', ')}`);
  }
  const get = (r, f) => (ix[f] >= 0 ? String(r[ix[f]] ?? '').trim() : '');
  const byDoc = new Map();
  for (const r of rows.slice(1)) {
    const docNo = get(r, 'docNo');
    if (!docNo) continue;
    if (!byDoc.has(docNo)) {
      byDoc.set(docNo, {
        invoice_number: docNo,
        customer_name: get(r, 'customer'),
        customer_contact: get(r, 'contact') || null,
        order_date: toIsoDate(get(r, 'date')),
        po_ref: get(r, 'po') || null,
        payment_terms: get(r, 'terms') || null,
        items: [],
      });
    }
    const name = get(r, 'name'), sku = get(r, 'sku');
    if (name || sku) {
      byDoc.get(docNo).items.push({
        sku: sku || 'N/A',
        name: name || sku || 'Item',
        quantity: num(get(r, 'qty')),
        unit: get(r, 'uom') || 'pcs',
      });
    }
  }
  return [...byDoc.values()];
}

module.exports = { parseInvoicesFromCsv };
