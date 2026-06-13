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

# Where Install.ps1 puts the bundled Firebird tool (no admin).
$FirebirdDir   = "$env:LOCALAPPDATA\WawasanOMS\firebird"

# Responsiveness: after the DB changes, wait this many seconds for writes to settle,
# then send. A safety re-check also runs every N minutes even with no change.
$DebounceSeconds = 4
$SafetyMinutes   = 10

# Log file.
$LogFile       = "$env:LOCALAPPDATA\WawasanOMS\sync.log"
