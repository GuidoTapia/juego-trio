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
// Flips to true while we're in a room. Used to ignore in-flight state messages
// that the server may have emitted before our leaveRoom was processed — without
// this guard, leaving from the winner overlay flickers back to the game.
let inRoom = false;
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
    if (res?.ok) { inRoom = true; showScreen("room"); }
  });
};
$("btn-join").onclick = () => {
  const name = $("input-name").value.trim();
  const code = $("input-code").value.trim().toUpperCase();
  if (!name) return toast("Pon un nombre");
  if (!code) return toast("Falta el código");
  localStorage.setItem("trio:name", name);
  callOK("joinRoom", { name, code }, (res) => {
    if (res?.ok) { inRoom = true; showScreen("room"); }
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
  inRoom = false;
  socket.emit("leaveRoom");
  state = null;
  // Force-hide the winner overlay in case we're leaving from it.
  $("winner-overlay").classList.add("hidden");
  showScreen("home");
}

$("btn-add-bot").onclick = () => callOK("addBot", {});
$("btn-start").onclick = () => callOK("startGame", {});

/* =================== Socket events =================== */
socket.on("connect", () => { myId = socket.id; });
socket.on("state", (s) => {
  if (!inRoom) return; // ignore stragglers after we explicitly left
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
    const reveals = playerRevealsThisTurn(p.id);
    let handHTML = "";
    // Leftmost: revealed-as-lowest cards (face up, in reveal order).
    for (const num of reveals.low) {
      handHTML += `<div class="mini-card face" style="background-image:url('/cartas/carta-trio-${num}.webp')"></div>`;
    }
    // Middle: still-hidden cards (card backs).
    const hidden = Math.max(0, p.handSize - reveals.low.length - reveals.high.length);
    for (let i = 0; i < hidden; i++) handHTML += '<div class="mini-card"></div>';
    // Rightmost: revealed-as-highest cards (face up, in reverse so the actual hand
    // highest appears furthest right).
    for (let i = reveals.high.length - 1; i >= 0; i--) {
      handHTML += `<div class="mini-card face" style="background-image:url('/cartas/carta-trio-${reveals.high[i]}.webp')"></div>`;
    }
    const avail = computeAvailableForPlayer(p.id);
    div.innerHTML = `
      <div class="name">${escapeHTML(p.name)}${!p.connected ? ' <span style="font-size:10px;color:#c00">(desconectado)</span>' : ""}</div>
      <div class="stats">${p.handSize} cartas</div>
      <div class="opp-hand">${handHTML}</div>
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
      c.style.backgroundImage = `url('/cartas/carta-trio-${cell.number}.webp')`;
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
    const availIdxs = isMyTurn && !state.turn?.pendingResolve ? computeMyAvailable() : [];
    me.hand.forEach((num, idx) => {
      const card = document.createElement("div");
      card.className = "card face";
      card.dataset.num = num;
      card.style.backgroundImage = `url('/cartas/carta-trio-${num}.webp')`;
      const isRevealedFromMe =
        idx < lowRevealed || idx >= me.hand.length - highRevealed;
      if (isRevealedFromMe) card.classList.add("revealed-from-me");
      // Tappable end cards (lowest at left, highest at right) on my turn.
      if (!isRevealedFromMe && availIdxs.length > 0) {
        if (idx === availIdxs[0]) {
          card.classList.add("highlight", "clickable");
          card.onclick = () => sendAction({ type: "ask", playerId: myId, which: "lowest" });
        } else if (availIdxs.length > 1 && idx === availIdxs[availIdxs.length - 1]) {
          card.classList.add("highlight", "clickable");
          card.onclick = () => sendAction({ type: "ask", playerId: myId, which: "highest" });
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
  const label = $("reveal-label");
  row.innerHTML = "";
  result.textContent = "";
  result.className = "reveal-result";
  label.innerHTML = "Reveladas este turno";

  if (!state.turn || state.turn.reveals.length === 0) {
    row.innerHTML = '<span style="color:#aaa;font-size:12px;">—</span>';
    return;
  }
  if (state.turn.target !== null) {
    label.innerHTML = `Objetivo <span class="target-pill">${state.turn.target}</span>`;
  }
  for (const r of state.turn.reveals) {
    const entry = document.createElement("div");
    entry.className = "reveal-entry";
    const meta = r.source === "player"
      ? `${escapeHTML(r.playerName)}<br>${r.which === "lowest" ? "↓ baja" : "↑ alta"}`
      : "centro";
    entry.innerHTML = `
      <div class="card face flipped" style="background-image:url('/cartas/carta-trio-${r.number}.webp')" data-num="${r.number}"></div>
      <div class="reveal-meta">${meta}</div>
    `;
    row.appendChild(entry);
  }
  if (state.turn.pendingResolve) {
    const last = state.turn.reveals[state.turn.reveals.length - 1];
    const allMatch = state.turn.reveals.length === 3 &&
      state.turn.reveals.every((r) => r.number === state.turn.target);
    if (allMatch) {
      result.textContent = `¡TRIO DEL ${state.turn.target}!`;
      result.classList.add("trio");
    } else if (last.number !== state.turn.target) {
      result.textContent = `${last.number} ≠ ${state.turn.target}`;
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
    .map((n) => {
      const card = `<div class="trio-card" style="background-image:url('/cartas/carta-trio-${n}.webp')"></div>`;
      return `<div class="trio-group ${n === 7 ? "seven" : ""}" title="Trio del ${n}">${card}${card}${card}</div>`;
    })
    .join(" ");
}

// What numbers has this player been forced to reveal in the current turn?
// Returns { low: [n1, n2, ...], high: [m1, m2, ...] } in the order they were revealed.
function playerRevealsThisTurn(playerId) {
  const low = [];
  const high = [];
  for (const r of state.turn?.reveals || []) {
    if (r.source !== "player" || r.playerId !== playerId) continue;
    if (r.which === "lowest") low.push(r.number);
    else high.push(r.number);
  }
  return { low, high };
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

/* =================== Tutorial =================== */
function cardImg(n, extraClass = "") {
  return `<div class="tut-card ${extraClass}" style="background-image:url('/cartas/carta-trio-${n}.webp')"></div>`;
}
function backImg() {
  return `<div class="tut-card back"></div>`;
}

const TUTORIAL_STEPS = [
  {
    title: "¿Qué es Trio?",
    body: `
      <p>Trio es un juego rápido en el que <span class="key">tres es el número mágico</span>.</p>
      <p>El mazo tiene 36 cartas: 3 copias de cada número del 1 al 12. Tu objetivo es completar trios (3 cartas iguales) antes que los demás.</p>
      <div class="tutorial-visual">
        ${cardImg(5)}${cardImg(5)}${cardImg(5)}
      </div>
    `,
  },
  {
    title: "El reparto",
    body: `
      <p>Cada jugador recibe varias cartas en su mano, <span class="key">ordenadas de menor a mayor</span>. Las cartas que sobran se ponen boca abajo en el centro de la mesa.</p>
      <div class="tutorial-visual">
        ${backImg()}${backImg()}${backImg()}${backImg()}${backImg()}
      </div>
      <p>Nadie ve las cartas de nadie — ni siquiera las del centro.</p>
    `,
  },
  {
    title: "En tu turno",
    body: `
      <p>Tienes dos formas de revelar cartas, una a la vez:</p>
      <ul>
        <li>Pulsa <span class="key">↓ Más baja</span> o <span class="key">↑ Más alta</span> en cualquier jugador (incluido tú) para destapar la carta del extremo de su mano.</li>
        <li>O pulsa una carta del <span class="key">centro</span> para destaparla.</li>
      </ul>
      <p>La <strong>primera</strong> carta revelada define el número que estás cazando.</p>
    `,
  },
  {
    title: "Coincidir o fallar",
    body: `
      <p>Una vez fijado el número, sigues revelando. Tienes dos finales posibles:</p>
      <div class="tutorial-visual outcome">
        <div class="outcome-row">
          <span class="outcome-label ok">¡Trio!</span>
          ${cardImg(8)}${cardImg(8)}${cardImg(8)}
        </div>
        <div class="outcome-row">
          <span class="outcome-label fail">Falla</span>
          ${cardImg(8)}${cardImg(8)}${cardImg(3)}
        </div>
      </div>
      <p>Si las 3 coinciden, te llevas el trio. Si una no coincide, las cartas vuelven a su sitio y pasa el turno.</p>
    `,
  },
  {
    title: "Cómo ganar",
    body: `
      <p>Gana el primero que reúna:</p>
      <ul>
        <li><span class="key">3 trios</span> cualesquiera, o</li>
        <li>El <span class="key">trio del 7</span> (vale como victoria inmediata).</li>
      </ul>
      <div class="tutorial-visual">
        ${cardImg(7)}${cardImg(7)}${cardImg(7)}
      </div>
      <p>El 7 está en el medio del rango (1-12) y es difícil de cazar — por eso es el premio mayor.</p>
    `,
  },
  {
    title: "¡A jugar!",
    body: `
      <p>Vamos a abrir una partida con 2 bots para que pruebes. Cuando sea tu turno, mira los <strong>botones ↓ ↑</strong> de cada jugador o pulsa las cartas de los extremos de tu mano.</p>
      <p>Si te trabas, este tutorial vuelve a estar disponible desde el menú principal.</p>
    `,
    finalAction: { label: "Empezar partida con bots", run: startTutorialGame },
  },
];

let tutorialIdx = 0;

function openTutorial() {
  tutorialIdx = 0;
  renderTutorial();
  $("tutorial-overlay").classList.remove("hidden");
}
function closeTutorial() {
  $("tutorial-overlay").classList.add("hidden");
}
function renderTutorial() {
  const step = TUTORIAL_STEPS[tutorialIdx];
  $("tutorial-body").innerHTML = `<h2>${escapeHTML(step.title)}</h2>${step.body}`;
  $("tutorial-progress").textContent = `${tutorialIdx + 1} / ${TUTORIAL_STEPS.length}`;
  $("tutorial-prev").disabled = tutorialIdx === 0;
  const next = $("tutorial-next");
  if (tutorialIdx === TUTORIAL_STEPS.length - 1 && step.finalAction) {
    next.textContent = step.finalAction.label;
  } else if (tutorialIdx === TUTORIAL_STEPS.length - 1) {
    next.textContent = "Cerrar";
  } else {
    next.textContent = "Siguiente";
  }
}
function nextTutorial() {
  const step = TUTORIAL_STEPS[tutorialIdx];
  if (tutorialIdx === TUTORIAL_STEPS.length - 1) {
    closeTutorial();
    if (step.finalAction) step.finalAction.run();
    return;
  }
  tutorialIdx++;
  renderTutorial();
}
function prevTutorial() {
  if (tutorialIdx > 0) { tutorialIdx--; renderTutorial(); }
}

function startTutorialGame() {
  const name = ($("input-name").value || "").trim() || "Tú";
  localStorage.setItem("trio:name", name);
  callOK("createRoom", { name }, (res) => {
    if (!res?.ok) return;
    inRoom = true;
    socket.emit("addBot", {}, (r1) => {
      if (!r1?.ok) return toast(r1?.error || "Error añadiendo bot");
      socket.emit("addBot", {}, (r2) => {
        if (!r2?.ok) return toast(r2?.error || "Error añadiendo bot");
        socket.emit("startGame", {}, (r3) => {
          if (!r3?.ok) toast(r3?.error || "Error empezando");
        });
      });
    });
  });
}

$("btn-tutorial").onclick = openTutorial;
$("tutorial-close").onclick = closeTutorial;
$("tutorial-next").onclick = nextTutorial;
$("tutorial-prev").onclick = prevTutorial;
