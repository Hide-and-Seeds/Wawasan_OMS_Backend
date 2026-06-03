// src/utils/db.js
// Postgres (Supabase) data layer. Replaces the old better-sqlite3 connection.
//
// DATABASE_URL should be a Supabase connection-pooler string (Supavisor),
// e.g. the "Transaction" pooler on port 6543 — best for serverless/Vercel:
//   postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
require('dotenv').config();
const { Pool, types } = require('pg');

// Return DATE columns (oid 1082) as plain 'YYYY-MM-DD' strings instead of JS
// Date objects, so the API keeps emitting the date format the frontend expects
// (and we avoid UTC off-by-one shifts when serializing to JSON).
types.setTypeParser(1082, (v) => v);

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL is not set — Postgres queries will fail until it is configured.');
}

let _pool;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase requires TLS. The pooler presents a cert that does not match
      // the hostname, so we don't enforce CA verification here.
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      // Keep the pool small — serverless functions each hold their own pool.
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    _pool.on('error', (err) => console.error('Unexpected idle Postgres client error', err));
  }
  return _pool;
}

// Run a single query. Usage: const { rows } = await query('SELECT ...', [a, b]);
function query(text, params) {
  return getPool().query(text, params);
}

// Run several statements atomically. The callback receives a `q(text, params)`
// bound to a single dedicated client (so BEGIN/COMMIT wrap all of them).
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query, withTransaction };
