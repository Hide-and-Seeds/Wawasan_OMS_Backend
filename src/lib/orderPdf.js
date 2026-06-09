// src/lib/orderPdf.js
// Customer-facing "Order Confirmation" PDF (no prices — money lives in SQL
// Account). Returned as a base64 media object the WhatsApp worker can attach.
const { query } = require('../utils/db');

async function orderConfirmationMedia(orderId) {
  // Lazy require so a missing pdf-lib only disables the PDF, never the route.
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

  const order = (await query(
    `SELECT invoice_number, customer_name, order_date, required_delivery_date
     FROM orders WHERE id = $1`, [orderId]
  )).rows[0];
  if (!order) return null;
  const items = (await query(
    `SELECT sku, name, quantity, unit FROM order_items WHERE order_id = $1 ORDER BY created_at`, [orderId]
  )).rows;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = 48, R = 595.28 - 48;
  const orange = rgb(0.976, 0.451, 0.086), dark = rgb(0.12, 0.12, 0.12), grey = rgb(0.42, 0.42, 0.42);
  let y = 792;
  const draw = (s, x, size, f = font, col = dark) => page.drawText(String(s == null ? '' : s), { x, y, size, font: f, color: col });

  draw('WAWASAN CANDLE', L, 22, bold, orange);
  y -= 18; draw('Order Confirmation', L, 12, font, grey);
  y -= 32;
  draw(`Invoice ${order.invoice_number}`, L, 13, bold);
  draw(`Order date: ${order.order_date || '-'}`, 360, 11, font, grey);
  y -= 18; draw(`Customer: ${order.customer_name || '-'}`, L, 11);
  y -= 16; draw(`Expected delivery: ${order.required_delivery_date || '-'}`, L, 11);
  y -= 30;

  draw('SKU', L, 10, bold, grey); draw('Product', L + 110, 10, bold, grey); draw('Qty', 458, 10, bold, grey); draw('Unit', 510, 10, bold, grey);
  y -= 8; page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.6, color: grey }); y -= 16;
  for (const it of items) {
    if (y < 96) break;
    draw((it.sku || '').slice(0, 16), L, 10);
    draw((it.name || '').slice(0, 46), L + 110, 10);
    draw(Math.round(Number(it.quantity) || 0), 458, 10);
    draw(it.unit || 'pcs', 510, 10);
    y -= 15;
  }
  y = Math.max(y - 22, 60);
  draw('This is an order confirmation, not a tax invoice.', L, 9, font, grey);
  y -= 13; draw('Thank you for choosing Wawasan Candle.', L, 9, font, grey);

  const bytes = await pdf.save();
  return { data: Buffer.from(bytes).toString('base64'), mimetype: 'application/pdf', filename: `Order-${order.invoice_number}.pdf` };
}

module.exports = { orderConfirmationMedia };
