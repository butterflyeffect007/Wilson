# Payments — Silver Harbor

## Stripe (card)

**Payment Link (live):**
```
https://buy.stripe.com/14AbJ3dz26F54974EP7EQ00
```

**Subscribe page:**
```
https://butterflyeffect007.github.io/Wilson/subscribe.html
```

The button on the subscribe page opens the Payment Link directly.

### Optional: gate alerts behind payment
On the Windows machine set:
```powershell
$env:STRIPE_SECRET_KEY = "sk_live_..."
$env:STRIPE_PRICE_ID = "price_..."
```
Then restart the dispatcher. Alerts only fire when there is at least one active subscriber.

## Solana / Phantom

**Receive address** (USDC or SOL):

```
8ErdfNEmpcfmE8Dn3tvUgeSkkQNLf3vQTbfk3Q27m5FH
```

- Network: Solana mainnet
- Wallet: Phantom
- Recommended token: USDC

## Notes

- Never commit secret keys.
- Double-check the Phantom address before sending large amounts.
