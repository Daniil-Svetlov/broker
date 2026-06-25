#!/usr/bin/env python3
"""Статический сервер для проверочного фронтенда на :3030.

    python3 serve.py            # http://localhost:3030/terminal.html
    PORT=4000 python3 serve.py

Это нужно только чтобы открыть страницу с того же origin, что в скриншоте
(localhost:3030). Бэкенд (Go :8090, Django :8000) уже отдаёт CORS-заголовки.
"""
import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", "3030"))
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Не кэшируем — чтобы правки сразу подхватывались.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(socketserver.TCPServer):
    # Чтобы перезапуск не падал с «Address already in use» (порт в TIME_WAIT).
    allow_reuse_address = True


with Server(("", PORT), Handler) as httpd:
    print(f"Фронтенд: http://localhost:{PORT}/terminal.html")
    httpd.serve_forever()
