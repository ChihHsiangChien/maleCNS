import http.server
import socketserver
import webbrowser
import sys

DEFAULT_PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    pass

socketserver.TCPServer.allow_reuse_address = True

def start_server():
    port = DEFAULT_PORT
    httpd = None
    for attempt_port in range(DEFAULT_PORT, DEFAULT_PORT + 10):
        try:
            httpd = socketserver.TCPServer(("", attempt_port), Handler)
            port = attempt_port
            break
        except OSError:
            continue

    if not httpd:
        print("[ERROR] Could not bind to ports 8000-8009. Ports in use.")
        sys.exit(1)

    print(f"\n=======================================================")
    print(f"  Drosophila Connectome 3D Visualizer Server  ")
    print(f"  Running on: http://localhost:{port}")
    print(f"  Mi1 3D Visualizer: http://localhost:{port}/mi1_3d_visualizer.html")
    print(f"=======================================================\n")
    webbrowser.open(f"http://localhost:{port}/mi1_3d_visualizer.html")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Server stopped.")

if __name__ == "__main__":
    start_server()
