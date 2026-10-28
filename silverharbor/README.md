# Silver Harbor

Live Ethereum observation + anomaly detection + alert stack, controllable by Wilson.

## Components

| Script | Role |
|--------|------|
| `websocket_connector.cjs` | WebSocket `newHeads` feeder → `ethereum_observations.ndjson` |
| `evaluator.cjs` | Rolling 1h anomaly rules (gaps, surges) → `evaluation_receipts.ndjson` |
| `webhook_dispatcher.cjs` | Status-flip alerts (Telegram/Discord) with Stripe paywall |
| `agent.cjs` | HTTP control plane (start/stop/status) on port 3001 |

## Docker (recommended)

```powershell
cd silverharbor
copy .env.example .env
# edit .env and put your Alchemy key
docker compose up -d --build
```

Check logs:
```powershell
docker compose logs -f
```

## Manual (Windows)

```powershell
cd silverharbor
npm install
$env:ETH_WS_URL = "wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
$env:AGENT_SECRET = "wilson-secret-change-me"
node agent.cjs
```

In another window:

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3001/cmd `
  -Headers @{ "x-secret" = "wilson-secret-change-me" } `
  -ContentType "application/json" `
  -Body '{"action":"start","target":"connector"}'
```

Repeat for `evaluator` and `dispatcher`.

## Env vars

See `.env.example`.

## Wilson control

See `src/lib/agent.ts` in the main Wilson app.
