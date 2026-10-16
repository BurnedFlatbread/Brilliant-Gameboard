// Online lobby server: Node built-ins only. Run with `node server.js` (PORT env optional).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, getLevelConfig } from './game/config.js';
import {
  createGame, placeStartNumber, clearStartNumber, setReady, rollRound, submitPlacement,
  resolveRound, allSubmitted, getLegalPlacements, currentRoller, targetScore,
} from './game/engine.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const lobbies = new Map();
const streams = new Map(); // lobbyId -> Set<{ res, token }>

const STATIC = {
  '/': ['client/index.html', 'text/html; charset=utf-8'],
  '/style.css': ['client/style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['client/favicon.svg', 'image/svg+xml'],
  '/favicon.ico': ['client/favicon.svg', 'image/svg+xml'],
  '/client/ui.js': ['client/ui.js', 'text/javascript; charset=utf-8'],
  '/game/config.js': ['game/config.js', 'text/javascript; charset=utf-8'],
  '/game/engine.js': ['game/engine.js', 'text/javascript; charset=utf-8'],
};

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const hash = (pw, salt) => scryptSync(pw, salt, 32);

function passwordOk(lobby, pw) {
  const h = hash(String(pw ?? ''), lobby.salt);
  return timingSafeEqual(h, lobby.pwHash);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10_000) { reject(new HttpError(413, 'Aanvraag te groot.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(new HttpError(400, 'Ongeldige JSON.')); }
    });
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function playerIndex(lobby, token) {
  return lobby.players.findIndex((p) => p.token === token);
}

const newPlayer = (name, token) => ({ name, token, connections: 0, leftAt: Date.now() });

function removePlayer(lobby, idx) {
  const [gone] = lobby.players.splice(idx, 1);
  for (const s of streams.get(lobby.id) || []) if (s.token === gone.token) s.res.end();
  if (lobby.players.length === 0) { lobbies.delete(lobby.id); streams.delete(lobby.id); } else broadcast(lobby);
}

function lobbySummary(l) {
  return { id: l.id, name: l.name, level: l.level, players: l.players.length, maxPlayers: l.maxPlayers, status: l.status };
}

function viewFor(lobby, token) {
  const me = playerIndex(lobby, token);
  const v = {
    lobby: {
      id: lobby.id, name: lobby.name, level: lobby.level, maxPlayers: lobby.maxPlayers, status: lobby.status,
      players: lobby.players.map((p) => p.name), me, isHost: me === 0,
    },
    game: null,
  };
  const g = lobby.game;
  if (!g) return v;
  const placing = g.phase === 'placing';
  v.game = {
    phase: g.phase,
    round: g.round,
    dice: g.dice,
    order: g.order,
    roller: g.order.length ? currentRoller(g) : null,
    target: targetScore(g),
    scores: g.players.map((p, i) => ({ name: p.name, score: p.score, ready: p.ready, done: !!g.pending[i] })),
    cells: g.players[me].cells,
    completed: g.players[me].completed,
    legal: placing && !g.pending[me] ? getLegalPlacements(g, me) : [],
    pending: !!g.pending[me],
    claims: g.areaClaims,
    lastResolution: g.lastResolution,
    winners: g.winners,
  };
  return v;
}

function broadcast(lobby) {
  for (const s of streams.get(lobby.id) || []) {
    s.res.write(`data: ${JSON.stringify(viewFor(lobby, s.token))}\n\n`);
  }
}

function getLobby(id) {
  const l = lobbies.get(id);
  if (!l) throw new HttpError(404, 'Lobby niet gevonden.');
  return l;
}

function applyAction(lobby, me, body) {
  const g = lobby.game;
  if (!g) throw new HttpError(400, 'Het spel is nog niet gestart.');
  let r;
  switch (body.type) {
    case 'startNumber': r = placeStartNumber(g, me, { index: Number(body.index), number: Number(body.number) }); break;
    case 'clearStart': r = clearStartNumber(g, me, Number(body.index)); break;
    case 'ready': r = setReady(g, me); break;
    case 'roll': r = rollRound(g, me); break;
    case 'place': r = submitPlacement(g, me, { index: Number(body.index), die: Number(body.die) }); break;
    case 'pass': r = submitPlacement(g, me, null); break;
    default: throw new HttpError(400, 'Onbekende actie.');
  }
  if (!r.ok) throw new HttpError(400, r.reason);
  if (g.phase === 'placing' && allSubmitted(g)) resolveRound(g);
  if (g.phase === 'over') lobby.status = 'over';
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api, lobbies, [id], [verb]
  if (parts[1] !== 'lobbies') throw new HttpError(404, 'Niet gevonden.');

  if (parts.length === 2 && req.method === 'GET') {
    return send(res, 200, [...lobbies.values()].filter((l) => l.status === 'waiting' && l.players.length < l.maxPlayers && l.players[0].connections > 0).map(lobbySummary));
  }
  if (parts.length === 2 && req.method === 'POST') {
    const b = await readJson(req);
    const name = clean(b.name, 30);
    const playerName = clean(b.playerName, 20);
    const maxPlayers = Number(b.maxPlayers);
    const level = Number(b.level);
    const password = String(b.password ?? '');
    if (!LEVELS[level]) throw new HttpError(400, 'Kies een geldig level.');
    if (!name || !playerName) throw new HttpError(400, 'Lobbynaam en spelersnaam zijn verplicht.');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 5) throw new HttpError(400, 'Het aantal spelers moet 2-5 zijn.');
    if (!password || password.length > 100) throw new HttpError(400, 'Een lobbywachtwoord is verplicht.');
    const salt = randomBytes(16);
    const lobby = {
      id: randomBytes(6).toString('hex'), name, level, maxPlayers, salt, pwHash: hash(password, salt),
      players: [], status: 'waiting', game: null,
    };
    const token = randomBytes(16).toString('hex');
    lobby.players.push(newPlayer(playerName, token));
    lobbies.set(lobby.id, lobby);
    return send(res, 200, { lobbyId: lobby.id, token });
  }

  const lobby = getLobby(parts[2]);
  const verb = parts[3];

  if (verb === 'join' && req.method === 'POST') {
    const b = await readJson(req);
    if (!passwordOk(lobby, b.password)) throw new HttpError(403, 'Verkeerd wachtwoord.');
    if (lobby.status !== 'waiting') throw new HttpError(400, 'Het spel is al gestart.');
    if (lobby.players.length >= lobby.maxPlayers) throw new HttpError(400, 'De lobby is vol.');
    const playerName = clean(b.playerName, 20);
    if (!playerName) throw new HttpError(400, 'Spelersnaam is verplicht.');
    const token = randomBytes(16).toString('hex');
    lobby.players.push(newPlayer(playerName, token));
    broadcast(lobby);
    return send(res, 200, { lobbyId: lobby.id, token });
  }

  if (verb === 'events' && req.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (playerIndex(lobby, token) < 0) throw new HttpError(403, 'Je zit niet in deze lobby.');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const s = { res, token };
    if (!streams.has(lobby.id)) streams.set(lobby.id, new Set());
    streams.get(lobby.id).add(s);
    const player = lobby.players[playerIndex(lobby, token)];
    player.connections += 1;
    res.write(`data: ${JSON.stringify(viewFor(lobby, token))}\n\n`);
    const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(beat);
      streams.get(lobby.id)?.delete(s);
      player.connections -= 1;
      if (player.connections <= 0) player.leftAt = Date.now();
    });
    return undefined;
  }

  if ((verb === 'start' || verb === 'action' || verb === 'leave') && req.method === 'POST') {
    const b = await readJson(req);
    const me = playerIndex(lobby, String(b.token ?? ''));
    if (me < 0) throw new HttpError(403, 'Je zit niet in deze lobby.');
    if (verb === 'leave') {
      if (lobby.status === 'waiting') removePlayer(lobby, me);
      return send(res, 200, { ok: true });
    }
    if (verb === 'start') {
      if (me !== 0) throw new HttpError(403, 'Alleen de maker van de lobby kan starten.');
      if (lobby.status !== 'waiting') throw new HttpError(400, 'Al gestart.');
      if (lobby.players.length !== lobby.maxPlayers) throw new HttpError(400, 'De lobby is nog niet vol.');
      lobby.game = createGame(getLevelConfig(lobby.level), lobby.players.map((p) => p.name));
      lobby.status = 'playing';
    } else {
      applyAction(lobby, me, b);
    }
    broadcast(lobby);
    return send(res, 200, { ok: true });
  }
  throw new HttpError(404, 'Niet gevonden.');
}

// Players without a connection are dropped after a grace period; empty lobbies are deleted.
setInterval(() => {
  const now = Date.now();
  for (const lobby of [...lobbies.values()]) {
    if (lobby.status === 'waiting') {
      for (let i = lobby.players.length - 1; i >= 0; i--) {
        const p = lobby.players[i];
        if (p.connections <= 0 && now - p.leftAt > 30_000) removePlayer(lobby, i);
      }
    } else {
      const grace = lobby.status === 'playing' ? 10 * 60_000 : 30_000;
      const idle = lobby.players.every((p) => p.connections <= 0 && now - p.leftAt > grace);
      if (idle) { lobbies.delete(lobby.id); streams.delete(lobby.id); }
    }
  }
}, 10_000).unref();

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const entry = STATIC[url.pathname];
    if (!entry) throw new HttpError(404, 'Niet gevonden.');
    const data = await readFile(path.join(ROOT, entry[0]));
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    return res.end(data);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Serverfout.' : e.message });
    else res.end();
    return undefined;
  }
}).listen(PORT, () => console.log(`Brilliant server on http://localhost:${PORT}`));
