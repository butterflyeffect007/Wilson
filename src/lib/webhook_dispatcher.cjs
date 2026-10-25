/**
 * webhook_dispatcher.cjs
 * Watches evaluation_receipts.ndjson and fires Telegram/Discord alerts
 * on status flips. Gated by Stripe so only paid subscribers receive alerts.
 *
 * Env vars:
 *   STRIPE_SECRET_KEY     (required for paywall)
 *   STRIPE_PRICE_ID       (the price ID of your alert subscription)
 *   TELEGRAM_BOT_TOKEN    (optional)
 *   TELEGRAM_CHAT_ID      (optional — or use a channel)
 *   DISCORD_WEBHOOK_URL   (optional)
 *
 * Run: node webhook_dispatcher.cjs
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const RECEIPTS_FILE = path.join(__dirname, 'evaluation_receipts.ndjson');
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

let lastStatus = 'CLEAN_PASS';
let lastLineCount = 0;
let paidCustomers = new Set();

function stripeGet(path) {
  return new Promise((resolve) => {
    if (!STRIPE_SECRET_KEY) return resolve(null);
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function refreshPaidCustomers() {
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) return;
  const subs = await stripeGet(`/v1/subscriptions?price=${STRIPE_PRICE_ID}&status=active&limit=100`);
  if (!subs || !subs.data) return;
  paidCustomers = new Set(subs.data.map(s => s.customer));
  console.log(`[DISPATCH] ${paidCustomers.size} paid subscribers`);
}

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
  // Paywall: only send if there is at least one paid subscriber
  // (For a shared channel this is enough. For per-user DMs, expand later.)
  if (STRIPE_SECRET_KEY && paidCustomers.size === 0) {
    console.log('[DISPATCH] No paid subscribers — alert suppressed');
    return;
  }

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

  console.log(`[DISPATCH] ${receipt.status} | block ${receipt.block_number} | sent to ${paidCustomers.size || 'all'} subscribers`);
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

console.log('[DISPATCH] Webhook dispatcher started (Stripe paywall enabled).');
refreshPaidCustomers();
setInterval(refreshPaidCustomers, 5 * 60 * 1000); // refresh every 5 min
setInterval(processNewReceipts, 2000);
