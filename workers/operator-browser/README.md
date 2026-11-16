# wilson-operator-browser (optional)

A tiny Cloudflare Worker that gives Operator mode a **real browser**, so Wilson can click actual buttons, type into forms and show you a live picture of the page. Without it, Operator still searches, reads pages and follows links ("Reading mode").

- Runs on **Cloudflare Browser Run** (headless Chrome), included in the **Workers Free plan**: about **10 browser minutes a day**, 3 browsers at once, **no card**. When the day's minutes are used up, Operator says so and you can keep going in Reading mode (minutes reset at midnight UTC).
- Uses the Cloudflare account you already have for `wilson-proxy`, so no new account.
- Stores nothing. Browser sessions close after about 2 minutes idle.
- Refuses on its own to type into password, card or one-time-code fields (the app also asks you before any submit, purchase, send, sign-in or delete).

## Set it up from your phone (no computer needed)

1. **Pick a long random key** (at least 16 characters, e.g. from your password manager). This is your *Operator browser key*.
2. **Cloudflare API token:** Cloudflare dashboard → My Profile → API Tokens → Create Token → template **"Edit Cloudflare Workers"** → Create. Copy it. Also copy your **Account ID** (Workers & Pages overview, right side).
3. **GitHub secrets:** this repo → Settings → Secrets and variables → Actions → New repository secret, three times:
   - `CLOUDFLARE_API_TOKEN` = the token from step 2
   - `CLOUDFLARE_ACCOUNT_ID` = your account ID
   - `OPERATOR_TOKEN` = your key from step 1
4. **Deploy:** repo → Actions → "Deploy Operator live browser (optional)" → Run workflow. When it finishes, the log shows the address, like `https://wilson-operator-browser.<your-subdomain>.workers.dev`.
5. **Connect Wilson:** open Operator → ⚙︎ → paste the address into *Live browser address* and your key into *Live browser key* → Save. The chip at the top switches to **🌐 Live browser**.

If the deploy step complains about permissions, edit the API token and add **Account → Browser Rendering → Edit**.

## Developer notes

- `src/actions.js` holds the page logic in plain Puppeteer calls; `src/index.js` is the Worker (auth, CORS, sessions).
- Local check against real Chrome: `npm i --no-save puppeteer-core && node tests/operator/browser-actions.local.mjs` from the repo root.
- `ALLOWED_ORIGINS` in `wrangler.toml` limits which sites may call it (default: `https://butterflyeffect007.github.io`).
- Deploy by hand instead: `cd workers/operator-browser && npm install && npx wrangler secret put OPERATOR_TOKEN && npx wrangler deploy`.
