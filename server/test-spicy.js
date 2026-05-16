// Tests for spicy mode: the connection rule, win detection, and a full
// bot-vs-bot spicy game ending on a valid spicy win.

import { MODES, areConnected } from "./modes.js";
import {
  createRoom, addPlayer, setMode, startGame,
  applyReveal, resolveTurn, currentPlayer,
} from "./game.js";
import { chooseBotAction } from "./bot.js";

let failures = 0;
function check(label, cond) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label);
  if (!cond) failures++;
}

// --- areConnected ---
check("1 connects with 6 (1+6=7)", areConnected(1, 6));
check("1 connects with 8 (8-1=7)", areConnected(1, 8));
check("4 connects with 3 (4+3=7)", areConnected(4, 3));
check("4 connects with 11 (11-4=7)", areConnected(4, 11));
check("6 does NOT connect with 8", !areConnected(6, 8));
check("1 does NOT connect with 2", !areConnected(1, 2));
check("5 connects with 12 (12-5=7)", areConnected(5, 12));

// --- mode win conditions ---
check("simple: 3 trios wins", MODES.simple.checkWin([1, 2, 3]) === "three");
check("simple: 2 trios is not a win", MODES.simple.checkWin([1, 6]) === null);
check("simple: the 7 trio wins", MODES.simple.checkWin([7]) === "seven");
check("spicy: 2 connected trios wins", MODES.spicy.checkWin([1, 6]) === "connected");
check("spicy: 2 unconnected trios is not a win", MODES.spicy.checkWin([1, 2]) === null);
check("spicy: connected pair among 3 trios wins", MODES.spicy.checkWin([1, 2, 8]) === "connected");
check("spicy: the 7 trio wins", MODES.spicy.checkWin([7]) === "seven");

// --- full spicy game (3 bots) ---
function simulateSpicyGame() {
  const room = createRoom("SPCY", "host", "spicy");
  for (let i = 0; i < 3; i++) addPlayer(room, { id: `bot:${i}`, name: `B${i}`, isBot: true });
  setMode(room, "spicy");
  startGame(room);
  let turns = 0;
  while (room.phase === "playing" && turns < 4000) {
    const actor = currentPlayer(room);
    const action = chooseBotAction(room, actor.id);
    if (!action) break;
    applyReveal(room, actor.id, action);
    if (room.turn.pendingResolve) { resolveTurn(room); turns++; }
  }
  return room;
}

let spicyWins = 0;
for (let g = 0; g < 8; g++) {
  const room = simulateSpicyGame();
  if (room.phase !== "ended") continue;
  spicyWins++;
  const winner = room.players.find((p) => p.id === room.winner);
  const trios = winner.trios;
  const validWin =
    trios.includes(7) ||
    trios.some((a, i) => trios.some((b, j) => i !== j && areConnected(a, b)));
  check(`spicy game ${g + 1}: winner ${winner.name} has a valid spicy win (${JSON.stringify(trios)})`, validWin);
}
check("at least some spicy games completed", spicyWins > 0);

console.log(failures === 0 ? "\nAll spicy tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
