// src/utils/reset-passwords.js
// One-shot: set EVERY user's login password to a single shared value (boss request).
//
//   npm run reset-passwords            → sets the default shared password
//   npm run reset-passwords -- newpass → sets "newpass" for everyone
//
// ⚠ Security trade-off: all accounts share one secret, so signing in no longer
// proves who a person is. The audit log still records the account that acted,
// but anyone with the password can sign in as anyone. This is intentional for
// this deployment. Keep `seed.js`'s SHARED_PASSWORD in sync if you change it.

const bcrypt = require('bcryptjs');
require('dotenv').config();
const { getPool, query } = require('./db');

const SHARED_PASSWORD = process.argv[2] || 'wawasan123';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Add your Supabase connection string to .env first.');
    process.exit(1);
  }
  const pool = getPool();
  try {
    const hashed = bcrypt.hashSync(SHARED_PASSWORD, 10);
    const res = await query('UPDATE users SET password = $1, updated_at = now()', [hashed]);
    console.log(`✅ Set the same password on ${res.rowCount} user account(s).`);
    console.log(`   Everyone now logs in with: ${SHARED_PASSWORD}`);
  } catch (err) {
    console.error('❌ Reset failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
