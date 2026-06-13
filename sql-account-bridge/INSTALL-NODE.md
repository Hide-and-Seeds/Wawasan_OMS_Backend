# Install Node on the box (for the auto + instant Firebird path)

Goal: read invoices straight from SQL Account's Firebird database, so an invoice
keyed in SQL Account lands on the OMS board within seconds - **no manual export**.
That needs Node on the on-prem PC (the CSV relay does not; this does).

`node-firebird` is **pure JavaScript** - no Visual Studio / build tools needed.

## 0. Before you start
- You need **local admin** on the box to install Node.
- Best if Node goes on the **same PC that runs SQL Account** (then the DB is at
  `127.0.0.1:3050` - no network/firewall to open).

## 1. Install Node LTS
**Option A - installer (simplest):**
1. On the box, open https://nodejs.org and download the **Windows Installer (.msi), LTS**.
2. Run it - accept defaults (it adds Node to PATH automatically).
3. Close and reopen PowerShell.

**Option B - if `winget` is available:**
```
winget install OpenJS.NodeJS.LTS
```

**Verify:**
```
node -v      # expect v20.x or newer
npm -v
```

## 2. Pull the Firebird driver
In the bridge folder (copy `sql-account-bridge\` onto the box):
```
npm install            # installs node-firebird (pure JS, no compiler)
```

## 3. Find the real table names  (GO / NO-GO test)
SQL Account's table names are version-specific - we confirm them, never guess.
Fill the `FB_*` lines in `.env` (see `.env.example`), then:
```
npm run discover
```
- **It lists tables + columns** -> the free Firebird path works. Send me the output
  and I'll write `FB_SQL`.
- **It fails to log in** -> SQL Account has locked the database. Free path is blocked;
  we'd switch to the paid SDK / Restful API.

## 4. Wire + test
1. Put the confirmed `FB_SQL` in `.env`, set `SOURCE=firebird`, `FB_SINCE_DAYS=7`.
2. Preview (sends nothing): `npm run dry-run`
3. Go live near-instant: set `POLL_SECONDS=20` and keep it running (Task Scheduler
   every minute, or `nssm`/`pm2` as a service).

## What I still need from the box
- `FB_DATABASE` = full path to the `.FDB` (e.g. `C:\eStream\SQLAccounting\Share\YOURCO.FDB`)
- A DB user + password that can read it (SQL Account may not allow plain `SYSDBA` -
  step 3 tells us)
- Confirm the Firebird service is running and the port (default `3050`)
