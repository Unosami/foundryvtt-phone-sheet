import { hideChat, toggleChat } from "./chat.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

const MODULE_ID = "phone-sheet";
const TEMPLATES = `modules/${MODULE_ID}/templates/dnd5e`;

/** Action groups in display order. dnd5e has no "free" activation type, see #actionGroup. */
const ACTION_GROUPS = {
  action: "PHONESHEET.Group.Action",
  bonus: "PHONESHEET.Group.Bonus",
  reaction: "PHONESHEET.Group.Reaction",
  free: "PHONESHEET.Group.Free",
  special: "PHONESHEET.Group.Special"
};

/** Subsections inside an action group, by where the action comes from, in display order. */
const ACTION_SOURCES = {
  weapon: { label: "PHONESHEET.Source.Weapons", icon: "fa-solid fa-sword" },
  spell: { label: "PHONESHEET.Source.Spells", icon: "fa-solid fa-wand-sparkles" },
  item: { label: "PHONESHEET.Source.Items", icon: "fa-solid fa-flask" },
  class: { label: "PHONESHEET.Source.Class", icon: "fa-solid fa-star" },
  race: { label: "PHONESHEET.Source.Species", icon: "fa-solid fa-dna" },
  feat: { label: "PHONESHEET.Source.Feats", icon: "fa-solid fa-medal" },
  feature: { label: "PHONESHEET.Source.Other", icon: "fa-solid fa-circle-dot" }
};

/** Sort order of item types inside the Items subsection. */
const TYPE_ORDER = ["consumable", "equipment", "tool", "loot"];

/** Inventory sections in display order. Containers get a section each, after these. */
const INVENTORY_SECTIONS = {
  weapon: "PHONESHEET.Inventory.Weapons",
  equipment: "PHONESHEET.Inventory.Equipment",
  consumable: "PHONESHEET.Inventory.Consumables",
  tool: "PHONESHEET.Inventory.Tools",
  loot: "PHONESHEET.Inventory.Loot"
};

/**
 * Search, filter chips and sort orders for the list tabs. Rows match a chip by its tag; chips in the same
 * group widen the filter (Weapons or Spells), chips in different groups narrow it (Spells that are Attacks).
 */
const LIST_FILTERS = {
  actions: {
    placeholder: "PHONESHEET.Search.Actions",
    chips: [
      { tag: "weapon", group: "source", label: "PHONESHEET.Source.Weapons", icon: "fa-solid fa-sword" },
      { tag: "spell", group: "source", label: "PHONESHEET.Source.Spells", icon: "fa-solid fa-wand-sparkles" },
      { tag: "item", group: "source", label: "PHONESHEET.Source.Items", icon: "fa-solid fa-flask" },
      { tag: "feature", group: "source", label: "PHONESHEET.Filter.Features", icon: "fa-solid fa-star" },
      { tag: "attack", group: "attack", label: "PHONESHEET.Filter.Attacks", icon: "fa-solid fa-crosshairs" },
      { tag: "limited", group: "limited", label: "PHONESHEET.Filter.Limited", icon: "fa-solid fa-battery-half" }
    ],
    sorts: [
      { id: "default", label: "PHONESHEET.Sort.Default" },
      { id: "name", label: "PHONESHEET.Sort.Name" },
      // Flat sorts drop the source subsections and rank everything in an action group as one list.
      { id: "damage", label: "PHONESHEET.Sort.Damage", flat: true },
      { id: "range", label: "PHONESHEET.Sort.Range", flat: true }
    ]
  },
  inventory: {
    placeholder: "PHONESHEET.Search.Items",
    chips: [
      { tag: "equipped", group: "equipped", label: "PHONESHEET.Equipped", icon: "fa-solid fa-shield-halved" },
      { tag: "attuned", group: "attuned", label: "PHONESHEET.Attuned", icon: "fa-solid fa-sun" },
      { tag: "magical", group: "magical", label: "PHONESHEET.Filter.Magical", icon: "fa-solid fa-sparkles" },
      { tag: "usable", group: "usable", label: "PHONESHEET.Filter.Usable", icon: "fa-solid fa-hand-sparkles" }
    ],
    sorts: [
      { id: "default", label: "PHONESHEET.Sort.Name" },
      { id: "weight", label: "PHONESHEET.Sort.Weight" },
      { id: "combat", label: "PHONESHEET.Sort.Combat" }
    ]
  },
  // Spells stay grouped by level; sorting reorders the spells inside each level.
  spellbook: {
    placeholder: "PHONESHEET.Search.Spells",
    chips: [
      { tag: "action", group: "time", label: "PHONESHEET.Filter.Action" },
      { tag: "bonus", group: "time", label: "PHONESHEET.Filter.Bonus" },
      { tag: "reaction", group: "time", label: "PHONESHEET.Filter.Reaction" },
      { tag: "concentration", group: "concentration", label: "PHONESHEET.Concentration", icon: "fa-solid fa-brain" },
      { tag: "ritual", group: "ritual", label: "PHONESHEET.Ritual", icon: "fa-solid fa-book-sparkles" },
      { tag: "prepared", group: "prepared", label: "PHONESHEET.Prepared", icon: "fa-solid fa-book-open" }
    ],
    sorts: [
      { id: "default", label: "PHONESHEET.Sort.Name" },
      { id: "damage", label: "PHONESHEET.Sort.Damage" },
      { id: "range", label: "PHONESHEET.Sort.Range" }
    ]
  }
};

const byName = (a, b) => a.dataset.name.localeCompare(b.dataset.name, game.i18n.lang);

/** Row orders, comparing list elements. The default is the order the rows were rendered in. */
const SORTS = {
  default: (a, b) => a.dataset.order - b.dataset.order,
  name: byName,
  weight: (a, b) => (b.dataset.weight - a.dataset.weight) || byName(a, b),
  damage: (a, b) => (b.dataset.damage - a.dataset.damage) || byName(a, b),
  combat: (a, b) => (b.dataset.combat - a.dataset.combat) || byName(a, b),
  // Two unlimited ranges subtract to NaN, which falls through to the name like a tie.
  range: (a, b) => (b.dataset.range - a.dataset.range) || byName(a, b)
};

/** Average result of a roll formula, or 0 if it can't be worked out without rolling. */
const averageRoll = formula => {
  if ( !formula ) return 0;
  try {
    const low = new Roll(formula).evaluateSync({ minimize: true }).total;
    const high = new Roll(formula).evaluateSync({ maximize: true }).total;
    return Number.isFinite(low + high) ? (low + high) / 2 : 0;
  } catch(err) {
    return 0;
  }
};

/**
 * Rates for the inventory's combat value sort, in damage per round. The target is a typical foe:
 * AC 15 and a +3 saving throw.
 */
const COMBAT_WEIGHTS = {
  targetAC: 15,
  targetSave: 3,
  healing: 0.5,
  ac: 1.5,
  unproficientArmor: 4,
  attack: 0.5,
  save: 1,
  spellDC: 1,
  resistance: 2,
  immunity: 3
};

/** Chance to hit the typical foe with an attack bonus, with natural 1s missing and 20s hitting. */
const hitChance = bonus => Math.clamp((21 + bonus - COMBAT_WEIGHTS.targetAC) / 20, 0.05, 0.95);

/** Lowercased text a row is searched by. */
const searchText = (...parts) => parts.filter(_ => _).join(" ").toLocaleLowerCase(game.i18n.lang);

const PROF_ICONS = {
  0: "fa-regular fa-circle",
  0.5: "fa-solid fa-circle-half-stroke",
  1: "fa-solid fa-circle",
  2: "fa-solid fa-circle-check"
};

const signed = n => (n >= 0 ? `+${n}` : `${n}`);

/** How far a swipe has to travel, in pixels, to change tabs. */
const SWIPE_DISTANCE = 70;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A single-column, phone-first sheet for dnd5e characters.
 * Rolls and item use go through the dnd5e system, so results behave exactly like the normal sheet.
 */
export default class PhoneSheet5e extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["phone-sheet-app"],
    window: { frame: false, positioned: false },
    form: { submitOnChange: true },
    actions: {
      rollSkill: PhoneSheet5e.#onRollSkill,
      rollTool: PhoneSheet5e.#onRollTool,
      rollCheck: PhoneSheet5e.#onRollCheck,
      rollSave: PhoneSheet5e.#onRollSave,
      rollInitiative: PhoneSheet5e.#onRollInitiative,
      rollDeathSave: PhoneSheet5e.#onRollDeathSave,
      useActivity: PhoneSheet5e.#onUseActivity,
      castSpell: PhoneSheet5e.#onCastSpell,
      togglePrepared: PhoneSheet5e.#onTogglePrepared,
      setSlot: PhoneSheet5e.#onSetSlot,
      endConcentration: PhoneSheet5e.#onEndConcentration,
      openMember: PhoneSheet5e.#onOpenMember,
      adjustExhaustion: PhoneSheet5e.#onAdjustExhaustion,
      setExhaustion: PhoneSheet5e.#onSetExhaustion,
      rollHitDie: PhoneSheet5e.#onRollHitDie,
      endEffect: PhoneSheet5e.#onEndEffect,
      toggleInfo: PhoneSheet5e.#onToggleInfo,
      toggleGroup: PhoneSheet5e.#onToggleGroup,
      toggleFilters: PhoneSheet5e.#onToggleFilters,
      toggleFilter: PhoneSheet5e.#onToggleFilter,
      setSort: PhoneSheet5e.#onSetSort,
      clearSearch: PhoneSheet5e.#onClearSearch,
      resetFilters: PhoneSheet5e.#onResetFilters,
      adjustQuantity: PhoneSheet5e.#onAdjustQuantity,
      toggleEquipped: PhoneSheet5e.#onToggleEquipped,
      toggleAttuned: PhoneSheet5e.#onToggleAttuned,
      damage: PhoneSheet5e.#onDamage,
      heal: PhoneSheet5e.#onHeal,
      toggleCondition: PhoneSheet5e.#onToggleCondition,
      toggleInspiration: PhoneSheet5e.#onToggleInspiration,
      shortRest: PhoneSheet5e.#onShortRest,
      longRest: PhoneSheet5e.#onLongRest,
      openChat: PhoneSheet5e.#onOpenChat,
      openMenu: PhoneSheet5e.#onOpenMenu
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    character: { template: `${TEMPLATES}/character.hbs`, templates: [`${TEMPLATES}/encumbrance.hbs`], scrollable: [""] },
    party: { template: `${TEMPLATES}/party.hbs`, scrollable: [""] },
    skills: { template: `${TEMPLATES}/skills.hbs`, scrollable: [""] },
    actions: { template: `${TEMPLATES}/actions.hbs`, templates: [`${TEMPLATES}/filterbar.hbs`], scrollable: [""] },
    inventory: {
      template: `${TEMPLATES}/inventory.hbs`,
      templates: [`${TEMPLATES}/encumbrance.hbs`, `${TEMPLATES}/filterbar.hbs`],
      scrollable: [""]
    },
    spellbook: { template: `${TEMPLATES}/spellbook.hbs`, templates: [`${TEMPLATES}/filterbar.hbs`], scrollable: [""] },
    description: { template: `${TEMPLATES}/description.hbs`, scrollable: [""] },
    nav: { template: `${TEMPLATES}/nav.hbs` }
  };

  static TABS = {
    primary: {
      // Same order as the desktop sheet, with the character overview first.
      tabs: [
        { id: "character", icon: "fa-solid fa-heart", label: "PHONESHEET.Tab.Character" },
        { id: "party", icon: "fa-solid fa-users", label: "PHONESHEET.Tab.Party" },
        { id: "skills", icon: "fa-solid fa-dice-d20", label: "PHONESHEET.Tab.Skills" },
        { id: "actions", icon: "fa-solid fa-hand-fist", label: "PHONESHEET.Tab.Actions" },
        { id: "inventory", icon: "fa-solid fa-sack", label: "PHONESHEET.Tab.Inventory" },
        { id: "spellbook", icon: "fa-solid fa-wand-sparkles", label: "PHONESHEET.Tab.Spellbook" },
        { id: "description", icon: "fa-solid fa-scroll", label: "PHONESHEET.Tab.Description" }
      ],
      initial: "character"
    }
  };

  /** Actor types this sheet can show. Groups and encounters get a Party tab instead of the character tabs. */
  static TYPES = new Set(["character", "npc", "vehicle", "group", "encounter"]);

  /**
   * Callbacks for the menu, supplied by the main script so this file doesn't depend on it.
   * @type {{switchCharacter: Function, fullSheet: Function, exit: Function, openActor: Function}}
   */
  static menu;

  /** Item descriptions and party members the player has expanded. */
  #expanded = new Set();

  /** Action groups, action sources and spellbook sections the player has collapsed. */
  #collapsed = new Set();

  /** Search text, filter chips and sort order of each list tab. Kept across renders. */
  #filters = Object.fromEntries(Object.keys(LIST_FILTERS).map(tab => [tab, {
    query: "", tags: new Set(), sort: "default", open: false
  }]));

  /** Parts rendered for this actor, so parts for tabs that went away can be removed. */
  #partIds = new Set();

  /** Re-renders the party tab when a member changes. */
  #memberHook = null;

  get title() {
    return this.document.name;
  }

  /** Tabs this actor has. The spellbook only shows up for actors that have spells. */
  #availableTabs() {
    const actor = this.document;
    if ( actor.system.isGroup ) return new Set(["party", "inventory", "description"]);
    const tabs = new Set(["actions", "inventory", "character"]);
    if ( actor.system.abilities ) tabs.add("skills");
    if ( actor.itemTypes.spell?.length ) tabs.add("spellbook");
    return tabs;
  }

  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if ( !config ) return config;
    const available = this.#availableTabs();
    const tabs = config.tabs.filter(t => available.has(t.id));
    return { ...config, tabs, initial: tabs[0]?.id ?? null };
  }

  _prepareTabs(group) {
    // The remembered tab may not exist for this actor, such as the spellbook for a fighter.
    const { tabs } = this._getTabsConfig(group);
    if ( !tabs.some(t => t.id === this.tabGroups[group]) ) this.tabGroups[group] = tabs[0]?.id ?? null;
    return super._prepareTabs(group);
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const available = this.#availableTabs();
    for ( const { id } of this.constructor.TABS.primary.tabs ) {
      if ( !available.has(id) ) delete parts[id];
    }
    this.#partIds = new Set(Object.keys(parts));
    return parts;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const { attributes } = actor.system;
    const hp = attributes?.hp;
    Object.assign(context, {
      actor,
      img: actor.img,
      hp: hp ? {
        value: hp.value ?? 0,
        max: hp.max ?? 0,
        temp: hp.temp || 0,
        pct: hp.max ? Math.clamp(Math.round((hp.value / hp.max) * 100), 0, 100) : 0
      } : null,
      ac: attributes?.ac?.value ?? null,
      init: signed(attributes?.init?.total ?? attributes?.init?.mod ?? 0),
      memberCount: actor.system.isGroup ? actor.system.members.length : null,
      stats: actor.system.isGroup ? [] : this.#prepareHeaderStats()
    });
    return context;
  }

  /**
   * Spell attack and save DC, and the save DCs of class features such as Battle Master maneuvers,
   * shown under the name so they're always in view.
   */
  #prepareHeaderStats() {
    const actor = this.document;
    const stats = [];
    if ( actor.itemTypes.spell?.length ) {
      const seen = new Set();
      for ( const { attack, dc } of this.#prepareCasting() ) {
        if ( seen.has(`${attack}|${dc}`) ) continue;
        seen.add(`${attack}|${dc}`);
        stats.push({ icon: "fa-solid fa-wand-sparkles", label: game.i18n.localize("PHONESHEET.Spell"), attack, dc,
          tab: "spellbook" });
      }
    }

    // Class features whose saves use their own DC rather than the spell DC, merged by DC.
    const features = new Map();
    const subtypes = CONFIG.DND5E.featureTypes.class?.subtypes ?? {};
    for ( const item of actor.itemTypes.feat ?? [] ) {
      if ( item.system.type?.value !== "class" ) continue;
      for ( const activity of item.system.activities ?? [] ) {
        const dc = activity.save?.dc;
        if ( !dc?.value || (dc.calculation === "spellcasting") ) continue;
        const subtype = subtypes[item.system.type.subtype];
        const label = subtype ? game.i18n.localize(subtype.label ?? subtype) : item.name;
        if ( !features.has(dc.value) ) features.set(dc.value, new Set());
        features.get(dc.value).add(label);
      }
    }
    for ( const [dc, labels] of features ) {
      stats.push({
        icon: "fa-solid fa-bullseye",
        label: labels.size === 1 ? labels.first() : game.i18n.localize("PHONESHEET.FeatureDC"),
        dc,
        tab: "actions"
      });
    }
    return stats;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs[partId];
    if ( partId in LIST_FILTERS ) context.filter = {
      ...LIST_FILTERS[partId],
      tab: partId,
      inputId: `${this.id}-search-${partId}`
    };
    switch ( partId ) {
      case "party": Object.assign(context, await this.#prepareParty()); break;
      case "description": Object.assign(context, await this.#prepareDescription()); break;
      case "skills": Object.assign(context, this.#prepareSkills()); break;
      case "actions": Object.assign(context, await this.#prepareActions()); break;
      case "spellbook": Object.assign(context, await this.#prepareSpellbook()); break;
      case "inventory": Object.assign(context, await this.#prepareInventory()); break;
      case "character": Object.assign(context, this.#prepareCharacter(), await this.#prepareEffects()); break;
    }
    return context;
  }

  #prepareSkills() {
    const { abilities = {}, skills = {}, tools } = this.document.system;
    const abilityAbbr = id => CONFIG.DND5E.abilities[id]?.abbreviation ?? id;

    const abilityRows = Object.entries(abilities).map(([id, abl]) => ({
      id,
      abbr: abilityAbbr(id).toUpperCase(),
      value: abl.value,
      check: signed(abl.mod + (abl.checkBonus ?? 0) + (abl.checkProf?.flat ?? 0)),
      save: signed(abl.save?.value ?? abl.mod),
      saveProficient: abl.saveProf?.multiplier > 0
    }));

    const skillRows = Object.entries(skills).map(([id, skill]) => ({
      id,
      label: CONFIG.DND5E.skills[id]?.label ?? id,
      ability: abilityAbbr(skill.ability),
      total: signed(skill.total),
      passive: skill.passive,
      proficient: skill.value > 0,
      icon: PROF_ICONS[skill.value] ?? PROF_ICONS[0]
    })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

    const { keyLabel } = dnd5e.documents.Trait;
    const toolRows = Object.entries(tools ?? {}).map(([id, tool]) => ({
      id,
      label: keyLabel(id, { trait: "tool" }) ?? id,
      ability: abilityAbbr(tool.ability),
      total: signed(tool.total ?? 0),
      icon: PROF_ICONS[tool.value] ?? PROF_ICONS[0]
    })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

    return { abilityRows, skillRows, toolRows };
  }

  async #prepareActions() {
    const groups = Object.fromEntries(Object.entries(ACTION_GROUPS).map(([id, label]) => [id, {
      id, label, count: 0, sources: {}, collapsed: this.#collapsed.has(id)
    }]));

    // Separate copies of the same item (two daggers, three healing potions) share one row.
    const merged = new Map();
    for ( const item of this.document.items ) {
      if ( !this.#isAvailable(item) ) continue;
      const activities = item.system.activities?.filter(a => a.canUse) ?? [];
      for ( const activity of activities ) {
        const groupId = this.#actionGroup(item, activity);
        const key = [groupId, item.type, item.name, activity.name, item.system.level ?? 0].join("|");
        if ( !merged.has(key) ) merged.set(key, { groupId, multiple: activities.length > 1, copies: [] });
        merged.get(key).copies.push({ item, activity });
      }
    }

    for ( const { groupId, multiple, copies } of merged.values() ) {
      // Use a copy that can still be used, so tapping the row doesn't pick an empty one.
      const { item, activity } = copies.find(c => !this.#isDepleted(c.item, c.activity)) ?? copies[0];
      const row = await this.#prepareActionRow(item, activity, multiple, groupId);
      if ( item.system.quantity !== undefined ) {
        const quantity = copies.reduce((n, c) => n + (c.item.system.quantity ?? 1), 0);
        if ( quantity > 1 ) row.quantity = quantity;
      }
      const group = groups[groupId];
      const sourceId = this.#actionSource(item);
      const id = `${groupId}.${sourceId}`;
      group.sources[sourceId] ??= { id, ...ACTION_SOURCES[sourceId], rows: [], collapsed: this.#collapsed.has(id) };
      group.sources[sourceId].rows.push(row);
      group.count++;
    }

    const typeRank = t => { const i = TYPE_ORDER.indexOf(t); return i === -1 ? TYPE_ORDER.length : i; };
    for ( const group of Object.values(groups) ) {
      group.sources = Object.keys(ACTION_SOURCES).map(id => group.sources[id]).filter(_ => _);
      for ( const source of group.sources ) {
        source.rows.sort((a, b) => (typeRank(a.type) - typeRank(b.type)) || (a.level - b.level)
          || a.name.localeCompare(b.name, game.i18n.lang));
      }
    }

    return {
      groups: Object.values(groups).filter(g => g.count),
      slots: this.#prepareSlots()
    };
  }

  /** Which subsection of an action group an item belongs in. Features are split by feature type. */
  #actionSource(item) {
    if ( ["weapon", "spell"].includes(item.type) ) return item.type;
    if ( item.type !== "feat" ) return "item";
    const type = item.system.type?.value;
    return ["class", "race", "feat"].includes(type) ? type : "feature";
  }

  /** Skip things the character can't use right now: unprepared spells and unequipped gear. */
  #isAvailable(item) {
    const sys = item.system;
    if ( item.type === "spell" ) {
      return (sys.level === 0) || !sys.canPrepare || (sys.prepared > 0);
    }
    if ( ["weapon", "equipment"].includes(item.type) ) return sys.equipped !== false;
    return true;
  }

  #usesOf(item, activity) {
    return activity.uses?.max ? activity.uses : item.system.uses;
  }

  /** Average damage of the hardest-hitting activity, for sorting. Healing doesn't count, unless it's asked for. */
  #averageDamage(activities, { healing=false }={}) {
    let best = 0;
    for ( const activity of activities ) {
      const parts = (activity.labels?.damage ?? [])
        .filter(d => d.formula && ((d.damageType in CONFIG.DND5E.healingTypes) === healing));
      best = Math.max(best, parts.reduce((total, d) => total + averageRoll(d.formula), 0));
    }
    return best;
  }

  /**
   * How much an item helps in a fight, for sorting the inventory. Everything is scored in damage per round:
   * the expected damage of its best attack or effect, healing at half value, and its armor and magic bonuses
   * converted at the rates in COMBAT_WEIGHTS. Also returns the facts behind the score, for the item's row.
   * @returns {{score: number, details: string[]}}
   */
  #combatValue(item) {
    const sys = item.system;
    const actor = this.document;
    let offense = 0;
    let healing = 0;
    let best = null;
    let bestHeal = null;
    for ( const activity of sys.activities ?? [] ) {
      const heal = this.#averageDamage([activity], { healing: true });
      if ( heal > healing ) [healing, bestHeal] = [heal, activity];
      const damage = this.#averageDamage([activity]);
      if ( !damage ) continue;
      let chance = 1;
      if ( activity.type === "attack" ) chance = hitChance(parseInt(activity.labels?.toHit) || 0);
      else if ( (activity.type === "save") && activity.save?.dc?.value ) {
        const fail = Math.clamp((activity.save.dc.value - 1 - COMBAT_WEIGHTS.targetSave) / 20, 0.05, 0.95);
        const onSave = { half: 0.5, full: 1 }[activity.damage?.onSave] ?? 0;
        chance = fail + ((1 - fail) * onSave);
      }
      if ( damage * chance > offense ) [offense, best] = [damage * chance, activity];
    }
    let score = offense + (healing * COMBAT_WEIGHTS.healing);

    // The best attack or healing, shown the way the Actions tab shows it.
    const details = [];
    const shown = best ?? bestHeal;
    if ( shown ) {
      const labels = shown.labels ?? {};
      if ( labels.toHit ) details.push(game.i18n.format("PHONESHEET.ToHit", { bonus: labels.toHit }));
      if ( labels.save ) details.push(labels.save);
      const damage = labels.damage?.map(d => d.label).filter(_ => _).join(", ");
      if ( damage ) details.push(damage);
      if ( labels.range ) details.push(labels.range);
    }

    // Armor and shields, by the AC this character would get from them.
    const armorType = sys.type?.value;
    if ( (item.type === "equipment") && (armorType in CONFIG.DND5E.armorTypes) && sys.armor?.value ) {
      let ac = sys.armor.value;
      if ( ["light", "medium"].includes(armorType) ) {
        ac += Math.min(sys.armor.dex ?? Infinity, actor.system.abilities?.dex?.mod ?? 0);
      }
      // Wearing armor without proficiency means disadvantage on attacks and no spellcasting.
      if ( sys.proficiencyMultiplier === 0 ) ac -= COMBAT_WEIGHTS.unproficientArmor;
      // Too heavy to wear without slowing down.
      if ( sys.strength && ((actor.system.abilities?.str?.value ?? 0) < sys.strength) ) ac -= 1;
      score += ac * COMBAT_WEIGHTS.ac;
      // Shields add to AC, armor sets it; show the AC as this character would have it, before penalties.
      details.push(armorType === "shield"
        ? game.i18n.format("PHONESHEET.Combat.ACBonus", { bonus: signed(sys.armor.value) })
        : game.i18n.format("PHONESHEET.Combat.AC", {
          ac: sys.armor.value + (["light", "medium"].includes(armorType)
            ? Math.min(sys.armor.dex ?? Infinity, actor.system.abilities?.dex?.mod ?? 0) : 0)
        }));
    }

    // Bonuses the item grants through its effects, like a Ring of Protection. They need attunement first.
    if ( (sys.attunement === "required") && !sys.attuned ) return { score, details };
    const shownBonus = (key, value) => {
      const number = Number(value);
      details.push(game.i18n.format(key, { bonus: Number.isFinite(number) ? signed(number) : value }));
    };
    const damageType = value => game.i18n.localize(CONFIG.DND5E.damageTypes[value]?.label ?? value);
    for ( const effect of item.effects ?? [] ) {
      if ( !effect.transfer || effect.disabled ) continue;
      for ( const { key, value } of effect.system?.changes ?? effect.changes ?? [] ) {
        const number = Number(value);
        const bonus = Number.isFinite(number) ? number : averageRoll(String(value ?? ""));
        if ( /\.attributes\.ac\.bonus$/.test(key) ) {
          score += bonus * COMBAT_WEIGHTS.ac;
          shownBonus("PHONESHEET.Combat.ACBonus", value);
        }
        else if ( /\.bonuses\.abilities\.save$/.test(key) ) {
          score += bonus * COMBAT_WEIGHTS.save;
          shownBonus("PHONESHEET.Combat.Saves", value);
        }
        else if ( /\.bonuses\.[mr][ws]ak\.attack$/.test(key) ) {
          score += bonus * COMBAT_WEIGHTS.attack;
          shownBonus("PHONESHEET.Combat.Attacks", value);
        }
        else if ( /\.bonuses\.[mr][ws]ak\.damage$/.test(key) ) {
          score += bonus;
          shownBonus("PHONESHEET.Combat.Damage", value);
        }
        else if ( /\.bonuses\.spell\.dc$/.test(key) ) {
          score += bonus * COMBAT_WEIGHTS.spellDC;
          shownBonus("PHONESHEET.Combat.SpellDC", value);
        }
        else if ( /\.traits\.dr\.value$/.test(key) ) {
          score += COMBAT_WEIGHTS.resistance;
          details.push(game.i18n.format("PHONESHEET.Combat.Resist", { type: damageType(value) }));
        }
        else if ( /\.traits\.di\.value$/.test(key) ) {
          score += COMBAT_WEIGHTS.immunity;
          details.push(game.i18n.format("PHONESHEET.Combat.Immune", { type: damageType(value) }));
        }
      }
    }
    // One ring adding to both melee and ranged attacks shows up once.
    return { score, details: [...new Set(details)] };
  }

  /**
   * Range in feet, for sorting. Melee weapons use their reach and touch counts as 5 feet. Self and
   * special ranges count as 0, unlimited ranges as the longest.
   */
  #rangeFeet(item, activity) {
    const range = (activity?.range?.override || (item.type !== "weapon")) && activity?.range?.units
      ? activity.range : item.system.range;
    const units = range?.units;
    if ( units in CONFIG.DND5E.movementUnits ) {
      return dnd5e.utils.convertLength(range.value || range.reach || 0, units, "ft", { strict: false });
    }
    if ( units === "touch" ) return 5;
    if ( units === "any" ) return Infinity;
    return 0;
  }

  #isDepleted(item, activity) {
    const uses = this.#usesOf(item, activity);
    return (uses?.max && (uses.value <= 0)) || (item.system.quantity === 0);
  }

  /**
   * Map a dnd5e activation type to one of our groups. dnd5e has no free action type, so a
   * "special" activation whose condition text says "free" counts as one.
   * Some imported activities override the item's activation with a blank one; those use the item's.
   */
  #actionGroup(item, activity) {
    const { condition } = activity.activation ?? {};
    const type = activity.activation?.type || item.system.activation?.type;
    if ( ["action", "bonus", "reaction"].includes(type) ) return type;
    if ( (type === "special") && /\bfree\b|no action/i.test(condition ?? "") ) return "free";
    return "special";
  }

  async #prepareActionRow(item, activity, multiple, groupId) {
    const sys = item.system;
    const labels = activity.labels ?? {};
    const details = [];
    if ( groupId === "special" ) {
      const { type, value } = activity.activation?.type ? activity.activation : (sys.activation ?? {});
      const typeLabel = CONFIG.DND5E.activityActivationTypes[type]?.label;
      if ( typeLabel ) details.push(value > 1 ? `${value} ${typeLabel}` : typeLabel);
    }
    if ( item.type === "spell" ) details.push(item.labels?.level);
    if ( labels.toHit ) details.push(game.i18n.format("PHONESHEET.ToHit", { bonus: labels.toHit }));
    if ( labels.save ) details.push(labels.save);
    const damage = labels.damage?.map(d => d.label).filter(_ => _).join(", ");
    if ( damage ) details.push(damage);
    if ( labels.range && (item.type !== "feat") ) details.push(labels.range);

    const uses = this.#usesOf(item, activity);
    const key = `${item.id}.${activity.id}`;
    const expanded = this.#expanded.has(key);
    const source = this.#actionSource(item);
    const tags = [["weapon", "spell", "item"].includes(source) ? source : "feature"];
    if ( labels.toHit || labels.save || damage ) tags.push("attack");
    if ( uses?.max ) tags.push("limited");
    const activityName = multiple ? activity.name : null;
    const detailText = details.filter(_ => _).join(" · ");
    return {
      key,
      itemId: item.id,
      activityId: activity.id,
      type: item.type,
      level: sys.level ?? 0,
      img: activity.img ?? item.img,
      name: item.name,
      activityName,
      search: searchText(item.name, activityName, detailText),
      tags: tags.join(" "),
      sortDamage: this.#averageDamage([activity]),
      sortRange: this.#rangeFeet(item, activity),
      details: detailText,
      uses: uses?.max ? `${uses.value ?? 0}/${uses.max}` : null,
      expanded,
      description: expanded ? await this.#enrich(item) : null
    };
  }

  async #enrich(item) {
    return foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description?.value ?? "", {
      rollData: item.getRollData(),
      relativeTo: item,
      secrets: item.isOwner
    });
  }

  async #prepareInventory() {
    const actor = this.document;
    const { currency = {}, attributes = {} } = actor.system;

    const collapsed = id => this.#collapsed.has(`inventory.${id}`);
    const sections = new Map(Object.entries(INVENTORY_SECTIONS).map(([id, label]) => [id, {
      id, label, rows: [], collapsed: collapsed(id)
    }]));
    const containers = new Map();
    const physical = actor.items
      .filter(i => i.system.quantity !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

    for ( const item of physical.filter(i => i.type === "container") ) {
      const capacity = await item.system.computeCapacity?.();
      containers.set(item.id, {
        id: item.id,
        label: item.name,
        img: item.img,
        capacity: Number.isFinite(capacity?.max)
          ? `${capacity.value}/${capacity.max} ${game.i18n.localize(capacity.units ?? "")}`.trim() : null,
        rows: [],
        collapsed: collapsed(item.id)
      });
    }

    for ( const item of physical ) {
      if ( item.type === "container" ) continue;
      const section = containers.get(item.system.container) ?? sections.get(item.type) ?? sections.get("loot");
      section.rows.push(await this.#prepareInventoryRow(item));
    }

    return {
      ...this.#prepareEncumbrance(),
      currency: Object.entries(CONFIG.DND5E.currencies).map(([key, c]) => ({
        key,
        name: `system.currency.${key}`,
        abbr: game.i18n.localize(c.abbreviation),
        icon: c.icon,
        value: currency[key] ?? 0
      })),
      sections: [...sections.values(), ...containers.values()].filter(s => s.rows.length || containers.has(s.id))
    };
  }

  /** Carried weight and attuned items, shown on both the Inventory and Character tabs. */
  #prepareEncumbrance() {
    const { encumbrance, attunement } = this.document.system.attributes ?? {};
    return {
      encumbrance: encumbrance?.max ? {
        value: encumbrance.value,
        max: encumbrance.max,
        pct: Math.round(encumbrance.pct ?? 0),
        encumbered: encumbrance.encumbered
      } : null,
      attunement: attunement?.max ? `${attunement.value}/${attunement.max}` : null
    };
  }

  /**
   * The attunement icon next to a magic item's name: attuned, waiting on attunement before it works,
   * or magical without needing it. Items that can be attuned but work without it count as not needing it.
   */
  #attunementFlag(item) {
    const sys = item.system;
    let state = null;
    if ( sys.attuned ) state = "attuned";
    else if ( sys.attunement === "required" ) state = "required";
    else if ( sys.properties?.has("mgc") ) state = "none";
    if ( !state ) return null;
    return {
      state,
      icon: { attuned: "fa-solid fa-sun", required: "fa-regular fa-sun", none: "fa-solid fa-sparkles" }[state],
      label: `PHONESHEET.Attunement.${state.capitalize()}`
    };
  }

  async #prepareInventoryRow(item) {
    const sys = item.system;
    const key = `inv.${item.id}`;
    const expanded = this.#expanded.has(key);
    const weight = sys.totalWeight;
    const units = CONFIG.DND5E.weightUnits[sys.weight?.units]?.abbreviation;
    const usable = !!sys.activities?.some(a => a.canUse);
    const tags = [];
    if ( sys.equipped ) tags.push("equipped");
    if ( sys.attuned ) tags.push("attuned");
    if ( sys.properties?.has("mgc") ) tags.push("magical");
    if ( usable ) tags.push("usable");
    const combat = this.#combatValue(item);
    const weightLabel = (typeof weight === "number") && (weight > 0)
      ? `${weight.toNearest(0.1)} ${units ? game.i18n.localize(units) : ""}`.trim() : null;
    const details = [...combat.details, weightLabel].filter(_ => _).join(" · ");
    return {
      key,
      itemId: item.id,
      img: item.img,
      name: item.name,
      search: searchText(item.name, details),
      tags: tags.join(" "),
      sortWeight: (typeof weight === "number") ? weight : 0,
      sortCombat: combat.score.toNearest(0.01),
      quantity: sys.quantity,
      details,
      canEquip: typeof sys.equipped === "boolean",
      equipped: sys.equipped,
      attunement: sys.attunement ? CONFIG.DND5E.attunementTypes[sys.attunement] : null,
      attuned: sys.attuned,
      attunementFlag: this.#attunementFlag(item),
      expanded,
      activities: expanded ? (sys.activities?.filter(a => a.canUse).map(a => ({ id: a.id, name: a.name })) ?? []) : [],
      description: expanded ? await this.#enrich(item) : null
    };
  }

  #prepareSlots() {
    const spells = this.document.system.spells ?? {};
    const slots = [];
    for ( let level = 1; level <= 9; level++ ) {
      const slot = spells[`spell${level}`];
      if ( slot?.max ) slots.push({ label: dnd5e.utils.formatNumber(level, { ordinal: true }), ...slot });
    }
    if ( spells.pact?.max ) {
      slots.push({ label: game.i18n.localize("PHONESHEET.Pact"), value: spells.pact.value, max: spells.pact.max });
    }
    return slots.map(s => ({ ...s, pips: Array.from({ length: s.max }, (_, i) => i < s.value) }));
  }

  async #prepareSpellbook() {
    const actor = this.document;
    const { spellcasting } = CONFIG.DND5E;
    const sections = new Map();

    // Mirrors the dnd5e sheet: one section per spell slot level, plus cantrips, pact magic and other methods.
    const register = (key, level, config) => {
      if ( sections.has(key) ) return;
      level = config?.slots ? level : 1;
      const usesSlots = !!config?.slots && (level !== 0);
      const slot = usesSlots ? actor.system.spells?.[key] : null;
      const max = slot ? (slot.override ?? slot.max ?? 0) : 0;
      const value = slot?.value ?? 0;
      const id = `spellbook.${key}`;
      const slotLevel = slot?.level ?? level ?? 0;
      sections.set(key, {
        id,
        key,
        label: config?.getLabel({ level }) ?? game.i18n.localize("PHONESHEET.ItemSpells"),
        rank: level === 0 ? 0 : usesSlots ? (slotLevel * 100) + config.order : 10000 + (config?.order ?? 1000),
        collapsed: this.#collapsed.has(id),
        pips: usesSlots ? Array.from({ length: Math.max(max, value) }, (_, i) => ({
          n: i + 1, filled: value > i, temp: i >= max
        })) : null,
        rows: []
      });
    };

    for ( const config of Object.values(spellcasting) ) {
      const levels = config.getAvailableLevels?.(actor) ?? [];
      if ( !levels.length ) continue;
      if ( config.cantrips ) register("spell0", 0, spellcasting.spell);
      levels.forEach(l => register(config.getSpellSlotKey(l), l, config));
    }

    for ( const spell of actor.itemTypes.spell ) {
      let method = spell.system.method;
      if ( !(method in spellcasting) ) method = "innate";
      const config = spellcasting[method];
      const level = config.isSingleLevel && (spell.system.level !== 0) ? null : (spell.system.level || 0);
      let key = config.getSpellSlotKey?.(level) ?? method;
      if ( spell.getFlag("dnd5e", "cachedFor") ) {
        if ( !spell.system.linkedActivity?.displayInSpellbook ) continue;
        key = "item";
        register(key);
      }
      else register(key, level, config);
      sections.get(key).rows.push(await this.#prepareSpellRow(spell));
    }

    for ( const section of sections.values() ) {
      section.rows.sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name, game.i18n.lang));
    }

    const concentration = actor.concentration ?? { effects: new Set() };
    return {
      casting: this.#prepareCasting(),
      concentration: [...concentration.effects].map(effect => {
        const data = effect.getFlag("dnd5e", "item");
        return { id: effect.id, name: actor.items.get(data?.id)?.name ?? data?.data?.name ?? effect.name };
      }),
      sections: [...sections.values()].sort((a, b) => a.rank - b.rank)
    };
  }

  /** Spell attack and save DC for each spellcasting class, or the actor's own for NPCs. */
  #prepareCasting() {
    const actor = this.document;
    const abilityLabel = id => CONFIG.DND5E.abilities[id]?.label ?? "";
    const rows = Object.values(actor.spellcastingClasses ?? {}).map(cls => ({
      label: cls.name,
      ability: abilityLabel(cls.spellcasting.ability),
      attack: signed(cls.spellcasting.attack ?? 0),
      dc: cls.spellcasting.save
    }));
    const spell = actor.system.attributes?.spell;
    if ( !rows.length && spell?.dc ) rows.push({
      label: game.i18n.localize("PHONESHEET.Spellcasting"),
      ability: abilityLabel(actor.system.attributes.spellcasting),
      attack: signed(spell.attack ?? 0),
      dc: spell.dc
    });
    return rows;
  }

  async #prepareSpellRow(spell) {
    const sys = spell.system;
    const labels = spell.labels ?? {};
    const states = CONFIG.DND5E.spellPreparationStates;
    const canPrepare = sys.canPrepare && (sys.level > 0);
    const key = `spell.${spell.id}`;
    const expanded = this.#expanded.has(key);
    const uses = sys.uses;
    const details = [labels.activation, labels.range, labels.components?.vsm].filter(_ => _).join(" · ");
    const concentration = sys.properties.has("concentration");
    const ritual = sys.properties.has("ritual");
    const prepared = !canPrepare || (sys.prepared > states.unprepared.value);
    const tags = [];
    if ( ["action", "bonus", "reaction"].includes(sys.activation?.type) ) tags.push(sys.activation.type);
    if ( concentration ) tags.push("concentration");
    if ( ritual ) tags.push("ritual");
    if ( prepared ) tags.push("prepared");
    return {
      key,
      itemId: spell.id,
      img: spell.img,
      name: spell.name,
      search: searchText(spell.name, labels.school, details),
      tags: tags.join(" "),
      sortDamage: this.#averageDamage(sys.activities ?? []),
      sortRange: this.#rangeFeet(spell, null),
      level: sys.level,
      school: labels.school,
      details,
      concentration,
      ritual,
      canPrepare,
      always: canPrepare && (sys.prepared === states.always.value),
      prepared,
      uses: uses?.max ? `${uses.value ?? 0}/${uses.max}` : null,
      expanded,
      extra: expanded ? [labels.concentrationDuration ?? labels.duration, labels.components?.full].filter(_ => _) : null,
      description: expanded ? await this.#enrich(spell) : null
    };
  }

  async #prepareParty() {
    const actor = this.document;
    const members = actor.type === "encounter"
      ? actor.system.members.map(m => ({ actor: fromUuidSync(m.uuid), quantity: m.quantity?.value }))
      : actor.system.members.map(m => ({ actor: m.actor }));

    const rows = [];
    for ( const { actor: member, quantity } of members ) {
      if ( member instanceof Actor ) rows.push(await this.#prepareMember(member, quantity));
    }
    return { members: rows };
  }

  /** A party member, showing only what the player could see on the member's own sheet. */
  async #prepareMember(member, quantity) {
    const observer = member.testUserPermission(game.user, "OBSERVER");
    const limited = member.testUserPermission(game.user, "LIMITED");
    const { hp, ac } = member.system.attributes ?? {};
    const { level, cr, biography } = member.system.details ?? {};
    const key = `member.${member.uuid}`;
    const expanded = limited && this.#expanded.has(key);
    const row = {
      key,
      uuid: member.uuid,
      name: member.name,
      img: member.img,
      owner: member.isOwner,
      canExpand: limited,
      expanded,
      quantity: quantity > 1 ? quantity : null,
      subtitle: level ? game.i18n.format("PHONESHEET.Level", { level })
        : (cr !== undefined) && (cr !== null) ? game.i18n.format("PHONESHEET.CR", { cr }) : null,
      hp: observer && hp?.max ? {
        value: hp.value ?? 0,
        max: hp.max,
        pct: Math.clamp(Math.round(((hp.value ?? 0) / hp.max) * 100), 0, 100)
      } : null,
      ac: observer ? (ac?.value ?? null) : null
    };
    if ( !expanded ) return row;

    if ( observer ) {
      row.classes = Object.values(member.classes ?? {}).map(c => {
        const subclass = c.subclass ? ` (${c.subclass.name})` : "";
        return `${c.name}${subclass} ${c.system.levels}`;
      }).join(" / ");
      row.abilities = Object.entries(member.system.abilities ?? {}).map(([id, abl]) => ({
        abbr: (CONFIG.DND5E.abilities[id]?.abbreviation ?? id).toUpperCase(),
        value: abl.value,
        mod: signed(abl.mod ?? 0)
      }));
      const { skills } = member.system;
      row.passives = ["prc", "ins", "inv"].filter(id => skills?.[id]).map(id => ({
        label: CONFIG.DND5E.skills[id]?.label ?? id,
        value: skills[id].passive
      }));
    }
    // Limited permission only shows the public biography, as on the system's limited sheet.
    const text = observer ? biography?.value : biography?.public;
    if ( text ) row.biography = await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, {
      rollData: member.getRollData(), relativeTo: member, secrets: member.isOwner
    });
    return row;
  }

  async #prepareDescription() {
    const actor = this.document;
    const { full, summary } = actor.system.description ?? {};
    const text = full || summary;
    return {
      description: text ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, {
        rollData: actor.getRollData(), relativeTo: actor, secrets: actor.isOwner
      }) : null
    };
  }

  #prepareCharacter() {
    const actor = this.document;
    const { attributes } = actor.system;
    const death = attributes.death;
    const movement = attributes.movement ?? {};
    const units = movement.units ?? "ft";
    const speeds = ["walk", "fly", "swim", "climb", "burrow"]
      .filter(k => movement[k])
      .map(k => (k === "walk" ? `${movement[k]} ${units}` : `${game.i18n.localize(CONFIG.DND5E.movementTypes[k]?.label ?? k)} ${movement[k]}`));

    const conditions = CONFIG.statusEffects
      .filter(s => s.hud !== false && CONFIG.DND5E.conditionTypes?.[s.id] && !CONFIG.DND5E.conditionTypes[s.id].pseudo)
      .filter(s => s.id !== "exhaustion")
      .map(s => ({ id: s.id, label: game.i18n.localize(s.name), img: s.img, active: actor.statuses.has(s.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

    const hd = attributes.hd;
    const exhaustion = CONFIG.DND5E.conditionTypes?.exhaustion;
    return {
      exhaustion: (exhaustion && (attributes.exhaustion !== undefined))
        ? this.#prepareExhaustion(exhaustion, attributes) : null,
      canSpendHitDie: (hd?.value ?? 0) > 0,
      traits: this.#prepareTraits(),
      dying: !!death && (attributes.hp?.value <= 0),
      death: {
        success: Array.from({ length: 3 }, (_, i) => i < (death?.success ?? 0)),
        failure: Array.from({ length: 3 }, (_, i) => i < (death?.failure ?? 0))
      },
      prof: attributes.prof === undefined ? null : signed(attributes.prof),
      speed: speeds.join(", ") || "—",
      hitDice: hd?.max ? `${hd.value ?? 0}/${hd.max}` : null,
      canInspire: actor.type === "character",
      inspiration: attributes.inspiration,
      canRest: !!actor.system.isCreature,
      conditions,
      ...this.#prepareEncumbrance()
    };
  }

  /**
   * Exhaustion level, as a bar of levels, with what the current level does. The 2024 rules stack a flat
   * penalty per level; the 2014 rules add a new effect at each level, so those are listed cumulatively.
   */
  #prepareExhaustion(config, attributes) {
    const level = attributes.exhaustion ?? 0;
    const max = config.levels ?? 6;
    const effects = [];
    if ( level >= max ) effects.push(game.i18n.localize("PHONESHEET.Exhaustion.Death"));
    else if ( game.settings.get("dnd5e", "rulesVersion") === "legacy" ) {
      for ( let n = 1; n <= level; n++ ) effects.push(game.i18n.localize(`PHONESHEET.Exhaustion.Legacy.${n}`));
    }
    else if ( level ) {
      const { rolls = 2, speed = 5 } = config.reduction ?? {};
      const units = CONFIG.DND5E.movementUnits?.[attributes.movement?.units];
      effects.push(game.i18n.format("PHONESHEET.Exhaustion.Rolls", { penalty: rolls * level }));
      effects.push(game.i18n.format("PHONESHEET.Exhaustion.Speed", {
        penalty: speed * level, units: units ? game.i18n.localize(units.abbreviation) : "ft"
      }));
    }
    return {
      img: config.img,
      level,
      max,
      pips: Array.from({ length: max }, (_, i) => ({ n: i + 1, filled: i < level })),
      effects
    };
  }

  /** Temporary effects, like Bless or Hex. Conditions have their own buttons, so they're left out. */
  async #prepareEffects() {
    const actor = this.document;
    const conditions = CONFIG.DND5E.conditionTypes ?? {};
    const none = game.i18n.localize("COMMON.None");
    const effects = [];
    for ( const effect of actor.allApplicableEffects() ) {
      if ( effect.disabled || effect.isSuppressed || !effect.isTemporary ) continue;
      if ( effect.statuses.size && [...effect.statuses].every(s => s in conditions) ) continue;
      const key = `effect.${effect.uuid}`;
      const expanded = this.#expanded.has(key);
      const duration = effect.duration?.label;
      effects.push({
        key,
        uuid: effect.uuid,
        name: effect.name,
        img: effect.img,
        source: effect.parent === actor ? null : effect.parent?.name,
        duration: duration && (duration !== none) ? duration : null,
        canEnd: effect.isOwner,
        expanded,
        description: expanded && effect.description
          ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(effect.description, {
            rollData: actor.getRollData(), relativeTo: effect, secrets: effect.isOwner
          }) : null
      });
    }
    effects.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    return { effects };
  }

  /** Senses, languages, resistances and proficiencies, as plain lists. */
  #prepareTraits() {
    const actor = this.document;
    const traits = [];
    const split = text => (text ?? "").split(";").map(t => t.trim()).filter(_ => _);

    const senses = actor.system.attributes?.senses;
    if ( senses ) {
      const unit = CONFIG.DND5E.movementUnits?.[senses.units];
      const units = unit ? game.i18n.localize(unit.abbreviation) : (senses.units ?? "");
      const values = Object.entries(senses.ranges ?? {}).filter(([, range]) => range)
        .map(([id, range]) => `${game.i18n.localize(CONFIG.DND5E.senses[id] ?? id)} ${range} ${units}`.trim());
      values.push(...split(senses.special));
      if ( values.length ) traits.push({ label: game.i18n.localize("DND5E.Senses"), values: values.join(", ") });
    }

    const { keyLabel } = dnd5e.documents.Trait;
    for ( const id of ["languages", "dr", "di", "dv", "ci", "armor", "weapon"] ) {
      const config = CONFIG.DND5E.traits[id];
      const data = config && foundry.utils.getProperty(actor, config.actorKeyPath ?? `system.traits.${id}`);
      if ( !data ) continue;
      const values = Array.from(data.value ?? []).map(key => keyLabel(key, { trait: id }) ?? key);
      values.push(...split(data.custom));
      if ( values.length ) traits.push({ label: game.i18n.localize(config.labels.title), values: values.join(", ") });
    }
    return traits;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  changeTab(tab, group, options) {
    const tabs = this._getTabsConfig(group)?.tabs.map(t => t.id) ?? [];
    const from = tabs.indexOf(this.tabGroups[group]);
    const changed = this.tabGroups[group] !== tab;
    super.changeTab(tab, group, options);
    hideChat();
    if ( this.document.sheet?.rendered ) this.document.sheet.close();
    // Slide the new tab in from the side it sits on in the tab bar, so tab order (and swiping) makes sense.
    if ( changed && (from !== -1) && !reducedMotion() ) {
      const section = this.element.querySelector(`.tab[data-group="${group}"][data-tab="${tab}"]`);
      const offset = tabs.indexOf(tab) > from ? 40 : -40;
      section?.animate([
        { transform: `translateX(${offset}px)`, opacity: 0 },
        { transform: "none", opacity: 1 }
      ], { duration: 180, easing: "ease-out" });
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    // Tabs that went away, such as the spellbook after the last spell is deleted, leave their old part behind.
    for ( const element of this.element.querySelectorAll("[data-application-part]") ) {
      if ( !this.#partIds.has(element.dataset.applicationPart) ) element.remove();
    }
    for ( const partId of options.parts ) {
      if ( (partId in LIST_FILTERS) && this.#partIds.has(partId) ) this.#activateFilterBar(partId);
    }
  }

  /* -------------------------------------------- */
  /*  Search and filters                          */
  /* -------------------------------------------- */

  /** The section and filter bar of a list tab. */
  #filterElements(tab) {
    const section = this.element.querySelector(`.tab[data-group="primary"][data-tab="${tab}"]`);
    return { section, bar: section?.querySelector(".ps-filterbar") };
  }

  /** Hook up a freshly rendered filter bar, and filter its tab the way it was before the render. */
  #activateFilterBar(tab) {
    const { section, bar } = this.#filterElements(tab);
    if ( !bar ) return;
    const state = this.#filters[tab];
    const input = bar.querySelector("input");
    input.value = state.query;
    input.addEventListener("input", () => {
      state.query = input.value;
      this.#applyFilters(tab);
    });
    input.addEventListener("keydown", event => {
      // Enter would submit the sheet's form. Close the keyboard instead, so the results are in view.
      if ( event.key === "Enter" ) {
        event.preventDefault();
        input.blur();
      }
      else if ( event.key === "Escape" ) PhoneSheet5e.#onClearSearch.call(this, event, input);
    });
    // The search box isn't actor data; keep the form from submitting on it.
    input.addEventListener("change", event => event.stopPropagation());

    // Tuck the bar away while scrolling down the list and bring it back on the way up.
    let lastY = section.scrollTop;
    section.addEventListener("scroll", () => {
      const y = section.scrollTop;
      const dy = y - lastY;
      if ( Math.abs(dy) < 8 ) return;
      lastY = y;
      const keep = (dy < 0) || (y < bar.offsetHeight) || state.open || bar.contains(document.activeElement);
      bar.classList.toggle("ps-tucked", !keep);
    }, { passive: true });

    this.#applyFilters(tab);
  }

  /** Show the rows of a tab that match its search and chips, in its sort order, and update the bar to match. */
  #applyFilters(tab) {
    const { section, bar } = this.#filterElements(tab);
    if ( !bar ) return;
    const state = this.#filters[tab];
    const config = LIST_FILTERS[tab];

    // Update the bar.
    const count = state.tags.size + (state.sort === "default" ? 0 : 1);
    bar.classList.toggle("open", state.open);
    bar.querySelector(".ps-search-clear").hidden = !state.query;
    const toggle = bar.querySelector(".ps-filter-toggle");
    toggle.classList.toggle("active", !!count);
    toggle.setAttribute("aria-expanded", String(state.open));
    const badge = bar.querySelector(".ps-filter-badge");
    badge.textContent = count;
    badge.hidden = !count;
    for ( const chip of bar.querySelectorAll("[data-tag]") ) {
      const active = state.tags.has(chip.dataset.tag);
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", String(active));
    }
    for ( const button of bar.querySelectorAll("[data-sort]") ) {
      button.classList.toggle("active", button.dataset.sort === state.sort);
    }
    bar.querySelector(".ps-filter-reset").hidden = !count;

    // Filter the rows. A row needs one matching chip from each group the player picked from.
    const query = state.query.trim().toLocaleLowerCase(game.i18n.lang);
    const groups = new Map();
    for ( const { tag, group } of config.chips ) {
      if ( !state.tags.has(tag) ) continue;
      if ( !groups.has(group) ) groups.set(group, []);
      groups.get(group).push(tag);
    }
    const filtering = !!query || (groups.size > 0);
    section.classList.toggle("ps-filtering", filtering);
    for ( const row of section.querySelectorAll("[data-search]") ) {
      const tags = row.dataset.tags.split(" ");
      row.hidden = (!!query && !row.dataset.search.includes(query))
        || groups.values().some(wanted => !wanted.some(t => tags.includes(t)));
    }

    // Flat sorts gather each group's rows into its own list; other sorts send them back to their subsection.
    const flat = !!config.sorts.find(s => s.id === state.sort)?.flat;
    section.classList.toggle("ps-flat", flat);
    for ( const row of section.querySelectorAll("[data-home]") ) {
      const list = flat ? row.closest(".ps-group").querySelector(":scope > .ps-flat-list")
        : section.querySelector(`.ps-list[data-list="${row.dataset.home}"]`);
      if ( list && (row.parentElement !== list) ) list.append(row);
    }

    // Sort the rows inside each list.
    const compare = SORTS[state.sort] ?? SORTS.default;
    for ( const list of section.querySelectorAll(".ps-list") ) {
      const rows = Array.from(list.children).filter(li => li.dataset.search !== undefined);
      list.append(...rows.sort(compare));
    }

    // Hide sections with nothing left in them, and count what's left in the ones that stay.
    for ( const group of section.querySelectorAll("[data-filter-group]") ) {
      const visible = group.querySelectorAll("[data-search]:not([hidden])").length;
      group.hidden = filtering && !visible;
      const counter = group.querySelector(":scope > button .ps-count");
      if ( counter ) counter.textContent = visible;
    }
    section.querySelector(".ps-no-match").hidden = !filtering
      || !!section.querySelector("[data-search]:not([hidden])");
  }

  static #onToggleFilters(event, target) {
    const tab = target.closest(".tab").dataset.tab;
    this.#filters[tab].open = !this.#filters[tab].open;
    this.#applyFilters(tab);
  }

  static #onToggleFilter(event, target) {
    const tab = target.closest(".tab").dataset.tab;
    const { tags } = this.#filters[tab];
    if ( !tags.delete(target.dataset.tag) ) tags.add(target.dataset.tag);
    this.#applyFilters(tab);
  }

  static #onSetSort(event, target) {
    const tab = target.closest(".tab").dataset.tab;
    this.#filters[tab].sort = target.dataset.sort;
    this.#applyFilters(tab);
  }

  static #onClearSearch(event, target) {
    const tab = target.closest(".tab").dataset.tab;
    this.#filters[tab].query = "";
    this.#filterElements(tab).bar.querySelector("input").value = "";
    this.#applyFilters(tab);
  }

  static #onResetFilters(event, target) {
    const tab = target.closest(".tab").dataset.tab;
    this.#filters[tab].tags.clear();
    this.#filters[tab].sort = "default";
    this.#applyFilters(tab);
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#enableSwipe();
    if ( !this.document.system.isGroup ) return;
    this.#memberHook = Hooks.on("updateActor", actor => {
      if ( this.rendered && this.#isMember(actor) ) this.render({ parts: ["party"] });
    });
  }

  /**
   * Swipe left or right on a tab to move to the next or previous one. The page follows the finger,
   * slides away when the swipe is far enough, and springs back when it isn't (or there's no tab that way).
   */
  #enableSwipe() {
    let gesture = null;
    const neighbour = dx => {
      const tabs = this._getTabsConfig("primary").tabs.map(t => t.id);
      return tabs[tabs.indexOf(this.tabGroups.primary) + (dx < 0 ? 1 : -1)] ?? null;
    };
    const reset = section => Object.assign(section.style, { transform: "", opacity: "", transition: "" });

    this.element.addEventListener("touchstart", event => {
      const touch = event.touches[0];
      const section = event.target.closest(".tab.ps-scroll");
      // Leave sideways gestures alone where they scroll or edit something.
      const ignore = !section || (event.touches.length > 1)
        || event.target.closest("input, textarea, table, prose-mirror");
      gesture = ignore ? null : { x: touch.clientX, y: touch.clientY, section, axis: null, dx: 0 };
    }, { passive: true });

    this.element.addEventListener("touchmove", event => {
      if ( !gesture ) return;
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      // Decide once whether this is a sideways swipe or a scroll, then stick with it.
      if ( !gesture.axis ) {
        if ( Math.max(Math.abs(dx), Math.abs(dy)) < 10 ) return;
        gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
      }
      if ( gesture.axis !== "x" ) return;
      // Drag with resistance when there's no tab in that direction.
      gesture.dx = neighbour(dx) ? dx : dx / 4;
      if ( reducedMotion() ) return;
      Object.assign(gesture.section.style, {
        transition: "none",
        transform: `translateX(${gesture.dx}px)`,
        opacity: String(1 - Math.min(Math.abs(gesture.dx) / 600, 0.4))
      });
    }, { passive: true });

    const end = () => {
      if ( !gesture ) return;
      const { section, axis, dx } = gesture;
      gesture = null;
      if ( axis !== "x" ) return;
      const next = neighbour(dx);
      if ( !next || (Math.abs(dx) < SWIPE_DISTANCE) ) {
        if ( reducedMotion() ) return reset(section);
        section.style.transition = "transform 200ms ease-out, opacity 200ms ease-out";
        section.style.transform = "translateX(0)";
        section.style.opacity = "1";
        setTimeout(() => reset(section), 200);
        return;
      }
      if ( reducedMotion() ) return this.changeTab(next, "primary");
      section.style.transition = "transform 140ms ease-in, opacity 140ms ease-in";
      section.style.transform = `translateX(${dx < 0 ? "-100%" : "100%"})`;
      section.style.opacity = "0";
      setTimeout(() => {
        reset(section);
        this.changeTab(next, "primary");
      }, 140);
    };
    this.element.addEventListener("touchend", end, { passive: true });
    this.element.addEventListener("touchcancel", end, { passive: true });
  }

  _onClose(options) {
    super._onClose(options);
    if ( this.#memberHook !== null ) Hooks.off("updateActor", this.#memberHook);
    this.#memberHook = null;
  }

  #isMember(actor) {
    const { members } = this.document.system;
    return members.some(m => (m.actor === actor) || (m.uuid === actor.uuid));
  }


  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onRollSkill(event, target) {
    this.document.rollSkill({ skill: target.dataset.id, event });
  }

  static #onRollTool(event, target) {
    this.document.rollToolCheck({ tool: target.dataset.id, event });
  }

  static #onRollCheck(event, target) {
    this.document.rollAbilityCheck({ ability: target.dataset.id, event });
  }

  static #onRollSave(event, target) {
    this.document.rollSavingThrow({ ability: target.dataset.id, event });
  }

  static #onRollInitiative() {
    this.document.rollInitiativeDialog();
  }

  static #onRollDeathSave(event) {
    this.document.rollDeathSave({ event });
  }

  #itemFor(target) {
    return this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static #onUseActivity(event, target) {
    const activityId = target.dataset.activityId ?? target.closest("[data-activity-id]")?.dataset.activityId;
    this.#itemFor(target)?.system.activities?.get(activityId)?.use({ event });
  }

  static #onToggleInfo(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    if ( !this.#expanded.delete(key) ) this.#expanded.add(key);
    this.render({ parts: [target.closest(".tab").dataset.tab] });
  }

  static #onAdjustQuantity(event, target) {
    const item = this.#itemFor(target);
    if ( !item ) return;
    const quantity = Math.max(0, (item.system.quantity ?? 0) + Number(target.dataset.delta));
    item.update({ "system.quantity": quantity });
  }

  static #onToggleEquipped(event, target) {
    const item = this.#itemFor(target);
    item?.update({ "system.equipped": !item.system.equipped });
  }

  static #onToggleAttuned(event, target) {
    const item = this.#itemFor(target);
    item?.update({ "system.attuned": !item.system.attuned });
  }

  static #onToggleGroup(event, target) {
    const id = target.dataset.id;
    if ( !this.#collapsed.delete(id) ) this.#collapsed.add(id);
    this.render({ parts: [target.closest(".tab").dataset.tab] });
  }

  static #onCastSpell(event, target) {
    this.#itemFor(target)?.use({ event });
  }

  static #onTogglePrepared(event, target) {
    const item = this.#itemFor(target);
    const { unprepared, prepared, always } = CONFIG.DND5E.spellPreparationStates;
    if ( !item || (item.system.prepared === always.value) ) return;
    item.update({ "system.prepared": item.system.prepared ? unprepared.value : prepared.value });
  }

  /** Tapping a filled slot spends it and everything after it; tapping an empty one restores up to it. */
  static #onSetSlot(event, target) {
    const { slot, n } = target.dataset;
    const current = this.document.system.spells?.[slot]?.value ?? 0;
    const value = current >= Number(n) ? Number(n) - 1 : Number(n);
    this.document.update({ [`system.spells.${slot}.value`]: value });
  }

  static #onEndConcentration(event, target) {
    this.document.endConcentration(target.dataset.id);
  }

  /** Tapping a level on the bar sets it; tapping the current level steps back one. */
  static #onSetExhaustion(event, target) {
    const level = Number(target.dataset.level);
    const current = this.document.system.attributes.exhaustion ?? 0;
    this.document.update({ "system.attributes.exhaustion": level === current ? level - 1 : level });
  }

  static #onAdjustExhaustion(event, target) {
    const max = CONFIG.DND5E.conditionTypes.exhaustion?.levels ?? 6;
    const level = Math.clamp((this.document.system.attributes.exhaustion ?? 0) + Number(target.dataset.delta), 0, max);
    this.document.update({ "system.attributes.exhaustion": level });
  }

  /** Spend the largest hit die available, as the system sheet does. */
  /** Ask first: the tile is easy to tap by accident, and a spent hit die can't be taken back. */
  static async #onRollHitDie(event) {
    const actor = this.document;
    const hd = actor.system.attributes.hd;
    const denomination = actor.system.isNPC ? `d${hd?.denomination}` : hd?.largestAvailable;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "PHONESHEET.SpendHitDie" },
      content: `<p>${game.i18n.format("PHONESHEET.SpendHitDieConfirm", { die: denomination, remaining: hd?.value ?? 0 })}</p>`,
      rejectClose: false
    });
    if ( ok ) actor.rollHitDie({ denomination: actor.system.isNPC ? undefined : denomination });
  }

  static async #onEndEffect(event, target) {
    const effect = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    if ( !effect ) return;
    // Effects from items can't be deleted from the actor, so turn them off instead.
    if ( effect.parent === this.document ) effect.delete();
    else effect.update({ disabled: true });
  }

  static #onOpenMember(event, target) {
    const actor = fromUuidSync(target.dataset.uuid);
    if ( actor?.isOwner ) PhoneSheet5e.menu.openActor(actor);
  }

  #hpAmount() {
    const input = this.element.querySelector("input.hp-amount");
    const amount = Math.abs(parseInt(input?.value));
    if ( input ) input.value = "";
    return Number.isFinite(amount) && (amount > 0) ? amount : null;
  }

  static #onDamage() {
    const amount = this.#hpAmount();
    if ( amount ) this.document.applyDamage(amount);
  }

  static #onHeal() {
    const amount = this.#hpAmount();
    if ( amount ) this.document.applyDamage(-amount);
  }

  static #onToggleCondition(event, target) {
    this.document.toggleStatusEffect(target.dataset.id);
  }

  static #onToggleInspiration() {
    this.document.update({ "system.attributes.inspiration": !this.document.system.attributes.inspiration });
  }

  static #onShortRest() {
    this.document.shortRest();
  }

  static #onLongRest() {
    this.document.longRest();
  }

  static #onOpenChat() {
    toggleChat();
  }

  static async #onOpenMenu() {
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "PHONESHEET.Menu" },
      classes: ["phone-sheet-chooser"],
      buttons: [
        { action: "fullSheet", label: "PHONESHEET.FullSheet", icon: "fa-solid fa-book-open" },
        { action: "switchCharacter", label: "PHONESHEET.Switch", icon: "fa-solid fa-users" },
        { action: "exit", label: "PHONESHEET.Exit", icon: "fa-solid fa-desktop" }
      ],
      rejectClose: false
    });
    if ( choice ) PhoneSheet5e.menu[choice]?.(this.document);
  }
}
