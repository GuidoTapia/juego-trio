// Pure game state machine for Trio.
//
// Mode-blind: how a win is detected and how many cards are dealt come from
// ./modes.js. Every function operates on a `room` object, mutating it and
// appending events to room.log. No I/O, no timers — see orchestrator.js.

import { DEAL_TABLE, MODES, DEFAULT_MODE, isValidMode, winLogKey } from "./modes.js";

const DECK = (() => {
  const cards = [];
  for (let n = 1; n <= 12; n++) for (let i = 0; i < 3; i++) cards.push(n);
  return cards;
})();

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createRoom(code, hostName, mode = DEFAULT_MODE) {
  return {
    code,
    phase: "lobby",
    mode: isValidMode(mode) ? mode : DEFAULT_MODE,
    hostId: null,
    players: [],
    middle: [],
    currentPlayerIndex: 0,
    turn: null,
    winner: null,
    log: [],
    // Public knowledge accumulated across turns: per playerId, the lowest/highest
    // numbers ever seen revealed from their hand (still in their hand because
    // the cards either belong to a failed turn or were observed before any trio
    // success that involved this player). Invalidated when a player loses cards.
    knownEnds: {},
    createdAt: Date.now(),
  };
}

// Change the game mode. Only allowed while still in the lobby.
export function setMode(room, mode) {
  if (room.phase !== "lobby") throw new Error("La partida ya empezó");
  if (!isValidMode(mode)) throw new Error("Modo inválido");
  room.mode = mode;
}

export function addPlayer(room, { id, name, isBot = false, token = null }) {
  if (room.phase !== "lobby") throw new Error("La partida ya empezó");
  if (room.players.length >= 6) throw new Error("Sala llena");
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    throw new Error("Ese nombre ya está en uso");
  const player = {
    id,
    name,
    isBot,
    hand: [],
    trios: [],
    connected: true,
    // Persistent identity (set by the client, survives socket disconnects).
    token,
    // True when a bot has taken over this human's seat after a long absence.
    // The player can reclaim it on reconnect.
    botControlled: false,
  };
  room.players.push(player);
  if (!room.hostId && !isBot) room.hostId = id;
  return player;
}

// Rebind an existing player slot (matched by token) to a new socket ID.
// Returns the player or null if no match. Caller should also update
// socketRoom and hostId tracking.
export function rejoinPlayer(room, token, newSocketId) {
  if (!token) return null;
  const player = room.players.find((p) => p.token === token && !p.isBot);
  if (!player) return null;
  const oldId = player.id;
  player.id = newSocketId;
  player.connected = true;
  if (room.hostId === oldId) room.hostId = newSocketId;
  return { player, oldId };
}

export function removePlayer(room, id) {
  const idx = room.players.findIndex((p) => p.id === id);
  if (idx === -1) return;
  if (room.phase === "lobby") {
    room.players.splice(idx, 1);
    if (room.hostId === id) {
      const nextHuman = room.players.find((p) => !p.isBot);
      room.hostId = nextHuman ? nextHuman.id : null;
    }
  } else {
    room.players[idx].connected = false;
  }
}

export function startGame(room, opts = {}) {
  if (room.phase !== "lobby") throw new Error("Ya en juego");
  const n = room.players.length;
  if (n < 3 || n > 6) throw new Error("Trio requiere 3-6 jugadores");
  const conf = DEAL_TABLE[n];

  const deck = shuffled(DECK);
  for (const p of room.players) {
    p.hand = deck.splice(0, conf.perPlayer).sort((a, b) => a - b);
    p.trios = [];
  }
  room.middle = deck.splice(0, conf.middle).map((number) => ({ number, faceUp: false }));

  if (opts.firstPlayerId) {
    const idx = room.players.findIndex((p) => p.id === opts.firstPlayerId);
    room.currentPlayerIndex = idx >= 0 ? idx : 0;
  } else {
    room.currentPlayerIndex = Math.floor(Math.random() * n);
  }

  room.phase = "playing";
  room.winner = null;
  room.turn = newTurnState();
  room.log = [];
  room.knownEnds = {};
  pushLog(room, "system", "log.start", { name: currentPlayer(room).name });
}

function newTurnState() {
  return {
    reveals: [],
    target: null,
    pendingResolve: false,
  };
}

export function currentPlayer(room) {
  return room.players[room.currentPlayerIndex];
}

// Append a translatable event to the room log. Exported so the orchestrator
// can record its own system events (bot takeover, etc.) the same way.
export function pushLog(room, kind, i18nKey, params = {}) {
  room.log.push({ t: Date.now(), kind, i18nKey, params });
  if (room.log.length > 200) room.log.shift();
}

// Returns the visible hand size (a player can be asked only if they have cards).
export function handSize(player) {
  return player.hand.length;
}

// What positions of a player's hand are still "available" (not currently revealed during this turn).
function availableHandIndices(room, playerId) {
  const set = new Set(room.turn.reveals
    .filter((r) => r.source === "player" && r.playerId === playerId)
    .map((r) => r.handIndex));
  const player = room.players.find((p) => p.id === playerId);
  const out = [];
  for (let i = 0; i < player.hand.length; i++) if (!set.has(i)) out.push(i);
  return out;
}

function availableMiddleIndices(room) {
  return room.middle
    .map((m, i) => (m && !m.faceUp ? i : -1))
    .filter((i) => i >= 0);
}

// Pick lowest/highest available index from a player's sorted hand.
function pickEndIndex(room, playerId, which) {
  const avail = availableHandIndices(room, playerId);
  if (avail.length === 0) return null;
  return which === "lowest" ? avail[0] : avail[avail.length - 1];
}

export function legalActions(room) {
  if (room.phase !== "playing") return [];
  const actions = [];
  for (const p of room.players) {
    if (availableHandIndices(room, p.id).length === 0) continue;
    actions.push({ type: "ask", playerId: p.id, which: "lowest" });
    if (availableHandIndices(room, p.id).length > 1) {
      actions.push({ type: "ask", playerId: p.id, which: "highest" });
    }
  }
  for (const i of availableMiddleIndices(room)) {
    actions.push({ type: "middle", middleIndex: i });
  }
  return actions;
}

// Apply an action and return { revealedNumber, mismatched, trioCompleted }.
// Does NOT advance the turn here — callers can decide when to resolve.
export function applyReveal(room, actorId, action) {
  if (room.phase !== "playing") throw new Error("Partida no activa");
  const actor = currentPlayer(room);
  if (actor.id !== actorId) throw new Error("No es tu turno");
  if (room.turn.pendingResolve) throw new Error("Revelación pendiente de resolver");

  let reveal;
  if (action.type === "ask") {
    const target = room.players.find((p) => p.id === action.playerId);
    if (!target) throw new Error("Jugador no existe");
    const idx = pickEndIndex(room, target.id, action.which);
    if (idx === null) throw new Error("Ese jugador no tiene cartas disponibles");
    const number = target.hand[idx];
    reveal = {
      source: "player",
      playerId: target.id,
      playerName: target.name,
      handIndex: idx,
      which: action.which,
      number,
    };
    const key = actor.id === target.id
      ? (action.which === "lowest" ? "log.reveal_self_low" : "log.reveal_self_high")
      : (action.which === "lowest" ? "log.reveal_ask_low" : "log.reveal_ask_high");
    pushLog(room, "reveal", key, { actor: actor.name, target: target.name, number });
  } else if (action.type === "middle") {
    const i = action.middleIndex;
    if (!Number.isInteger(i) || i < 0 || i >= room.middle.length) throw new Error("Carta del centro inválida");
    const cell = room.middle[i];
    if (!cell || cell.faceUp) throw new Error("Esa carta ya está revelada");
    reveal = { source: "middle", middleIndex: i, number: cell.number };
    cell.faceUp = true;
    pushLog(room, "reveal", "log.reveal_middle", { actor: actor.name, number: cell.number });
  } else {
    throw new Error("Acción desconocida");
  }

  room.turn.reveals.push(reveal);

  // Determine target / mismatch / trio outcomes.
  let mismatched = false;
  let trioCompleted = false;
  if (room.turn.target === null) {
    room.turn.target = reveal.number;
  } else if (reveal.number !== room.turn.target) {
    mismatched = true;
  } else if (room.turn.reveals.length === 3
      && room.turn.reveals.every((r) => r.number === room.turn.target)) {
    trioCompleted = true;
  }

  room.turn.pendingResolve = mismatched || trioCompleted;
  return { reveal, mismatched, trioCompleted };
}

// Finalize the turn: either return cards (mismatch) or award trio (success).
// Then advance to next player. Returns the outcome string.
export function resolveTurn(room) {
  if (!room.turn.pendingResolve && room.turn.reveals.length === 0) {
    throw new Error("Nada que resolver");
  }
  const target = room.turn.target;
  const reveals = room.turn.reveals;
  const last = reveals[reveals.length - 1];
  const allMatch = reveals.length === 3 && reveals.every((r) => r.number === target);

  let outcome;
  if (allMatch) {
    // Award trio: physically remove each card from its source.
    // Group reveals by source so we remove highest indices first.
    const byPlayer = new Map();
    const middleIdx = [];
    for (const r of reveals) {
      if (r.source === "player") {
        if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, []);
        byPlayer.get(r.playerId).push(r.handIndex);
      } else {
        middleIdx.push(r.middleIndex);
      }
    }
    for (const [pid, idxs] of byPlayer) {
      const p = room.players.find((x) => x.id === pid);
      idxs.sort((a, b) => b - a);
      for (const i of idxs) p.hand.splice(i, 1);
    }
    // Mark middle slots as taken instead of splicing — the layout stays stable
    // so the remaining cards don't visually jump around.
    for (const i of middleIdx) room.middle[i] = null;

    // Knowledge about the ends of contributing players is now stale.
    invalidateKnownEnds(room, reveals);

    const winner = currentPlayer(room);
    winner.trios.push(target);
    pushLog(room, "trio", "log.trio_completed", { name: winner.name, number: target });
    outcome = "trio";

    // Win detection is delegated to the active mode.
    const winReason = MODES[room.mode].checkWin(winner.trios);
    if (winReason) {
      room.phase = "ended";
      room.winner = winner.id;
      pushLog(room, "win", winLogKey(winReason), { name: winner.name });
    }
  } else if (last && reveals.length >= 2 && last.number !== target) {
    // Mismatch: return all revealed cards to their origins.
    // Middle cards revealed during this turn flip back face-down.
    for (const r of reveals) {
      if (r.source === "middle") {
        const cell = room.middle[r.middleIndex];
        if (cell) cell.faceUp = false;
      }
      // Player-source cards stay in their hand (they were never moved).
    }
    // Failed reveals are public information that survives across turns.
    recordKnownEnds(room, reveals);
    pushLog(room, "fail", "log.fail", { reveals: reveals.map((r) => r.number).join(", ") });
    outcome = "fail";
  } else {
    throw new Error("Resolución prematura");
  }

  // Advance turn.
  if (room.phase === "playing") {
    advanceTurn(room);
    room.turn = newTurnState();
    pushLog(room, "system", "log.turn_change", { name: currentPlayer(room).name });
  } else {
    room.turn = newTurnState();
  }
  return outcome;
}

function advanceTurn(room) {
  const n = room.players.length;
  // Always advance to the next index. Even if hand is empty, the player can still play
  // using the middle and opponents' cards (per rules).
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % n;
}

// Send a finished room back to the lobby for a rematch, keeping the same
// players (and their tokens / bot-control flags reset).
export function resetToLobby(room) {
  room.phase = "lobby";
  room.winner = null;
  room.middle = [];
  room.turn = null;
  room.log = [];
  room.knownEnds = {};
  for (const p of room.players) {
    p.hand = [];
    p.trios = [];
    p.botControlled = false;
  }
}

function recordKnownEnds(room, reveals) {
  for (const r of reveals) {
    if (r.source !== "player") continue;
    if (!room.knownEnds[r.playerId]) {
      room.knownEnds[r.playerId] = { lowest: null, highest: null };
    }
    const k = room.knownEnds[r.playerId];
    if (r.which === "lowest") {
      k.lowest = k.lowest === null ? r.number : Math.min(k.lowest, r.number);
    } else {
      k.highest = k.highest === null ? r.number : Math.max(k.highest, r.number);
    }
  }
}

function invalidateKnownEnds(room, reveals) {
  for (const r of reveals) {
    if (r.source !== "player") continue;
    const k = room.knownEnds[r.playerId];
    if (!k) continue;
    if (r.which === "lowest") k.lowest = null;
    else k.highest = null;
  }
}

// Hide info the actor shouldn't see (other players' hand numbers + middle face-down numbers).
export function viewFor(room, viewerId) {
  const v = {
    code: room.code,
    phase: room.phase,
    mode: room.mode,
    hostId: room.hostId,
    currentPlayerId: room.players[room.currentPlayerIndex]?.id ?? null,
    winner: room.winner,
    log: room.log.slice(-40),
    middle: room.middle.map((m, i) => ({
      index: i,
      taken: m === null,
      faceUp: m ? m.faceUp : false,
      number: m && m.faceUp ? m.number : null,
    })),
    turn: room.turn ? {
      target: room.turn.target,
      pendingResolve: room.turn.pendingResolve,
      reveals: room.turn.reveals.map((r) =>
        r.source === "player"
          ? {
              source: "player",
              playerId: r.playerId,
              playerName: r.playerName,
              which: r.which,
              number: r.number,
            }
          : { source: "middle", middleIndex: r.middleIndex, number: r.number }
      ),
    } : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      botControlled: !!p.botControlled,
      connected: p.connected,
      handSize: p.hand.length,
      trios: p.trios.slice(),
      hand: p.id === viewerId ? p.hand.slice() : null,
    })),
    you: viewerId,
  };
  return v;
}

export function maybeResolveAuto(room) {
  if (room.turn?.pendingResolve) return resolveTurn(room);
  return null;
}
