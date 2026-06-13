# config.example.ps1  —  copy to  config.ps1  and edit.
# config.ps1 is gitignored because it holds the secret. Never commit the real one.

# OMS cloud endpoint. Keep the /webhook/sql-account-csv path; change the host
# only if your backend URL is different.
$WebhookUrl    = "https://wawasan-oms-backend.vercel.app/api/orders/webhook/sql-account-csv"

# MUST equal the backend's SQL_ACCOUNT_WEBHOOK_SECRET.
# Same value already sits in ..\.env  (line WEBHOOK_SECRET=) — copy it from there.
$WebhookSecret = "PASTE_THE_WEBHOOK_SECRET_HERE"

# Where SQL Account drops its exported invoice CSV. EITHER:
#   a single file ......... "C:\SQLAccountExports\invoices.csv"
#   OR a folder (newest .csv is sent each run) ... "C:\SQLAccountExports"
$CsvPath       = "C:\SQLAccountExports\invoices.csv"

# Optional log file so you can see what happened on each run.
$LogFile       = "$PSScriptRoot\sync.log"
