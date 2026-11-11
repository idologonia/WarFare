/**
 * Сервер WarFare: роздає гру (папка dist) і веде мережеві кімнати.
 * Запуск: node dist-server/index.js [порт]. Логіка бою — та сама, що в клієнті (src/game).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { content } from '@/content';
import { createMission, Mission } from '@/game/simulation/mission';
import type { SideId } from '@/game/types';
import { PROTOCOL_VERSION, type ClientMsg, type RoomInfo, type RoomSettings, type ServerMsg } from '@/net/protocol';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const ROOT = resolve(process.env.WARFARE_DIST ?? join(process.cwd(), 'dist'));
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

interface Player {
  ws: WebSocket | null;
  side: SideId;
  token: string;
}

interface Room {
  id: string;
  settings: RoomSettings;
  players: Player[];
  mission: Mission | null;
  seq: number;
  created: number;
  lastActive: number;
}

const rooms = new Map<string, Room>();
const other = (s: SideId): SideId => (s === 'blue' ? 'red' : 'blue');
const send = (ws: WebSocket | null, m: ServerMsg) => ws && ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

function info(r: Room): RoomInfo {
  return {
    id: r.id,
    name: r.settings.name,
    scenarioId: r.settings.scenarioId,
    scenarioName: content().scenarios.get(r.settings.scenarioId)?.name ?? r.settings.scenarioId,
    hostSide: r.settings.side,
    players: r.players.filter((p) => p.ws).length,
    started: !!r.mission,
  };
}

const listFor = () => [...rooms.values()].filter((r) => !r.mission || r.players.some((p) => !p.ws)).map(info);

function startRoom(r: Room): void {
  const state = createMission(r.settings.scenarioId, {
    seed: Math.floor(Math.random() * 2 ** 31),
    difficulty: r.settings.difficulty,
    controllers: { blue: 'human', red: 'human' },
    revealAll: false,
  });
  const m = new Mission(state);
  for (const side of ['blue', 'red'] as SideId[]) m.dispatch({ type: 'autoDeploy', side });
  m.dispatch({ type: 'startBattle' });
  r.mission = m;
  r.seq = 0;
  for (const p of r.players) send(p.ws, { t: 'start', state: m.state, seq: 0 });
}

function onMessage(ws: WebSocket, me: { room: Room | null; player: Player | null }, msg: ClientMsg): void {
  switch (msg.t) {
    case 'list':
      return void send(ws, { t: 'rooms', rooms: listFor() });
    case 'create': {
      const sc = content().scenarios.get(msg.settings.scenarioId);
      if (!sc) return void send(ws, { t: 'error', error: 'Невідомий сценарій' });
      const r: Room = { id: randomBytes(3).toString('hex'), settings: { ...msg.settings, name: String(msg.settings.name || 'Кімната').slice(0, 40) }, players: [], mission: null, seq: 0, created: Date.now(), lastActive: Date.now() };
      const p: Player = { ws, side: msg.settings.side, token: randomBytes(12).toString('hex') };
      r.players.push(p);
      rooms.set(r.id, r);
      me.room = r;
      me.player = p;
      send(ws, { t: 'joined', room: info(r), side: p.side, token: p.token });
      console.log(`Кімната ${r.id} «${r.settings.name}» створена`);
      return;
    }
    case 'join': {
      const r = rooms.get(msg.roomId);
      if (!r) return void send(ws, { t: 'error', error: 'Кімнати вже немає' });
      if (r.players.length >= 2) return void send(ws, { t: 'error', error: 'Кімната заповнена' });
      const p: Player = { ws, side: other(r.settings.side), token: randomBytes(12).toString('hex') };
      r.players.push(p);
      me.room = r;
      me.player = p;
      send(ws, { t: 'joined', room: info(r), side: p.side, token: p.token });
      for (const q of r.players) if (q !== p) send(q.ws, { t: 'peer', connected: true });
      startRoom(r);
      return;
    }
    case 'rejoin': {
      const r = rooms.get(msg.roomId);
      const p = r?.players.find((x) => x.token === msg.token);
      if (!r || !p) return void send(ws, { t: 'error', error: 'Не вдалося повернутися до кімнати' });
      p.ws = ws;
      me.room = r;
      me.player = p;
      send(ws, { t: 'joined', room: info(r), side: p.side, token: p.token });
      if (r.mission) send(ws, { t: 'sync', state: r.mission.state, seq: r.seq });
      for (const q of r.players) if (q !== p) send(q.ws, { t: 'peer', connected: true });
      return;
    }
    case 'leave':
      return void drop(me, true);
    case 'cmd': {
      const r = me.room;
      const p = me.player;
      if (!r?.mission || !p) return;
      r.lastActive = Date.now();
      const s = r.mission.state;
      // Хід лише своєю стороною.
      const cmdSide = 'side' in msg.cmd ? (msg.cmd as { side: SideId }).side : s.turn.side;
      if (s.turn.side !== p.side || cmdSide !== p.side) return void send(ws, { t: 'sync', state: s, seq: r.seq, error: 'Зараз не ваш хід' });
      const res = r.mission.dispatch(msg.cmd);
      if (!res.ok) return void send(ws, { t: 'sync', state: s, seq: r.seq, error: res.error });
      r.seq++;
      for (const q of r.players) if (q !== p) send(q.ws, { t: 'cmd', seq: r.seq, side: p.side, cmd: msg.cmd });
      if (s.turn.phase === 'ended') console.log(`Кімната ${r.id}: бій завершено`);
      return;
    }
  }
}

function drop(me: { room: Room | null; player: Player | null }, leave: boolean): void {
  const r = me.room;
  const p = me.player;
  if (!r || !p) return;
  p.ws = null;
  for (const q of r.players) if (q !== p) send(q.ws, { t: 'peer', connected: false });
  if (leave || !r.mission) {
    r.players = r.players.filter((x) => x !== p);
    if (!r.players.length) rooms.delete(r.id);
  }
  me.room = null;
  me.player = null;
}

// Прибирання покинутих кімнат (2 години без дій).
setInterval(() => {
  for (const r of rooms.values()) if (Date.now() - r.lastActive > 2 * 3600_000 && r.players.every((p) => !p.ws)) rooms.delete(r.id);
}, 60_000);

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/api/health') {
    res.setHeader('Content-Type', 'application/json');
    return void res.end(JSON.stringify({ ok: true, name: 'WarFare', protocol: PROTOCOL_VERSION, rooms: rooms.size }));
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, '');
  if (!path || path.endsWith('/')) path += 'index.html';
  const file = resolve(ROOT, path);
  if (!file.startsWith(ROOT)) return void res.writeHead(403).end();
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
});

const wss = new WebSocketServer({ server: http, path: '/ws' });
wss.on('connection', (ws) => {
  const me: { room: Room | null; player: Player | null } = { room: null, player: null };
  ws.on('message', (data) => {
    try {
      onMessage(ws, me, JSON.parse(String(data)) as ClientMsg);
    } catch (e) {
      send(ws, { t: 'error', error: 'Помилка сервера' });
      console.error(e);
    }
  });
  ws.on('close', () => drop(me, false));
});

http.listen(PORT, () => {
  console.log(`WarFare сервер: http://localhost:${PORT}  (гра з папки ${ROOT})`);
});
