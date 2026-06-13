// sql-account-bridge/discover-firebird.mjs
// One-off probe: connect to the SQL Account .FDB and print its tables + the
// columns of the likely sales-invoice tables, so you can fill FB_SQL in .env
// with the REAL names. SQL Account's schema is version-specific - never guess.
//
//   npm install                              # once, pulls node-firebird
//   node --env-file=.env discover-firebird.mjs
//
// Needs the same FB_* vars as the bridge's SOURCE=firebird path (see .env.example).
//
// DOUBLES AS A GO / NO-GO TEST: if this connects and lists tables, the free
// Firebird-direct path is viable. If it errors on login, SQL Account has locked
// the database (changed SYSDBA password / embedded server) and the free path is
// blocked -> the paid SDK Live / Restful API is then the only route.

try { process.loadEnvFile(); } catch { /* rely on real env */ }

let Firebird;
try { ({ default: Firebird } = await import('node-firebird')); }
catch { console.error('node-firebird not installed. Run:  npm install'); process.exit(1); }

const options = {
  host: process.env.FB_HOST || '127.0.0.1',
  port: parseInt(process.env.FB_PORT || '3050', 10),
  database: process.env.FB_DATABASE,            // full path to the .FDB
  user: process.env.FB_USER || 'SYSDBA',
  password: process.env.FB_PASSWORD || 'masterkey',
  lowercase_keys: false,
  encoding: process.env.FB_ENCODING || 'UTF8',
};
if (!options.database) { console.error('Set FB_DATABASE (full path to the .FDB) in .env'); process.exit(1); }

const attach = () => new Promise((res, rej) => Firebird.attach(options, (e, db) => e ? rej(e) : res(db)));
const q = (db, sql, params = []) => new Promise((res, rej) => db.query(sql, params, (e, r) => e ? rej(e) : res(r || [])));

// Table names that usually hold sales invoices / their lines / debtors in SQL Account.
const LIKELY = /(^|_)(IV|INV|INVOICE|SAL|SALE|SALES|DO|DOC|AR|DEBTOR|CUST)/i;

let db;
try {
  db = await attach();
} catch (e) {
  console.error('\nCONNECT FAILED:', e.message);
  console.error('-> If this is an auth/permission error, SQL Account has locked the .FDB.');
  console.error('   The free Firebird-direct path is blocked; use the paid SDK / Restful API.');
  process.exit(1);
}

try {
  const tables = (await q(db,
    `SELECT TRIM(RDB$RELATION_NAME) AS NAME FROM RDB$RELATIONS
     WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL ORDER BY 1`)).map((r) => r.NAME);

  console.log(`\n=== ${tables.length} user tables ===`);
  console.log(tables.join('  '));

  const likely = tables.filter((t) => LIKELY.test(t));
  console.log(`\n=== likely invoice/debtor tables: ${likely.join(', ') || '(none matched - scan the full list above)'} ===`);

  for (const t of likely) {
    const cols = (await q(db,
      `SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS
       WHERE RDB$RELATION_NAME = ? ORDER BY RDB$FIELD_POSITION`, [t])).map((r) => r.NAME);
    let count = '?';
    try { count = (await q(db, `SELECT COUNT(*) AS C FROM "${t}"`))[0].C; } catch { /* perms */ }
    console.log(`\n-- ${t}  (${count} rows)`);
    console.log('   ' + cols.join(', '));
  }

  console.log('\nNext: in .env, build FB_SQL = one row per invoice LINE, joining the header');
  console.log('table (DocNo, Customer, Date, delivery address) to the detail table');
  console.log('(ItemCode, Description, Qty, UOM) on their DOCKEY. Alias columns to: docno,');
  console.log('customer, contact, docdate, po, terms, sku, name, qty, uom, deliveryaddress1..4.');
  console.log('Then SOURCE=firebird and:  npm run dry-run');
} finally {
  db.detach(() => {});
}
