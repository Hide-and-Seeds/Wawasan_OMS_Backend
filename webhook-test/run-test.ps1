# run-test.ps1 - send ONE brand-new test invoice to the OMS webhook.
# An order appears in the "Order" column of the board, with no manual typing.
# Easiest way to run: double-click  Run-Test.cmd  (it handles PowerShell for you).

$ErrorActionPreference = "Stop"
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$envFile = Join-Path $here "webhook-test.env"

$url = "https://wawasan-oms-backend.vercel.app/api/orders/webhook/sql-account"
$secret = ""

# Load saved settings (KEY=VALUE per line) if the file exists.
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*([^=]+?)\s*=\s*(.*)$') {
      $k = $matches[1].Trim(); $v = $matches[2].Trim()
      if ($k -eq "WEBHOOK_URL" -and $v) { $url = $v }
      if ($k -eq "WEBHOOK_SECRET") { $secret = $v }
    }
  }
}

# First run: ask for the secret once, then offer to remember it.
if (-not $secret -or $secret -eq "paste-your-secret-here") {
  Write-Host "Webhook secret not set yet." -ForegroundColor Yellow
  Write-Host "Find it in Vercel -> backend project -> Settings -> Environment Variables -> SQL_ACCOUNT_WEBHOOK_SECRET" -ForegroundColor DarkGray
  $secret = Read-Host "Paste the webhook secret"
  if (-not $secret) { Write-Host "No secret entered - stopping." -ForegroundColor Red; return }
  $save = Read-Host "Remember it on this PC so you are not asked again? (y/n)"
  if ($save -eq "y") {
    [System.IO.File]::WriteAllText($envFile, "WEBHOOK_URL=$url`r`nWEBHOOK_SECRET=$secret")
    Write-Host "Saved to webhook-test.env (kept on this PC only)." -ForegroundColor Green
  }
}

# Build a brand-new invoice. The number is unique every run, so it is never a duplicate.
$invoice = "TEST-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$payload = [ordered]@{
  invoice_number = $invoice
  customer_name  = "Test Customer Sdn Bhd"
  order_date     = (Get-Date -Format "yyyy-MM-dd")
  po_ref         = "TEST-PO"
  payment_terms  = "C.O.D."
  notes          = "Created by run-test.ps1 (webhook test - safe to delete)"
  items = @(
    [ordered]@{ sku = "STK006"; name = "FIRE CHICKEN FIRESTARTER (40 BIJI) - 72 BOX/CTN"; quantity = 10; unit = "CTN" }
    [ordered]@{ sku = "STK035"; name = "SERAI LILIN ANTI INSECTS CANDLES - 2PCS/PACK"; quantity = 2; unit = "CTN" }
  )
}
$body = $payload | ConvertTo-Json -Depth 6

Write-Host ""
Write-Host "Sending test invoice $invoice ..." -ForegroundColor Cyan
Write-Host "  -> $url" -ForegroundColor DarkGray
Write-Host ""

try {
  $resp = Invoke-RestMethod -Method Post -Uri $url -Headers @{ "x-webhook-secret" = $secret } -ContentType "application/json" -Body $body
  Write-Host "SUCCESS - the order was created on the board." -ForegroundColor Green
  Write-Host ("  Invoice: {0}" -f $invoice)
  Write-Host "  Open the OMS board - it is the newest card in the 'Order' column."
  Write-Host "  When done testing, open it and use 'Cancel order' to clear it (Boss/Ops)."
} catch {
  $status = $null
  if ($_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch {} }
  $detail = ""
  if ($_.Exception.Response) {
    try {
      $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $detail = $sr.ReadToEnd()
    } catch {}
  }
  Write-Host "IT DID NOT WORK." -ForegroundColor Red
  switch ($status) {
    401 { Write-Host "  Reason: wrong webhook secret. Delete webhook-test.env, run again, paste the correct secret." -ForegroundColor Yellow }
    400 { Write-Host "  Reason: a required field was missing (invoice_number / customer_name)." -ForegroundColor Yellow }
    409 { Write-Host "  Reason: that invoice already exists. Just run again (it makes a fresh number each time)." -ForegroundColor Yellow }
    default {
      if ($status) { Write-Host ("  Server returned HTTP {0}." -f $status) -ForegroundColor Yellow }
      else { Write-Host "  Could not reach the server. Check the internet connection and the URL." -ForegroundColor Yellow }
    }
  }
  if ($detail) { Write-Host ("  Server said: {0}" -f $detail) -ForegroundColor DarkGray }
}
