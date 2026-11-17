# Remote Clicker

Click a spot in the box on the web page, and every computer running the agent in the same room clicks the same spot on its own screen.

```
browser (box) ──WebSocket──▶ Railway relay ──WebSocket──▶ agent.py ──▶ real mouse click
```

- The page sends positions as fractions (0–1), so the click lands in the same relative place on any screen size.
- The box takes the shape of the remote screen, and hovering shows the exact pixel it will click.
- Supports left click, right click and double click. Each click turns green when the agent confirms it, and the log shows the round-trip time.
- Protected by an `ACCESS_KEY`: without it nobody can connect as a page or as an agent.

## 1. Put it on GitHub

```bash
cd remote-clicker
git init && git add . && git commit -m "remote clicker"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/remote-clicker.git
git push -u origin main
```

## 2. Deploy on Railway

1. railway.app → **New Project → Deploy from GitHub repo** → pick the repo. Railway detects Node and runs `npm start`.
2. Go to **Variables** and add `ACCESS_KEY` = a long random password.
3. Go to **Settings → Networking → Generate Domain**. You get something like `https://remote-clicker-production.up.railway.app`.
4. Open that URL, enter a room code (any word, e.g. `office`) and your access key, then click **Connect**.

> Why not Vercel? Vercel functions are short-lived and can't keep a WebSocket open, so the relay has to run on Railway. If you still want the page itself on Vercel, deploy only the `public/` folder there and add `<script>window.RELAY_URL="wss://YOUR-APP.up.railway.app"</script>` before the main script in `index.html`.

## 3. Run the agent on the computer that should be clicked

```bash
cd agent
pip install -r requirements.txt
python agent.py --server wss://YOUR-APP.up.railway.app --room office --key YOUR_ACCESS_KEY
```

- **macOS:** the first time, allow your Terminal app in **System Settings → Privacy & Security → Accessibility**, or clicks will silently do nothing.
- **Windows/Linux:** works as-is (Linux needs an X11 session).
- `--dry-run` prints the clicks without moving the mouse, which is handy for testing.
- `--name "Gaming PC"` sets the label shown in the page's computer dropdown.
- To stop it, press **Ctrl+C**, or slam the mouse into a screen corner (pyautogui's fail-safe).

## Test locally

```bash
npm install
ACCESS_KEY=test npm start                     # http://localhost:3000
python agent/agent.py --server ws://localhost:3000 --room demo --key test --dry-run
```

## Speed

Each click travels page → Railway → agent. Expect roughly 30–150 ms depending on how far both machines are from the Railway region. Pick the region closest to you in Railway's service settings. The agent clicks with no added delay (`pyautogui.PAUSE = 0`).
