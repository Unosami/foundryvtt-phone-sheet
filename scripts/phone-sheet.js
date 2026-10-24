import PhoneSheet5e from "./dnd5e-sheet.js";
import { hideChat, preloadChat, toggleChat } from "./chat.js";
import { initInviteQR } from "./invite-qr.js";
import { initRollToasts } from "./roll-toast.js";

const MODULE_ID = "phone-sheet";
const WINDOW_CLASS = "phone-sheet-window";

let active = false;

/** The dnd5e phone sheet in use, or null on other systems. */
let phoneSheet = null;

// For the GM on desktop: QR codes in the Game Invitation Links window.
initInviteQR();

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "mode", {
    name: "PHONESHEET.Mode.Name",
    hint: "PHONESHEET.Mode.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      auto: "PHONESHEET.Mode.Auto",
      always: "PHONESHEET.Mode.Always",
      never: "PHONESHEET.Mode.Never"
    },
    default: "auto",
    requiresReload: true
  });
});

/** Decide whether this device should run in phone mode. */
function shouldActivate() {
  const mode = game.settings.get(MODULE_ID, "mode");
  if ( mode === "always" ) return true;
  if ( (mode === "never") || game.user.isGM ) return false;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return window.matchMedia("(pointer: coarse)").matches && (shortSide < 600);
}

/** Whether the phone sheet can show this actor. Anything else gets the system sheet and the fallback toolbar. */
const usePhoneSheet = actor => (game.system.id === "dnd5e") && PhoneSheet5e.TYPES.has(actor.type);

Hooks.once("setup", () => {
  active = shouldActivate();
  if ( !active ) return;
  document.body.classList.add("phone-sheet");

  // Skip the canvas for this session only, without changing the saved core setting.
  // The canvas is initialized right after this hook, and Scene#view checks the same setting.
  const settings = game.settings;
  const get = settings.get;
  settings.get = function(namespace, key, ...args) {
    if ( (namespace === "core") && (key === "noCanvas") ) return true;
    return get.call(this, namespace, key, ...args);
  };
});

Hooks.once("ready", () => {
  if ( !active ) return;
  PhoneSheet5e.menu = {
    fullSheet: actor => renderSheet(actor.sheet),
    switchCharacter: chooseActor,
    openActor: openSheet,
    exit: exitPhoneMode
  };
  buildToolbar();
  openSheet(defaultActor());
  preloadChat();
  initRollToasts();
  keepScreenAwake();
  watchDialogs();
});

/** Pop-ups: any window other than the phone sheet, the full-screen sheets and chat. */
const DIALOG_SELECTOR = `.application:not(.${WINDOW_CLASS}, .phone-sheet-app), .app.window-app:not(.${WINDOW_CLASS})`;

/**
 * Dim the screen behind pop-ups with one shared backdrop, so a dialog opened from another dialog
 * (rolling a hit die during a short rest) doesn't darken the screen twice. Hidden windows don't count.
 */
function watchDialogs() {
  let queued = false;
  const update = () => {
    queued = false;
    const visible = el => (el.checkVisibility ? el.checkVisibility() : el.offsetWidth > 0);
    const open = Array.from(document.body.children).some(el => el.matches(DIALOG_SELECTOR) && visible(el));
    document.body.classList.toggle("phone-sheet-dialog", open);
  };
  new MutationObserver(() => {
    if ( queued ) return;
    queued = true;
    requestAnimationFrame(update);
  }).observe(document.body, { childList: true });
  update();
}

/**
 * Stop the phone dimming and locking mid-session. Browsers only allow this on HTTPS pages
 * (navigator.wakeLock is missing over plain http), and drop the lock whenever the page is hidden.
 */
function keepScreenAwake() {
  if ( !navigator.wakeLock ) return;
  const request = () => navigator.wakeLock.request("screen").catch(() => {});
  request();
  document.addEventListener("visibilitychange", () => {
    if ( document.visibilityState === "visible" ) request();
  });
}

// Any actor sheet or chat popout opened in phone mode fills the screen.
Hooks.on("renderApplicationV2", (app, element) => {
  if ( !active || (app instanceof PhoneSheet5e) ) return;
  if ( isActorSheet(app) || element.classList.contains("sidebar-popout") ) element.classList.add(WINDOW_CLASS);
});
Hooks.on("renderActorSheet", (app, html) => {
  if ( active ) (html[0] ?? html).closest(".app")?.classList.add(WINDOW_CLASS);
});

function isActorSheet(app) {
  return (app instanceof foundry.applications.api.DocumentSheetV2) && (app.document instanceof foundry.documents.Actor);
}

/** The user's assigned character, or the first character they own. */
function defaultActor() {
  return game.user.character ?? ownedActors()[0] ?? null;
}

function ownedActors() {
  return game.actors.filter(a => a.isOwner && (a.type === "character"))
    .concat(game.actors.filter(a => a.isOwner && (a.type !== "character")));
}

let current = null;

function renderSheet(sheet) {
  if ( sheet instanceof foundry.applications.api.ApplicationV2 ) sheet.render({force: true});
  else sheet.render(true);
}

function openSheet(actor) {
  if ( !actor ) {
    ui.notifications.warn("PHONESHEET.NoActor", {localize: true});
    return;
  }
  if ( current && (current !== actor) ) {
    current.sheet?.close();
    phoneSheet?.close();
  }
  current = actor;
  const custom = usePhoneSheet(actor);
  // The phone sheet has its own nav; the toolbar keeps Switch and Exit reachable on every other sheet.
  document.getElementById("phone-sheet-toolbar")?.toggleAttribute("hidden", custom);
  if ( custom ) {
    if ( phoneSheet?.document !== actor ) phoneSheet = new PhoneSheet5e({document: actor});
    phoneSheet.render({force: true});
  }
  else renderSheet(actor.sheet);
}

async function chooseActor() {
  const actors = ownedActors();
  if ( !actors.length ) return openSheet(null);
  if ( actors.length === 1 ) return openSheet(actors[0]);
  const buttons = actors.map(a => ({
    action: a.id,
    label: a.name,
    icon: "fa-solid fa-user",
    default: a === current
  }));
  const id = await foundry.applications.api.DialogV2.wait({
    window: {title: "PHONESHEET.Switch"},
    classes: ["phone-sheet-chooser"],
    buttons,
    rejectClose: false
  });
  if ( id ) openSheet(game.actors.get(id));
}

async function exitPhoneMode() {
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: {title: "PHONESHEET.Exit"},
    content: `<p>${game.i18n.localize("PHONESHEET.ExitConfirm")}</p>`
  });
  if ( !ok ) return;
  await game.settings.set(MODULE_ID, "mode", "never");
  foundry.utils.debouncedReload();
}

/** Bottom toolbar for sheets the phone sheet doesn't handle: other systems, and actor types added by modules. */
function buildToolbar() {
  const bar = document.createElement("nav");
  bar.id = "phone-sheet-toolbar";
  const buttons = [
    ["fa-solid fa-id-card", "PHONESHEET.Sheet", () => { hideChat(); openSheet(current ?? defaultActor()); }],
    ["fa-solid fa-comments", "PHONESHEET.Chat", toggleChat, "ps-chat-button"],
    ["fa-solid fa-users", "PHONESHEET.Switch", chooseActor],
    ["fa-solid fa-desktop", "PHONESHEET.Exit", exitPhoneMode]
  ];
  for ( const [icon, label, onClick, cssClass] of buttons ) {
    const button = document.createElement("button");
    if ( cssClass ) button.classList.add(cssClass);
    button.type = "button";
    button.innerHTML = `<i class="${icon}"></i>`;
    button.ariaLabel = button.dataset.tooltip = game.i18n.localize(label);
    button.addEventListener("click", onClick);
    bar.append(button);
  }
  document.body.append(bar);
}
