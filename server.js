// RunningMan — tiny 2-player relay server
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'public', 'index.html');

const server = http.createServer((req, res) => {
  fs.readFile(INDEX, (err, data) => {
    if (err) { res.writeHead(500); return res.end('server error'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

let lobby = null; // one waiting player

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function startRound(room) {
  room.roundOver = false;
  room.again = [false, false];
  const seed = (Math.random() * 0xffffffff) >>> 0;
  room.players.forEach((p, i) => send(p, { t: 'start', seed, you: i }));
}

function makeRoom(a, b) {
  const room = { players: [a, b], roundOver: false, again: [false, false] };
  a.room = b.room = room;
  a.idx = 0; b.idx = 1;
  startRound(room);
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = ws.room;

    if (msg.t === 'state' && room) {
      send(room.players[1 - ws.idx], { t: 'peer', d: msg.d, x: msg.x, z: msg.z });
    } else if (msg.t === 'dead' && room && !room.roundOver) {
      room.roundOver = true;
      const winner = 1 - ws.idx;
      room.players.forEach((p, i) =>
        send(p, { t: 'end', win: i === winner, reason: msg.reason, dist: msg.d | 0 }));
    } else if (msg.t === 'again' && room) {
      room.again[ws.idx] = true;
      if (room.again[0] && room.again[1]) startRound(room);
      else send(room.players[1 - ws.idx], { t: 'peerReady' });
    }
  });

  ws.on('close', () => {
    if (ws.room) {
      const other = ws.room.players[1 - ws.idx];
      other.room = null;
      send(other, { t: 'peerLeft' });
      // put the survivor back in the lobby
      if (other.readyState === other.OPEN) {
        if (lobby && lobby !== other && lobby.readyState === lobby.OPEN) makeRoom(lobby, other), lobby = null;
        else lobby = other;
      }
    } else if (lobby === ws) {
      lobby = null;
    }
  });

  // matchmaking
  if (lobby && lobby.readyState === lobby.OPEN && lobby !== ws) {
    const a = lobby; lobby = null;
    makeRoom(a, ws);
  } else {
    lobby = ws;
    send(ws, { t: 'wait' });
  }
});

server.listen(PORT, () => {
  console.log(`RunningMan on http://localhost:${PORT}`);
  console.log(`Share it:  cloudflared tunnel --url http://localhost:${PORT}`);
});
