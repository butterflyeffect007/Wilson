# Wilson End Project

Clean, consolidated layout of everything built in this session.

## Structure

```
Wilson/
├── silverharbor/          # Live Ethereum observation + alerts
│   ├── README.md
│   ├── websocket_connector.cjs
│   ├── evaluator.cjs
│   ├── webhook_dispatcher.cjs   # Stripe paywall
│   └── agent.cjs                 # control plane :3001
├── trading/                # Agentic equity systems (paper only)
│   ├── README.md
│   ├── main.py
│   ├── agentic_AI_portfolio_manager.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── sentiment/             # one-shot news + VIX + PDF
│   │   ├── client_example.py
│   │   ├── requirements.txt
│   │   └── README.md
│   └── ibkr/                  # IBKR adaptation guide
│       ├── how_to.md
│       └── README.md
└── src/lib/
    ├── agent.ts              # Wilson → Silver Harbor control
    └── github.ts             # Wilson → GitHub push helper
```

## Verified working (2026-10-25)

- Silver Harbor agent listening on port 3001
- Connector, evaluator, and dispatcher all startable via the agent
- Live Ethereum blocks flowing into `ethereum_observations.ndjson`
- Anomaly receipts writing to `evaluation_receipts.ndjson` (BLOCK_TIME_GAP detections confirmed)
- Stripe paywall gate present in the dispatcher
- Wilson `agent.ts` client ready (Tailscale IP 100.117.181.95)
- Wilson `github.ts` push helper ready (token stored in localStorage)

## What works today

- Silver Harbor: live blocks → anomaly receipts → optional paid alerts
- Wilson can start/stop the three Silver Harbor processes over Tailscale
- Wilson can push files to this repo once a GitHub token is set in localStorage
- Trading systems are organized; copy full sources from attachments and set keys to run

## Next clean-ups (optional)

- Move the actual `.cjs` scripts into `silverharbor/` (currently they live on the Windows box)
- Add a Windows service or PM2 config so the agent survives reboots
- Wire the portfolio manager as another agent target
