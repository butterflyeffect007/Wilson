# Payments — Silver Harbor

## Stripe (card)

**Publishable key (test):**
```
pk_test_51UUM9uET7kb1wx0eWZ2HUWLHkVskOmkzUz0Z515RQfiCThWuteFUFEfxcX4TVxa0WNTHcB9bsSqwA9ZHoPvcMxnc00Tk3GLID4
```

**Subscribe page:**
```
https://butterflyeffect007.github.io/Wilson/subscribe.html
```

### Setup remaining
1. Create a product + recurring price in the Stripe dashboard.
2. Copy the Price ID (`price_...`).
3. Replace `price_REPLACE_ME` in `public/subscribe.html`.
4. Set on the Windows agent machine:
   ```powershell
   $env:STRIPE_SECRET_KEY = "sk_test_..."
   $env:STRIPE_PRICE_ID = "price_..."
   ```
5. Restart the dispatcher.

## Solana / Phantom

**Receive address** (USDC or SOL):

```
8ErdfNEmpcfmE8Dn3tvUgeSkkQNLf3vQTbfk3Q27m5FH
```

- Network: Solana mainnet
- Wallet: Phantom
- Recommended token: USDC

## Notes

- Test key is safe to expose.
- Never commit the secret key (`sk_test_` or `sk_live_`).
- Double-check the Phantom address before sending large amounts.
