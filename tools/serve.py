#!/usr/bin/env python3
"""Serves dist/ with cache headers a progressive web app can actually live with.

Python's stock `http.server` sends no `Cache-Control` at all, only
`Last-Modified`. Browsers respond to that by guessing — heuristic caching — and
may reuse index.html and sw.js for a good while without ever asking the server
whether they changed. For a normal static site that is merely untidy; for a PWA
it means a new build can sit on the server indefinitely while the phone keeps
showing the old one.

So: never cache the entry points, cache the hashed assets forever. Files under
/assets/ have a content hash in the name, so a change to one produces a new URL
and the old entry can safely be kept.

    python3 tools/serve.py [port] [host]

Binds all interfaces by default, which is needed for both ways of reaching it:
directly on the Tailscale address, and via `tailscale serve`, which proxies from
localhost. Binding only one of those silently breaks the other — a proxy pointed
at 127.0.0.1 returns 502 if the server is listening solely on the tailnet
address.
"""

import http.server
import os
import sys
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "dist"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        path = self.path.split("?")[0]
        if path.startswith("/assets/"):
            # Content-addressed: the name changes whenever the bytes do.
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            # index.html, sw.js, the manifest, the samples: always revalidate.
            # Offline is the service worker's job, not the HTTP cache's.
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        # Quieter than the default, which logs every sample request.
        if "GET / " in format % args or ".js" in (format % args):
            super().log_message(format, *args)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    host = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"

    if not DIST.is_dir():
        raise SystemExit(f"{DIST} does not exist — run `npm run build` first")

    os.chdir(DIST)
    server = http.server.ThreadingHTTPServer((host, port), Handler)
    print(f"Serving {DIST} on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
