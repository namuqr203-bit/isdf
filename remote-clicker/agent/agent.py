#!/usr/bin/env python3
"""
Remote clicker agent — run this on the computer that should receive clicks.

    pip install -r requirements.txt
    python agent.py --server wss://YOUR-APP.up.railway.app --room myroom --key YOUR_ACCESS_KEY

Safety:
  * Only clicks while this window is running. Ctrl+C stops it.
  * Slam the mouse into any screen corner to trigger pyautogui's fail-safe and stop it.
  * macOS: allow your Terminal app in System Settings → Privacy & Security → Accessibility.
"""
import argparse
import asyncio
import json
import platform
import sys
import urllib.parse

import websockets
from websockets.exceptions import ConnectionClosedError, InvalidURI, WebSocketException


def make_clicker(dry_run):
    if dry_run:
        w, h = 1920, 1080

        def click(x, y, button, double):
            print(f"[dry-run] {'double ' if double else ''}{button} click at {x}, {y}")

        return (w, h), click

    import pyautogui

    pyautogui.PAUSE = 0          # no artificial delay between actions -> fast
    pyautogui.FAILSAFE = True    # mouse in a corner aborts
    w, h = pyautogui.size()      # logical screen size (handles Retina scaling)

    def click(x, y, button, double):
        pyautogui.click(x=x, y=y, button=button, clicks=2 if double else 1, interval=0.05 if double else 0)

    return (w, h), click


async def run(args):
    (sw, sh), click = make_clicker(args.dry_run)
    q = urllib.parse.urlencode({"role": "agent", "room": args.room, "key": args.key})
    url = f"{args.server.rstrip('/')}/ws?{q}"
    name = args.name or platform.node() or "computer"
    print(f"Screen {sw}x{sh}. Connecting to {args.server} room '{args.room}' as '{name}'…")

    backoff = 1
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, max_size=2**16) as ws:
                backoff = 1
                await ws.send(json.dumps({"type": "hello", "name": name, "w": sw, "h": sh}))
                print("Connected. Waiting for clicks (Ctrl+C to stop).")
                async for raw in ws:
                    m = json.loads(raw)
                    if m.get("type") == "error":
                        print("Server:", m.get("error"))
                        return
                    if m.get("type") != "click":
                        continue
                    x = round(float(m["x"]) * (sw - 1))
                    y = round(float(m["y"]) * (sh - 1))
                    try:
                        click(x, y, m.get("button", "left"), bool(m.get("double")))
                    except Exception as e:  # includes pyautogui.FailSafeException
                        print("Stopped:", e)
                        return
                    if not args.quiet:
                        print(f"click {m.get('button', 'left')} @ {x},{y}")
                    await ws.send(json.dumps({"type": "ack", "id": m.get("id")}))
        except ConnectionClosedError as e:
            code = e.rcvd.code if e.rcvd else None
            if code == 4001:
                print("Wrong access key or room — check --key.")
                return
            print(f"Disconnected ({code}); retrying in {backoff}s")
        except InvalidURI as e:
            print("Bad --server URL:", e)
            return
        except (OSError, WebSocketException) as e:
            print(f"Can't reach server ({e}); retrying in {backoff}s")
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 15)


def main():
    p = argparse.ArgumentParser(description="Receive clicks from the Remote Clicker page.")
    p.add_argument("--server", required=True, help="e.g. wss://your-app.up.railway.app (or ws://localhost:3000)")
    p.add_argument("--room", required=True, help="room code, same as on the web page")
    p.add_argument("--key", required=True, help="ACCESS_KEY set on the server")
    p.add_argument("--name", help="name shown on the web page")
    p.add_argument("--dry-run", action="store_true", help="print clicks instead of clicking")
    p.add_argument("--quiet", action="store_true")
    args = p.parse_args()
    sys.stdout.reconfigure(line_buffering=True)  # show clicks immediately
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
