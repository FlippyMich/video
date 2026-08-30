#!/usr/bin/env node
/**
 * The collaboration relay.
 *
 * A deliberately small WebSocket server: it keeps track of who is in each room
 * and forwards messages between them. It does not store projects, it does not
 * merge anything, and it does not know what a scene is.
 *
 * The document lives with the clients. When somebody joins, the relay asks an
 * existing peer for a snapshot and forwards it. If everybody leaves, the room
 * disappears — which is the right behaviour for a tool where the project file
 * on your own disk is the real copy.
 *
 *   node server/collab.mjs [--port 8787]
 *
 * Then in the studio: Collaborate → connect to ws://localhost:8787
 */

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { parse } from 'node:url';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = Number(portArg >= 0 ? argv[portArg + 1] : process.env.PORT || 8787);

/** roomName -> Map<peerId, { socket, peer }> */
const rooms = new Map();

const wss = new WebSocketServer({ port: PORT });

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

wss.on('connection', (socket, request) => {
  const { query } = parse(request.url ?? '', true);
  const roomName = String(query.room ?? 'default').slice(0, 64);
  const id = randomUUID().slice(0, 8);

  let room = rooms.get(roomName);
  if (!room) {
    room = new Map();
    rooms.set(roomName, room);
  }

  let peer = { id, name: `Guest ${id.slice(0, 4)}`, colour: '#ffc23d', lastSeen: Date.now() };
  let joined = false;

  const others = () => [...room.values()].filter((e) => e.peer.id !== id);
  const sendTo = (target, message) => {
    if (target.socket.readyState === 1) target.socket.send(JSON.stringify(message));
  };
  const broadcast = (message) => { for (const entry of others()) sendTo(entry, message); };

  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }

    switch (message.type) {
      case 'hello': {
        // The name and colour are chosen by the client; everything else about
        // a peer is the relay's business.
        peer = {
          id,
          name: String(message.name ?? peer.name).slice(0, 40),
          colour: String(message.colour ?? peer.colour).slice(0, 16),
          lastSeen: Date.now(),
        };
        const existing = others().map((e) => e.peer);
        room.set(id, { socket, peer });
        joined = true;
        socket.send(JSON.stringify({ type: 'welcome', you: id, peers: existing }));
        broadcast({ type: 'joined', peer });
        log(`+ ${peer.name} (${id}) joined "${roomName}" — ${room.size} here`);
        break;
      }

      case 'presence': {
        if (!joined) return;
        peer = { ...peer, ...message.peer, id, lastSeen: Date.now() };
        room.set(id, { socket, peer });
        broadcast({ type: 'presence', peer });
        break;
      }

      case 'patch': {
        if (!joined || !message.patch) return;
        broadcast({ type: 'patch', patch: { ...message.patch, author: id } });
        break;
      }

      case 'snapshot-request': {
        if (!joined) return;
        // Ask exactly one peer — the longest-connected. Asking everybody would
        // send the whole project N times for one join.
        const [first] = others();
        if (first) sendTo(first, { type: 'snapshot-request', from: id });
        break;
      }

      case 'snapshot': {
        if (!joined) return;
        const target = room.get(message.to);
        if (target) sendTo(target, { type: 'snapshot', to: message.to, project: message.project, versions: message.versions });
        break;
      }

      default:
        break;
    }
  });

  socket.on('close', () => {
    room.delete(id);
    if (joined) {
      broadcast({ type: 'left', id });
      log(`- ${peer.name} (${id}) left "${roomName}" — ${room.size} here`);
    }
    if (room.size === 0) {
      rooms.delete(roomName);
      log(`  room "${roomName}" is empty and was dropped`);
    }
  });

  socket.on('error', () => socket.close());
});

// Drop sockets that have stopped answering: a laptop that sleeps leaves a
// connection that looks open forever, and its ghost stays in the peer list.
const HEARTBEAT = 30_000;
setInterval(() => {
  for (const [name, room] of rooms) {
    for (const [peerId, entry] of room) {
      if (entry.socket.readyState !== 1) {
        room.delete(peerId);
        continue;
      }
      entry.socket.ping();
    }
    if (room.size === 0) rooms.delete(name);
  }
}, HEARTBEAT).unref?.();

log(`BloomStudio collaboration relay listening on ws://localhost:${PORT}`);
log('Rooms are created on demand and disappear when the last person leaves.');
