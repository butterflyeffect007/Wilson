# Preview isolation (proposal)

## Today
Previews are published to the same GitHub Pages site as the live app
(`https://butterflyeffect007.github.io/Wilson/preview/pr-N/`). Same address = same browser storage, so
preview code *could* read what the live app saved on the phone.

## Done now (this PR)
`src/lib/previewIsolation.ts` no longer copies sign-ins into a preview: account session tokens, the
Architect key/flag, the GitHub token, the push id, and anything credential-shaped stay with the live app.
Old previews that already copied them have those copies removed the next time they open. A preview starts
signed out; harmless settings (theme, voice choice, etc.) still carry over.

## Proposed next step (needs Jenny's OK, nothing changed yet)
Serve previews from a **different address** so the browser keeps them fully separate. (A second GitHub
Pages repo would still live on `butterflyeffect007.github.io`, the same browser origin, so it would not help.)

- **Recommended, free:** Cloudflare Pages project `wilson-previews` →
  `https://pr-N.wilson-previews.pages.dev`. Different origin, so the preview can't see live sign-ins at all.
  The Worker would add `https://*.wilson-previews.pages.dev` to its allowed origins (preview-only Worker
  first). The `preview-pr.yml` workflow would deploy with Wrangler instead of pushing to `gh-pages`.
- **Alternative:** a custom domain for the live app (e.g. `wilson.example`) and keep previews on github.io.
  Costs a domain, so not preferred.
