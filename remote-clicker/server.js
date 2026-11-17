// Remote clicker relay: serves the control page and relays clicks to agents over WebSockets.
// Deploy on Railway (needs a long-lived process — Vercel serverless can't hold WebSockets).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ACCESS_KEY = process.env.ACCESS_KEY || "";
if (!ACCESS_KEY) {
  console.warn("WARNING: ACCESS_KEY is not set. Set it in Railway → Variables. Refusing all connections until then.");
}

const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const full = path.join(PUBLIC, path.normalize(file));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

function keyOk(k) {
  if (!ACCESS_KEY || typeof k !== "string") return false;
  const a = Buffer.from(k), b = Buffer.from(ACCESS_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// rooms: code -> { agents:Set<ws>, controllers:Set<ws> }
const rooms = new Map();
const room = (c) => {
  if (!rooms.has(c)) rooms.set(c, { agents: new Set(), controllers: new Set() });
  return rooms.get(c);
};
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function agentList(r) {
  return [...r.agents].map((a) => ({ id: a.id, name: a.info?.name, w: a.info?.w, h: a.info?.h }));
}
function broadcastStatus(r) {
  for (const c of r.controllers) send(c, { type: "agents", agents: agentList(r) });
}

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

wss.on("connection", (ws, req) => {
  const q = new URL(req.url, "http://x").searchParams;
  const role = q.get("role");
  const code = (q.get("room") || "").slice(0, 64);
  if (!keyOk(q.get("key")) || !code || !["agent", "controller"].includes(role)) {
    send(ws, { type: "error", error: "unauthorized" });
    return ws.close(4001, "unauthorized");
  }
  ws.id = crypto.randomBytes(4).toString("hex");
  ws.role = role;
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  const r = room(code);

  if (role === "agent") {
    r.agents.add(ws);
    console.log(`[${code}] agent ${ws.id} connected`);
  } else {
    r.controllers.add(ws);
    send(ws, { type: "agents", agents: agentList(r) });
  }

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (role === "agent") {
      if (m.type === "hello") {
        ws.info = { name: String(m.name || "computer").slice(0, 60), w: +m.w || 0, h: +m.h || 0 };
        broadcastStatus(r);
      } else if (m.type === "ack") {
        for (const c of r.controllers) send(c, { type: "ack", id: m.id, agent: ws.id });
      }
      return;
    }
    // controller -> agents
    if (m.type === "click" || m.type === "move") {
      const x = Number(m.x), y = Number(m.y);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
      const out = {
        type: m.type, x, y, id: m.id,
        button: ["left", "right", "middle"].includes(m.button) ? m.button : "left",
        double: !!m.double,
      };
      for (const a of r.agents) if (!m.target || m.target === a.id) send(a, out);
    } else if (m.type === "ping") {
      send(ws, { type: "pong", t: m.t });
    }
  });

  ws.on("close", () => {
    r.agents.delete(ws);
    r.controllers.delete(ws);
    if (role === "agent") { console.log(`[${code}] agent ${ws.id} left`); broadcastStatus(r); }
    if (!r.agents.size && !r.controllers.size) rooms.delete(code);
  });
});

// drop dead connections (keeps Railway's proxy from holding stale sockets)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.listen(PORT, () => console.log(`relay listening on :${PORT}`));
