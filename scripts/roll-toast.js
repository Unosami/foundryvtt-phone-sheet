import { isChatShown, showChat } from "./chat.js";

/**
 * Rolls go to chat, which is hidden behind its tab on a phone. Pop up the player's own results
 * above the bottom bar so they don't have to open chat to read a total.
 */

const MAX_TOASTS = 3;
const LIFETIME_MS = 5000;

/** Attack results wait longer, since they ask whether the attack hit. */
const ATTACK_LIFETIME_MS = 20000;

/** How long to wait for Dice So Nice to finish before showing the result anyway. */
const DICE_TIMEOUT_MS = 6000;

let container = null;

export function initRollToasts() {
  Hooks.on("createChatMessage", message => {
    if ( !message.isAuthor || !message.isRoll || !message.isContentVisible ) return;
    afterDice(message).then(() => {
      if ( !isChatShown() ) showToast(message);
    });
  });
}

/** Don't spoil the 3D dice: wait for their animation when Dice So Nice is showing them. */
function afterDice(message) {
  if ( !game.dice3d ) return Promise.resolve();
  return new Promise(resolve => {
    const id = Hooks.on("diceSoNiceRollComplete", messageId => {
      if ( messageId !== message.id ) return;
      Hooks.off("diceSoNiceRollComplete", id);
      resolve();
    });
    setTimeout(() => {
      Hooks.off("diceSoNiceRollComplete", id);
      resolve();
    }, DICE_TIMEOUT_MS);
  });
}

function showToast(message) {
  container ??= Object.assign(document.createElement("ol"), { id: "phone-sheet-toasts" });
  if ( !container.isConnected ) document.body.append(container);

  const { rolls } = message;
  // Damage parts add up to one number; anything else (several attacks, say) lists each total.
  const { DamageRoll } = CONFIG.Dice;
  const isDamage = !!DamageRoll && rolls.every(r => r instanceof DamageRoll);
  const total = isDamage ? rolls.reduce((n, r) => n + r.total, 0) : rolls.map(r => r.total).join(" / ");
  const critical = rolls.some(r => r.isCritical);
  const fumble = !critical && rolls.some(r => r.isFumble);

  const toast = document.createElement("li");
  toast.className = "phone-sheet-toast";
  if ( critical ) toast.classList.add("critical");
  if ( fumble ) toast.classList.add("fumble");
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = rollLabel(message);
  const value = document.createElement("strong");
  value.textContent = total;
  const range = isDamage ? damageRange(rolls) : null;
  if ( range && (range.min !== range.max) ) {
    if ( total === range.min ) value.classList.add("min");
    else if ( total === range.max ) value.classList.add("max");
  }
  toast.append(label, value);
  toast.addEventListener("click", () => {
    dismiss(toast);
    showChat();
  });

  const activity = damageFor(message);
  if ( activity ) toast.append(hitButtons(toast, message, activity, critical));

  container.prepend(toast);
  while ( container.children.length > MAX_TOASTS ) container.lastElementChild.remove();
  setTimeout(() => dismiss(toast), activity ? ATTACK_LIFETIME_MS : LIFETIME_MS);
}

/**
 * The lowest and highest totals these damage rolls could have produced, crit dice included.
 * Skipped for exploding dice, which have no maximum.
 */
function damageRange(rolls) {
  if ( rolls.some(r => r.dice.some(d => d.modifiers.some(m => /^x/i.test(m)))) ) return null;
  try {
    let min = 0;
    let max = 0;
    for ( const roll of rolls ) {
      min += roll.clone().evaluateSync({ minimize: true, strict: false }).total;
      max += roll.clone().evaluateSync({ maximize: true, strict: false }).total;
    }
    return { min, max };
  } catch {
    return null;
  }
}

/** The activity to roll damage with, if this is an attack roll whose activity deals damage. */
function damageFor(message) {
  if ( message.getFlag("dnd5e", "roll.type") !== "attack" ) return null;
  const activity = message.getAssociatedActivity?.();
  return activity?.damage?.parts?.length && activity.rollDamage ? activity : null;
}

/** Ask whether the attack landed; a hit rolls damage, whose total then pops up as its own toast. */
function hitButtons(toast, message, activity, critical) {
  const buttons = document.createElement("div");
  buttons.className = "hit-buttons";
  const miss = document.createElement("button");
  miss.type = "button";
  miss.textContent = game.i18n.localize("PHONESHEET.Miss");
  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "hit";
  hit.textContent = game.i18n.localize(critical ? "PHONESHEET.CriticalHit" : "PHONESHEET.Hit");
  buttons.append(miss, hit);

  miss.addEventListener("click", event => {
    event.stopPropagation();
    dismiss(toast);
  });
  hit.addEventListener("click", event => {
    event.stopPropagation();
    dismiss(toast);
    rollDamage(message, activity, critical);
  });
  return buttons;
}

/** Roll damage the way the Damage button on the attack's chat card does, without the extra dialog. */
function rollDamage(message, activity, isCritical) {
  const attackMode = message.getFlag("dnd5e", "roll.attackMode");
  const storedAmmo = message.getFlag("dnd5e", "roll.ammunitionData");
  const actor = activity.actor;
  const ammunition = storedAmmo
    ? new Item.implementation(storedAmmo, { parent: actor })
    : actor?.items.get(message.getFlag("dnd5e", "roll.ammunition"));
  const originatingMessage = message.getFlag("dnd5e", "originatingMessage");
  const messageConfig = originatingMessage ? { data: { "flags.dnd5e.originatingMessage": originatingMessage } } : {};
  activity.rollDamage({ ammunition, attackMode, isCritical }, { configure: false }, messageConfig);
}

function dismiss(toast) {
  toast.classList.add("leaving");
  setTimeout(() => toast.remove(), 250);
}

/** The flavor text, without its HTML, or the formula when there isn't any. */
function rollLabel(message) {
  const div = document.createElement("div");
  div.innerHTML = message.flavor ?? "";
  return div.textContent.trim() || message.rolls[0]?.formula || game.i18n.localize("PHONESHEET.Roll");
}
