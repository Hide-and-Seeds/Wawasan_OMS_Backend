# SQL Account → OMS, on a Windows box with NO Node

For a Windows machine you reach by Remote Desktop where Node is **not** installed.
Uses only **PowerShell** (built into Windows) + **Task Scheduler**. The cloud does
all parsing and de-duplication, so this side stays tiny.

How it flows:

```
SQL Account  --export-->  invoice CSV  --PowerShell POST-->  OMS cloud
                                                             (parse + de-dup + create on board)
```

## One-time setup

1. **Copy this folder** (`windows-no-node`) onto the box, e.g. `C:\OMS-Invoice-Sync`.

2. **Make your config:** copy `config.example.ps1` to `config.ps1`, open it in Notepad, fill in:
   - `$WebhookSecret` — the backend's `SQL_ACCOUNT_WEBHOOK_SECRET` (same value already in `..\.env`).
   - `$CsvPath` — where SQL Account saves its export. A single file **or** a folder (newest `.csv` is sent each run).

3. **Test once.** Open PowerShell in the folder and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\Send-Invoices.ps1
   ```
   Expect a line like `Sent invoices.csv: total=12 created=12 duplicate=0 failed=0`.
   Run it again — now it should say `duplicate=12` (proof the de-dup works; safe to repeat).
   Check the board: the orders are there.

## Schedule it (every 5 minutes)

**Easy command** — paste into Command Prompt (cmd), fix the path:
```cmd
schtasks /Create /TN "OMS Invoice Sync" /SC MINUTE /MO 5 /F ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\OMS-Invoice-Sync\Send-Invoices.ps1\""
```
Change `5` for a different interval. Delete it later with:
`schtasks /Delete /TN "OMS Invoice Sync" /F`

**Or via the Task Scheduler app** (if you prefer clicking):
- Create Task → name it `OMS Invoice Sync`
- **Triggers** → New → *Daily*, then *Repeat task every 5 minutes* for *1 day* (indefinitely)
- **Actions** → New → Program: `powershell`
  Arguments: `-NoProfile -ExecutionPolicy Bypass -File "C:\OMS-Invoice-Sync\Send-Invoices.ps1"`
- General tab → tick **Run whether user is logged on or not** if the box should sync even when nobody's signed in (it asks for the Windows account password).
- Conditions tab → tick **Run task as soon as possible after a scheduled start is missed** (covers reboots/sleep).

## Good to know

- **Safe to re-run.** Re-sending the same CSV just returns `duplicate` for orders already on the board. No double-creates, ever.
- **No prices/tax** leave SQL Account — only invoice no., customer, items, dates.
- **Watch it:** open `sync.log` to see each run's result.
- **Garbled accents?** In `Send-Invoices.ps1`, change `-Encoding UTF8` to `-Encoding Default`.
- **`401 Invalid webhook secret`** → `$WebhookSecret` doesn't match the backend.
- **`No invoice rows found`** → the export's columns weren't recognised; open the CSV and check it has a Doc No and a Customer column.

## The one thing to confirm

This only works if **this box can actually open the CSV** — i.e. SQL Account runs on
this same machine, or exports into a folder this machine can reach (network share,
OneDrive/Drive sync). If it can't, the CSV never arrives and we switch to the
**email-to-board** route instead (SQL Account emails the export; a Google Apps
Script forwards it — nothing installed anywhere).
