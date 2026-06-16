# config.example.ps1 - copy to config.ps1 and edit. config.ps1 is gitignored (holds the secret).
# ASCII only.

# OMS cloud endpoint - keep the path.
$WebhookUrl    = "https://wawasan-oms-backend.vercel.app/api/orders/webhook/sql-account-csv"

# MUST equal the backend SQL_ACCOUNT_WEBHOOK_SECRET.
$WebhookSecret = "PASTE_THE_WEBHOOK_SECRET_HERE"

# Full path to the SQL Account database (.FDB). Leave "" to auto-detect under C:\eStream.
$FdbPath       = ""

# Only send invoices dated within this many days (keeps each send small; the cloud de-dups).
$DaysBack      = 30

# Invoices per POST batch (prevents huge first-time payloads -> Vercel 413 on backfills).
$BatchInvoices = 25

# Where Install.ps1 puts the bundled Firebird tool (no admin).
$FirebirdDir   = "$env:LOCALAPPDATA\WawasanOMS\firebird"

# Responsiveness: check the DB file for changes every PollSeconds; after a change,
# wait DebounceSeconds for writes to settle, then send. A safety re-check also runs
# every SafetyMinutes even with no detected change. (Firebird saves are detected by
# polling the file timestamp - FileSystemWatcher does not fire on its memory-mapped writes.)
$PollSeconds     = 5
$DebounceSeconds = 4
$SafetyMinutes   = 10

# Log file.
$LogFile       = "$env:LOCALAPPDATA\WawasanOMS\sync.log"
