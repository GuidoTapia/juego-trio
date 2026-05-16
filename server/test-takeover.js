// E2E test for the bot-takeover-on-disconnect flow.
// Verifies: a player who stays disconnected past BOT_TAKEOVER_MS gets a bot in
// their seat, the game keeps moving, and reconnecting + takeControl returns it.

import { spawn } from "child_process";
import { io as ioClient } from "socket.io-client";

const TAKEOVER_MS = 1500;
const server = spawn("node", ["server/index.js"], {
  env: { ...process.env, PORT: "3488", BOT_TAKEOVER_MS: String(TAKEOVER_MS) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write("[server] " + d));
server.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));
await new Promise((r) => setTimeout(r, 800));

const URL = "http://localhost:3488";
const call = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));
const connect = () => {
  const s = ioClient(URL, { forceNew: true });
  return new Promise((res) => s.once("connect", () => res(s)));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label);
  if (!cond) failures++;
}

const TOKEN_HOST = "tok-host";
const TOKEN_BOB = "tok-bob";

// Trivial legal-move picker so the connected human (Alice) doesn't freeze the
// table on her own turns — lets us observe that turns keep advancing.
function pickAction(s) {
  if (s.turn?.pendingResolve) return null;
  const faceDown = s.middle.filter((m) => !m.faceUp && !m.taken);
  const me = s.players.find((p) => p.id === s.you);
  if (s.turn?.target == null) {
    if (faceDown.length) return { type: "middle", middleIndex: faceDown[0].index };
    return { type: "ask", playerId: me.id, which: "lowest" };
  }
  const T = s.turn.target;
  if (me?.hand?.length) {
    if (me.hand[0] === T) return { type: "ask", playerId: me.id, which: "lowest" };
    if (me.hand[me.hand.length - 1] === T) return { type: "ask", playerId: me.id, which: "highest" };
  }
  if (faceDown.length) return { type: "middle", middleIndex: faceDown[0].index };
  const opp = s.players.find((p) => p.id !== me.id && p.handSize > 0);
  return opp ? { type: "ask", playerId: opp.id, which: "lowest" } : null;
}

const host = await connect();
let hostState = null;
host.on("state", (s) => {
  hostState = s;
  if (s.phase === "playing" && s.currentPlayerId === s.you && !s.turn?.pendingResolve) {
    const action = pickAction(s);
    if (action) host.emit("action", { action }, () => {});
  }
});
const created = await call(host, "createRoom", { name: "Alice", token: TOKEN_HOST });
const code = created.code;

const bob = await connect();
await call(bob, "joinRoom", { code, name: "Bob", token: TOKEN_BOB });
await call(host, "addBot", {});
await call(host, "startGame", {});
await sleep(300);
check("game started", hostState && hostState.players.length === 3);

// Bob drops and stays away past the takeover window.
bob.disconnect();
await sleep(TAKEOVER_MS + 1200);

const bobSeat = hostState.players.find((p) => p.name === "Bob");
check("Bob's seat is now bot-controlled", bobSeat && bobSeat.botControlled === true);
check("Bob's seat still counts as 3 players", hostState.players.length === 3);

// The game should not be frozen — let it run a bit and confirm turns advance.
const logLenBefore = hostState.log.length;
await sleep(4000);
check("game keeps progressing while bot covers Bob", hostState.log.length > logLenBefore);

// Bob reconnects — seat is still bot-controlled, he's offered the option.
const bob2 = await connect();
let bob2State = null;
bob2.on("state", (s) => { bob2State = s; });
const rejoin = await call(bob2, "joinRoom", { code, name: "Bob", token: TOKEN_BOB });
check("rejoin reports botControlled flag", rejoin.botControlled === true);
await sleep(300);
const bobMe = bob2State.players.find((p) => p.id === bob2State.you);
check("after reconnect Bob is connected", bobMe && bobMe.connected === true);
check("after reconnect seat still bot-controlled", bobMe && bobMe.botControlled === true);

// Bob reclaims control.
const took = await call(bob2, "takeControl", {});
check("takeControl ok", took.ok);
await sleep(300);
const bobMe2 = bob2State.players.find((p) => p.id === bob2State.you);
check("seat no longer bot-controlled", bobMe2 && bobMe2.botControlled === false);

host.disconnect();
bob2.disconnect();
server.kill();
console.log(failures === 0 ? "\nAll takeover tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
