/* global io */
const socket = io();

const $ = (id) => document.getElementById(id);
const screens = {
  home: $("screen-home"),
  room: $("screen-room"),
  game: $("screen-game"),
};

let state = null;
let myId = null;
const stored = {
  name: localStorage.getItem("trio:name") || "",
};
if (stored.name) $("input-name").value = stored.name;

function showScreen(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle("active", k === name);
}

function toast(msg, ms = 2200) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

function callOK(label, payload, cb) {
  socket.emit(label, payload, (res) => {
    if (!res?.ok) toast(res?.error || "Error");
    cb?.(res);
  });
}

/* =================== Home actions =================== */
$("btn-create").onclick = () => {
  const name = $("input-name").value.trim();
  if (!name) return toast("Pon un nombre");
  localStorage.setItem("trio:name", name);
  callOK("createRoom", { name }, (res) => {
    if (res?.ok) showScreen("room");
  });
};
$("btn-join").onclick = () => {
  const name = $("input-name").value.trim();
  const code = $("input-code").value.trim().toUpperCase();
  if (!name) return toast("Pon un nombre");
  if (!code) return toast("Falta el código");
  localStorage.setItem("trio:name", name);
  callOK("joinRoom", { name, code }, (res) => {
    if (res?.ok) showScreen("room");
  });
};
$("input-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

/* =================== Room (lobby) actions =================== */
$("btn-copy").onclick = async () => {
  const code = state?.code;
  if (!code) return;
  try { await navigator.clipboard.writeText(code); toast("Código copiado"); }
  catch { toast(code); }
};
$("btn-leave").onclick = () => leaveRoom();
$("btn-leave-2").onclick = () => leaveRoom();
$("btn-leave-3").onclick = () => leaveRoom();

function leaveRoom() {
  socket.emit("leaveRoom");
  state = null;
  showScreen("home");
}

$("btn-add-bot").onclick = () => callOK("addBot", {});
$("btn-start").onclick = () => callOK("startGame", {});

/* =================== Socket events =================== */
socket.on("connect", () => { myId = socket.id; });
socket.on("state", (s) => {
  state = s;
  myId = s.you;
  render();
});

/* =================== Rendering =================== */
function render() {
  if (!state) return;
  if (state.phase === "lobby") {
    showScreen("room");
    renderLobby();
  } else {
    showScreen("game");
    renderGame();
  }
}

function renderLobby() {
  $("room-code").textContent = state.code;
  const list = $("lobby-players");
  list.innerHTML = "";
  const iAmHost = state.hostId === myId;
  for (const p of state.players) {
    const li = document.createElement("li");
    const labels = [];
    if (p.id === state.hostId) labels.push('<span class="host-badge">HOST</span>');
    if (p.id === myId) labels.push('<span class="you-badge">TÚ</span>');
    li.innerHTML = `<span>${escapeHTML(p.name)} ${labels.join("")}</span>`;
    if (p.isBot && iAmHost) {
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.textContent = "Quitar";
      btn.onclick = () => callOK("removeBot", { playerId: p.id });
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
  const n = state.players.length;
  $("btn-add-bot").disabled = !iAmHost || n >= 6;
  $("btn-start").disabled = !iAmHost || n < 3 || n > 6;
  const hint = $("lobby-hint");
  if (n < 3) hint.textContent = `Necesitas al menos 3 jugadores (faltan ${3 - n}). Puedes añadir bots.`;
  else if (!iAmHost) hint.textContent = "Esperando al anfitrión para empezar…";
  else hint.textContent = `${n} jugadores listos. ¡Cuando quieras!`;
}

function renderGame() {
  $("game-code").textContent = state.code;

  const me = state.players.find((p) => p.id === myId);
  const current = state.players.find((p) => p.id === state.currentPlayerId);
  const isMyTurn = current && current.id === myId;

  // Turn banner
  const banner = $("turn-banner");
  if (state.phase === "ended") {
    const w = state.players.find((p) => p.id === state.winner);
    banner.textContent = `🏆 Gana ${w?.name ?? "?"}`;
  } else if (isMyTurn) {
    banner.textContent = "✨ Tu turno";
  } else if (current) {
    banner.textContent = `Turno de ${current.name}`;
  }

  const canAct = isMyTurn && !state.turn?.pendingResolve;

  // Opponents area
  const oppEl = $("opponents");
  oppEl.innerHTML = "";
  const opponents = state.players.filter((p) => p.id !== myId);
  for (const p of opponents) {
    const isCurrent = p.id === state.currentPlayerId;
    const div = document.createElement("div");
    div.className = "opponent" + (isCurrent ? " turn" : "") +
      (!p.connected ? " disconnected" : "") + (p.handSize === 0 ? " empty" : "");
    const triosHTML = renderTrios(p.trios);
    let backs = "";
    for (let i = 0; i < p.handSize; i++) backs += '<div class="mini-card"></div>';
    const avail = computeAvailableForPlayer(p.id);
    div.innerHTML = `
      <div class="name">${escapeHTML(p.name)}${!p.connected ? ' <span style="font-size:10px;color:#c00">(desconectado)</span>' : ""}</div>
      <div class="stats">${p.handSize} cartas</div>
      <div class="opp-hand">${backs}</div>
      <div class="opp-trios">${triosHTML}</div>
      <div class="opp-actions">
        <button class="opp-btn" data-which="lowest" ${canAct && avail.lowestUsable ? "" : "disabled"}>↓ Más baja</button>
        <button class="opp-btn" data-which="highest" ${canAct && avail.highestUsable ? "" : "disabled"}>↑ Más alta</button>
      </div>
    `;
    const [lowBtn, highBtn] = div.querySelectorAll(".opp-btn");
    lowBtn.onclick = () => sendAction({ type: "ask", playerId: p.id, which: "lowest" });
    highBtn.onclick = () => sendAction({ type: "ask", playerId: p.id, which: "highest" });
    oppEl.appendChild(div);
  }

  // Reveal strip
  renderRevealStrip();

  // Middle cards — fixed grid, slots persist after a trio.
  const middleEl = $("middle");
  middleEl.innerHTML = "";
  const cols = middleColumns(state.middle.length);
  middleEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  for (const cell of state.middle) {
    const c = document.createElement("div");
    c.className = "card";
    if (cell.taken) {
      c.classList.add("empty-slot");
    } else if (cell.faceUp) {
      c.classList.add("face", "flipped");
      c.dataset.num = cell.number;
      c.style.backgroundImage = `url('/cartas/carta-trio-${cell.number}.png')`;
    }
    const canClick = canAct && !cell.taken && !cell.faceUp;
    if (canClick) {
      c.classList.add("clickable");
      c.onclick = () => sendAction({ type: "middle", middleIndex: cell.index });
    } else if (!cell.faceUp && !cell.taken) {
      c.classList.add("disabled");
    }
    middleEl.appendChild(c);
  }

  // My info & hand
  const meInfo = $("me-info");
  meInfo.innerHTML = `
    <span><strong>${escapeHTML(me?.name || "")}</strong> · ${me?.hand?.length ?? 0} cartas</span>
    <span>Tus trios: <span class="my-trios">${renderTrios(me?.trios || [])}</span></span>
  `;
  const handEl = $("me-hand");
  handEl.innerHTML = "";
  if (me?.hand) {
    const lowRevealed = countOwnReveals("lowest");
    const highRevealed = countOwnReveals("highest");
    me.hand.forEach((num, idx) => {
      const card = document.createElement("div");
      card.className = "card face";
      card.dataset.num = num;
      card.style.backgroundImage = `url('/cartas/carta-trio-${num}.png')`;
      const isRevealedFromMe =
        idx < lowRevealed || idx >= me.hand.length - highRevealed;
      if (isRevealedFromMe) card.classList.add("disabled");
      if (isMyTurn && !state.turn?.pendingResolve && !isRevealedFromMe) {
        const availIdxs = computeMyAvailable();
        if (
          availIdxs.length > 0 &&
          (idx === availIdxs[0] || idx === availIdxs[availIdxs.length - 1])
        ) {
          card.classList.add("highlight");
        }
      }
      handEl.appendChild(card);
    });
  }

  renderMeActions(isMyTurn);
  renderActions(isMyTurn);
  renderLog();

  // Winner overlay
  const overlay = $("winner-overlay");
  if (state.phase === "ended") {
    const w = state.players.find((p) => p.id === state.winner);
    $("winner-title").textContent = w?.id === myId ? "¡Has ganado! 🎉" : `Gana ${w?.name ?? "?"}`;
    $("winner-detail").textContent = w?.trios?.includes(7)
      ? "Con el trio del 7."
      : "Con 3 trios.";
    overlay.classList.remove("hidden");
    $("btn-play-again").disabled = state.hostId !== myId;
  } else {
    overlay.classList.add("hidden");
  }
}

function renderRevealStrip() {
  const row = $("reveal-row");
  const result = $("reveal-result");
  row.innerHTML = "";
  result.textContent = "";
  result.className = "reveal-result";
  if (!state.turn || state.turn.reveals.length === 0) {
    $("reveal-label").textContent = "Esperando a que se revele una carta…";
    return;
  }
  $("reveal-label").textContent = state.turn.target !== null
    ? `Buscando el trio del ${state.turn.target}`
    : "Cartas reveladas";
  for (const r of state.turn.reveals) {
    const c = document.createElement("div");
    c.className = "card face flipped";
    c.dataset.num = r.number;
    c.style.backgroundImage = `url('/cartas/carta-trio-${r.number}.png')`;
    const label = document.createElement("div");
    label.style.cssText = "text-align:center;font-size:11px;color:#666;margin-top:4px;";
    if (r.source === "player") {
      label.textContent = `${r.playerName} (${r.which === "lowest" ? "↓" : "↑"})`;
    } else {
      label.textContent = "centro";
    }
    const wrap = document.createElement("div");
    wrap.appendChild(c);
    wrap.appendChild(label);
    row.appendChild(wrap);
  }
  if (state.turn.pendingResolve) {
    const last = state.turn.reveals[state.turn.reveals.length - 1];
    const allMatch = state.turn.reveals.length === 3 &&
      state.turn.reveals.every((r) => r.number === state.turn.target);
    if (allMatch) {
      result.textContent = `¡TRIO DEL ${state.turn.target}!`;
      result.classList.add("trio");
    } else if (last.number !== state.turn.target) {
      result.textContent = `${last.number} no coincide con ${state.turn.target}. Las cartas vuelven…`;
      result.classList.add("fail");
    }
  }
}

function computeMyAvailable() {
  const me = state.players.find((p) => p.id === myId);
  if (!me?.hand) return [];
  const lowRevealed = countOwnReveals("lowest");
  const highRevealed = countOwnReveals("highest");
  const start = lowRevealed;
  const end = me.hand.length - highRevealed;
  if (end <= start) return [];
  const out = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}

function countOwnReveals(which) {
  if (!state.turn) return 0;
  let c = 0;
  for (const r of state.turn.reveals) {
    if (r.source === "player" && r.playerId === myId && r.which === which) c++;
  }
  return c;
}

// Reasonable row layout for the middle pile:
//   even count  -> 2 rows (cols = N/2)
//   odd multiple of 3 -> 3 rows (cols = N/3)
//   anything else -> roughly square (ceil(sqrt))
function middleColumns(n) {
  if (n <= 0) return 1;
  if (n % 2 === 0) return n / 2;
  if (n % 3 === 0) return n / 3;
  return Math.ceil(Math.sqrt(n));
}

function renderActions(isMyTurn) {
  const a = $("actions");
  a.innerHTML = "";
  if (state.phase !== "playing") return;
  if (!isMyTurn) {
    a.innerHTML = `<span class="group-label">Espera tu turno…</span>`;
    return;
  }
  if (state.turn?.pendingResolve) {
    a.innerHTML = `<span class="group-label">Resolviendo…</span>`;
    return;
  }
  const label = document.createElement("span");
  label.className = "group-label";
  label.textContent = state.turn?.target === null
    ? "Tu turno: pídele una carta a un jugador o destapa una del centro."
    : `Sigue buscando un ${state.turn.target}.`;
  a.appendChild(label);
}

function renderMeActions(isMyTurn) {
  const canAct = isMyTurn && !state.turn?.pendingResolve;
  const avail = computeAvailableForPlayer(myId);
  const lowBtn = $("me-btn-low");
  const highBtn = $("me-btn-high");
  lowBtn.disabled = !(canAct && avail.lowestUsable);
  highBtn.disabled = !(canAct && avail.highestUsable);
  lowBtn.onclick = () => sendAction({ type: "ask", playerId: myId, which: "lowest" });
  highBtn.onclick = () => sendAction({ type: "ask", playerId: myId, which: "highest" });
}

function computeAvailableForPlayer(pid) {
  const p = state.players.find((x) => x.id === pid);
  if (!p) return { lowestUsable: false, highestUsable: false };
  let usedLow = 0;
  let usedHigh = 0;
  if (state.turn) {
    for (const r of state.turn.reveals) {
      if (r.source !== "player" || r.playerId !== pid) continue;
      if (r.which === "lowest") usedLow++;
      else usedHigh++;
    }
  }
  const total = p.handSize ?? p.hand?.length ?? 0;
  const remaining = total - usedLow - usedHigh;
  if (remaining <= 0) return { lowestUsable: false, highestUsable: false };
  if (remaining === 1) return { lowestUsable: true, highestUsable: false };
  return { lowestUsable: true, highestUsable: true };
}

function renderTrios(trios) {
  return trios
    .map((n) => `<span class="trio-chip ${n === 7 ? "seven" : ""}">${n}×3</span>`)
    .join("");
}

function renderLog() {
  const el = $("log");
  el.innerHTML = "";
  for (const entry of state.log || []) {
    const div = document.createElement("div");
    div.className = "entry " + (entry.kind || "");
    div.textContent = entry.text;
    el.appendChild(div);
  }
  el.scrollTop = el.scrollHeight;
}

function sendAction(action) {
  callOK("action", { action });
}

$("btn-play-again").onclick = () => callOK("playAgain", {});

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
