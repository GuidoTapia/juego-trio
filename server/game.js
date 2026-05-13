// Pure game logic for Trio (simple mode).
// All functions operate on a `room` object: they mutate it and append events to room.log.

const DECK = (() => {
  const cards = [];
  for (let n = 1; n <= 12; n++) for (let i = 0; i < 3; i++) cards.push(n);
  return cards;
})();

const DEAL_TABLE = {
  3: { perPlayer: 9, middle: 9 },
  4: { perPlayer: 7, middle: 8 },
  5: { perPlayer: 6, middle: 6 },
  6: { perPlayer: 5, middle: 6 },
};

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createRoom(code, hostName) {
  return {
    code,
    phase: "lobby",
    mode: "simple",
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

export function addPlayer(room, { id, name, isBot = false }) {
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
  };
  room.players.push(player);
  if (!room.hostId && !isBot) room.hostId = id;
  return player;
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

export function startGame(room) {
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
  room.currentPlayerIndex = Math.floor(Math.random() * n);
  room.phase = "playing";
  room.winner = null;
  room.turn = newTurnState();
  room.log = [];
  room.knownEnds = {};
  pushLog(room, "system", `La partida comienza. Empieza ${currentPlayer(room).name}.`);
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

function pushLog(room, kind, text, data = {}) {
  room.log.push({ t: Date.now(), kind, text, ...data });
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
    pushLog(room, "reveal",
      actor.id === target.id
        ? `${actor.name} revela su carta ${action.which === "lowest" ? "más baja" : "más alta"}: ${number}.`
        : `${actor.name} pide la carta ${action.which === "lowest" ? "más baja" : "más alta"} de ${target.name}: ${number}.`,
      { number, by: actor.id, from: target.id }
    );
  } else if (action.type === "middle") {
    const i = action.middleIndex;
    if (!Number.isInteger(i) || i < 0 || i >= room.middle.length) throw new Error("Carta del centro inválida");
    const cell = room.middle[i];
    if (!cell || cell.faceUp) throw new Error("Esa carta ya está revelada");
    reveal = { source: "middle", middleIndex: i, number: cell.number };
    cell.faceUp = true;
    pushLog(room, "reveal", `${actor.name} revela una carta del centro: ${cell.number}.`,
      { number: cell.number, by: actor.id, from: "middle" });
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
    pushLog(room, "trio", `¡${winner.name} completa el trio de ${target}!`, { number: target, by: winner.id });
    outcome = "trio";

    if (target === 7 || winner.trios.length >= 3) {
      room.phase = "ended";
      room.winner = winner.id;
      pushLog(room, "win",
        target === 7
          ? `${winner.name} GANA con el trio del 7!`
          : `${winner.name} GANA con 3 trios!`,
        { winner: winner.id }
      );
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
    pushLog(room, "fail",
      `Las cartas reveladas (${reveals.map(r => r.number).join(", ")}) no coinciden. Las cartas vuelven.`,
      { reveals: reveals.map((r) => r.number) }
    );
    outcome = "fail";
  } else {
    throw new Error("Resolución prematura");
  }

  // Advance turn.
  if (room.phase === "playing") {
    advanceTurn(room);
    room.turn = newTurnState();
    pushLog(room, "system", `Turno de ${currentPlayer(room).name}.`);
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
