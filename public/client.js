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
// True only for the in-game guided session that the home-page tutorial spawns.
// When true and the first state arrives, we run a coachmark sequence.
let isTutorial = false;
let tutorialCoachShown = false;

// Persistent client identity: lets the server reattach this user to an existing
// player slot after a refresh or accidental disconnect. Lives in localStorage.
let myToken = localStorage.getItem("trio:token");
if (!myToken) {
  myToken = (crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  localStorage.setItem("trio:token", myToken);
}

const stored = {
  name: localStorage.getItem("trio:name") || "",
};
if (stored.name) $("input-name").value = stored.name;
// Pre-fill the join code if the page was opened with a shared room URL.
{
  const urlRoom = getUrlRoom();
  if (urlRoom) $("input-code").value = urlRoom;
}

// URL hash <-> room code. Sharing the URL is enough to invite someone or to
// recover your own session after a reload.
function getUrlRoom() {
  const raw = (location.hash || "").replace(/^#/, "").toUpperCase();
  return /^[A-Z0-9]{4}$/.test(raw) ? raw : "";
}
function setUrlRoom(code) {
  if (!code) return;
  if (location.hash !== `#${code}`) {
    history.replaceState(null, "", `#${code}`);
  }
}
function clearUrlRoom() {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

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
    if (!res?.ok) toast(res?.error || t("toast.error"));
    cb?.(res);
  });
}

/* =================== Home actions =================== */
$("btn-create").onclick = () => {
  const name = $("input-name").value.trim();
  if (!name) return toast(t("toast.need_name"));
  localStorage.setItem("trio:name", name);
  callOK("createRoom", { name, token: myToken }, (res) => {
    if (res?.ok) {
      inRoom = true;
      setUrlRoom(res.code);
      showScreen("room");
    }
  });
};
$("btn-join").onclick = () => {
  const name = $("input-name").value.trim();
  const code = $("input-code").value.trim().toUpperCase();
  if (!name) return toast(t("toast.need_name"));
  if (!code) return toast(t("toast.need_code"));
  localStorage.setItem("trio:name", name);
  callOK("joinRoom", { name, code, token: myToken }, (res) => {
    if (res?.ok) {
      inRoom = true;
      setUrlRoom(res.code);
      showScreen("room");
    }
  });
};
$("input-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

/* =================== Room (lobby) actions =================== */
$("btn-copy").onclick = async () => {
  const code = state?.code;
  if (!code) return;
  try { await navigator.clipboard.writeText(code); toast(t("toast.code_copied")); }
  catch { toast(code); }
};
$("btn-leave").onclick = () => leaveRoom();
$("btn-leave-2").onclick = () => leaveRoom();
$("btn-leave-3").onclick = () => leaveRoom();

function leaveRoom() {
  inRoom = false;
  isTutorial = false;
  tutorialCoachShown = false;
  endCoachmarks();
  socket.emit("leaveRoom");
  state = null;
  clearUrlRoom();
  // Force-hide the winner overlay in case we're leaving from it.
  $("winner-overlay").classList.add("hidden");
  showScreen("home");
}

$("btn-add-bot").onclick = () => callOK("addBot", {});
$("btn-start").onclick = () => callOK("startGame", {});

// Runs on every socket (re)connection. Two jobs:
//  - If we believe we're still in a room (e.g. the socket dropped mid-game),
//    silently re-bind to our slot via the persistent token.
//  - On a fresh load where the URL carries a room code, try to walk straight
//    back into that room. If we have no saved name yet, just pre-fill the code.
function attemptAutoRejoin() {
  const code = (inRoom && state?.code) ? state.code : getUrlRoom();
  if (!code) return;
  const name = (localStorage.getItem("trio:name") || "").trim();
  if (!name) {
    $("input-code").value = code;
    return;
  }
  socket.emit("joinRoom", { name, code, token: myToken }, (res) => {
    if (res?.ok) {
      inRoom = true;
      setUrlRoom(res.code);
      if (!screens.room.classList.contains("active") &&
          !screens.game.classList.contains("active")) {
        showScreen("room");
      }
    } else if (inRoom) {
      // We thought we were in a room but the server no longer knows us
      // (room expired, server restarted…). Fall back to the home screen.
      inRoom = false;
      state = null;
      clearUrlRoom();
      showScreen("home");
      toast(res?.error || t("toast.error"));
    } else {
      // Fresh load, room unavailable — keep the code handy for a manual retry.
      $("input-code").value = code;
    }
  });
}

/* =================== Socket events =================== */
socket.on("connect", () => {
  myId = socket.id;
  attemptAutoRejoin();
});
socket.on("state", (s) => {
  if (!inRoom) return; // ignore stragglers after we explicitly left
  state = s;
  myId = s.you;
  setUrlRoom(s.code);
  render();
  // Tutorial-mode coachmarks: once the first "playing" state lands, walk the
  // player through the table before they make their first move.
  if (isTutorial && !tutorialCoachShown && state.phase === "playing") {
    tutorialCoachShown = true;
    // Defer to next frame so the layout is settled before measuring rects.
    requestAnimationFrame(() => requestAnimationFrame(startCoachmarks));
  }
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
    if (p.id === state.hostId) labels.push(`<span class="host-badge">${t("lobby.host_badge")}</span>`);
    if (p.id === myId) labels.push(`<span class="you-badge">${t("lobby.you_badge")}</span>`);
    li.innerHTML = `<span>${escapeHTML(p.name)} ${labels.join("")}</span>`;
    if (p.isBot && iAmHost) {
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.textContent = t("lobby.remove");
      btn.onclick = () => callOK("removeBot", { playerId: p.id });
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
  const n = state.players.length;
  $("btn-add-bot").disabled = !iAmHost || n >= 6;
  $("btn-start").disabled = !iAmHost || n < 3 || n > 6;
  const hint = $("lobby-hint");
  if (n < 3) hint.textContent = t("lobby.hint_need_more", { n: 3 - n });
  else if (!iAmHost) hint.textContent = t("lobby.hint_waiting_host");
  else hint.textContent = t("lobby.hint_ready", { n });

  // Mode selector — only the host can change it; others see it locked.
  const mode = state.mode || "simple";
  for (const btn of document.querySelectorAll(".mode-btn")) {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle("active", isActive);
    btn.disabled = !iAmHost;
    btn.onclick = iAmHost && !isActive
      ? () => callOK("setMode", { mode: btn.dataset.mode })
      : null;
  }
  $("mode-desc").textContent = iAmHost
    ? t(mode === "spicy" ? "lobby.mode_spicy_desc" : "lobby.mode_simple_desc")
    : t(mode === "spicy" ? "lobby.mode_spicy_desc" : "lobby.mode_simple_desc")
        + " · " + t("lobby.mode_locked");

  // The winning rule depends on the mode.
  $("rule-win").innerHTML = t(mode === "spicy" ? "lobby.rule4_spicy" : "lobby.rule4_simple");
}

function renderGame() {
  $("game-code").textContent = state.code;

  // Show the SPICY tag in the header when that mode is active.
  const modeTag = $("mode-tag");
  if (state.mode === "spicy") {
    modeTag.textContent = t("game.mode_spicy_tag");
    modeTag.style.display = "";
  } else {
    modeTag.style.display = "none";
  }

  const me = state.players.find((p) => p.id === myId);
  const current = state.players.find((p) => p.id === state.currentPlayerId);
  const isMyTurn = current && current.id === myId;

  // Turn banner
  const banner = $("turn-banner");
  if (state.phase === "ended") {
    const w = state.players.find((p) => p.id === state.winner);
    banner.textContent = t("game.turn_win", { name: w?.name ?? "?" });
  } else if (isMyTurn) {
    banner.textContent = t("game.turn_mine");
  } else if (current) {
    banner.textContent = t("game.turn_other", { name: current.name });
  }

  const canAct = isMyTurn && !state.turn?.pendingResolve;

  // Opponents area — adaptive grid: at most 2 rows, columns = ceil(count/2),
  // so 2 opponents stack in 1 column, 3-4 use 2 columns, 5 use 3.
  const oppEl = $("opponents");
  oppEl.innerHTML = "";
  const opponents = state.players.filter((p) => p.id !== myId);
  const oppCols = Math.max(1, Math.ceil(opponents.length / 2));
  oppEl.style.gridTemplateColumns = `repeat(${oppCols}, 170px)`;
  for (const p of opponents) {
    const isCurrent = p.id === state.currentPlayerId;
    const div = document.createElement("div");
    div.className = "opponent" + (isCurrent ? " turn" : "") +
      (!p.connected ? " disconnected" : "") + (p.handSize === 0 ? " empty" : "") +
      (p.botControlled ? " bot-controlled" : "");
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
    let statusTag = "";
    if (p.botControlled) {
      statusTag = ` <span class="bot-tag" title="${t("game.bot_badge_title")}">🤖</span>`;
    } else if (!p.connected) {
      statusTag = ` <span style="font-size:10px;color:#c00">${t("game.opp_disconnected")}</span>`;
    }
    div.innerHTML = `
      <div class="name">${escapeHTML(p.name)}${statusTag}</div>
      <div class="stats">${t("game.cards_count", { n: p.handSize })}</div>
      <div class="opp-hand">${handHTML}</div>
      <div class="opp-trios">${triosHTML}</div>
      <div class="opp-actions">
        <button class="opp-btn" data-which="lowest" ${canAct && avail.lowestUsable ? "" : "disabled"}>${t("game.actions.ask_low")}</button>
        <button class="opp-btn" data-which="highest" ${canAct && avail.highestUsable ? "" : "disabled"}>${t("game.actions.ask_high")}</button>
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
    <span><strong>${escapeHTML(me?.name || "")}</strong> · ${t("game.cards_count", { n: me?.hand?.length ?? 0 })}</span>
    <span>${t("game.your_trios")} <span class="my-trios">${renderTrios(me?.trios || [])}</span></span>
  `;

  // Spicy-mode hint: which trios to chase, given the ones already collected.
  const spicyHint = $("spicy-hint");
  if (state.mode === "spicy" && state.phase === "playing") {
    const myTrios = me?.trios || [];
    if (myTrios.length === 0) {
      spicyHint.innerHTML = t("game.spicy_hint_first");
    } else {
      const targets = spicyTargets(myTrios);
      spicyHint.innerHTML = t("game.spicy_hint_targets", { nums: targets.join(", ") });
    }
    spicyHint.hidden = false;
  } else {
    spicyHint.hidden = true;
  }
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

  // Bot-takeover banner: shown when I'm back but a bot still holds my seat.
  const takeoverBanner = $("takeover-banner");
  if (state.phase === "playing" && me?.botControlled) {
    takeoverBanner.classList.remove("hidden");
  } else {
    takeoverBanner.classList.add("hidden");
  }

  // Winner overlay
  const overlay = $("winner-overlay");
  if (state.phase === "ended") {
    const w = state.players.find((p) => p.id === state.winner);
    $("winner-title").textContent = w?.id === myId
      ? t("winner.title_self")
      : t("winner.title_other", { name: w?.name ?? "?" });
    if (w?.trios?.includes(7)) {
      $("winner-detail").textContent = t("winner.detail_seven");
    } else if (state.mode === "spicy") {
      const pair = findConnectedPair(w?.trios || []);
      $("winner-detail").textContent = pair
        ? t("winner.detail_connected", { a: pair[0], b: pair[1] })
        : t("winner.detail_three");
    } else {
      $("winner-detail").textContent = t("winner.detail_three");
    }
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
  label.innerHTML = t("game.reveal_label_waiting");

  if (!state.turn || state.turn.reveals.length === 0) {
    row.innerHTML = '<span style="color:#aaa;font-size:12px;">—</span>';
    return;
  }
  if (state.turn.target !== null) {
    label.innerHTML = `${t("game.reveal_label_target")} <span class="target-pill">${state.turn.target}</span>`;
  }
  for (const r of state.turn.reveals) {
    const entry = document.createElement("div");
    entry.className = "reveal-entry";
    let meta;
    if (r.source === "player") {
      const which = r.which === "lowest" ? t("game.reveal_meta_low") : t("game.reveal_meta_high");
      meta = `${escapeHTML(r.playerName)}<br>${which}`;
    } else {
      meta = t("game.reveal_meta_middle");
    }
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
      result.textContent = t("game.reveal_trio", { n: state.turn.target });
      result.classList.add("trio");
    } else if (last.number !== state.turn.target) {
      result.textContent = t("game.reveal_fail", { got: last.number, target: state.turn.target });
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

// Column count for the middle pile.
//   Desktop — the center column is narrow but tall, so use fewer, taller
//   columns: 2 for 6/8 cards, 3 for 9.
//   Mobile — wider grids to limit vertical scrolling (6→3, 8→4, 9→3).
function middleColumns(n) {
  if (n <= 0) return 1;
  if (window.innerWidth > 700) return n >= 9 ? 3 : 2;
  if (n % 2 === 0) return n / 2;
  if (n % 3 === 0) return n / 3;
  return Math.ceil(Math.sqrt(n));
}

function renderActions(isMyTurn) {
  const a = $("actions");
  a.innerHTML = "";
  if (state.phase !== "playing") return;
  if (!isMyTurn) {
    a.innerHTML = `<span class="group-label">${t("game.wait_turn")}</span>`;
    return;
  }
  if (state.turn?.pendingResolve) {
    a.innerHTML = `<span class="group-label">${t("game.resolving")}</span>`;
    return;
  }
  const label = document.createElement("span");
  label.className = "group-label";
  label.textContent = state.turn?.target === null
    ? t("game.your_turn_first")
    : t("game.your_turn_continue", { n: state.turn.target });
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

// Spicy connection: two trio numbers are linked if they add up to 7 or differ
// by 7 (mirrors server/modes.js areConnected).
function areConnected(a, b) {
  return a + b === 7 || Math.abs(a - b) === 7;
}

// First connected pair within a set of trio numbers, or null.
function findConnectedPair(trios) {
  for (let i = 0; i < trios.length; i++) {
    for (let j = i + 1; j < trios.length; j++) {
      if (areConnected(trios[i], trios[j])) return [trios[i], trios[j]];
    }
  }
  return null;
}

// Numbers that, completed as a trio, would connect to one the player already
// has — i.e. the trios worth chasing to win in spicy mode.
function spicyTargets(myTrios) {
  const targets = new Set();
  for (const trio of myTrios) {
    for (let n = 1; n <= 12; n++) {
      if (!myTrios.includes(n) && areConnected(trio, n)) targets.add(n);
    }
  }
  return [...targets].sort((a, b) => a - b);
}

function renderTrios(trios) {
  const spicy = state?.mode === "spicy";
  return trios
    .map((n, i) => {
      const card = `<div class="trio-card" style="background-image:url('/cartas/carta-trio-${n}.webp')"></div>`;
      const classes = ["trio-group"];
      if (n === 7) classes.push("seven");
      const connected = spicy && trios.some((m, j) => j !== i && areConnected(n, m));
      if (connected) classes.push("connected");
      const title = connected ? t("game.connected_title") : `Trio ${n}`;
      return `<div class="${classes.join(" ")}" title="${title}">${card}${card}${card}</div>`;
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
    div.textContent = entry.i18nKey
      ? t(entry.i18nKey, entry.params || {})
      : (entry.text || "");
    el.appendChild(div);
  }
  el.scrollTop = el.scrollHeight;
}

function sendAction(action) {
  callOK("action", { action });
}

$("btn-play-again").onclick = () => callOK("playAgain", {});
$("btn-take-control").onclick = () => callOK("takeControl", {});

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

// Each step references i18n keys for translated copy; the visual builder draws
// real card thumbnails so the example art is consistent across languages.
const TUTORIAL_STEPS = [
  { titleKey: "tutorial.step1.title", bodyKey: "tutorial.step1.body",
    visual: () => `${cardImg(5)}${cardImg(5)}${cardImg(5)}` },
  { titleKey: "tutorial.step2.title", bodyKey: "tutorial.step2.body",
    visual: () => `${backImg()}${backImg()}${backImg()}${backImg()}${backImg()}` },
  { titleKey: "tutorial.step3.title", bodyKey: "tutorial.step3.body" },
  { titleKey: "tutorial.step4.title", bodyKey: "tutorial.step4.body",
    visualClass: "outcome",
    visual: () => `
      <div class="outcome-row">
        <span class="outcome-label ok">${t("tutorial.step4.ok_label")}</span>
        ${cardImg(8)}${cardImg(8)}${cardImg(8)}
      </div>
      <div class="outcome-row">
        <span class="outcome-label fail">${t("tutorial.step4.fail_label")}</span>
        ${cardImg(8)}${cardImg(8)}${cardImg(3)}
      </div>
    `,
    tailKey: "tutorial.step4.tail" },
  { titleKey: "tutorial.step5.title", bodyKey: "tutorial.step5.body",
    visual: () => `${cardImg(7)}${cardImg(7)}${cardImg(7)}` },
  { titleKey: "tutorial.step6.title", bodyKey: "tutorial.step6.body",
    finalAction: { labelKey: "tutorial.start", run: startTutorialGame } },
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
  const visualHTML = step.visual
    ? `<div class="tutorial-visual ${step.visualClass || ""}">${step.visual()}</div>`
    : "";
  const tailHTML = step.tailKey ? t(step.tailKey) : "";
  $("tutorial-body").innerHTML =
    `<h2>${escapeHTML(t(step.titleKey))}</h2>${t(step.bodyKey)}${visualHTML}${tailHTML}`;
  $("tutorial-progress").textContent = `${tutorialIdx + 1} / ${TUTORIAL_STEPS.length}`;
  $("tutorial-prev").disabled = tutorialIdx === 0;
  $("tutorial-prev").textContent = t("tutorial.prev");
  const next = $("tutorial-next");
  if (tutorialIdx === TUTORIAL_STEPS.length - 1 && step.finalAction) {
    next.textContent = t(step.finalAction.labelKey);
  } else if (tutorialIdx === TUTORIAL_STEPS.length - 1) {
    next.textContent = t("tutorial.close");
  } else {
    next.textContent = t("tutorial.next");
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
  const fallback = getLang() === "es" ? "Tú" : "You";
  const name = ($("input-name").value || "").trim() || fallback;
  localStorage.setItem("trio:name", name);
  callOK("createRoom", { name, token: myToken, tutorial: true }, (res) => {
    if (!res?.ok) return;
    inRoom = true;
    isTutorial = true;
    tutorialCoachShown = false;
    socket.emit("addBot", {}, (r1) => {
      if (!r1?.ok) return toast(r1?.error || "Error añadiendo bot");
      socket.emit("addBot", {}, (r2) => {
        if (!r2?.ok) return toast(r2?.error || "Error añadiendo bot");
        // Force the human to play the first turn so the tutorial feels like a
        // proper "your move" intro rather than dropping into a bot's reveal.
        socket.emit("startGame", { firstPlayerId: socket.id }, (r3) => {
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

/* =================== Language selectors =================== */
// There is one .lang-select on each screen so the control is always reachable.
// They share the same setLang() target and stay in sync on change.
(function setupLangSelectors() {
  if (typeof window.LANGS === "undefined") return;
  const selectors = document.querySelectorAll(".lang-select");
  for (const sel of selectors) {
    for (const { code, label } of window.LANGS) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = label;
      sel.appendChild(opt);
    }
    sel.value = getLang();
    sel.addEventListener("change", () => {
      setLang(sel.value);
      for (const other of selectors) if (other !== sel) other.value = sel.value;
    });
  }
})();

// Re-render every dynamic surface whenever the language changes so the running
// game updates instantly (turn banner, action buttons, log entries, etc.).
document.addEventListener("trio:lang-changed", () => {
  if (state) render();
  if (!$("tutorial-overlay").classList.contains("hidden")) renderTutorial();
});

// Re-render on resize (rAF-throttled) so the middle-grid column count adapts
// when crossing the mobile/desktop breakpoint.
let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if (state && state.phase !== "lobby") render();
  });
});

/* =================== In-game coachmarks =================== */
// Each step points at a real DOM selector in the game screen and explains it.
// Targets are read at fire-time so they pick up the rendered layout (cards,
// opponents, etc.).
const COACH_STEPS = [
  { selector: "#me-hand",       titleKey: "coach.hand.title",   bodyKey: "coach.hand.body",   placement: "top" },
  { selector: ".me-hand-row",   titleKey: "coach.row.title",    bodyKey: "coach.row.body",    placement: "top" },
  { selector: "#opponents",     titleKey: "coach.opps.title",   bodyKey: "coach.opps.body",   placement: "bottom" },
  { selector: "#middle",        titleKey: "coach.middle.title", bodyKey: "coach.middle.body", placement: "top" },
  { selector: ".reveal-strip",  titleKey: "coach.reveal.title", bodyKey: "coach.reveal.body", placement: "left" },
  { selector: "#turn-banner",   titleKey: "coach.turn.title",   bodyKey: "coach.turn.body",   placement: "bottom" },
];

let coachIdx = 0;
let coachActiveTarget = null;

function startCoachmarks() {
  coachIdx = 0;
  $("coach-overlay").classList.remove("hidden");
  showCoachStep();
  window.addEventListener("resize", repositionCoachmark);
}

function showCoachStep() {
  const step = COACH_STEPS[coachIdx];
  if (!step) return endCoachmarks();
  // Unhighlight previous
  if (coachActiveTarget) unhighlightCoach(coachActiveTarget);
  const target = document.querySelector(step.selector);
  if (!target) {
    coachIdx++;
    return showCoachStep();
  }
  coachActiveTarget = target;
  highlightCoach(target);

  const tip = $("coach-tooltip");
  tip.style.display = "block";
  tip.innerHTML = `
    <h3>${escapeHTML(t(step.titleKey))}</h3>
    <p>${t(step.bodyKey)}</p>
    <div class="coach-actions">
      <span class="coach-step">${coachIdx + 1} / ${COACH_STEPS.length}</span>
      <div>
        <button class="coach-skip" id="coach-skip">${t("coach.skip")}</button>
        <button class="primary" id="coach-next">${coachIdx === COACH_STEPS.length - 1 ? t("coach.done") : t("coach.next")}</button>
      </div>
    </div>
  `;
  // Position after innerHTML is in so size is known.
  positionCoachTooltip(target, step.placement);

  document.getElementById("coach-next").onclick = () => {
    coachIdx++;
    showCoachStep();
  };
  document.getElementById("coach-skip").onclick = endCoachmarks;
}

function repositionCoachmark() {
  const step = COACH_STEPS[coachIdx];
  if (!step || !coachActiveTarget) return;
  positionCoachTooltip(coachActiveTarget, step.placement);
}

function positionCoachTooltip(target, placement) {
  const tip = $("coach-tooltip");
  const tRect = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 12;
  let left, top;
  if (placement === "top") {
    left = tRect.left + tRect.width / 2 - tipRect.width / 2;
    top = tRect.top - tipRect.height - margin;
    if (top < 10) { top = tRect.bottom + margin; } // flip if no room
  } else if (placement === "left") {
    left = tRect.left - tipRect.width - margin;
    top = tRect.top + tRect.height / 2 - tipRect.height / 2;
    if (left < 10) { left = tRect.right + margin; }
  } else if (placement === "right") {
    left = tRect.right + margin;
    top = tRect.top + tRect.height / 2 - tipRect.height / 2;
  } else { // bottom
    left = tRect.left + tRect.width / 2 - tipRect.width / 2;
    top = tRect.bottom + margin;
    if (top + tipRect.height > window.innerHeight - 10) top = tRect.top - tipRect.height - margin;
  }
  // Clamp to viewport.
  left = Math.max(10, Math.min(left, window.innerWidth - tipRect.width - 10));
  top = Math.max(10, Math.min(top, window.innerHeight - tipRect.height - 10));
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function highlightCoach(el) {
  el.dataset._coachOrigPos = el.style.position || "";
  el.dataset._coachOrigZ = el.style.zIndex || "";
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  el.style.zIndex = "2001";
  el.classList.add("coach-highlight");
  // Scroll into view if it's offscreen.
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function unhighlightCoach(el) {
  el.classList.remove("coach-highlight");
  el.style.position = el.dataset._coachOrigPos || "";
  el.style.zIndex = el.dataset._coachOrigZ || "";
  delete el.dataset._coachOrigPos;
  delete el.dataset._coachOrigZ;
}

function endCoachmarks() {
  if (coachActiveTarget) {
    unhighlightCoach(coachActiveTarget);
    coachActiveTarget = null;
  }
  $("coach-overlay").classList.add("hidden");
  const tip = $("coach-tooltip");
  if (tip) {
    tip.style.display = "none";
    tip.innerHTML = "";
  }
  window.removeEventListener("resize", repositionCoachmark);
}
