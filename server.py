import http.server
import socketserver
import webbrowser

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    pass

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"\n=======================================================")
        print(f"  Fruit Fly Space Invaders Connectome Game Server  ")
        print(f"  Running on: http://localhost:{PORT}")
        print(f"=======================================================\n")
        webbrowser.open(f"http://localhost:{PORT}")
        httpd.serve_forever()
