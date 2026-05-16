// Socket.IO API layer: translates client events into game/orchestrator calls.
// This is the only place that touches `socket`; rules live in game.js and
// timing/bots in orchestrator.js.

import {
  createRoom,
  addPlayer,
  removePlayer,
  rejoinPlayer,
  startGame,
  applyReveal,
  currentPlayer,
  resetToLobby,
  setMode,
  pushLog,
} from "./game.js";
import {
  generateCode,
  addRoom,
  getRoom,
  deleteRoom,
  bindSocket,
  unbindSocket,
  codeOf,
  botId,
} from "./rooms.js";
import {
  broadcastRoom,
  scheduleBotTurn,
  scheduleResolveIfPending,
  scheduleBotTakeover,
  cancelBotTakeover,
  refreshTurnTimer,
} from "./orchestrator.js";

const BOT_NAMES = ["Alan", "Babbage", "Lovelace", "Turing", "Hopper", "Knuth"];
const EMPTY_ROOM_GRACE_MS = 60_000;

// Wraps a handler body so every error becomes a clean { ok:false } callback.
function guard(cb, fn) {
  try {
    fn();
  } catch (e) {
    cb?.({ ok: false, error: e.message });
  }
}

export function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("createRoom", ({ name, token, tutorial } = {}, cb) => guard(cb, () => {
      const trimmed = (name || "").trim();
      if (!trimmed) throw new Error("Nombre requerido");
      const code = generateCode();
      const room = createRoom(code, trimmed);
      // Tutorial rooms skip the AFK takeover — the coachmark overlay blocks
      // input while the new player reads it.
      if (tutorial) room.tutorial = true;
      addPlayer(room, { id: socket.id, name: trimmed, isBot: false, token });
      addRoom(code, room);
      bindSocket(socket.id, code);
      socket.join(code);
      cb?.({ ok: true, code });
      broadcastRoom(code);
    }));

    socket.on("joinRoom", ({ code, name, token } = {}, cb) => guard(cb, () => {
      const trimmed = (name || "").trim();
      if (!trimmed) throw new Error("Nombre requerido");
      const upper = (code || "").toUpperCase().trim();
      const room = getRoom(upper);
      if (!room) throw new Error("Sala no encontrada");

      // If the token matches a player already in this room, treat it as a
      // reconnect: rebind their existing slot to this socket instead of
      // creating a duplicate.
      if (token) {
        const result = rejoinPlayer(room, token, socket.id);
        if (result) {
          unbindSocket(result.oldId);
          bindSocket(socket.id, upper);
          socket.join(upper);
          cancelBotTakeover(token); // they made it back in time
          cb?.({
            ok: true,
            code: upper,
            rejoined: true,
            botControlled: !!result.player.botControlled,
          });
          broadcastRoom(upper);
          return;
        }
      }

      addPlayer(room, { id: socket.id, name: trimmed, isBot: false, token });
      bindSocket(socket.id, upper);
      socket.join(upper);
      cb?.({ ok: true, code: upper });
      broadcastRoom(upper);
    }));

    socket.on("addBot", (_, cb) => guard(cb, () => {
      const code = codeOf(socket.id);
      const room = getRoom(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede añadir bots");
      const used = new Set(room.players.map((p) => p.name.toLowerCase()));
      const base =
        BOT_NAMES.find((n) => !used.has(`${n} 🤖`.toLowerCase())) ||
        `Bot${room.players.length}`;
      const name = `${base} 🤖`;
      addPlayer(room, { id: botId(room, base), name, isBot: true });
      broadcastRoom(code);
      cb?.({ ok: true });
    }));

    socket.on("removeBot", ({ playerId } = {}, cb) => guard(cb, () => {
      const code = codeOf(socket.id);
      const room = getRoom(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede");
      const target = room.players.find((p) => p.id === playerId);
      if (!target || !target.isBot) throw new Error("No es un bot");
      removePlayer(room, playerId);
      broadcastRoom(code);
      cb?.({ ok: true });
    }));

    socket.on("takeControl", (_, cb) => guard(cb, () => {
      const code = codeOf(socket.id);
      const room = getRoom(code);
      if (!room) throw new Error("Sala inexistente");
      const player = room.players.find((p) => p.id === socket.id);
      if (!player) throw new Error("No estás en la sala");
      if (!player.botControlled) throw new Error("Ya tienes el control");
      player.botControlled = false;
      pushLog(room, "system", "log.control_resumed", { name: player.name });
      broadcastRoom(code);
      refreshTurnTimer(code); // they're back at the wheel — restart the idle watch
      cb?.({ ok: true });
    }));

    socket.on("setMode", ({ mode } = {}, cb) => guard(cb, () => {
      const code = codeOf(socket.id);
      const room = getRoom(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede cambiar el modo");
      setMode(room, mode);
      broadcastRoom(code);
      cb?.({ ok: true });
    }));

    socket.on("startGame", (payload = {}, cb) => guard(cb, () => {
      const code = codeOf(socket.id);
      const room = getRoom(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede empezar");
      // Honour an explicit starting player (the tutorial makes the human play
      // the first turn).
      startGame(room, { firstPlayerId: payload?.firstPlayerId });
      broadcastRoom(code);
      scheduleBotTurn(code);
      cb?.({ ok: true });
    }));

    socket.on("action", ({ action } = {}, cb) => guard(cb, () => {
      const code = codeOf(socket.id);
      const room = getRoom(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.phase !== "playing") throw new Error("Partida no activa");
      if (currentPlayer(room).id !== socket.id) throw new Error("No es tu turno");
      applyReveal(room, socket.id, action);
      broadcastRoom(code);
      scheduleResolveIfPending(code);
      refreshTurnTimer(code); // the player acted — reset their idle window
      cb?.({ ok: true });
    }));

    socket.on("playAgain", (_, cb) => guard(cb, () => {
      const code = codeOf(socket.id);
      const room = getRoom(code);
      if (!room) throw new Error("Sala inexistente");
      if (room.hostId !== socket.id) throw new Error("Solo el anfitrión puede");
      if (room.phase !== "ended") throw new Error("La partida no terminó");
      resetToLobby(room);
      broadcastRoom(code);
      cb?.({ ok: true });
    }));

    socket.on("leaveRoom", () => leave(socket));
    socket.on("disconnect", () => leave(socket));
  });
}

// Detach a socket from its room. Mid-game this keeps the seat (and arms a bot
// takeover); in the lobby it removes the player outright.
function leave(socket) {
  const code = codeOf(socket.id);
  if (!code) return;
  unbindSocket(socket.id);
  const room = getRoom(code);
  if (!room) return;

  // Capture the player before removePlayer mutates their state.
  const player = room.players.find((p) => p.id === socket.id);
  removePlayer(room, socket.id);

  // Mid-game: arm a bot takeover so the table doesn't freeze on an absent
  // player. Seats already bot-controlled keep their bot (no new timer).
  if (
    room.phase === "playing" &&
    player &&
    !player.isBot &&
    !player.botControlled &&
    player.token
  ) {
    scheduleBotTakeover(code, player.token);
  }

  // Drop the room if it has no connected humans after a short grace period.
  const connectedHumans = room.players.filter((p) => !p.isBot && p.connected);
  if (connectedHumans.length === 0) {
    setTimeout(() => {
      const r = getRoom(code);
      if (!r) return;
      const stillEmpty = r.players.filter((p) => !p.isBot && p.connected).length === 0;
      if (stillEmpty) deleteRoom(code);
    }, EMPTY_ROOM_GRACE_MS);
  }
  broadcastRoom(code);
}
