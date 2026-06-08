// src/utils/seed.js
// Seed demo users, settings and sample orders.
// Run with: npm run seed   (requires DATABASE_URL in .env, after `npm run migrate`)

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { getPool, query } = require('./db');

const users = [
  { name: 'Boss',                 email: 'admin@wawasancandle.com',    role: 'super_admin',           password: 'Admin@123',    avatar_color: '#7C3AED' },
  { name: 'Office Admin',         email: 'office@wawasancandle.com',   role: 'admin',                 password: 'Office@123',   avatar_color: '#9333EA' },
  { name: 'Reenee',               email: 'reenee@wawasancandle.com',   role: 'operations_controller', password: 'Reenee@123',   avatar_color: '#0891B2' },
  { name: 'Misha',                email: 'misha@wawasancandle.com',    role: 'production_lead',        password: 'Misha@123',    avatar_color: '#059669' },
  { name: 'Staff Ali',            email: 'ali@wawasancandle.com',      role: 'production_staff',       password: 'Staff@123',    avatar_color: '#D97706' },
  { name: 'Staff Siti',           email: 'siti@wawasancandle.com',     role: 'packing_staff',          password: 'Staff@123',    avatar_color: '#DB2777' },
  { name: 'Delivery Coordinator', email: 'dispatch@wawasancandle.com', role: 'delivery_team',          password: 'Dispatch@123', avatar_color: '#0EA5E9' },
];

// No-login couriers (delivery providers). Managed in-app under Delivery → Couriers.
const deliverers = ['Lazada (LEX)', 'Shopee (SPX)', 'J&T Express', 'Ninja Van', 'Pos Laju', 'City-Link', 'GDex', 'Flash Express', 'DHL', 'Own Driver'];

const defaultSettings = [
  ['stage_order_name', 'Order'],
  ['stage_production_name', 'Production'],
  ['stage_packing_name', 'Packing'],
  ['stage_delivery_name', 'Ready for Delivery'],
  ['priority_normal_label', 'Normal'],
  ['priority_urgent_label', 'Urgent'],
  ['session_timeout_hours', '8'],
];

const sampleOrders = [
  { invoice: 'INV-2024-001', customer: 'Kedai Bunga Jaya', contact: '0123456789', stage: 'production',          priority: 'urgent', importance: 'vip',      daysFromNow: 2 },
  { invoice: 'INV-2024-002', customer: 'Harumni Sdn Bhd',  contact: '0187654321', stage: 'order',               priority: 'normal', importance: 'standard', daysFromNow: 7 },
  { invoice: 'INV-2024-003', customer: 'Candle World KL',  contact: '0165551234', stage: 'packing',             priority: 'normal', importance: 'priority', daysFromNow: 5 },
  { invoice: 'INV-2024-004', customer: 'Gift House Subang',contact: '0112223344', stage: 'ready_for_delivery',  priority: 'urgent', importance: 'vip',      daysFromNow: 1 },
  { invoice: 'INV-2024-005', customer: 'Aromatherapy Plus',contact: '0145556677', stage: 'order',               priority: 'normal', importance: 'standard', daysFromNow: 10 },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Add your Supabase connection string to .env first.');
    process.exit(1);
  }

  const pool = getPool();
  try {
    for (const user of users) {
      const hashed = bcrypt.hashSync(user.password, 10);
      await query(
        `INSERT INTO users (id, name, email, password, role, avatar_color)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO NOTHING`,
        [uuidv4(), user.name, user.email, hashed, user.role, user.avatar_color]
      );
      console.log(`✅ Ensured user: ${user.email} (${user.role}) — password: ${user.password}`);
    }

    for (const name of deliverers) {
      const exists = (await query('SELECT 1 FROM deliverers WHERE name = $1', [name])).rows[0];
      if (!exists) {
        await query('INSERT INTO deliverers (id, name) VALUES ($1, $2)', [uuidv4(), name]);
        console.log(`✅ Ensured deliverer: ${name}`);
      }
    }

    for (const [key, value] of defaultSettings) {
      await query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    const admin = (await query("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1")).rows[0];

    if (admin) {
      for (const o of sampleOrders) {
        const orderId = uuidv4();
        const inserted = (await query(
          `INSERT INTO orders
             (id, invoice_number, customer_name, customer_contact, order_date,
              required_delivery_date, stage, priority, importance, created_by)
           VALUES ($1, $2, $3, $4, CURRENT_DATE,
              CURRENT_DATE + ($5 * INTERVAL '1 day'), $6, $7, $8, $9)
           ON CONFLICT (invoice_number) DO NOTHING
           RETURNING id`,
          [orderId, o.invoice, o.customer, o.contact, o.daysFromNow, o.stage, o.priority, o.importance, admin.id]
        )).rows[0];

        if (inserted) {
          await query(
            `INSERT INTO order_items (id, order_id, sku, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6)`,
            [uuidv4(), orderId, 'CND-001', 'Lavender Candle 200g', 100, 'pcs']
          );
          await query(
            `INSERT INTO order_items (id, order_id, sku, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6)`,
            [uuidv4(), orderId, 'CND-002', 'Vanilla Candle 150g', 50, 'pcs']
          );
          console.log(`✅ Created order: ${o.invoice}`);
        } else {
          console.log(`↩️  Order already exists, skipped: ${o.invoice}`);
        }
      }
    }

    console.log('\n🎉 Seed complete!');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
