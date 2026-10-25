/**
 * webhook_dispatcher.cjs
 * Watches evaluation_receipts.ndjson and fires Telegram/Discord alerts
 * on status flips from CLEAN_PASS to PASS_WITH_WARNINGS or VALIDATION_FAILED.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN   (optional)
 *   TELEGRAM_CHAT_ID     (optional)
 *   DISCORD_WEBHOOK_URL  (optional)
 *
 * Place this file in the SilverHarbor folder alongside the other scripts
 * and run: node webhook_dispatcher.cjs
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const RECEIPTS_FILE = path.join(__dirname, 'evaluation_receipts.ndjson');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

let lastStatus = 'CLEAN_PASS';
let lastLineCount = 0;

function post(url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.write(data);
    req.end();
  });
}

async function notify(receipt) {
  const text = [
    `*Silver Harbor Alert*`,
    `Status: ${receipt.status}`,
    `Block: ${receipt.block_number || 'n/a'}`,
    `Gas: ${receipt.gas_price_wei || 'n/a'}`,
    `Reasons: ${(receipt.reasons || []).join(' | ') || 'none'}`,
    `Time: ${receipt.timestamp || new Date().toISOString()}`
  ].join('\n');

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    await post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' }
    );
  }

  if (DISCORD_WEBHOOK_URL) {
    await post(DISCORD_WEBHOOK_URL, { content: text });
  }

  console.log(`[DISPATCH] ${receipt.status} | block ${receipt.block_number}`);
}

function processNewReceipts() {
  if (!fs.existsSync(RECEIPTS_FILE)) return;

  try {
    const lines = fs.readFileSync(RECEIPTS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length <= lastLineCount) return;

    const newLines = lines.slice(lastLineCount);
    lastLineCount = lines.length;

    for (const line of newLines) {
      try {
        const receipt = JSON.parse(line);
        const status = receipt.status || 'CLEAN_PASS';

        if (status !== lastStatus && status !== 'CLEAN_PASS') {
          notify(receipt);
        }
        lastStatus = status;
      } catch (e) {}
    }
  } catch (e) {}
}

console.log('[DISPATCH] Webhook dispatcher started. Watching receipts...');
setInterval(processNewReceipts, 2000);
