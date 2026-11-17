# Courtside Arcade on Hugging Face: serves the app and proxies /db/* to DataBallr (same as the old Netlify rule).
# Gradio owns the web server (the Space expects it); the app's own routes go in front of Gradio's.
import os
import gradio as gr
import httpx
from fastapi import Request
from fastapi.responses import FileResponse, Response
from fastapi.routing import APIRoute

ROOT = os.path.dirname(os.path.abspath(__file__))
UP = "https://api.databallr.com"
PUBLIC = {"index.html", "app.js", "data.js", "engine.js", "sw.js", "worker.js", "styles.css", "manifest.webmanifest",
          "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"}
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".webmanifest": "application/manifest+json", ".png": "image/png"}
client = httpx.AsyncClient(timeout=30, follow_redirects=True)


async def db(path: str, request: Request):
    r = await client.get(f"{UP}/{path}", params=request.query_params,
                         headers={"Accept": request.headers.get("accept", "application/json"), "User-Agent": "CourtsideArcade/1.0"})
    return Response(r.content, status_code=r.status_code,
                    headers={"Cache-Control": r.headers.get("cache-control", "no-cache")},
                    media_type=r.headers.get("content-type", "application/json"))


def serve(path: str):
    ext = os.path.splitext(path)[1]
    headers = {"Cache-Control": "no-cache"} if path in ("sw.js", "index.html") else {}
    return FileResponse(os.path.join(ROOT, path), media_type=TYPES.get(ext), headers=headers)


async def home():
    return serve("index.html")


async def asset(path: str):
    return serve(path) if path in PUBLIC else Response("Not found", status_code=404)


with gr.Blocks(title="Courtside Arcade") as demo:
    gr.Markdown("Courtside Arcade is running.")

demo.launch(prevent_thread_lock=True, ssr_mode=False)
fa = demo.app
mine = [APIRoute("/db/{path:path}", db, methods=["GET"]), APIRoute("/", home, methods=["GET"])]
mine += [APIRoute("/" + p, (lambda p=p: (lambda: serve(p)))(), methods=["GET"]) for p in sorted(PUBLIC)]
fa.router.routes[:0] = mine
demo.block_thread()
