# Wilson self-fix worker module

Prepared only. Do **not** deploy and do **not** set the secret until Jenny says yes.

This module adds Architect-only endpoints on the existing `wilson-proxy` worker:

- `POST /admin/selffix/propose` — create a branch, commit proposed `src/` or `public/` files, open a PR
- `POST /admin/selffix/:id/approve` — merge the PR (goes live via the existing Pages deploy)
- `POST /admin/selffix/:id/decline` — close the PR
- `POST /admin/selffix/:id/undo` — restore the previous contents, open a revert PR, merge it
- `GET  /admin/selffix/:id` — read the stored proposal

Auth is the same Architect path the app already uses (`isAdminAuth`: Bearer `ADMIN_KEY` or an architect `wsess_` session). Non-architects are rejected by `handleAdminApi` before this module runs.

## Install (when approved)

In the `wilson-proxy` repo:

1. Copy `selffix.js` to `src/selffix.js`.
2. Apply `hook-snippet.js`: import `handleSelfFix` and delegate `/admin/selffix` *after* `isAdminAuth` succeeds.
3. Create a fine-grained GitHub PAT (see scopes below) and store it only as a Wrangler secret named `GH_SELFFIX_TOKEN`. Never commit it, never put it in the Wilson app, never log it.

```bash
cd /path/to/wilson-proxy
npx wrangler secret put GH_SELFFIX_TOKEN
npx wrangler deploy
```

## Token scopes

Fine-grained personal access token, repository access **only** `butterflyeffect007/Wilson`:

- **Contents**: Read and write (branches, commits, file contents)
- **Pull requests**: Read and write (open, merge, close)

Metadata read is implicit. Do not grant other repos, administration, workflows, or secrets.

## Guardrails baked in

- Writes only to `butterflyeffect007/Wilson`
- Paths must start with `src/` or `public/`
- Blocked: `..`, `.github/`, `workers/`, `wrangler.toml`, `.env*`, `.git`, and any path whose name looks like a secret, token, or credential
- Max 20 files, 200 KB each
- The token is never included in responses or error text

## Preview

PR previews are a separate GitHub Action in the Wilson repo (`.github/workflows/preview-pr.yml`). That workflow also stays off `main` until Jenny approves. It publishes to `/Wilson/preview/pr-N/` with `keep_files: true` and does **not** use `force_orphan`, so it will not replace the live site. The existing `deploy-pages.yml` is unchanged.
