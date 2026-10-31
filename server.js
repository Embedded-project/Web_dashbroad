require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const path = require('path');

const required = ['NETPIE_CLIENT_ID', 'NETPIE_TOKEN', 'DASHBOARD_PASSWORD'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);
const namespace = process.env.ROBOT_NAMESPACE || 'robot01';
if (!/^[a-zA-Z0-9_-]+$/.test(namespace)) throw new Error('Invalid ROBOT_NAMESPACE');
const topics = {
  cmd: `@msg/${namespace}/cmd`,
  state: `@msg/${namespace}/state`,
  telemetry: `@msg/${namespace}/telemetry`
};
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/control' });
const useTLS = process.env.MQTT_TLS === 'true';
const broker = mqtt.connect(`${useTLS ? 'mqtts' : 'mqtt'}://${process.env.NETPIE_HOST || 'mqtt.netpie.io'}:${process.env.NETPIE_PORT || (useTLS ? '1884' : '1883')}`, {
  clientId: process.env.NETPIE_CLIENT_ID,
  username: process.env.NETPIE_TOKEN,
  password: process.env.NETPIE_SECRET || '',
  clean: true,
  reconnectPeriod: 3000,
  connectTimeout: 10000
});
let brokerOnline = false;
let owner = null;
let lastInputAt = 0;
let direction = 'S';
let lastRobotTelemetry = 0;

function broadcast(value) {
  const payload = JSON.stringify(value);
  for (const peer of wss.clients) if (peer.readyState === WebSocket.OPEN && peer.authorized) peer.send(payload);
}
function publishMove(next) {
  if (!brokerOnline) return;
  broker.publish(topics.cmd, next, { qos: 0, retain: false });
}
function stop() {
  direction = 'S';
  owner = null;
  publishMove('S');
  broadcast({ type: 'control', direction: 'S' });
}
broker.on('connect', () => {
  brokerOnline = true;
  broker.subscribe([topics.state, topics.telemetry], { qos: 0 });
  stop();
  broadcast({ type: 'broker', connected: true });
});
broker.on('close', () => {
  brokerOnline = false;
  direction = 'S';
  owner = null;
  broadcast({ type: 'broker', connected: false });
});
broker.on('error', err => console.error('NETPIE:', err.message));
broker.on('message', (topic, data) => {
  if (topic === topics.telemetry) {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.type !== 'telemetry') return;
      lastRobotTelemetry = Date.now();
      broadcast(parsed);
    } catch (_) { /* ignore corrupted telemetry */ }
  }
  if (topic === topics.state) broadcast({ type: 'robot-state', direction: data.toString().slice(0,1) });
});

const expectedPassword = Buffer.from(process.env.DASHBOARD_PASSWORD);
function checkPassword(password) {
  const candidate = Buffer.from(typeof password === 'string' ? password : '');
  return candidate.length === expectedPassword.length && crypto.timingSafeEqual(candidate, expectedPassword);
}

wss.on('connection', ws => {
  ws.authorized = false;
  ws.on('message', raw => {
    if (raw.length > 256) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!ws.authorized) {
      if (msg.type !== 'auth' || !checkPassword(msg.password)) { ws.close(1008, 'Unauthorized'); return; }
      ws.authorized = true;
      ws.send(JSON.stringify({ type: 'authorized', broker: brokerOnline }));
      return;
    }
    if (msg.type === 'stop') {
      if (owner === ws) stop();
      return;
    }
    if (msg.type !== 'move' || typeof msg.direction !== 'string' || !/^[FBLR]$/.test(msg.direction)) return;
    if (!brokerOnline) return;
    if (owner && owner !== ws) return;
    owner = ws;
    direction = msg.direction;
    lastInputAt = Date.now();
    // Publish every authenticated press/hold frame, not only direction changes.
    publishMove(direction);
    ws.send(JSON.stringify({ type: 'control', direction }));
  });
  ws.on('close', () => { if (owner === ws) stop(); });
});

setInterval(() => {
  if (owner && (Date.now() - lastInputAt > 400 || owner.readyState !== WebSocket.OPEN)) stop();
  broadcast({ type: 'health', broker: brokerOnline, robotOnline: Date.now() - lastRobotTelemetry < 3500 });
}, 150);

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Dashboard running on port ${port}`));
