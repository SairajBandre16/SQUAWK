#!/usr/bin/env python3
"""Local dev server for Squawk: serves the site and relays the ADS-B feeds so live data works on localhost.

    python3 serve.py            # http://localhost:8000
    python3 serve.py 9000       # another port
"""
import http.server, os, socketserver, sys, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.abspath(__file__))

RELAYS = {
    '/api/adsb/': 'https://api.adsb.lol/v2/',
    '/api/apl/': 'https://api.airplanes.live/v2/',
    '/api/adsbfi/': 'https://opendata.adsb.fi/api/v2/',
}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # serve this folder wherever the script is started from
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        for prefix, upstream in RELAYS.items():
            if self.path.startswith(prefix):
                return self.relay(upstream + self.path[len(prefix):])
        return super().do_GET()

    def send_head(self):
        # keep .git and other dotfiles private
        if any(p.startswith('.') for p in urllib.parse.unquote(self.path.split('?')[0]).replace('\\', '/').split('/') if p):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)

    def relay(self, url):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'squawk-local-relay'})
            with urllib.request.urlopen(req, timeout=10) as r:
                body, status, ctype = r.read(), r.status, r.headers.get('Content-Type', 'application/json')
        except urllib.error.HTTPError as e:
            body, status, ctype = e.read(), e.code, 'application/json'
        except Exception as e:
            body, status, ctype = str(e).encode(), 502, 'text/plain'
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # always revalidate, so edited modules are picked up on a plain reload
        if not getattr(self, 'path', '').startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        if not getattr(self, 'path', '').startswith('/api/'):
            super().log_message(fmt, *args)

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('', port), Handler) as httpd:
    print(f'Squawk running at http://localhost:{port}  (Ctrl+C to stop)')
    httpd.serve_forever()
