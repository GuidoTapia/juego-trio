// Headless simulation: 3-6 bot-only games using the same game + bot modules.
// Catches game-state bugs without needing the UI.

import {
  createRoom,
  addPlayer,
  startGame,
  applyReveal,
  resolveTurn,
  currentPlayer,
} from "./game.js";
import { chooseBotAction } from "./bot.js";

function simulateGame(n, gameIndex) {
  const room = createRoom("TEST", "host");
  for (let i = 0; i < n; i++) {
    addPlayer(room, { id: `bot:${i}`, name: `Bot${i}`, isBot: true });
  }
  startGame(room);

  let turns = 0;
  let reveals = 0;
  const maxTurns = 2000;

  while (room.phase === "playing" && turns < maxTurns) {
    const actor = currentPlayer(room);
    if (!actor) throw new Error("No current player");
    const action = chooseBotAction(room, actor.id);
    if (!action) {
      throw new Error(`No action for ${actor.id}`);
    }
    applyReveal(room, actor.id, action);
    reveals++;
    if (room.turn.pendingResolve) {
      resolveTurn(room);
      turns++;
    }
  }

  const trios = room.players.map((p) => p.trios);
  const totalTrios = trios.flat().length;
  const stuck = room.phase !== "ended";
  console.log(
    `Game #${gameIndex} (${n} bots): ${stuck ? "STUCK" : "OK"}, turns=${turns}, reveals=${reveals}, winner=${room.winner}, trios=${JSON.stringify(trios)}`
  );
  // Sanity check on card accounting at all times.
  const inHands = room.players.reduce((s, p) => s + p.hand.length, 0);
  const inMiddle = room.middle.filter((m) => m !== null).length;
  const inTrios = totalTrios * 3;
  if (inHands + inMiddle + inTrios !== 36) {
    throw new Error(`Card count mismatch: hands=${inHands} middle=${inMiddle} trios=${inTrios}`);
  }
  return stuck ? 0 : 1;
}

let i = 0;
let wins = 0;
let total = 0;
for (const n of [3, 4, 5, 6]) {
  for (let r = 0; r < 5; r++) {
    total++;
    wins += simulateGame(n, ++i);
  }
}
console.log(`\nFinished ${wins}/${total} games to completion (rest stuck at turn cap).`);
