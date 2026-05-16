// Real-time orchestration layer: everything that needs timers or the socket
// server. Drives bot turns, paces reveal resolution, broadcasts room state,
// and hands a seat to a bot when a player is gone too long.
//
// game.js stays pure; this module is where time and I/O live.

import { getRoom } from "./rooms.js";
import { currentPlayer, applyReveal, resolveTurn, viewFor, pushLog } from "./game.js";
import { chooseBotAction } from "./bot.js";

// How long the final reveal stays on the table before resolving, so a player
// who blinked can still read the outcome.
const RESOLVE_DELAY_MS = 2500;

// Pacing between a bot's individual reveals.
const BOT_FIRST_REVEAL_MS = 800;
const BOT_NEXT_REVEAL_MS = 1100;

// How long a player can be disconnected mid-game before a bot takes their seat.
// Overridable via env (tests use a short value).
const BOT_TAKEOVER_MS = Number(process.env.BOT_TAKEOVER_MS) || 30_000;

const takeoverTimers = new Map(); // playerToken -> timeout handle

let io = null;

export function initOrchestrator(socketServer) {
  io = socketServer;
}

// A seat is auto-played when it's a real bot OR a human whose seat a bot took
// over after a long disconnect.
export function isAutoPlayed(player) {
  return !!player && (player.isBot || player.botControlled);
}

export function broadcastRoom(code) {
  const room = getRoom(code);
  if (!room) return;
  for (const p of room.players) {
    if (p.isBot || !p.connected) continue;
    io.to(p.id).emit("state", viewFor(room, p.id));
  }
}

// If the current seat is auto-played, schedule its next step.
export function scheduleBotTurn(code) {
  const room = getRoom(code);
  if (!room || room.phase !== "playing") return;
  if (!isAutoPlayed(currentPlayer(room))) return;
  if (room.turn.pendingResolve) {
    setTimeout(() => doResolve(code), RESOLVE_DELAY_MS);
    return;
  }
  const delay = room.turn.reveals.length === 0 ? BOT_FIRST_REVEAL_MS : BOT_NEXT_REVEAL_MS;
  setTimeout(() => doBotMove(code), delay);
}

function doBotMove(code) {
  const room = getRoom(code);
  if (!room || room.phase !== "playing") return;
  const player = currentPlayer(room);
  // Re-check at fire time: a human may have reclaimed their seat since this
  // move was scheduled.
  if (!isAutoPlayed(player)) return;
  if (room.turn.pendingResolve) {
    setTimeout(() => doResolve(code), RESOLVE_DELAY_MS);
    return;
  }
  const action = chooseBotAction(room, player.id);
  if (!action) return;
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
    setTimeout(() => doBotMove(code), BOT_NEXT_REVEAL_MS);
  }
}

function doResolve(code) {
  const room = getRoom(code);
  if (!room || !room.turn?.pendingResolve) return;
  try {
    resolveTurn(room);
  } catch (e) {
    console.error("Resolve error:", e.message);
    return;
  }
  broadcastRoom(code);
  if (room.phase === "playing") scheduleBotTurn(code);
}

// Called after a human's reveal: if the turn is now ready to resolve, pace it.
export function scheduleResolveIfPending(code) {
  const room = getRoom(code);
  if (room?.turn?.pendingResolve) {
    setTimeout(() => doResolve(code), RESOLVE_DELAY_MS);
  }
}

// Arm a timer: if the player (by token) is still away when it fires, hand
// their seat to a bot so the game keeps moving.
export function scheduleBotTakeover(code, token) {
  if (!token) return;
  clearTimeout(takeoverTimers.get(token));
  const timer = setTimeout(() => {
    takeoverTimers.delete(token);
    const room = getRoom(code);
    if (!room || room.phase !== "playing") return;
    const p = room.players.find((x) => x.token === token);
    if (!p || p.connected || p.botControlled) return;
    p.botControlled = true;
    pushLog(room, "system", "log.bot_takeover", { name: p.name });
    broadcastRoom(code);
    scheduleBotTurn(code); // in case it's already their turn
  }, BOT_TAKEOVER_MS);
  takeoverTimers.set(token, timer);
}

export function cancelBotTakeover(token) {
  if (!token) return;
  clearTimeout(takeoverTimers.get(token));
  takeoverTimers.delete(token);
}
