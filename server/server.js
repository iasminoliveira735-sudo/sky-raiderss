import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 10000);
const rooms = new Map();
const clients = new Map();

const phaseDifficulty = (phase) => {
  if (phase <= 150) return { name: 'FÁCIL', mult: 0.82, reward: 300 };
  if (phase <= 300) return { name: 'MÉDIO', mult: 1, reward: 380 };
  if (phase <= 450) return { name: 'DIFÍCIL', mult: 1.22, reward: 470 };
  if (phase <= 600) return { name: 'HARD', mult: 1.48, reward: 580 };
  if (phase <= 750) return { name: 'EXTREMO', mult: 1.8, reward: 700 };
  return { name: 'LENDÁRIO', mult: 2.15, reward: 850 };
};

function roomCode() {
  let code;
  do code = crypto.randomBytes(3).toString('hex').toUpperCase(); while (rooms.has(code));
  return code;
}
function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }
function broadcast(room, data) { for (const p of room.players.values()) send(p.ws, data); }
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready }));
}
function broadcastPlayers(room) { broadcast(room, { type: 'players', players: publicPlayers(room) }); }

function createRoom(ws, name) {
  const code = roomCode();
  const player = { id: crypto.randomUUID(), ws, name: String(name || 'PILOTO').slice(0, 16), ready: false };
  const room = {
    code, host: player.id, players: new Map([[player.id, player]]),
    phase: 1, status: 'lobby', seed: crypto.randomInt(1, 2147483647),
    startedAt: 0, tick: 0, state: { wave: 1, boss: false, score: {}, hp: {} }
  };
  rooms.set(code, room); clients.set(ws, { room: code, player: player.id });
  send(ws, { type: 'room_created', room: code, playerId: player.id, phase: room.phase });
  broadcastPlayers(room);
}
function joinRoom(ws, code, name) {
  const room = rooms.get(code);
  if (!room) return send(ws, { type: 'error', message: 'Sala não encontrada.' });
  if (room.status !== 'lobby') return send(ws, { type: 'error', message: 'A partida já começou.' });
  if (room.players.size >= 4) return send(ws, { type: 'error', message: 'Sala cheia.' });
  const player = { id: crypto.randomUUID(), ws, name: String(name || 'PILOTO').slice(0, 16), ready: false };
  room.players.set(player.id, player); clients.set(ws, { room: code, player: player.id });
  send(ws, { type: 'room_joined', room: code, playerId: player.id, phase: room.phase });
  broadcastPlayers(room);
}
function startMatch(room) {
  if (room.status !== 'lobby' || room.players.size < 2) return;
  if (![...room.players.values()].every(p => p.ready)) return;
  room.status = 'running'; room.startedAt = Date.now(); room.tick = 0;
  room.seed = crypto.randomInt(1, 2147483647);
  const d = phaseDifficulty(room.phase);
  broadcast(room, { type: 'match_start', room: room.code, phase: room.phase, difficulty: d.name, multiplier: d.mult, reward: d.reward, seed: room.seed, serverTime: Date.now() });
}
function leave(ws) {
  const meta = clients.get(ws); if (!meta) return;
  const room = rooms.get(meta.room); clients.delete(ws); if (!room) return;
  room.players.delete(meta.player);
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.host === meta.player) room.host = room.players.keys().next().value;
  broadcastPlayers(room);
  broadcast(room, { type: 'state', room: room.code, phase: room.phase, status: room.status, tick: room.tick, serverTime: Date.now() });
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Sky Raiders Multiplayer Server online');
});
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', ws => {
  send(ws, { type: 'connected', serverTime: Date.now(), protocol: 1 });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Mensagem inválida.' }); }
    const meta = clients.get(ws);
    if (m.type === 'create_room') return createRoom(ws, m.name);
    if (m.type === 'join_room') return joinRoom(ws, String(m.room || '').toUpperCase(), m.name);
    if (!meta) return;
    const room = rooms.get(meta.room); if (!room) return;
    const player = room.players.get(meta.player); if (!player) return;
    if (m.type === 'ready') { player.ready = !!m.ready; broadcastPlayers(room); return startMatch(room); }
    if (m.type === 'leave_room') return leave(ws);
    if (m.type === 'phase_select' && room.status === 'lobby' && meta.player === room.host) {
      const phase = Math.max(1, Math.min(900, Number(m.phase) || 1)); room.phase = phase; broadcast(room, { type: 'phase_sync', phase }); return;
    }
    if (m.type === 'player_state' && room.status === 'running') {
      broadcast(room, { type: 'player_state', id: player.id, x: Number(m.x) || 0, y: Number(m.y) || 0, hp: Number(m.hp) || 0, score: Number(m.score) || 0, serverTime: Date.now() });
    }
    if (m.type === 'combat_state' && room.status === 'running' && meta.player === room.host) {
      room.tick++; room.state = { ...m.state, tick: room.tick };
      broadcast(room, { type: 'combat_state', state: room.state, phase: room.phase, serverTime: Date.now() });
    }
    if (m.type === 'phase_complete' && room.status === 'running' && meta.player === room.host) {
      const next = Math.min(900, room.phase + 1); room.phase = next; room.status = 'lobby';
      for (const p of room.players.values()) p.ready = false;
      broadcast(room, { type: 'phase_complete', completedPhase: next - 1, nextPhase: next });
      broadcastPlayers(room);
    }
  });
  ws.on('close', () => leave(ws));
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status === 'running') broadcast(room, { type: 'server_tick', tick: ++room.tick, phase: room.phase, serverTime: Date.now() });
  }
}, 1000 / 20);

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Sky Raiders server listening on ${PORT}`));
