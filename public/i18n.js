/* Tiny i18n layer. To add a new language: copy one of the existing language
 * blocks below, translate the values, and register it in the LANGS list. The
 * UI's language selector reads LANGS to render its options. */

const TRANSLATIONS = {
  en: {
    // --- Home / lobby ---
    "home.tagline": "Three is the magic number. 3-6 players in real time.",
    "home.name_label": "Your name",
    "home.name_placeholder": "e.g. Walter",
    "home.create_room": "Create room",
    "home.or": "or",
    "home.code_placeholder": "CODE",
    "home.join": "Join",
    "home.tutorial_button": "First time? Take the tutorial",
    "home.hint": "Share your room code with friends, or add bots to play solo.",
    "home.lang_label": "Language",

    // --- Topbar ---
    "topbar.room": "Room:",
    "topbar.leave": "Leave",
    "topbar.copy": "Copy code",

    // --- In-room lobby ---
    "lobby.players": "Players",
    "lobby.host_badge": "HOST",
    "lobby.you_badge": "YOU",
    "lobby.remove": "Remove",
    "lobby.add_bot": "+ Add bot",
    "lobby.start_game": "Start game",
    "lobby.rules": "Quick rules",
    "lobby.rule1": "On your turn, reveal cards one at a time.",
    "lobby.rule2": "Ask for the <strong>lowest</strong> or <strong>highest</strong> card of any player (yourself included), or flip a card from the <strong>middle</strong>.",
    "lobby.rule3": "If the first two cards match you must keep going until the trio is complete or one fails.",
    "lobby.rule4": "First to collect <strong>3 trios</strong> or the <strong>7 trio</strong> wins.",
    "lobby.hint_need_more": "You need at least 3 players (missing {n}). You can add bots.",
    "lobby.hint_waiting_host": "Waiting for the host to start…",
    "lobby.hint_ready": "{n} players ready. Go when you want!",

    // --- Game table ---
    "game.turn_win": "🏆 {name} wins",
    "game.turn_mine": "✨ Your turn",
    "game.turn_other": "{name}'s turn",
    "game.opp_cards": "{n} cards",
    "game.opp_disconnected": "(disconnected)",
    "game.actions.ask_low": "↓ Lowest",
    "game.actions.ask_high": "↑ Highest",
    "game.actions.my_low": "↓ My lowest",
    "game.actions.my_high": "↑ My highest",
    "game.your_trios": "Your trios:",
    "game.cards_count": "{n} cards",
    "game.wait_turn": "Wait for your turn…",
    "game.resolving": "Resolving…",
    "game.your_turn_first": "Your turn: ask a player for a card or flip one from the middle.",
    "game.your_turn_continue": "Keep looking for a {n}.",
    "game.reveal_label_waiting": "Revealed this turn",
    "game.reveal_label_target": "Target",
    "game.reveal_meta_low": "↓ low",
    "game.reveal_meta_high": "↑ high",
    "game.reveal_meta_middle": "middle",
    "game.reveal_trio": "TRIO OF {n}!",
    "game.reveal_fail": "{got} ≠ {target}",

    // --- Winner overlay ---
    "winner.title_self": "You win! 🎉",
    "winner.title_other": "{name} wins",
    "winner.detail_seven": "With the 7 trio.",
    "winner.detail_three": "With 3 trios.",
    "winner.play_again": "Play again",
    "winner.leave_menu": "Back to menu",

    // --- Toasts ---
    "toast.need_name": "Type a name",
    "toast.need_code": "Missing code",
    "toast.code_copied": "Code copied",
    "toast.error": "Error",

    // --- Server log entries (server pushes i18nKey + params) ---
    "log.start": "The game begins. {name} goes first.",
    "log.turn_change": "{name}'s turn.",
    "log.reveal_self_low": "{actor} reveals their lowest card: {number}.",
    "log.reveal_self_high": "{actor} reveals their highest card: {number}.",
    "log.reveal_ask_low": "{actor} asks {target} for their lowest: {number}.",
    "log.reveal_ask_high": "{actor} asks {target} for their highest: {number}.",
    "log.reveal_middle": "{actor} reveals a card from the middle: {number}.",
    "log.trio_completed": "{name} completes the trio of {number}!",
    "log.fail": "Revealed cards ({reveals}) don't match. Cards go back.",
    "log.win_seven": "{name} WINS with the 7 trio!",
    "log.win_three": "{name} WINS with 3 trios!",

    // --- Tutorial overlay ---
    "tutorial.step1.title": "What is Trio?",
    "tutorial.step1.body": "<p>Trio is a quick card game where <span class=\"key\">three is the magic number</span>.</p><p>The deck has 36 cards: 3 copies of each number from 1 to 12. Your goal: complete trios (3 identical cards) before everyone else.</p>",
    "tutorial.step2.title": "The deal",
    "tutorial.step2.body": "<p>Each player gets a few cards face down, <span class=\"key\">sorted lowest to highest</span>. The leftover cards go face down in the middle.</p><p>Nobody sees anyone else's cards — not even the middle ones.</p>",
    "tutorial.step3.title": "On your turn",
    "tutorial.step3.body": "<p>You can reveal cards two ways, one at a time:</p><ul><li>Click <span class=\"key\">↓ Lowest</span> or <span class=\"key\">↑ Highest</span> on any player (yourself included) to flip the end card of their hand.</li><li>Or tap a <span class=\"key\">middle</span> card to flip it.</li></ul><p>The <strong>first</strong> revealed card sets the number you're chasing.</p>",
    "tutorial.step4.title": "Match or miss",
    "tutorial.step4.body": "<p>After the first card, keep revealing. Two outcomes are possible:</p>",
    "tutorial.step4.ok_label": "Trio!",
    "tutorial.step4.fail_label": "Miss",
    "tutorial.step4.tail": "<p>If all 3 match, you collect the trio. If one doesn't, every card goes back and the turn ends.</p>",
    "tutorial.step5.title": "How to win",
    "tutorial.step5.body": "<p>First player to collect:</p><ul><li><span class=\"key\">3 trios</span>, or</li><li>The <span class=\"key\">7 trio</span> (instant win).</li></ul><p>The 7 sits in the middle of the range — it's the toughest target and worth the biggest prize.</p>",
    "tutorial.step6.title": "Let's play!",
    "tutorial.step6.body": "<p>We'll set up a quick game against 2 bots. When it's your turn, use the <strong>↓ ↑ buttons</strong> on each player or tap the end cards of your own hand.</p><p>This tutorial is always available from the main menu.</p>",
    "tutorial.start": "Start practice game",
    "tutorial.prev": "Back",
    "tutorial.next": "Next",
    "tutorial.close": "Close",
    "tutorial.done": "Done",

    // --- In-game coachmarks (run only during the tutorial's bot game) ---
    "coach.hand.title": "This is your hand",
    "coach.hand.body": "Your cards stay sorted. Only you see them. Leftmost is your lowest, rightmost your highest.",
    "coach.row.title": "Your two plays",
    "coach.row.body": "Tap <span class=\"key\">↓ My lowest</span> or <span class=\"key\">↑ My highest</span> to reveal that end card. You can also tap the highlighted card directly.",
    "coach.opps.title": "The other players",
    "coach.opps.body": "Every opponent's hand is face down. Use the <span class=\"key\">↓ Lowest</span> or <span class=\"key\">↑ Highest</span> buttons under their name to ask for that card.",
    "coach.middle.title": "The middle",
    "coach.middle.body": "These cards are face down too. Tap any of them to flip it — sometimes the middle is your best shot.",
    "coach.reveal.title": "Revealed cards",
    "coach.reveal.body": "Here you see the cards revealed this turn and the target number. When 3 of a kind line up: trio!",
    "coach.turn.title": "It's your turn!",
    "coach.turn.body": "Start by revealing a card — the first one sets the number you'll be chasing. Good luck!",
    "coach.skip": "Skip tutorial",
    "coach.next": "Next",
    "coach.done": "Got it!",
  },

  es: {
    "home.tagline": "Three is the magic number. 3-6 jugadores en tiempo real.",
    "home.name_label": "Tu nombre",
    "home.name_placeholder": "ej. Walter",
    "home.create_room": "Crear sala",
    "home.or": "o",
    "home.code_placeholder": "CÓDIGO",
    "home.join": "Unirse",
    "home.tutorial_button": "¿Primera vez? Hacer tutorial",
    "home.hint": "Comparte el código de tu sala con tus amigos, o añade bots para jugar en solitario.",
    "home.lang_label": "Idioma",

    "topbar.room": "Sala:",
    "topbar.leave": "Salir",
    "topbar.copy": "Copiar código",

    "lobby.players": "Jugadores",
    "lobby.host_badge": "HOST",
    "lobby.you_badge": "TÚ",
    "lobby.remove": "Quitar",
    "lobby.add_bot": "+ Añadir bot",
    "lobby.start_game": "Empezar partida",
    "lobby.rules": "Reglas rápidas",
    "lobby.rule1": "En tu turno, revela cartas una a una.",
    "lobby.rule2": "Pide la carta <strong>más baja</strong> o la <strong>más alta</strong> a cualquier jugador (incluso a ti), o destapa una del <strong>centro</strong>.",
    "lobby.rule3": "Si las dos primeras coinciden, debes seguir hasta completar el trio o fallar.",
    "lobby.rule4": "Gana quien primero reúna <strong>3 trios</strong> o el <strong>trio del 7</strong>.",
    "lobby.hint_need_more": "Necesitas al menos 3 jugadores (faltan {n}). Puedes añadir bots.",
    "lobby.hint_waiting_host": "Esperando al anfitrión para empezar…",
    "lobby.hint_ready": "{n} jugadores listos. ¡Cuando quieras!",

    "game.turn_win": "🏆 Gana {name}",
    "game.turn_mine": "✨ Tu turno",
    "game.turn_other": "Turno de {name}",
    "game.opp_cards": "{n} cartas",
    "game.opp_disconnected": "(desconectado)",
    "game.actions.ask_low": "↓ Más baja",
    "game.actions.ask_high": "↑ Más alta",
    "game.actions.my_low": "↓ Mi más baja",
    "game.actions.my_high": "↑ Mi más alta",
    "game.your_trios": "Tus trios:",
    "game.cards_count": "{n} cartas",
    "game.wait_turn": "Espera tu turno…",
    "game.resolving": "Resolviendo…",
    "game.your_turn_first": "Tu turno: pídele una carta a un jugador o destapa una del centro.",
    "game.your_turn_continue": "Sigue buscando un {n}.",
    "game.reveal_label_waiting": "Reveladas este turno",
    "game.reveal_label_target": "Objetivo",
    "game.reveal_meta_low": "↓ baja",
    "game.reveal_meta_high": "↑ alta",
    "game.reveal_meta_middle": "centro",
    "game.reveal_trio": "¡TRIO DEL {n}!",
    "game.reveal_fail": "{got} ≠ {target}",

    "winner.title_self": "¡Has ganado! 🎉",
    "winner.title_other": "Gana {name}",
    "winner.detail_seven": "Con el trio del 7.",
    "winner.detail_three": "Con 3 trios.",
    "winner.play_again": "Jugar otra vez",
    "winner.leave_menu": "Salir al menú",

    "toast.need_name": "Pon un nombre",
    "toast.need_code": "Falta el código",
    "toast.code_copied": "Código copiado",
    "toast.error": "Error",

    "log.start": "La partida comienza. Empieza {name}.",
    "log.turn_change": "Turno de {name}.",
    "log.reveal_self_low": "{actor} revela su carta más baja: {number}.",
    "log.reveal_self_high": "{actor} revela su carta más alta: {number}.",
    "log.reveal_ask_low": "{actor} pide la carta más baja de {target}: {number}.",
    "log.reveal_ask_high": "{actor} pide la carta más alta de {target}: {number}.",
    "log.reveal_middle": "{actor} revela una carta del centro: {number}.",
    "log.trio_completed": "¡{name} completa el trio de {number}!",
    "log.fail": "Las cartas reveladas ({reveals}) no coinciden. Las cartas vuelven.",
    "log.win_seven": "¡{name} GANA con el trio del 7!",
    "log.win_three": "¡{name} GANA con 3 trios!",

    "tutorial.step1.title": "¿Qué es Trio?",
    "tutorial.step1.body": "<p>Trio es un juego rápido en el que <span class=\"key\">tres es el número mágico</span>.</p><p>El mazo tiene 36 cartas: 3 copias de cada número del 1 al 12. Tu objetivo es completar trios (3 cartas iguales) antes que los demás.</p>",
    "tutorial.step2.title": "El reparto",
    "tutorial.step2.body": "<p>Cada jugador recibe varias cartas en su mano, <span class=\"key\">ordenadas de menor a mayor</span>. Las cartas que sobran se ponen boca abajo en el centro de la mesa.</p><p>Nadie ve las cartas de nadie — ni siquiera las del centro.</p>",
    "tutorial.step3.title": "En tu turno",
    "tutorial.step3.body": "<p>Tienes dos formas de revelar cartas, una a la vez:</p><ul><li>Pulsa <span class=\"key\">↓ Más baja</span> o <span class=\"key\">↑ Más alta</span> en cualquier jugador (incluido tú) para destapar la carta del extremo de su mano.</li><li>O pulsa una carta del <span class=\"key\">centro</span> para destaparla.</li></ul><p>La <strong>primera</strong> carta revelada define el número que estás cazando.</p>",
    "tutorial.step4.title": "Coincidir o fallar",
    "tutorial.step4.body": "<p>Una vez fijado el número, sigues revelando. Tienes dos finales posibles:</p>",
    "tutorial.step4.ok_label": "¡Trio!",
    "tutorial.step4.fail_label": "Falla",
    "tutorial.step4.tail": "<p>Si las 3 coinciden, te llevas el trio. Si una no coincide, las cartas vuelven a su sitio y pasa el turno.</p>",
    "tutorial.step5.title": "Cómo ganar",
    "tutorial.step5.body": "<p>Gana el primero que reúna:</p><ul><li><span class=\"key\">3 trios</span> cualesquiera, o</li><li>El <span class=\"key\">trio del 7</span> (vale como victoria inmediata).</li></ul><p>El 7 está en el medio del rango (1-12) y es difícil de cazar — por eso es el premio mayor.</p>",
    "tutorial.step6.title": "¡A jugar!",
    "tutorial.step6.body": "<p>Vamos a abrir una partida con 2 bots para que pruebes. Cuando sea tu turno, mira los <strong>botones ↓ ↑</strong> de cada jugador o pulsa las cartas de los extremos de tu mano.</p><p>Si te trabas, este tutorial vuelve a estar disponible desde el menú principal.</p>",
    "tutorial.start": "Empezar partida con bots",
    "tutorial.prev": "Atrás",
    "tutorial.next": "Siguiente",
    "tutorial.close": "Cerrar",
    "tutorial.done": "Listo",

    "coach.hand.title": "Esta es tu mano",
    "coach.hand.body": "Tus cartas están ordenadas de menor a mayor. Solo tú las ves. La de la izquierda es la más baja, la de la derecha la más alta.",
    "coach.row.title": "Tus dos jugadas",
    "coach.row.body": "Pulsa <span class=\"key\">↓ Mi más baja</span> o <span class=\"key\">↑ Mi más alta</span> para revelar la carta de ese extremo. También puedes tocar directamente la carta resaltada.",
    "coach.opps.title": "Los demás jugadores",
    "coach.opps.body": "Cada oponente tiene sus cartas boca abajo. Pulsa los botones <span class=\"key\">↓ Más baja</span> o <span class=\"key\">↑ Más alta</span> debajo de su nombre para pedirle esa carta.",
    "coach.middle.title": "El centro",
    "coach.middle.body": "Estas cartas también están boca abajo. Toca cualquiera para destaparla — a veces el centro es tu mejor opción.",
    "coach.reveal.title": "Cartas reveladas",
    "coach.reveal.body": "Aquí ves las cartas reveladas en este turno y el número objetivo. Cuando aparezcan 3 iguales: ¡trio!",
    "coach.turn.title": "¡Es tu turno!",
    "coach.turn.body": "Empieza revelando una carta — la primera define el número que estarás cazando. Suerte.",
    "coach.skip": "Saltar tutorial",
    "coach.next": "Siguiente",
    "coach.done": "¡Listo!",
  },
};

// Display name + locale code, in the order they should appear in the picker.
window.LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

let currentLang = localStorage.getItem("trio:lang") || "en";
if (!TRANSLATIONS[currentLang]) currentLang = "en";

window.t = function t(key, params) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  let str = dict[key];
  if (str === undefined) str = TRANSLATIONS.en[key];
  if (str === undefined) return key;
  if (!params) return str;
  for (const k of Object.keys(params)) {
    str = str.split("{" + k + "}").join(params[k]);
  }
  return str;
};

window.setLang = function setLang(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  localStorage.setItem("trio:lang", lang);
  applyTranslations();
  document.dispatchEvent(new Event("trio:lang-changed"));
};

window.getLang = function getLang() {
  return currentLang;
};

window.applyTranslations = function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.innerHTML = window.t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = window.t(el.getAttribute("data-i18n-placeholder"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = window.t(el.getAttribute("data-i18n-title"));
  });
  document.documentElement.lang = currentLang;
};

// Run once on load so static text is already in the right language.
document.addEventListener("DOMContentLoaded", window.applyTranslations);
