import dotenv from 'dotenv';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the local-only file used by Wilson's setup. It is ignored by Git.
dotenv.config({ path: '.env.local' });

const apiKey = process.env.ALCHEMY_API_KEY?.trim();

if (!apiKey) {
  console.error('Missing ALCHEMY_API_KEY. Add it to your local .env.local file; never commit that file.');
  process.exit(1);
}

const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;

async function rpc(method) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
    signal: AbortSignal.timeout(15000),
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`Alchemy returned non-JSON content (HTTP ${response.status}). Check endpoint, network, and API key.`);
  }

  if (!response.ok) {
    throw new Error(`Alchemy HTTP ${response.status}: ${data?.error?.message ?? 'request rejected'}`);
  }
  if (data.error) throw new Error(`Alchemy RPC error: ${data.error.message}`);
  if (data.result == null) throw new Error(`Alchemy response missing result for ${method}`);
  return data.result;
}

async function main() {
  const [blockHex, gasPriceHex] = await Promise.all([
    rpc('eth_blockNumber'),
    rpc('eth_gasPrice'),
  ]);

  const record = {
    schema: 'ethereum_observation_v1',
    id: `ETH_OBS_${Date.now()}`,
    source: 'alchemy',
    network: 'ethereum-mainnet',
    block_number: Number.parseInt(blockHex, 16),
    gas_price_wei: BigInt(gasPriceHex).toString(),
    observed_at: new Date().toISOString(),
    trading_authorized: false,
    paper_only: true,
  };

  appendFileSync(resolve('ethereum_observations.ndjson'), `${JSON.stringify(record)}\n`, 'utf8');
  console.log('Alchemy read succeeded. Observation appended to ethereum_observations.ndjson.');
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error(`Ethereum observation failed: ${error.message}`);
  process.exitCode = 1;
});
