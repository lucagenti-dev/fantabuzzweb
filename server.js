const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 20000,
  pingInterval: 10000
});

app.use(express.static("public"));
app.get("/health", (_, res) => res.json({ ok: true }));

const rooms = new Map();
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_PLAYERS = 80;

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function safeText(value, max = 40) {
  return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, max);
}

function createRoom(hostSocket, settings = {}) {
  const code = makeCode();
  const room = {
    code,
    hostId: hostSocket.id,
    hostToken: crypto.randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    title: safeText(settings.title || "Asta tra amici", 60),
    item: "",
    basePrice: 1,
    currentBid: 0,
    leaderId: null,
    leaderName: "",
    status: "waiting",
    duration: 10,
    endAt: null,
    timer: null,
    sequence: 0,
    players: new Map(),
    history: []
  };
  rooms.set(code, room);
  hostSocket.join(code);
  return room;
}

function publicState(room) {
  return {
    code: room.code,
    title: room.title,
    item: room.item,
    basePrice: room.basePrice,
    currentBid: room.currentBid,
    leaderId: room.leaderId,
    leaderName: room.leaderName,
    status: room.status,
    duration: room.duration,
    endAt: room.endAt,
    sequence: room.sequence,
    playerCount: room.players.size,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      joinedAt: p.joinedAt
    })),
    history: room.history.slice(-12)
  };
}

function emitState(room) {
  room.updatedAt = Date.now();
  io.to(room.code).emit("state", publicState(room));
}

function clearTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function scheduleEnd(room) {
  clearTimer(room);
  if (!room.endAt) return;
  const delay = Math.max(0, room.endAt - Date.now());
  room.timer = setTimeout(() => {
    room.status = "sold";
    room.endAt = null;
    room.timer = null;
    room.sequence += 1;
    room.history.push({
      type: "sold",
      text: room.leaderName
        ? `${room.item || "Elemento"} assegnato a ${room.leaderName} per ${room.currentBid}`
        : `${room.item || "Elemento"} non assegnato`,
      at: Date.now()
    });
    emitState(room);
    io.to(room.code).emit("sound", "sold");
  }, delay);
}

function isHost(socket, room, token) {
  return socket.id === room.hostId || (token && token === room.hostToken);
}

io.on("connection", socket => {
  socket.on("createRoom", (payload, ack = () => {}) => {
    try {
      const room = createRoom(socket, payload || {});
      ack({ ok: true, code: room.code, hostToken: room.hostToken, state: publicState(room) });
    } catch {
      ack({ ok: false, error: "Impossibile creare la stanza." });
    }
  });

  socket.on("restoreHost", ({ code, hostToken }, ack = () => {}) => {
    const room = rooms.get(safeText(code, 8).toUpperCase());
    if (!room || hostToken !== room.hostToken) return ack({ ok: false, error: "Sessione host non valida." });
    room.hostId = socket.id;
    socket.join(room.code);
    ack({ ok: true, state: publicState(room) });
    emitState(room);
  });

  socket.on("joinRoom", ({ code, name, playerToken }, ack = () => {}) => {
    code = safeText(code, 8).toUpperCase();
    name = safeText(name, 24);
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: "Stanza inesistente o scaduta." });
    if (!name) return ack({ ok: false, error: "Inserisci il tuo nome." });

    let player = null;
    if (playerToken) {
      player = [...room.players.values()].find(p => p.token === playerToken);
    }

    if (!player) {
      if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, error: "Stanza piena." });
      const duplicate = [...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase());
      if (duplicate) return ack({ ok: false, error: "Nome già utilizzato." });
      player = {
        id: crypto.randomUUID(),
        token: crypto.randomUUID(),
        socketId: socket.id,
        name,
        joinedAt: Date.now(),
        connected: true,
        lastBidAt: 0
      };
      room.players.set(player.id, player);
    } else {
      player.socketId = socket.id;
      player.connected = true;
      if (name) player.name = name;
    }

    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    socket.join(code);
    ack({ ok: true, playerId: player.id, playerToken: player.token, state: publicState(room) });
    emitState(room);
  });

  socket.on("hostAction", ({ code, hostToken, action, payload }, ack = () => {}) => {
    const room = rooms.get(safeText(code, 8).toUpperCase());
    if (!room || !isHost(socket, room, hostToken)) return ack({ ok: false, error: "Non autorizzato." });
    payload = payload || {};

    if (action === "prepare") {
      clearTimer(room);
      room.item = safeText(payload.item, 60);
      room.basePrice = Math.max(0, Number(payload.basePrice) || 1);
      room.currentBid = room.basePrice - 1;
      room.duration = Math.min(60, Math.max(3, Number(payload.duration) || 10));
      room.leaderId = null;
      room.leaderName = "";
      room.status = "ready";
      room.endAt = null;
      room.history = [];
    } else if (action === "start") {
      clearTimer(room);
      room.status = "open";
      room.endAt = Date.now() + room.duration * 1000;
      room.sequence += 1;
      room.history.push({ type: "start", text: `Asta aperta: ${room.item || "Elemento"}`, at: Date.now() });
      scheduleEnd(room);
      io.to(room.code).emit("sound", "start");
    } else if (action === "pause") {
      clearTimer(room);
      room.status = "paused";
      room.endAt = null;
    } else if (action === "resume") {
      room.status = "open";
      room.endAt = Date.now() + room.duration * 1000;
      scheduleEnd(room);
    } else if (action === "sell") {
      clearTimer(room);
      room.status = "sold";
      room.endAt = null;
      room.sequence += 1;
      room.history.push({
        type: "sold",
        text: room.leaderName
          ? `${room.item || "Elemento"} assegnato a ${room.leaderName} per ${room.currentBid}`
          : `${room.item || "Elemento"} non assegnato`,
        at: Date.now()
      });
      io.to(room.code).emit("sound", "sold");
    } else if (action === "reset") {
      clearTimer(room);
      room.currentBid = Math.max(0, room.basePrice - 1);
      room.leaderId = null;
      room.leaderName = "";
      room.status = "ready";
      room.endAt = null;
      room.history = [];
    } else if (action === "kick") {
      const id = safeText(payload.playerId, 80);
      const p = room.players.get(id);
      if (p) {
        io.to(p.socketId).emit("kicked");
        const ps = io.sockets.sockets.get(p.socketId);
        if (ps) ps.leave(room.code);
        room.players.delete(id);
      }
    } else if (action === "title") {
      room.title = safeText(payload.title, 60) || room.title;
    } else {
      return ack({ ok: false, error: "Azione sconosciuta." });
    }

    emitState(room);
    ack({ ok: true });
  });

  socket.on("bid", ({ code, playerToken, increment }, ack = () => {}) => {
    const room = rooms.get(safeText(code, 8).toUpperCase());
    if (!room || room.status !== "open") return ack({ ok: false, error: "Asta non aperta." });

    const player = [...room.players.values()].find(p => p.token === playerToken);
    if (!player || player.socketId !== socket.id) return ack({ ok: false, error: "Giocatore non valido." });

    const now = Date.now();
    if (now - player.lastBidAt < 250) return ack({ ok: false, error: "Attendi un istante." });
    player.lastBidAt = now;

    increment = Number(increment);
    if (![1, 5, 10].includes(increment)) increment = 1;

    const minimum = room.currentBid < room.basePrice ? room.basePrice : room.currentBid + increment;
    room.currentBid = minimum;
    room.leaderId = player.id;
    room.leaderName = player.name;
    room.endAt = Date.now() + room.duration * 1000;
    room.sequence += 1;
    room.history.push({
      type: "bid",
      text: `${player.name}: ${room.currentBid}`,
      playerId: player.id,
      amount: room.currentBid,
      at: Date.now()
    });
    scheduleEnd(room);
    emitState(room);
    io.to(room.code).emit("sound", "bid");
    ack({ ok: true, amount: room.currentBid, sequence: room.sequence });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const id = socket.data.playerId;
    const room = rooms.get(code);
    if (room && id && room.players.has(id)) {
      const player = room.players.get(id);
      player.connected = false;
      emitState(room);
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.updatedAt < cutoff) {
      clearTimer(room);
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`FantaBuzz Web attivo sulla porta ${PORT}`);
});
