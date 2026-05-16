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
const BOT_TAKEOVER_MS = Number(process.env.BOT_TAKEOVER_MS) || 15_000;

// How long a connected player can sit on their turn doing nothing before a bot
// takes over, so the table isn't stalled by an AFK player.
const TURN_IDLE_MS = Number(process.env.TURN_IDLE_MS) || 30_000;

const takeoverTimers = new Map(); // playerToken -> timeout handle
const turnIdleTimers = new Map(); // roomCode  -> timeout handle

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

// If the current seat is auto-played, schedule its next step. If it's a
// connected human, start watching for inactivity instead.
export function scheduleBotTurn(code) {
  const room = getRoom(code);
  if (!room || room.phase !== "playing") return;
  if (!isAutoPlayed(currentPlayer(room))) {
    armTurnIdle(code);
    return;
  }
  clearTurnIdle(code);
  if (room.turn.pendingResolve) {
    setTimeout(() => doResolve(code), RESOLVE_DELAY_MS);
    return;
  }
  const delay = room.turn.reveals.length === 0 ? BOT_FIRST_REVEAL_MS : BOT_NEXT_REVEAL_MS;
  setTimeout(() => doBotMove(code), delay);
}

function clearTurnIdle(code) {
  clearTimeout(turnIdleTimers.get(code));
  turnIdleTimers.delete(code);
}

// (Re)arm the inactivity watch for the current seat. Only humans who are
// connected, on turn, and not already bot-controlled get watched — and never
// in a tutorial room (the coachmark overlay legitimately blocks input).
function armTurnIdle(code) {
  clearTurnIdle(code);
  const room = getRoom(code);
  if (!room || room.phase !== "playing" || room.tutorial) return;
  const player = currentPlayer(room);
  if (!player || isAutoPlayed(player) || !player.connected) return;
  const timer = setTimeout(() => {
    turnIdleTimers.delete(code);
    const r = getRoom(code);
    if (!r || r.phase !== "playing") return;
    const p = currentPlayer(r);
    if (!p || isAutoPlayed(p) || !p.connected) return;
    p.botControlled = true;
    pushLog(r, "system", "log.afk_takeover", { name: p.name });
    broadcastRoom(code);
    scheduleBotTurn(code);
  }, TURN_IDLE_MS);
  turnIdleTimers.set(code, timer);
}

// Re-evaluate the idle watch after any human input (a reveal, reclaiming a
// seat). Arms a fresh window if the turn continues; clears it otherwise.
export function refreshTurnTimer(code) {
  const room = getRoom(code);
  if (room && room.turn && room.turn.pendingResolve) {
    clearTurnIdle(code);
  } else {
    armTurnIdle(code);
  }
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
    // resolveTurn is built not to throw; this is a last-resort guard so an
    // unforeseen error can never leave the table frozen on pendingResolve.
    console.error("Resolve error:", e.message);
    room.turn = { reveals: [], target: null, pendingResolve: false };
  }
  broadcastRoom(code);
  if (room.phase === "playing") scheduleBotTurn(code);
  else clearTurnIdle(code);
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
