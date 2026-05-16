// E2E test for the AFK turn takeover: a connected player who sits on their
// turn doing nothing past TURN_IDLE_MS gets a bot, and can reclaim the seat.

import { spawn } from "child_process";
import { io as ioClient } from "socket.io-client";

const IDLE_MS = 1500;
const server = spawn("node", ["server/index.js"], {
  env: { ...process.env, PORT: "3466", TURN_IDLE_MS: String(IDLE_MS) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write("[server] " + d));
server.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));
await new Promise((r) => setTimeout(r, 800));

const URL = "http://localhost:3466";
const call = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
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

// Alice (host) + 2 bots. Alice is forced to play first, then does NOTHING.
const alice = await connect();
let aState = null;
alice.on("state", (s) => { aState = s; });
const created = await call(alice, "createRoom", { name: "Alice", token: "a" });
const code = created.code;
await call(alice, "addBot", {});
await call(alice, "addBot", {});
await call(alice, "startGame", { firstPlayerId: alice.id });
await sleep(200);

const me = () => aState.players.find((p) => p.id === aState.you);
check("game started, it's Alice's turn", aState.currentPlayerId === aState.you);
check("Alice's seat not yet bot-controlled", me().botControlled === false);

// Alice sits idle past the turn-idle window.
await sleep(IDLE_MS + 1000);
check("after idling, Alice's seat is bot-controlled", me().botControlled === true);

// The game should be moving on its own now.
const logLen = aState.log.length;
await sleep(3500);
check("game progresses with a bot covering Alice", aState.log.length > logLen);

// Alice reclaims her seat.
const took = await call(alice, "takeControl", {});
check("takeControl ok", took.ok);
await sleep(200);
check("seat no longer bot-controlled", me().botControlled === false);

alice.disconnect();
server.kill();
console.log(failures === 0 ? "\nAll AFK tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
