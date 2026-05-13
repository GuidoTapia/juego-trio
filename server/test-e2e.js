// End-to-end smoke test: spins up the server, connects a fake client,
// creates a room, adds bots, starts a game, and verifies state flows.

import { spawn } from "child_process";
import { io as ioClient } from "socket.io-client";

const server = spawn("node", ["server/index.js"], {
  env: { ...process.env, PORT: "3456" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write("[server] " + d));
server.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));

await new Promise((r) => setTimeout(r, 800));

const url = "http://localhost:3456";
const sock = ioClient(url);
let states = [];
sock.on("state", (s) => states.push(s));

await new Promise((r) => sock.once("connect", r));
console.log("Connected as", sock.id);

const created = await call(sock, "createRoom", { name: "Tester" });
console.log("createRoom:", created);
if (!created.ok) throw new Error("createRoom failed");

for (let i = 0; i < 2; i++) {
  const r = await call(sock, "addBot", {});
  if (!r.ok) throw new Error("addBot failed: " + r.error);
}
console.log("added 2 bots");

const started = await call(sock, "startGame", {});
console.log("startGame:", started);
if (!started.ok) throw new Error("startGame failed");

// Wait for game to progress and ideally end.
const deadline = Date.now() + 60_000;
let done = false;
while (Date.now() < deadline && !done) {
  await new Promise((r) => setTimeout(r, 500));
  const last = states[states.length - 1];
  if (last) {
    if (last.phase === "ended") {
      console.log("Game ended. Winner:", last.players.find((p) => p.id === last.winner)?.name);
      done = true;
    } else if (last.phase === "playing" && last.currentPlayerId === sock.id) {
      // It's the tester's turn — pick the first available legal action.
      const action = pickAction(last);
      if (action) await call(sock, "action", { action });
    }
  }
}

console.log("\nLast state phase:", states[states.length - 1]?.phase);
console.log("Total state updates:", states.length);
console.log("Last 3 log entries:", (states[states.length - 1]?.log || []).slice(-3).map((e) => e.text));

sock.disconnect();
server.kill();
process.exit(done ? 0 : 1);

function call(s, event, payload) {
  return new Promise((resolve) => s.emit(event, payload, resolve));
}

function pickAction(state) {
  // Trivial human-side play: if our hand has duplicates at the ends, ask self;
  // otherwise reveal a middle card or ask any opponent for their lowest.
  const me = state.players.find((p) => p.id === state.you);
  if (state.turn?.pendingResolve) return null;
  // First reveal: try a middle card
  const faceDown = state.middle.filter((m) => !m.faceUp);
  if (state.turn?.target === null) {
    if (faceDown.length > 0) return { type: "middle", middleIndex: faceDown[0].index };
    return { type: "ask", playerId: me.id, which: "lowest" };
  }
  // Subsequent: try own end first
  const T = state.turn.target;
  if (me?.hand?.length > 0) {
    const low = me.hand[0];
    const high = me.hand[me.hand.length - 1];
    if (low === T) return { type: "ask", playerId: me.id, which: "lowest" };
    if (high === T) return { type: "ask", playerId: me.id, which: "highest" };
  }
  if (faceDown.length > 0) return { type: "middle", middleIndex: faceDown[0].index };
  const opp = state.players.find((p) => p.id !== me.id && p.handSize > 0);
  if (opp) return { type: "ask", playerId: opp.id, which: "lowest" };
  return null;
}
