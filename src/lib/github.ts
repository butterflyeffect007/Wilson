/**
 * GitHub push helper for Wilson.
 *
 * Lets Wilson create or update files in the butterflyeffect007/Wilson repo
 * and commit them directly.
 *
 * Requires a GitHub personal access token with `repo` scope.
 * Store it once with setGitHubToken() (kept in localStorage).
 *
 * Usage:
 *   await setGitHubToken("ghp_...");
 *   await pushFile("src/lib/example.ts", "export const x = 1;");
 */

const OWNER = "butterflyeffect007";
const REPO = "Wilson";
const TOKEN_KEY = "wilson_github_token";

export function setGitHubToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getGitHubToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearGitHubToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function githubFetch(path: string, options: RequestInit = {}) {
  const token = getGitHubToken();
  if (!token) throw new Error("GitHub token not set. Call setGitHubToken() first.");

  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Create or update a file and commit it.
 * @param path  Repo-relative path, e.g. "src/lib/example.ts"
 * @param content  Full file content (string)
 * @param message  Commit message
 * @param branch  Branch name (default: main)
 */
export async function pushFile(
  path: string,
  content: string,
  message = `Update ${path}`,
  branch = "main"
) {
  // Get current file SHA if it exists (needed for updates)
  let sha: string | undefined;
  try {
    const existing = await githubFetch(
      `/repos/${OWNER}/${REPO}/contents/${path}?ref=${branch}`
    );
    sha = existing.sha;
  } catch {
    // File does not exist — create it
  }

  const body: any = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // base64
    branch,
  };
  if (sha) body.sha = sha;

  return githubFetch(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/**
 * Convenience: push multiple files in sequence (each gets its own commit).
 */
export async function pushFiles(
  files: { path: string; content: string; message?: string }[],
  branch = "main"
) {
  const results = [];
  for (const f of files) {
    results.push(await pushFile(f.path, f.content, f.message, branch));
  }
  return results;
}
