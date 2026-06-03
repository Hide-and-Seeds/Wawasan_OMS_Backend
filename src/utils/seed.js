// src/utils/seed.js
// Run with: node src/utils/seed.js

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');
require('dotenv').config();

const db = getDb();

const users = [
  { name: 'Boss Admin',    email: 'admin@wawasancandle.com',      role: 'super_admin',           password: 'Admin@123', avatar_color: '#7C3AED' },
  { name: 'Reenee',        email: 'reenee@wawasancandle.com',     role: 'operations_controller',  password: 'Reenee@123', avatar_color: '#0891B2' },
  { name: 'Misha',         email: 'misha@wawasancandle.com',      role: 'production_lead',        password: 'Misha@123', avatar_color: '#059669' },
  { name: 'Staff Ali',     email: 'ali@wawasancandle.com',        role: 'production_staff',       password: 'Staff@123', avatar_color: '#D97706' },
  { name: 'Staff Siti',    email: 'siti@wawasancandle.com',       role: 'packing_staff',          password: 'Staff@123', avatar_color: '#DB2777' },
  { name: 'Driver Raju',   email: 'raju@wawasancandle.com',       role: 'delivery_team',          password: 'Driver@123', avatar_color: '#DC2626' },
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO users (id, name, email, password, role, avatar_color)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const defaultSettings = [
  ['stage_order_name', 'Order'],
  ['stage_production_name', 'Production'],
  ['stage_packing_name', 'Packing'],
  ['stage_delivery_name', 'Ready for Delivery'],
  ['priority_normal_label', 'Normal'],
  ['priority_urgent_label', 'Urgent'],
  ['session_timeout_hours', '8'],
];

const insertSetting = db.prepare(`
  INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)
`);

for (const user of users) {
  const hashed = bcrypt.hashSync(user.password, 10);
  insert.run(uuidv4(), user.name, user.email, hashed, user.role, user.avatar_color);
  console.log(`✅ Created user: ${user.email} (${user.role}) — password: ${user.password}`);
}

for (const [key, value] of defaultSettings) {
  insertSetting.run(key, value);
}

// Seed sample orders
const sampleOrders = [
  {
    invoice: 'INV-2024-001', customer: 'Kedai Bunga Jaya', contact: '0123456789',
    stage: 'production', priority: 'urgent', daysFromNow: 2
  },
  {
    invoice: 'INV-2024-002', customer: 'Harumni Sdn Bhd', contact: '0187654321',
    stage: 'order', priority: 'normal', daysFromNow: 7
  },
  {
    invoice: 'INV-2024-003', customer: 'Candle World KL', contact: '0165551234',
    stage: 'packing', priority: 'normal', daysFromNow: 5
  },
  {
    invoice: 'INV-2024-004', customer: 'Gift House Subang', contact: '0112223344',
    stage: 'ready_for_delivery', priority: 'urgent', daysFromNow: 1
  },
  {
    invoice: 'INV-2024-005', customer: 'Aromatherapy Plus', contact: '0145556677',
    stage: 'order', priority: 'normal', daysFromNow: 10
  },
];

const admin = db.prepare('SELECT id FROM users WHERE role = "super_admin" LIMIT 1').get();

if (admin) {
  const insertOrder = db.prepare(`
    INSERT OR IGNORE INTO orders
    (id, invoice_number, customer_name, customer_contact, order_date, required_delivery_date, stage, priority, created_by)
    VALUES (?, ?, ?, ?, date('now'), date('now', ?), ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (id, order_id, sku, name, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const o of sampleOrders) {
    const orderId = uuidv4();
    insertOrder.run(orderId, o.invoice, o.customer, o.contact,
      `+${o.daysFromNow} days`, o.stage, o.priority, admin.id);
    insertItem.run(uuidv4(), orderId, 'CND-001', 'Lavender Candle 200g', 100, 'pcs');
    insertItem.run(uuidv4(), orderId, 'CND-002', 'Vanilla Candle 150g', 50, 'pcs');
    console.log(`✅ Created order: ${o.invoice}`);
  }
}

console.log('\n🎉 Seed complete!');
