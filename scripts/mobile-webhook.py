#!/usr/bin/env python3
"""Mobile webhook for Wilson — safe file updates via worktree.

Requires env:
  MOBILE_WORKTREE  absolute path to the dedicated worktree (e.g. ../mobile-work)
  WEBHOOK_TOKEN    shared secret for Authorization: Bearer <token>

Optional:
  BIND_IP          default 127.0.0.1 (use Tailscale IP or 0.0.0.0 carefully)
  PUBLISH_BRANCH   if set (e.g. main), ff-only merge + push after mobile-update
  MERGE_MESSAGE    commit message for the merge
"""

import json
import os
import hmac
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8765
WORK = os.path.realpath(os.environ["MOBILE_WORKTREE"])
TOKEN = os.environ["WEBHOOK_TOKEN"].encode()
MAX_BODY = 1_000_000
BIND = os.environ.get("BIND_IP", "127.0.0.1")
BLOCKED = {".git", ".github"}

PUBLISH_BRANCH = os.environ.get("PUBLISH_BRANCH")  # e.g. "main"
MERGE_MESSAGE = os.environ.get("MERGE_MESSAGE", "Merge mobile-update")


def safe_path(filename: str) -> str:
    full = os.path.realpath(os.path.join(WORK, filename))
    if os.path.commonpath([WORK, full]) != WORK:
        raise ValueError("Path outside repo")
    parts = os.path.relpath(full, WORK).split(os.sep)
    if BLOCKED & set(parts):
        raise ValueError("Blocked path")
    return full


def git(*args):
    subprocess.run(["git", *args], cwd=WORK, check=True, timeout=60)


class H(BaseHTTPRequestHandler):
    def _reply(self, code: int, msg: str):
        self.send_response(code)
        self.end_headers()
        self.wfile.write(msg.encode())

    def do_POST(self):
        auth = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(auth, b"Bearer " + TOKEN):
            return self._reply(401, "Unauthorized")
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return self._reply(400, "Bad Content-Length")
        if not 0 < length <= MAX_BODY:
            return self._reply(413, "Bad body size")
        try:
            p = json.loads(self.rfile.read(length))
            name, content = p.get("filename"), p.get("content")
            msg = p.get("message", "Update via mobile webhook")
            if not isinstance(name, str) or not isinstance(content, str) or not isinstance(msg, str):
                return self._reply(400, "Bad payload")

            path = safe_path(name)  # validate first
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)

            rel = os.path.relpath(path, WORK)
            git("add", "--", rel)
            git("commit", "-m", msg, "--", rel)
            git("push", "origin", "mobile-update")

            if PUBLISH_BRANCH:
                git("fetch", "origin", PUBLISH_BRANCH)
                git("checkout", PUBLISH_BRANCH)
                git("merge", "--ff-only", "mobile-update", "-m", MERGE_MESSAGE)
                git("push", "origin", PUBLISH_BRANCH)
                git("checkout", "mobile-update")

            self._reply(
                200,
                f"Pushed {rel} to mobile-update"
                + (f" and merged to {PUBLISH_BRANCH}" if PUBLISH_BRANCH else ""),
            )
        except subprocess.TimeoutExpired:
            self._reply(504, "Git timed out")
        except subprocess.CalledProcessError as e:
            self._reply(500, f"Git failed (exit {e.returncode})")
        except ValueError as e:
            self._reply(400, str(e))
        except Exception:
            self._reply(500, "Internal error")


if __name__ == "__main__":
    HTTPServer((BIND, PORT), H).serve_forever()
