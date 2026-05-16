// Entry point: wires up the HTTP server, static assets and Socket.IO, then
// hands off to the layered modules.
//
//   index.js          this file — process bootstrap
//   socket-handlers   socket event API
//   orchestrator      timers, bot turns, broadcasting
//   rooms             in-memory room registry
//   game              pure game state machine
//   modes             per-mode rules (deal table, win conditions)
//   bot               bot AI

import express from "express";
import http from "http";
import { Server as SocketServer } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

import { initOrchestrator } from "./orchestrator.js";
import { registerSocketHandlers } from "./socket-handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "..", "public")));

initOrchestrator(io);
registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`Trio server escuchando en http://localhost:${PORT}`);
});
