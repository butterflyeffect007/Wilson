/**
 * Architect-only self-fix API for wilson-proxy.
 *
 * Hook (after isAdminAuth in handleAdminApi):
 *   if (url.pathname.startsWith("/admin/selffix")) return handleSelfFix(req, env, url, h);
 *
 * GitHub token is read ONLY from env.GH_SELFFIX_TOKEN (a Wrangler secret).
 * Never log, echo, or return that value.
 *
 * Writes are locked to butterflyeffect007/Wilson and to src/ and public/ paths.
 */

const REPO = "butterflyeffect007/Wilson";
const API = `https://api.github.com/repos/${REPO}`;
const UA = "wilson-proxy-selffix";
const MAX_FILES = 20;
const MAX_BYTES = 200_000;
const KV_PREFIX = "selffix:";

const j = (o, s, h = {}) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...h } });

function token(env) {
  const t = env && env.GH_SELFFIX_TOKEN;
  if (!t || typeof t !== "string" || !t.trim()) return null;
  return t.trim();
}

export function allowedSelfFixPath(raw) {
  if (typeof raw !== "string") return { ok: false, error: "Invalid path." };
  const p = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!p || p.includes("\0") || p.includes("//")) return { ok: false, error: "Invalid path." };
  if (p.split("/").some((part) => part === ".." || part === "." || part === ".git")) {
    return { ok: false, error: "Path is not allowed." };
  }
  if (!/^(src|public)\//.test(p)) return { ok: false, error: "Writes are limited to src/ and public/." };
  if (p.startsWith(".github/") || p.includes("/.github/")) return { ok: false, error: "Path is not allowed." };
  if (p.startsWith("workers/") || p.includes("/workers/")) return { ok: false, error: "Path is not allowed." };
  if (/(^|\/)wrangler\.toml$/i.test(p)) return { ok: false, error: "Path is not allowed." };
  if (/(^|\/)\.env($|\.)/i.test(p)) return { ok: false, error: "Path is not allowed." };
  if (/(^|\/)\.git(\/|$)/i.test(p)) return { ok: false, error: "Path is not allowed." };
  if (/(^|\/)(secrets?|credentials?)(\/|$|\.)/i.test(p)) return { ok: false, error: "Path is not allowed." };
  if (/token|secret|credential/i.test(p)) return { ok: false, error: "Path is not allowed." };
  return { ok: true, path: p };
}


function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromBase64(b64) {
  const bin = atob(String(b64 || "").replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function slugify(title) {
  const s = String(title || "update")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "update";
  return `${s}-${Date.now().toString(36)}`;
}

async function gh(env, method, path, body) {
  const tok = token(env);
  if (!tok) throw Object.assign(new Error("Self-fix is not configured yet."), { status: 503 });
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/vnd.github+json",
      "User-Agent": UA,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const status = res.status === 401 || res.status === 403 ? 502 : res.status >= 400 && res.status < 500 ? 400 : 502;
    throw Object.assign(new Error("GitHub request failed."), { status });
  }
  return data;
}

async function getFile(env, path, ref) {
  const tok = token(env);
  const res = await fetch(`${API}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`, {
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/vnd.github+json",
      "User-Agent": UA,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error("GitHub request failed."), { status: 502 });
  const data = await res.json();
  if (data.type !== "file" || typeof data.content !== "string") return null;
  const text = fromBase64(data.content);
  return { sha: data.sha, content: text };
}

async function putFile(env, { path, content, branch, message, sha }) {
  return gh(env, "PUT", `/contents/${encodeURI(path)}`, {
    message,
    content: toBase64(content),
    branch,
    ...(sha ? { sha } : {}),
  });
}

async function deleteFile(env, { path, branch, message, sha }) {
  return gh(env, "DELETE", `/contents/${encodeURI(path)}`, { message, branch, sha });
}

async function loadRecord(env, id) {
  const raw = await env.WILSON_KV.get(KV_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}

async function saveRecord(env, rec) {
  await env.WILSON_KV.put(KV_PREFIX + rec.id, JSON.stringify(rec));
}

function previewUrl(pr) {
  return `https://butterflyeffect007.github.io/Wilson/preview/pr-${pr}/`;
}

function publicView(rec) {
  return {
    id: rec.id,
    title: rec.title,
    summary: rec.summary,
    changelogTitle: rec.changelogTitle,
    changelogBody: rec.changelogBody,
    files: rec.files.map((f) => ({ path: f.path, status: f.status })),
    diff: rec.diff || [],
    previewUrl: rec.previewUrl,
    prNumber: rec.prNumber,
    status: rec.status,
    liveAt: rec.liveAt,
  };
}

async function propose(req, env, h) {
  if (!token(env)) return j({ error: "Self-fix is not configured yet." }, 503, h);
  let b = {};
  try { b = await req.json(); } catch { return j({ error: "Invalid JSON." }, 400, h); }
  const title = String(b.title || "").trim().slice(0, 120);
  const summary = String(b.summary || "").trim().slice(0, 2000);
  if (!title || !summary) return j({ error: "Title and summary are required." }, 400, h);
  const incoming = Array.isArray(b.files) ? b.files : [];
  if (!incoming.length || incoming.length > MAX_FILES) return j({ error: "Provide 1–20 files." }, 400, h);

  const files = [];
  for (const f of incoming) {
    const check = allowedSelfFixPath(f && f.path);
    if (!check.ok) return j({ error: check.error }, 400, h);
    if (typeof f.content !== "string" && f.status !== "deleted") {
      return j({ error: "Each file needs its new content." }, 400, h);
    }
    if (typeof f.content === "string" && f.content.length > MAX_BYTES) {
      return j({ error: "A file is too large." }, 400, h);
    }
    files.push({
      path: check.path,
      status: f.status === "added" || f.status === "deleted" ? f.status : "edited",
      content: typeof f.content === "string" ? f.content : "",
    });
  }

  const repo = await gh(env, "GET", "");
  const defaultBranch = repo.default_branch || "main";
  if (repo.full_name !== REPO) return j({ error: "Unexpected repository." }, 500, h);
  const ref = await gh(env, "GET", `/git/ref/heads/${defaultBranch}`);
  const baseSha = ref.object && ref.object.sha;
  if (!baseSha) return j({ error: "Could not read the default branch." }, 502, h);

  for (const f of files) {
    const cur = await getFile(env, f.path, defaultBranch);
    f.previousContent = cur ? cur.content : null;
    f.previousSha = cur ? cur.sha : null;
    if (f.status !== "deleted" && f.status !== "added") {
      f.status = cur ? "edited" : "added";
    }
  }

  const slug = slugify(title);
  const branch = `selffix/${slug}`;
  await gh(env, "POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: baseSha });

  const message = `selffix: ${title}`;
  for (const f of files) {
    if (f.status === "deleted") {
      if (f.previousSha) await deleteFile(env, { path: f.path, branch, message, sha: f.previousSha });
    } else {
      const cur = await getFile(env, f.path, branch);
      await putFile(env, { path: f.path, content: f.content, branch, message, sha: cur ? cur.sha : undefined });
    }
  }

  const pr = await gh(env, "POST", "/pulls", {
    title,
    head: branch,
    base: defaultBranch,
    body: `${summary}\n\nProposed by Wilson. Nothing goes live until the Architect approves.`,
  });

  const rec = {
    id: slug,
    title,
    summary,
    changelogTitle: String(b.changelogTitle || title).slice(0, 120),
    changelogBody: String(b.changelogBody || summary).slice(0, 2000),
    files,
    diff: Array.isArray(b.diff) ? b.diff.slice(0, 400) : [],
    branch,
    base: defaultBranch,
    prNumber: pr.number,
    previewUrl: previewUrl(pr.number),
    status: "review",
    createdAt: new Date().toISOString(),
  };
  await saveRecord(env, rec);
  return j(publicView(rec), 200, h);
}

async function approve(env, rec, h) {
  if (rec.status !== "review") return j({ error: "This update is not waiting for review." }, 400, h);
  await gh(env, "PUT", `/pulls/${rec.prNumber}/merge`, {
    merge_method: "squash",
    commit_title: `selffix: ${rec.title}`,
  });
  rec.status = "live";
  rec.liveAt = new Date().toISOString();
  await saveRecord(env, rec);
  return j(publicView(rec), 200, h);
}

async function decline(env, rec, h) {
  if (rec.status !== "review") return j({ error: "This update is not waiting for review." }, 400, h);
  await gh(env, "PATCH", `/pulls/${rec.prNumber}`, { state: "closed" });
  rec.status = "declined";
  await saveRecord(env, rec);
  return j(publicView(rec), 200, h);
}

async function undo(env, rec, h) {
  if (rec.status !== "live") return j({ error: "Only a live update can be undone." }, 400, h);
  const repo = await gh(env, "GET", "");
  const defaultBranch = rec.base || repo.default_branch || "main";
  const ref = await gh(env, "GET", `/git/ref/heads/${defaultBranch}`);
  const baseSha = ref.object.sha;
  const branch = `selffix/undo-${rec.id}`;
  await gh(env, "POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: baseSha });
  const message = `selffix: undo ${rec.title}`;
  for (const f of rec.files) {
    const check = allowedSelfFixPath(f.path);
    if (!check.ok) return j({ error: check.error }, 400, h);
    const cur = await getFile(env, f.path, branch);
    if (f.previousContent == null) {
      if (cur) await deleteFile(env, { path: f.path, branch, message, sha: cur.sha });
    } else {
      await putFile(env, { path: f.path, content: f.previousContent, branch, message, sha: cur ? cur.sha : undefined });
    }
  }
  const pr = await gh(env, "POST", "/pulls", {
    title: `Undo: ${rec.title}`,
    head: branch,
    base: defaultBranch,
    body: "Undoes a self-fix update after Architect approval.",
  });
  await gh(env, "PUT", `/pulls/${pr.number}/merge`, {
    merge_method: "squash",
    commit_title: `selffix: undo ${rec.title}`,
  });
  rec.status = "undone";
  rec.undoPrNumber = pr.number;
  rec.undoneAt = new Date().toISOString();
  await saveRecord(env, rec);
  return j(publicView(rec), 200, h);
}

export async function handleSelfFix(req, env, url, h) {
  // Caller must already have verified Architect auth (isAdminAuth).
  if (!url.pathname.startsWith("/admin/selffix")) return j({ error: "Not found" }, 404, h);
  const rest = url.pathname.slice("/admin/selffix".length).replace(/\/+$/, "") || "/";
  try {
    if (rest === "/propose" && req.method === "POST") return await propose(req, env, h);
    const m = /^\/([^/]+)(?:\/(approve|decline|undo))?$/.exec(rest);
    if (!m) return j({ error: "Not found" }, 404, h);
    const rec = await loadRecord(env, decodeURIComponent(m[1]));
    if (!rec) return j({ error: "Update not found." }, 404, h);
    if (!m[2] && req.method === "GET") return j(publicView(rec), 200, h);
    if (m[2] === "approve" && req.method === "POST") return await approve(env, rec, h);
    if (m[2] === "decline" && req.method === "POST") return await decline(env, rec, h);
    if (m[2] === "undo" && req.method === "POST") return await undo(env, rec, h);
    return j({ error: "Method not allowed" }, 405, h);
  } catch (err) {
    const status = (err && err.status) || 500;
    return j({ error: err && err.message ? String(err.message) : "Self-fix request failed." }, status, h);
  }
}
