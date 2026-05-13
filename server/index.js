import express from "express";
import http from "http";
import { Server as SocketServer } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

import {
  createRoom,
  addPlayer,
  removePlayer,
  startGame,
  applyReveal,
  resolveTurn,
  currentPlayer,
  viewFor,
  legalActions,
} from "./game.js";
import { chooseBotAction } from "./bot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "..", "public")));

const rooms = new Map(); // code -> room
const socketRoom = new Map(); // socketId -> code

// How long the final reveal stays on the table before resolving (trio is taken
// or mismatched cards are returned). Long enough for someone who blinked to
// still read the outcome.
const RESOLVE_DELAY_MS = 2500;

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 30; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("No se pudo generar código");
}

function botId(room, name) {
  let n = 1;
  let id;
  do {
    id = `bot:${name.replace(/\s+/g, "_")}:${n++}`;
  } while (room.players.some((p) => p.id === id));
  return id;
}

function broadcastRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const p of room.players) {
    if (p.isBot || !p.connected) continue;
    io.to(p.id).emit("state", viewFor(room, p.id));
  }
}

function scheduleBotTurn(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== "playing") return;
  const player = currentPlayer(room);
  if (!player || !player.isBot) return;
  if (room.turn.pendingResolve) {
    setTimeout(() => doResolve(code), RESOLVE_DELAY_MS);
    return;
  }
  setTimeout(() => doBotMove(code), room.turn.reveals.length === 0 ? 800 : 1100);
}

function doBotMove(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== "playing") return;
  const player = currentPlayer(room);
  if (!player || !player.isBot) return;
  if (room.turn.pendingResolve) {
    setTimeout(() => doResolve(code), RESOLVE_DELAY_MS);
    return;
  }
  const action = chooseBotAction(room, player.id);
  if (!action) {
    return;
  }
  try {
    applyReveal(room, player.id, action);
  } catch (e) {
    console.error("Bot error:", e.message);
    return;
  }
  broadcastRoom(code);
  if (room.turn.pendingResolve) {
    setTimeout(() => doResolve(code), RESOLVE_DELAY_MS);
  } else {
    setTimeout(() => doBotMove(code), 1100);
  }
}

function doResolve(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (!room.turn?.pendingResolve) return;
  try {
    resolveTurn(room);
  } catch (e) {
    console.error("Resolve error:", e.message);
    return;
  }
  broadcastRoom(code);
  if (room.phase === "playing") scheduleBotTurn(code);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }, cb) => {
    try {
      const trimmed = (name || "").trim();
      if (!trimmed) throw new Error("Nombre requerido");
      const code = generateCode();
      const room = createRoom(code, trimmed);
      addPlayer(room, { id: socket.id, name: trimmed, isBot: false });
      rooms.set(code, room);
      socketRoom.set(socket.id, code);
      socket.join(code);
      cb?.({ ok: true, code });
      broadcastRoom(code);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("joinRoom", ({ code, name }, cb) => {
    try {
      const trimmed = (name || "").trim();
      if (!trimmed) throw new Error("Nombre requerido");
      const upper = (code || "").toUpperCase().trim();
      const room = rooms.get(upper);
      if (!room) throw new Error("Sala no encontrada");
      addPlayer(room, { id: socket.id, name: trimmed, isBot: false });
      socketRoom.set(socket.id, upper);
      socket.join(upper);
      cb?.({ ok: true, code: upper });
      broadcastRoom(upper);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("addBot", (_, cb) => {
    try {
      const code = socketRoom.get(socket.id);
      const room = rooms.get(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede añadir bots");
      const names = ["Alan", "Babbage", "Lovelace", "Turing", "Hopper", "Knuth"];
      const used = new Set(room.players.map((p) => p.name.toLowerCase()));
      const base =
        names.find((n) => !used.has(`${n} 🤖`.toLowerCase())) ||
        `Bot${room.players.length}`;
      const name = `${base} 🤖`;
      addPlayer(room, { id: botId(room, base), name, isBot: true });
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("removeBot", ({ playerId }, cb) => {
    try {
      const code = socketRoom.get(socket.id);
      const room = rooms.get(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede");
      const target = room.players.find((p) => p.id === playerId);
      if (!target || !target.isBot) throw new Error("No es un bot");
      removePlayer(room, playerId);
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("startGame", (_, cb) => {
    try {
      const code = socketRoom.get(socket.id);
      const room = rooms.get(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede empezar");
      startGame(room);
      broadcastRoom(code);
      scheduleBotTurn(code);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("action", ({ action }, cb) => {
    try {
      const code = socketRoom.get(socket.id);
      const room = rooms.get(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.phase !== "playing") throw new Error("Partida no activa");
      const player = currentPlayer(room);
      if (player.id !== socket.id) throw new Error("No es tu turno");
      applyReveal(room, socket.id, action);
      broadcastRoom(code);
      if (room.turn.pendingResolve) {
        setTimeout(() => doResolve(code), RESOLVE_DELAY_MS);
      }
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("playAgain", (_, cb) => {
    try {
      const code = socketRoom.get(socket.id);
      const room = rooms.get(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede");
      if (room.phase !== "ended") throw new Error("La partida no terminó");
      room.phase = "lobby";
      room.winner = null;
      room.middle = [];
      room.turn = null;
      for (const p of room.players) {
        p.hand = [];
        p.trios = [];
      }
      room.log = [];
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("leaveRoom", () => {
    leave(socket);
  });

  socket.on("disconnect", () => {
    leave(socket);
  });
});

function leave(socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  socketRoom.delete(socket.id);
  const room = rooms.get(code);
  if (!room) return;
  removePlayer(room, socket.id);
  // If the room has no connected humans, drop it after a short grace period.
  const humansLeft = room.players.filter((p) => !p.isBot && p.connected);
  if (humansLeft.length === 0) {
    setTimeout(() => {
      const r = rooms.get(code);
      if (!r) return;
      const stillEmpty = r.players.filter((p) => !p.isBot && p.connected).length === 0;
      if (stillEmpty) rooms.delete(code);
    }, 60_000);
  }
  broadcastRoom(code);
}

server.listen(PORT, () => {
  console.log(`Trio server escuchando en http://localhost:${PORT}`);
});
