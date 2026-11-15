/**
 * Servidor de telemetría — Protocolo Órbita Crítica / U.S.S. Aether
 *
 *  Tablero (astronauta) ──ws /game──▶ server.js ──ws /realtime──▶ Open MCT (control en tierra)
 *                                         └── GET /history/:id ──▶ Open MCT (datos históricos)
 *  Tablero ◀──ws /chat──▶ server.js ◀──ws /chat──▶ chat.html (dentro de Open MCT)
 *  Tablero ◀──ws /rtc (radio de voz, WebRTC)──▶ chat.html
 *
 *  http://<IP>:8080/             -> Open MCT (consola del experto)
 *  http://<IP>:8080/tablero.html -> Tablero de reparación (astronauta)
 *  https://<IP>:8443/...         -> lo mismo con HTTPS: necesario para usar el micrófono (radio)
 *                                   desde OTRO computador. El certificado es propio (autofirmado):
 *                                   la primera vez el navegador avisa y hay que aceptar.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443;
const CERT_DIR = path.join(__dirname, '.cert');
const MAX_POINTS_PER_KEY = 20000; // historial en memoria por medición

const dictionary = require('./public/dictionary.json');
const validKeys = new Set(dictionary.measurements.map((m) => m.key));

// ---------------------------------------------------------------------------
// Almacén en memoria
// ---------------------------------------------------------------------------
const history = {}; // key -> [{ id, timestamp, value }]
validKeys.forEach((k) => (history[k] = []));

const realtimeClients = new Set(); // sockets de Open MCT con sus suscripciones

function store(id, timestamp, value) {
  if (!validKeys.has(id)) return;
  const point = { id, timestamp, value };
  const series = history[id];
  series.push(point);
  if (series.length > MAX_POINTS_PER_KEY) series.splice(0, series.length - MAX_POINTS_PER_KEY);

  // Reenviar en tiempo real a los clientes Open MCT suscritos
  const msg = JSON.stringify(point);
  realtimeClients.forEach((client) => {
    if (client.subscriptions.has(id) && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(msg);
    }
  });
}

// ---------------------------------------------------------------------------
// HTTP: estáticos + historial
// ---------------------------------------------------------------------------
const app = express();
app.use('/openmct', express.static(path.join(__dirname, 'node_modules/openmct/dist')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build'))); // modo 3D
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules/three/examples/jsm'))); // complementos (entorno)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/history/:id', (req, res) => {
  const { id } = req.params;
  if (!validKeys.has(id)) return res.status(404).json({ error: `Medición desconocida: ${id}` });
  const start = Number(req.query.start) || 0;
  const end = Number(req.query.end) || Date.now();
  res.json(history[id].filter((p) => p.timestamp >= start && p.timestamp <= end));
});

// ---------------------------------------------------------------------------
// WebSockets: /game (entrada desde el tablero), /realtime (salida a Open MCT),
// /chat (texto) y /rtc (señalización de la radio de voz)
// ---------------------------------------------------------------------------
const gameWss = new WebSocketServer({ noServer: true });
const realtimeWss = new WebSocketServer({ noServer: true });
const chatWss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
const rtcWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

const WS_ROUTES = { '/game': gameWss, '/realtime': realtimeWss, '/chat': chatWss, '/rtc': rtcWss };

// Mismo manejo para HTTP y HTTPS
function handleUpgrade(req, socket, head) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const wss = WS_ROUTES[pathname];
  if (!wss) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
}

gameWss.on('connection', (ws, req) => {
  console.log(`[game] Tablero conectado desde ${req.socket.remoteAddress}`);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const timestamp = Number(msg.timestamp) || Date.now();
    if (msg.type === 'telemetry' && msg.values && typeof msg.values === 'object') {
      Object.entries(msg.values).forEach(([id, value]) => store(id, timestamp, value));
    } else if (msg.type === 'event' && typeof msg.value === 'string') {
      store('aether.events', timestamp, msg.value.slice(0, 300));
      console.log(`[evento] ${msg.value}`);
    }
  });
  ws.on('close', () => console.log('[game] Tablero desconectado'));
});

realtimeWss.on('connection', (ws) => {
  const client = { ws, subscriptions: new Set() };
  realtimeClients.add(client);
  // Protocolo del tutorial oficial de Open MCT: "subscribe <id>" / "unsubscribe <id>"
  ws.on('message', (raw) => {
    const [action, id] = raw.toString().split(' ');
    if (action === 'subscribe') client.subscriptions.add(id);
    if (action === 'unsubscribe') client.subscriptions.delete(id);
  });
  ws.on('close', () => realtimeClients.delete(client));
});

// ---------------------------------------------------------------------------
// Chat de texto: /chat (tablero <-> control en tierra). Todos reciben todo.
//  cliente -> servidor: { from: 'ASTRONAUTA' | 'TIERRA', name?, text }
//  servidor -> cliente: { type: 'history', messages: [...] } al conectar
//                       { type: 'chat', from, name, text, timestamp } por cada mensaje
// ---------------------------------------------------------------------------
const CHAT_HISTORY_MAX = 100;
const CHAT_ROLES = new Set(['ASTRONAUTA', 'TIERRA']);
const chatHistory = [];

chatWss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'history', messages: chatHistory }));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || !CHAT_ROLES.has(msg.from) || typeof msg.text !== 'string') return;
    const text = msg.text.trim().slice(0, 280);
    if (!text) return;
    const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 24) : '';
    const out = { type: 'chat', from: msg.from, name, text, timestamp: Date.now() };

    chatHistory.push(out);
    if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.shift();
    const data = JSON.stringify(out);
    chatWss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(data);
    });
    console.log(`[chat] ${out.from}${name ? ` (${name})` : ''}: ${text}`);
  });
});

// ---------------------------------------------------------------------------
// Radio de voz: /rtc. El audio viaja directo entre navegadores (WebRTC, en malla:
// cada participante se conecta con todos). El servidor solo presenta a los
// participantes, reenvía la negociación y avisa quién está hablando.
//  cliente -> servidor: { type: 'join', role, name }
//                       { type: 'signal', to, data }      (oferta/respuesta/ICE)
//                       { type: 'talking', on }
//  servidor -> cliente: { type: 'welcome', id, peers: [{ id, role, name }] }
//                       { type: 'peer-joined' | 'peer-left', id, role, name }
//                       { type: 'signal', from, data }
//                       { type: 'talking', id, role, name, on }
// ---------------------------------------------------------------------------
const rtcPeers = new Map(); // id -> { ws, role, name }
let nextRtcId = 1;

function rtcSend(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

rtcWss.on('connection', (ws) => {
  let id = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join' && id === null) {
      if (!CHAT_ROLES.has(msg.role)) return;
      id = String(nextRtcId++);
      const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 24) : '';
      const peers = [...rtcPeers].map(([peerId, p]) => ({ id: peerId, role: p.role, name: p.name }));
      rtcPeers.set(id, { ws, role: msg.role, name });
      rtcSend(ws, { type: 'welcome', id, peers });
      rtcPeers.forEach((p, peerId) => {
        if (peerId !== id) rtcSend(p.ws, { type: 'peer-joined', id, role: msg.role, name });
      });
      console.log(`[radio] ${msg.role}${name ? ` (${name})` : ''} se unió (${rtcPeers.size} en la radio)`);
      return;
    }
    if (id === null) return;
    const me = rtcPeers.get(id);

    if (msg.type === 'signal' && rtcPeers.has(String(msg.to))) {
      rtcSend(rtcPeers.get(String(msg.to)).ws, { type: 'signal', from: id, data: msg.data });
    } else if (msg.type === 'talking') {
      rtcPeers.forEach((p, peerId) => {
        if (peerId !== id) rtcSend(p.ws, { type: 'talking', id, role: me.role, name: me.name, on: Boolean(msg.on) });
      });
    }
  });

  ws.on('close', () => {
    if (id === null) return;
    const me = rtcPeers.get(id);
    rtcPeers.delete(id);
    rtcPeers.forEach((p) => rtcSend(p.ws, { type: 'peer-left', id, role: me.role, name: me.name }));
  });
});

// ---------------------------------------------------------------------------
// Arranque: HTTP siempre; HTTPS con certificado autofirmado (para el micrófono)
// ---------------------------------------------------------------------------
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// El certificado incluye las IP actuales del equipo; si cambian, se genera otro.
async function loadOrCreateCert(ips) {
  const meta = path.join(CERT_DIR, 'ips.json');
  try {
    const saved = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (ips.every((ip) => saved.includes(ip))) {
      return { key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')), cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')) };
    }
  } catch {
    // no hay certificado guardado: se genera uno
  }
  const selfsigned = require('selfsigned');
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 5);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'aether.local' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: notAfter,
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))]
      }
    ]
  });
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(path.join(CERT_DIR, 'key.pem'), pems.private);
  fs.writeFileSync(path.join(CERT_DIR, 'cert.pem'), pems.cert);
  fs.writeFileSync(meta, JSON.stringify(ips));
  return { key: pems.private, cert: pems.cert };
}

async function main() {
  const ips = lanAddresses();

  const httpServer = http.createServer(app);
  httpServer.on('upgrade', handleUpgrade);
  httpServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n❌ El puerto ${PORT} ya está en uso: probablemente el servidor ya está abierto en otra ventana.`);
      console.error('   Ciérrala (Ctrl+C) y vuelve a ejecutar npm start, o usa otro puerto: PORT=8090 HTTPS_PORT=8453 npm start\n');
      process.exit(1);
    }
    throw e;
  });
  httpServer.listen(PORT);

  let httpsOk = false;
  if (process.env.HTTPS !== 'off') {
    try {
      const httpsServer = https.createServer(await loadOrCreateCert(ips), app);
      httpsServer.on('upgrade', handleUpgrade);
      await new Promise((resolve, reject) => {
        httpsServer.once('error', reject);
        httpsServer.listen(HTTPS_PORT, resolve);
      });
      httpsOk = true;
    } catch (e) {
      console.warn(`(HTTPS no disponible: ${e.message}. La radio solo funcionará en este mismo equipo.)`);
    }
  }

  console.log('\n=== U.S.S. AETHER — servidor listo ===\n');
  console.log('En ESTE computador:');
  console.log(`  🛰  Control en tierra (Open MCT): http://localhost:${PORT}/`);
  console.log(`  🚀 Astronauta (tablero):         http://localhost:${PORT}/tablero.html`);
  if (httpsOk && ips.length) {
    console.log('\nDesde OTROS computadores de la misma red (con radio de voz):');
    ips.forEach((ip) => {
      console.log(`  🛰  https://${ip}:${HTTPS_PORT}/`);
      console.log(`  🚀 https://${ip}:${HTTPS_PORT}/tablero.html`);
    });
    console.log('  La primera vez el navegador muestra un aviso de seguridad (certificado propio):');
    console.log('  "Configuración avanzada" -> "Continuar". Es seguro: es tu propio servidor.');
  }
  console.log('');
}

main();
