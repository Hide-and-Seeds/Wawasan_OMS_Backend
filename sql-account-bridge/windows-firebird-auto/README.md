# SQL Account -> OMS, automatic & near-instant (single-user, NO admin)

For a desktop/single-user SQL Account (embedded Firebird, no server). Reads the
database directly and pushes new invoices to the OMS the moment they're saved -
no manual export, no clicking, no cost, **no admin rights**.

How it works:

```
SQL Account saves an invoice
  -> Watch.ps1 sees the database file change (Windows file-watch)
  -> waits a few seconds for writes to settle
  -> copies the .FDB (safe while the app is open) and reads new invoices with a
     bundled Firebird isql (the confirmed SL_IV + SL_IVDTL query)
  -> POSTs them to the OMS cloud, which parses + de-duplicates
  -> order appears on the board, ~a few seconds after it was saved
```

Everything runs as the logged-in user. No service, no admin.

## Install (one time, on the SQL Account PC)
1. Copy this `windows-firebird-auto` folder onto the PC, e.g. `C:\WawasanOMS-Sync`.
2. Copy `config.example.ps1` to `config.ps1`, open in Notepad, paste the
   **webhook secret** (the backend's `SQL_ACCOUNT_WEBHOOK_SECRET`). Leave
   `$FdbPath` blank to auto-detect, or set it.
3. Open PowerShell in the folder and run:
   ```
   powershell -ExecutionPolicy Bypass -File .\Install.ps1
   ```
   It finds the database, downloads the right Firebird tool (no admin), proves the
   pipe with a dry-run (creates nothing), installs auto-start at logon, and launches.

That's it. New invoices now flow on their own. Watch `%LOCALAPPDATA%\WawasanOMS\sync.log`.

## Test without creating anything
```
powershell -ExecutionPolicy Bypass -File .\Sync-Once.ps1 -DryRun
```

## Turn it off
```
powershell -ExecutionPolicy Bypass -File .\Uninstall.ps1
```
Removes the auto-start and stops the watcher. Add `-Purge` to also delete the
downloaded Firebird tool and the log (your `config.ps1` is kept).

## Notes
- Confirmed against SQL Account ODS13 (Firebird 4/5). If the DB is ODS12 (Firebird 3),
  Install picks Firebird 4; if that download isn't available, install Firebird manually
  and point `$FirebirdDir` at it.
- Assumes 64-bit Windows. Sales invoices are read from `SL_IV` + `SL_IVDTL`
  (cancelled excluded). Money/tax are never sent.
- True sub-second push (vs the few-second file-watch) would need SQL Account in
  multi-user/server mode or the paid eStream SDK - not required for this.
