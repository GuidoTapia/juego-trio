// E2E test for token-based reconnection.
// Verifies: a player who disconnects mid-game can rejoin the same slot via
// their token, and that joining with the same token never duplicates a slot.

import { spawn } from "child_process";
import { io as ioClient } from "socket.io-client";

const server = spawn("node", ["server/index.js"], {
  env: { ...process.env, PORT: "3499" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write("[server] " + d));
server.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));
await new Promise((r) => setTimeout(r, 800));

const URL = "http://localhost:3499";
const call = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));
const connect = () => {
  const s = ioClient(URL, { forceNew: true });
  return new Promise((res) => s.once("connect", () => res(s)));
};

let failures = 0;
function check(label, cond) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label);
  if (!cond) failures++;
}

const TOKEN_A = "tok-alice";
const TOKEN_B = "tok-bob";

// Host creates a room.
const host = await connect();
let hostState = null;
host.on("state", (s) => { hostState = s; });
const created = await call(host, "createRoom", { name: "Alice", token: TOKEN_A });
check("createRoom ok", created.ok);
const code = created.code;

// A second human joins.
const bob = await connect();
let bobState = null;
bob.on("state", (s) => { bobState = s; });
await call(bob, "joinRoom", { code, name: "Bob", token: TOKEN_B });

// A bot to reach 3 players, then start.
await call(host, "addBot", {});
await call(host, "startGame", {});
await new Promise((r) => setTimeout(r, 300));
check("game started (3 players)", hostState && hostState.players.length === 3);

// Bob's hand before the disconnect.
const bobMe = bobState.players.find((p) => p.id === bobState.you);
const bobHandBefore = JSON.stringify(bobMe.hand);

// Bob's socket drops.
bob.disconnect();
await new Promise((r) => setTimeout(r, 400));
check(
  "after drop, Bob still in room as disconnected",
  hostState.players.length === 3 &&
    hostState.players.some((p) => p.name === "Bob" && p.connected === false)
);

// Bob reconnects with the SAME token.
const bob2 = await connect();
let bob2State = null;
bob2.on("state", (s) => { bob2State = s; });
const rejoin = await call(bob2, "joinRoom", { code, name: "Bob", token: TOKEN_B });
check("rejoin reported ok", rejoin.ok);
check("rejoin flagged as rejoined", rejoin.rejoined === true);
await new Promise((r) => setTimeout(r, 300));

check("no duplicate slot — still 3 players", bob2State && bob2State.players.length === 3);
const bobMe2 = bob2State.players.find((p) => p.id === bob2State.you);
check("Bob is connected again", bobMe2 && bobMe2.connected === true);
check("Bob's hand preserved across rejoin", bobMe2 && JSON.stringify(bobMe2.hand) === bobHandBefore);

// Joining yet again with the same token must not add a 4th slot.
const bob3 = await connect();
const rejoin2 = await call(bob3, "joinRoom", { code, name: "Bob", token: TOKEN_B });
check("second rejoin ok", rejoin2.ok);
await new Promise((r) => setTimeout(r, 200));
const finalState = await new Promise((res) => {
  host.emit("__noop__"); // no-op; just read latest broadcast
  setTimeout(() => res(hostState), 200);
});
check("still exactly 3 players after repeat rejoin", finalState.players.length === 3);

host.disconnect();
bob2.disconnect();
bob3.disconnect();
server.kill();
console.log(failures === 0 ? "\nAll rejoin tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
