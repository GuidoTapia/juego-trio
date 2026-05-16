// Regression test for the "frozen after completing a trio on reconnect" bug.
//
// Cause: turn reveals store a player's socket id; reconnecting changes that id,
// so resolveTurn could not find the player and threw, leaving the turn stuck
// on pendingResolve forever. rejoinPlayer now re-points those references.

import { createRoom, addPlayer, applyReveal, resolveTurn, rejoinPlayer } from "./game.js";

let failures = 0;
function check(label, cond) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label);
  if (!cond) failures++;
}

// Build a deterministic 3-player playing state: everyone holds a single 5 so a
// trio of 5s can be completed in exactly three reveals.
function riggedRoom() {
  const room = createRoom("TST", "host");
  addPlayer(room, { id: "sockA", name: "A", token: "tokA" });
  addPlayer(room, { id: "sockB", name: "B", token: "tokB" });
  addPlayer(room, { id: "sockC", name: "C", token: "tokC" });
  room.phase = "playing";
  room.players[0].hand = [5];
  room.players[1].hand = [5];
  room.players[2].hand = [5];
  for (const p of room.players) p.trios = [];
  room.middle = [];
  room.currentPlayerIndex = 0; // A's turn
  room.turn = { reveals: [], target: null, pendingResolve: false };
  return room;
}

// --- Scenario: B reconnects mid-turn, then A completes the trio ---
{
  const room = riggedRoom();
  applyReveal(room, "sockA", { type: "ask", playerId: "sockA", which: "lowest" }); // A's 5
  applyReveal(room, "sockA", { type: "ask", playerId: "sockB", which: "lowest" }); // B's 5

  // B drops and reconnects — socket id changes from sockB to sockB2.
  const res = rejoinPlayer(room, "tokB", "sockB2");
  check("rejoin rebinds B", res && res.player.id === "sockB2");

  const revealForB = room.turn.reveals.find((r) => r.source === "player" && r.number === 5
    && room.players[1].hand !== undefined && r.handIndex === 0 && r.which === "lowest"
    && r.playerName === "B");
  check("B's in-flight reveal was re-pointed to the new id",
    revealForB && revealForB.playerId === "sockB2");

  applyReveal(room, "sockA", { type: "ask", playerId: "sockC", which: "lowest" }); // C's 5 → trio
  check("trio is pending resolve", room.turn.pendingResolve === true);

  let outcome, threw = false;
  try {
    outcome = resolveTurn(room);
  } catch (e) {
    threw = true;
    console.log("    threw:", e.message);
  }
  check("resolveTurn did NOT throw (no freeze)", !threw);
  check("trio awarded", outcome === "trio");
  check("A collected the 5 trio", JSON.stringify(room.players[0].trios) === "[5]");
  check("turn was not left pending", room.turn.pendingResolve === false);
  check("A's 5 was removed from hand", room.players[0].hand.length === 0);
  check("B's 5 was removed from hand", room.players[1].hand.length === 0);
  check("C's 5 was removed from hand", room.players[2].hand.length === 0);
}

// --- Scenario: a truly bogus reveal id must not crash resolveTurn either ---
{
  const room = riggedRoom();
  applyReveal(room, "sockA", { type: "ask", playerId: "sockA", which: "lowest" });
  applyReveal(room, "sockA", { type: "ask", playerId: "sockB", which: "lowest" });
  applyReveal(room, "sockA", { type: "ask", playerId: "sockC", which: "lowest" });
  // Simulate a dangling reference the sweep somehow missed.
  room.turn.reveals[1].playerId = "ghost-id";
  let threw = false;
  try {
    resolveTurn(room);
  } catch (e) {
    threw = true;
  }
  check("resolveTurn tolerates a dangling reveal id (no crash)", !threw);
  check("turn still resolved (not frozen)", room.turn.pendingResolve === false);
}

console.log(failures === 0 ? "\nAll reconnect-trio tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
