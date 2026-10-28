// multimodal_normalizer.cjs
// Builds unified training vectors from on-chain observations + market ticks
const fs = require('fs');
const path = require('path');

const OBS_FILE = path.join(__dirname, 'ethereum_observations.ndjson');
const MARKET_FILE = path.join(__dirname, 'market_ticks.ndjson');
const VECTOR_FILE = path.join(__dirname, 'unified_vectors.ndjson');

const WINDOW_MS = 60 * 60 * 1000;
const ALIGN_MS = 30 * 1000;

let onchainWindow = [];
let marketWindow = [];

function robustStats(values) {
  if (!values.length) return { median: 0, mad: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const absDev = values.map(v => Math.abs(v - median));
  const mad = absDev.sort((a, b) => a - b)[Math.floor(absDev.length / 2)] || 1;
  return { median, mad };
}

function zscore(value, stats) {
  return (value - stats.median) / (stats.mad || 1);
}

function loadWindow(file, windowArr, now) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const t = new Date(obj.timestamp).getTime();
      if (now - t <= WINDOW_MS) windowArr.push(obj);
    } catch (_) {}
  }
  windowArr.splice(0, windowArr.length, ...windowArr.filter(o => now - new Date(o.timestamp).getTime() <= WINDOW_MS));
}

function findNearestMarket(ts) {
  let best = null;
  let bestDelta = ALIGN_MS + 1;
  for (const tick of marketWindow) {
    const delta = Math.abs(new Date(tick.timestamp).getTime() - ts);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = tick;
    }
  }
  return bestDelta <= ALIGN_MS ? best : null;
}

function buildVector(obs) {
  const now = Date.now();
  loadWindow(OBS_FILE, onchainWindow, now);
  loadWindow(MARKET_FILE, marketWindow, now);

  const ts = new Date(obs.timestamp).getTime();
  const market = findNearestMarket(ts);

  const gasVals = onchainWindow.map(o => Number(o.gas_price_wei) || 0);
  const gapVals = [];
  for (let i = 1; i < onchainWindow.length; i++) {
    const dt = (new Date(onchainWindow[i].timestamp) - new Date(onchainWindow[i-1].timestamp)) / 1000;
    gapVals.push(dt);
  }
  const gasStats = robustStats(gasVals);
  const gapStats = robustStats(gapVals.length ? gapVals : [12]);

  const gas_z = zscore(Number(obs.gas_price_wei) || 0, gasStats);
  const gap_z = zscore(12, gapStats);

  let return_z = 0, volume_z = 0, spread_z = 0, mask_market = 0;
  if (market) {
    const returns = [];
    const volumes = marketWindow.map(t => Number(t.volume) || 0);
    const spreads = marketWindow.map(t => Number(t.spread) || 0);
    for (let i = 1; i < marketWindow.length; i++) {
      const p0 = Number(marketWindow[i-1].price) || 1;
      const p1 = Number(marketWindow[i].price) || 1;
      returns.push((p1 - p0) / p0);
    }
    const retStats = robustStats(returns.length ? returns : [0]);
    const volStats = robustStats(volumes);
    const sprStats = robustStats(spreads);

    const prev = marketWindow[marketWindow.length - 2];
    const ret = prev ? (Number(market.price) - Number(prev.price)) / (Number(prev.price) || 1) : 0;
    return_z = zscore(ret, retStats);
    volume_z = zscore(Number(market.volume) || 0, volStats);
    spread_z = zscore(Number(market.spread) || 0, sprStats);
    mask_market = 1;
  }

  const cross_1 = gas_z * Math.abs(return_z);
  const cross_2 = gap_z * volume_z;
  const cross_3 = (gas_z > 2 ? 1 : 0) * (Math.abs(return_z) > 1 ? 1 : 0);

  const vector = {
    timestamp: obs.timestamp,
    block_number: obs.block_number,
    features: [gas_z, gap_z, return_z, volume_z, spread_z, cross_1, cross_2, cross_3, 1, mask_market]
  };

  fs.appendFileSync(VECTOR_FILE, JSON.stringify(vector) + '\n');
  return vector;
}

module.exports = { buildVector };
