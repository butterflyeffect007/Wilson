# Payments — Silver Harbor

## Solana / Phantom

**Receive address** (USDC or SOL):

```
8ErdfNEmpcfmE8Dn3tvUgeSkkQNLf3vQTbfk3Q27m5FH
```

- Network: Solana mainnet
- Wallet: Phantom
- Recommended token: USDC

### How to pay
1. Open Phantom
2. Send USDC (or SOL) to the address above
3. Include a memo if you want the payment tied to a specific alert tier

## Stripe (card)

Stripe paywall is already wired in `webhook_dispatcher.cjs`.
Create a product + price in the Stripe dashboard, then set:

```powershell
$env:STRIPE_SECRET_KEY = "sk_live_..."
$env:STRIPE_PRICE_ID = "price_..."
```

Alerts only fire when there is at least one active subscriber.

## Notes

- This address is public and safe to share.
- Never share your seed phrase or private key.
- Double-check the address before sending large amounts.
