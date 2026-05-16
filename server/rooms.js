// Live room registry: the rooms themselves, the socket→room index, and room
// code generation. Pure in-memory bookkeeping — no game rules, no I/O.

const rooms = new Map();      // code -> room
const socketRoom = new Map(); // socketId -> code

// Ambiguous characters (0/O, 1/I) are excluded so codes are easy to share.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("No se pudo generar código");
}

export function addRoom(code, room) { rooms.set(code, room); }
export function getRoom(code) { return rooms.get(code); }
export function deleteRoom(code) { rooms.delete(code); }

export function bindSocket(socketId, code) { socketRoom.set(socketId, code); }
export function unbindSocket(socketId) { socketRoom.delete(socketId); }
export function codeOf(socketId) { return socketRoom.get(socketId); }
export function roomOf(socketId) { return rooms.get(socketRoom.get(socketId)); }

// Allocate a unique bot socket-id within a room.
export function botId(room, name) {
  let n = 1;
  let id;
  do {
    id = `bot:${name.replace(/\s+/g, "_")}:${n++}`;
  } while (room.players.some((p) => p.id === id));
  return id;
}
