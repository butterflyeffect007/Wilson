// Drop-in hook for wilson-proxy. Copy src from selffix.js and add these two edits.
// Do not deploy until Jenny approves. Do not put a GitHub token in app code or this repo.

// src/index.js — already routes /admin/* to handleAdminApi after CORS + OPTIONS.
// No change required there if handleAdminApi delegates as below.

// src/beta.js
import { handleSelfFix } from "./selffix.js";

// Inside handleAdminApi, AFTER isAdminAuth succeeds, BEFORE other /admin routes:
if (url.pathname.startsWith("/admin/selffix")) {
  return handleSelfFix(req, env, url, h);
}
