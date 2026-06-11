/**
 * Wawasan LTS — Email-to-Board
 * ----------------------------------------------------------------------------
 * Watches a Gmail inbox for invoice CSV attachments and posts each one to the
 * OMS, which creates the orders on the board (duplicates auto-skip).
 *
 * Runs on Google's cloud — FREE, and nothing is installed on the factory PC.
 * SQL Account (or a person) emails the invoice CSV to the inbox; this script,
 * on a 5-minute timer, picks it up and sends it to the cloud.
 *
 * SETUP (one time): see EMAIL-TO-BOARD-SETUP.md. In short —
 *   1. script.google.com → New project → paste this file.
 *   2. Fill WEBHOOK_SECRET below (the same SQL_ACCOUNT_WEBHOOK_SECRET the
 *      backend uses). Adjust SEARCH_QUERY if needed.
 *   3. Run installTrigger() once and approve the Gmail permission.
 * ----------------------------------------------------------------------------
 */

// ── Config ───────────────────────────────────────────────────────────────────
const WEBHOOK_URL    = 'https://wawasan-oms-backend.vercel.app/api/orders/webhook/sql-account-csv';
const WEBHOOK_SECRET = 'PASTE_SQL_ACCOUNT_WEBHOOK_SECRET_HERE';   // must equal the backend env var

// Which emails to look at. Gmail search syntax. Keep it tight so only invoice
// mails match — e.g. add  from:accounts@yourcompany.com  or  subject:Invoice.
const SEARCH_QUERY = 'is:unread has:attachment filename:csv';

// Labels used to mark handled / failed threads so they are never re-imported.
const DONE_LABEL  = 'OMS-Imported';
const ERROR_LABEL = 'OMS-Error';

const MAX_THREADS_PER_RUN = 25;   // safety cap per 5-min run

// ── Main: called by the time trigger ─────────────────────────────────────────
function pollInbox() {
  if (WEBHOOK_SECRET === 'PASTE_SQL_ACCOUNT_WEBHOOK_SECRET_HERE') {
    throw new Error('Set WEBHOOK_SECRET first (see EMAIL-TO-BOARD-SETUP.md).');
  }
  const doneLabel = getOrCreateLabel_(DONE_LABEL);
  const errLabel  = getOrCreateLabel_(ERROR_LABEL);
  const threads = GmailApp.search(SEARCH_QUERY, 0, MAX_THREADS_PER_RUN);

  threads.forEach(function (thread) {
    var threadOk = true;
    thread.getMessages().forEach(function (msg) {
      if (!msg.isUnread()) return;
      var csvs = msg.getAttachments().filter(function (a) {
        return /\.csv$/i.test(a.getName()) || a.getContentType() === 'text/csv';
      });
      if (!csvs.length) return;

      csvs.forEach(function (att) {
        try {
          var csv = att.getDataAsString();
          var resp = UrlFetchApp.fetch(WEBHOOK_URL, {
            method: 'post',
            contentType: 'application/json',
            headers: { 'x-webhook-secret': WEBHOOK_SECRET },
            payload: JSON.stringify({ csv: csv }),
            muteHttpExceptions: true,
          });
          var code = resp.getResponseCode();
          if (code < 200 || code >= 300) {
            threadOk = false;
            Logger.log('POST %s for %s: %s', code, att.getName(), resp.getContentText());
          } else {
            Logger.log('OK %s: %s', att.getName(), resp.getContentText());
          }
        } catch (e) {
          threadOk = false;
          Logger.log('Error on %s: %s', att.getName(), e);
        }
      });

      msg.markRead();   // so it is not picked up again next run
    });
    thread.addLabel(threadOk ? doneLabel : errLabel);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// Run ONCE to create the 5-minute trigger (and to grant the Gmail permission).
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollInbox') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollInbox').timeBased().everyMinutes(5).create();
  Logger.log('Trigger installed: pollInbox every 5 minutes.');
}

// Optional: run by hand to test the wiring once (processes the inbox immediately).
function runOnce() { pollInbox(); }
