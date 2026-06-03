// src/utils/migrate.js
// Apply the Postgres schema to your Supabase database.
// Run with: npm run migrate   (requires DATABASE_URL in .env)
//
// Alternatively, paste schema.sql straight into the Supabase SQL Editor.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { getPool } = require('./db');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schema.sql');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Add your Supabase connection string to .env first.');
    process.exit(1);
  }

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const pool = getPool();

  try {
    await pool.query(schema);
    console.log('✅ Database schema applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
