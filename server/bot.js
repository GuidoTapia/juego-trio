// Bot AI for Trio.
// Strategy notes:
//  - On the first reveal of a turn the bot tries to start a trio using
//    duplicates accessible at the extremes of its own hand.
//  - On subsequent reveals it commits to the target number, preferring
//    100%-success sources (own hand at the lowest/highest position),
//    then the middle (unknown), and finally asking opponents.

function availableHandIndices(room, playerId) {
  const set = new Set(
    room.turn.reveals
      .filter((r) => r.source === "player" && r.playerId === playerId)
      .map((r) => r.handIndex)
  );
  const p = room.players.find((x) => x.id === playerId);
  const out = [];
  for (let i = 0; i < p.hand.length; i++) if (!set.has(i)) out.push(i);
  return out;
}

function availableMiddleIndices(room) {
  return room.middle
    .map((m, i) => (m && !m.faceUp ? i : -1))
    .filter((i) => i >= 0);
}

function pickEndIndex(room, playerId, which) {
  const avail = availableHandIndices(room, playerId);
  if (avail.length === 0) return null;
  return which === "lowest" ? avail[0] : avail[avail.length - 1];
}

function endValue(room, playerId, which) {
  const i = pickEndIndex(room, playerId, which);
  if (i === null) return null;
  const p = room.players.find((x) => x.id === playerId);
  return p.hand[i];
}

// How many copies of `n` are still in the game (not in collected trios).
function remainingInGame(room, n) {
  let collected = 0;
  for (const p of room.players) for (const t of p.trios) if (t === n) collected += 3;
  return 3 - collected;
}

// Count of n the bot knows are "locked" outside its reach right now:
//  - In a face-up middle card whose access this turn has already been used (revealed face up but not part of this turn? In our rules a revealed middle card stays "in" the middle until trio completes — we treat any faceUp as available info)
// For probability heuristics we mainly care about the bot's view of unknowns.
function botKnowledge(room, botId) {
  const bot = room.players.find((p) => p.id === botId);
  const knownByNumber = new Array(13).fill(0);

  for (const n of bot.hand) knownByNumber[n]++;
  for (const p of room.players) for (const t of p.trios) knownByNumber[t] += 3;
  for (const m of room.middle) if (m && m.faceUp) knownByNumber[m.number]++;
  for (const r of room.turn?.reveals || []) {
    if (r.source === "player" && r.playerId !== botId) knownByNumber[r.number]++;
  }
  const knownEnds = room.knownEnds || {};
  for (const [pid, k] of Object.entries(knownEnds)) {
    if (pid === botId || !k) continue;
    if (k.lowest != null) knownByNumber[k.lowest]++;
    if (k.highest != null) knownByNumber[k.highest]++;
  }

  let unknownTotal = 0;
  for (const p of room.players) {
    if (p.id === botId) continue;
    const revealedFromThisPlayer = (room.turn?.reveals || []).filter(
      (r) => r.source === "player" && r.playerId === p.id
    ).length;
    let knownEndsForThis = 0;
    const k = knownEnds[p.id];
    if (k) {
      if (k.lowest != null) knownEndsForThis++;
      if (k.highest != null) knownEndsForThis++;
    }
    unknownTotal += Math.max(0, p.hand.length - revealedFromThisPlayer - knownEndsForThis);
  }
  for (const m of room.middle) if (m && !m.faceUp) unknownTotal++;

  const unknownByNumber = new Array(13).fill(0);
  for (let n = 1; n <= 12; n++) {
    unknownByNumber[n] = Math.max(0, remainingInGame(room, n) - knownByNumber[n]);
  }
  return { knownByNumber, unknownByNumber, unknownTotal };
}

function randInt(n) {
  return Math.floor(Math.random() * n);
}

// Find the best "starting reveal" for a new turn.
function chooseFirstReveal(room, botId) {
  const bot = room.players.find((p) => p.id === botId);
  const counts = new Map();
  for (let i = 0; i < bot.hand.length; i++) {
    const n = bot.hand[i];
    if (!counts.has(n)) counts.set(n, []);
    counts.get(n).push(i);
  }

  // Look for a number with two cards adjacent at the low end OR high end of the
  // current hand (so both are reachable through "lowest"/"highest" calls).
  let bestLow = null;
  let bestHigh = null;
  for (const [n, idxs] of counts) {
    if (idxs.length < 2) continue;
    if (idxs[0] === 0 && idxs[1] === 1) bestLow = bestLow ?? n;
    const last = bot.hand.length - 1;
    if (idxs[idxs.length - 1] === last && idxs[idxs.length - 2] === last - 1) {
      bestHigh = bestHigh ?? n;
    }
  }
  // If both a duplicate and external knowledge align (we can find a 3rd copy), great.
  if (bestLow !== null) return { type: "ask", playerId: botId, which: "lowest" };
  if (bestHigh !== null) return { type: "ask", playerId: botId, which: "highest" };

  // Special case: if we can guarantee the 7 trio (we hold a 7 + we know opponents hold 7s)
  // start there. Auto-win.
  const knownEnds = room.knownEnds || {};
  if (counts.has(7)) {
    // Count guaranteed 7s outside our hand using known ends
    const knownSeven = countKnownTargetOutside(room, 7, botId);
    if (counts.get(7).length + knownSeven >= 3) {
      // Try to reveal a 7 if it's at our end; otherwise start with someone else's 7.
      const lowV = endValue(room, botId, "lowest");
      const highV = endValue(room, botId, "highest");
      if (lowV === 7) return { type: "ask", playerId: botId, which: "lowest" };
      if (highV === 7) return { type: "ask", playerId: botId, which: "highest" };
      const ask = findGuaranteedAskForTarget(room, botId, 7);
      if (ask) return ask;
    }
  }

  // No accessible duplicate. Pick the candidate first reveal that maximizes the
  // chance of completing a trio: among own ends and the middle, prefer the one
  // whose target number has the most copies still attainable (known + unknown).
  const info = botKnowledge(room, botId);
  const lowV = endValue(room, botId, "lowest");
  const highV = endValue(room, botId, "highest");
  const candidates = [];
  if (lowV !== null) {
    candidates.push({
      action: { type: "ask", playerId: botId, which: "lowest" },
      score: scoreFirstTarget(room, botId, lowV),
    });
  }
  if (highV !== null) {
    candidates.push({
      action: { type: "ask", playerId: botId, which: "highest" },
      score: scoreFirstTarget(room, botId, highV),
    });
  }
  const midAvail = availableMiddleIndices(room);
  if (midAvail.length > 0) {
    // Middle reveal has expected target distribution; approximate score as average
    // over plausible numbers using unknownByNumber weights.
    let avgScore = 0;
    let weights = 0;
    for (let n = 1; n <= 12; n++) {
      const w = info.unknownByNumber[n];
      if (w <= 0) continue;
      avgScore += w * scoreFirstTarget(room, botId, n);
      weights += w;
    }
    if (weights > 0) avgScore /= weights;
    candidates.push({
      action: { type: "middle", middleIndex: midAvail[randInt(midAvail.length)] },
      score: avgScore,
    });
  }

  if (candidates.length === 0) return askRandomOpponent(room, botId);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].action;
}

function countKnownTargetOutside(room, target, botId) {
  let c = 0;
  for (const [pid, k] of Object.entries(room.knownEnds || {})) {
    if (pid === botId || !k) continue;
    if (k.lowest === target) c++;
    if (k.highest === target) c++;
  }
  return c;
}

// Heuristic score for picking T as the first target.
function scoreFirstTarget(room, botId, T) {
  const bot = room.players.find((p) => p.id === botId);
  const inHand = bot.hand.filter((n) => n === T).length;
  const knownOutside = countKnownTargetOutside(room, T, botId);
  const info = botKnowledge(room, botId);
  const unknownT = info.unknownByNumber[T];
  // We need 3 total. 100% sources are inHand + knownOutside. Unknown adds probability.
  const guaranteed = inHand + knownOutside;
  // The 7 trio auto-wins; bias slightly toward it.
  const bonus = T === 7 ? 1.5 : 0;
  // Score reflects expected matches when starting from T.
  return guaranteed + Math.min(unknownT, 3) * 0.5 + bonus;
}

function askRandomOpponent(room, botId) {
  const opps = room.players.filter(
    (p) => p.id !== botId && availableHandIndices(room, p.id).length > 0
  );
  if (opps.length === 0) return null;
  const p = opps[randInt(opps.length)];
  const which = Math.random() < 0.5 ? "lowest" : "highest";
  return { type: "ask", playerId: p.id, which };
}

// Among opponents, find one whose known low/high matches the target AND
// whose end hasn't already been revealed this turn (so an "ask" yields exactly
// that known card). Returns an action or null.
function findGuaranteedAskForTarget(room, botId, target) {
  const knownEnds = room.knownEnds || {};
  for (const p of room.players) {
    if (p.id === botId) continue;
    const avail = availableHandIndices(room, p.id);
    if (avail.length === 0) continue;
    const k = knownEnds[p.id];
    if (!k) continue;
    const lowUsed = (room.turn?.reveals || []).some(
      (r) => r.source === "player" && r.playerId === p.id && r.which === "lowest"
    );
    const highUsed = (room.turn?.reveals || []).some(
      (r) => r.source === "player" && r.playerId === p.id && r.which === "highest"
    );
    if (k.lowest === target && !lowUsed) return { type: "ask", playerId: p.id, which: "lowest" };
    if (k.highest === target && !highUsed) return { type: "ask", playerId: p.id, which: "highest" };
  }
  return null;
}

// Find a match for the current target.
function chooseMatchReveal(room, botId) {
  const target = room.turn.target;

  // 1) Own hand at an end position is a guaranteed match.
  const lowV = endValue(room, botId, "lowest");
  if (lowV === target) return { type: "ask", playerId: botId, which: "lowest" };
  const highV = endValue(room, botId, "highest");
  if (highV === target) return { type: "ask", playerId: botId, which: "highest" };

  // 2) Use public knowledge: any opponent whose known end equals the target.
  const guaranteed = findGuaranteedAskForTarget(room, botId, target);
  if (guaranteed) return guaranteed;

  // 3) Choose between middle and opponents based on probability.
  const info = botKnowledge(room, botId);
  const midAvail = availableMiddleIndices(room);
  const remainingT = info.unknownByNumber[target];

  // Probability of hitting target with a random middle reveal.
  const pMiddle = midAvail.length > 0 && info.unknownTotal > 0
    ? remainingT / info.unknownTotal
    : 0;

  // Probability of an opponent's specific end being the target. With no per-opponent
  // memory we treat each unknown card equally likely.
  let bestOpp = null;
  let bestOppP = 0;
  for (const p of room.players) {
    if (p.id === botId) continue;
    const avail = availableHandIndices(room, p.id);
    if (avail.length === 0) continue;
    const k = (room.knownEnds || {})[p.id] || {};
    // Skip ends we've already shown to be a NON-target (we know that end is some other number).
    const lowUsed = (room.turn?.reveals || []).some(
      (r) => r.source === "player" && r.playerId === p.id && r.which === "lowest"
    );
    const highUsed = (room.turn?.reveals || []).some(
      (r) => r.source === "player" && r.playerId === p.id && r.which === "highest"
    );
    const candidates = [];
    if (!lowUsed && (k.lowest === null || k.lowest === undefined)) candidates.push("lowest");
    if (!highUsed && (k.highest === null || k.highest === undefined)) candidates.push("highest");
    if (candidates.length === 0) continue;
    const pAsk = info.unknownTotal > 0 ? remainingT / info.unknownTotal : 0;
    if (pAsk > bestOppP) {
      bestOppP = pAsk;
      const which = candidates[randInt(candidates.length)];
      bestOpp = { type: "ask", playerId: p.id, which };
    }
  }

  if (pMiddle > 0 && pMiddle >= bestOppP) {
    return { type: "middle", middleIndex: midAvail[randInt(midAvail.length)] };
  }
  if (bestOpp) return bestOpp;
  if (midAvail.length > 0) {
    return { type: "middle", middleIndex: midAvail[randInt(midAvail.length)] };
  }
  return askRandomOpponent(room, botId);
}

export function chooseBotAction(room, botId) {
  if (room.turn.target === null) return chooseFirstReveal(room, botId);
  return chooseMatchReveal(room, botId);
}
