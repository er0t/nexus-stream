import http.server
import socketserver
import os

PORT = 5500
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        if self.path.endswith('.apk'):
            self.send_header('Content-Type', 'application/vnd.android.package-archive')
            filename = os.path.basename(self.path.split('?')[0])
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        elif self.path.endswith('app-ads.txt'):
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), CustomHandler) as httpd:
        print(f"Serving web-landing at http://0.0.0.0:{PORT}")
        httpd.serve_forever()
