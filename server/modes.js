// Game-mode definitions for Trio.
//
// A mode declares how the deck is dealt and how a win is detected. Adding a
// mode means adding one entry to MODES — the rest of the engine is mode-blind
// and just calls into here.

// Cards dealt per player and to the middle, keyed by player count. Shared by
// every mode (the deal is the same; only the win condition differs).
export const DEAL_TABLE = {
  3: { perPlayer: 9, middle: 9 },
  4: { perPlayer: 7, middle: 8 },
  5: { perPlayer: 6, middle: 6 },
  6: { perPlayer: 5, middle: 6 },
};

// Two trio numbers are "connected" (spicy mode) when they add up to 7 or differ
// by 7. Examples: 1↔6 (1+6=7), 1↔8 (8-1=7), 4↔3 (4+3=7), 4↔11 (11-4=7).
// 6 only connects with 1; 7 connects with nothing (and is the instant win).
export function areConnected(a, b) {
  return a + b === 7 || Math.abs(a - b) === 7;
}

// Does a set of collected trio numbers contain a connected pair?
function hasConnectedPair(trios) {
  for (let i = 0; i < trios.length; i++) {
    for (let j = i + 1; j < trios.length; j++) {
      if (areConnected(trios[i], trios[j])) return true;
    }
  }
  return false;
}

// Each mode's checkWin receives the winner's collected trio numbers and returns
// a win-reason string ("seven" | "three" | "connected") or null if no win yet.
export const MODES = {
  simple: {
    id: "simple",
    label: "Simple",
    checkWin(trios) {
      if (trios.includes(7)) return "seven";
      if (trios.length >= 3) return "three";
      return null;
    },
  },
  spicy: {
    id: "spicy",
    label: "Spicy",
    checkWin(trios) {
      if (trios.includes(7)) return "seven";
      if (hasConnectedPair(trios)) return "connected";
      return null;
    },
  },
};

export const DEFAULT_MODE = "simple";

export function isValidMode(mode) {
  return Object.prototype.hasOwnProperty.call(MODES, mode);
}

// Log i18n key for a given win reason.
export function winLogKey(reason) {
  return {
    seven: "log.win_seven",
    three: "log.win_three",
    connected: "log.win_connected",
  }[reason] || "log.win_three";
}
