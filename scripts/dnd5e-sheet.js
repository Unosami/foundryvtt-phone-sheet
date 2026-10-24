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

/** Sort order of item types inside an action group. */
const TYPE_ORDER = ["weapon", "feat", "spell", "consumable", "equipment", "tool", "loot"];

const PROF_ICONS = {
  0: "fa-regular fa-circle",
  0.5: "fa-solid fa-circle-half-stroke",
  1: "fa-solid fa-circle",
  2: "fa-solid fa-circle-check"
};

const signed = n => (n >= 0 ? `+${n}` : `${n}`);

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
      toggleInfo: PhoneSheet5e.#onToggleInfo,
      toggleGroup: PhoneSheet5e.#onToggleGroup,
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
    skills: { template: `${TEMPLATES}/skills.hbs`, scrollable: [""] },
    actions: { template: `${TEMPLATES}/actions.hbs`, scrollable: [""] },
    character: { template: `${TEMPLATES}/character.hbs`, scrollable: [""] },
    nav: { template: `${TEMPLATES}/nav.hbs` }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "skills", icon: "fa-solid fa-dice-d20", label: "PHONESHEET.Tab.Skills" },
        { id: "actions", icon: "fa-solid fa-hand-fist", label: "PHONESHEET.Tab.Actions" },
        { id: "character", icon: "fa-solid fa-heart", label: "PHONESHEET.Tab.Character" }
      ],
      initial: "skills"
    }
  };

  /**
   * Callbacks for the menu, supplied by the main script so this file doesn't depend on it.
   * @type {{switchCharacter: Function, fullSheet: Function, exit: Function}}
   */
  static menu;

  /** Item descriptions the player has expanded. */
  #expanded = new Set();

  /** Action groups the player has collapsed. */
  #collapsed = new Set();

  constructor(options) {
    super(options);
    const last = game.settings.get(MODULE_ID, "lastTab");
    if ( this.constructor.TABS.primary.tabs.some(t => t.id === last) ) this.tabGroups.primary = last;
  }

  get title() {
    return this.document.name;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const { attributes } = actor.system;
    const hp = attributes.hp;
    Object.assign(context, {
      actor,
      img: actor.img,
      hp: {
        value: hp.value,
        max: hp.max,
        temp: hp.temp || 0,
        pct: hp.max ? Math.clamp(Math.round((hp.value / hp.max) * 100), 0, 100) : 0
      },
      ac: attributes.ac?.value ?? 0,
      init: signed(attributes.init?.total ?? attributes.init?.mod ?? 0)
    });
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs[partId];
    switch ( partId ) {
      case "skills": Object.assign(context, this.#prepareSkills()); break;
      case "actions": Object.assign(context, await this.#prepareActions()); break;
      case "character": Object.assign(context, this.#prepareCharacter()); break;
    }
    return context;
  }

  #prepareSkills() {
    const { abilities, skills, tools } = this.document.system;
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
      id, label, rows: [], collapsed: this.#collapsed.has(id)
    }]));

    for ( const item of this.document.items ) {
      if ( !this.#isAvailable(item) ) continue;
      const activities = item.system.activities?.filter(a => a.canUse) ?? [];
      for ( const activity of activities ) {
        const groupId = this.#actionGroup(activity);
        groups[groupId].rows.push(await this.#prepareActionRow(item, activity, activities.length > 1, groupId));
      }
    }

    const typeRank = t => { const i = TYPE_ORDER.indexOf(t); return i === -1 ? TYPE_ORDER.length : i; };
    for ( const group of Object.values(groups) ) {
      group.rows.sort((a, b) => (typeRank(a.type) - typeRank(b.type)) || (a.level - b.level)
        || a.name.localeCompare(b.name, game.i18n.lang));
    }

    return {
      groups: Object.values(groups).filter(g => g.rows.length),
      slots: this.#prepareSlots()
    };
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

  /**
   * Map a dnd5e activation type to one of our groups. dnd5e has no free action type, so a
   * "special" activation whose condition text says "free" counts as one.
   */
  #actionGroup(activity) {
    const { type, condition } = activity.activation ?? {};
    if ( ["action", "bonus", "reaction"].includes(type) ) return type;
    if ( (type === "special") && /\bfree\b|no action/i.test(condition ?? "") ) return "free";
    return "special";
  }

  async #prepareActionRow(item, activity, multiple, groupId) {
    const sys = item.system;
    const labels = activity.labels ?? {};
    const details = [];
    if ( groupId === "special" ) {
      const { type, value } = activity.activation ?? {};
      const typeLabel = CONFIG.DND5E.activityActivationTypes[type]?.label;
      if ( typeLabel ) details.push(value > 1 ? `${value} ${typeLabel}` : typeLabel);
    }
    if ( item.type === "spell" ) details.push(item.labels?.level);
    if ( labels.toHit ) details.push(game.i18n.format("PHONESHEET.ToHit", { bonus: labels.toHit }));
    if ( labels.save ) details.push(labels.save);
    const damage = labels.damage?.map(d => d.label).filter(_ => _).join(", ");
    if ( damage ) details.push(damage);
    if ( labels.range && (item.type !== "feat") ) details.push(labels.range);

    const uses = activity.uses?.max ? activity.uses : sys.uses;
    const key = `${item.id}.${activity.id}`;
    const expanded = this.#expanded.has(key);
    return {
      key,
      itemId: item.id,
      activityId: activity.id,
      type: item.type,
      level: sys.level ?? 0,
      img: activity.img ?? item.img,
      name: item.name,
      activityName: multiple ? activity.name : null,
      details: details.filter(_ => _).join(" · "),
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

  #prepareCharacter() {
    const actor = this.document;
    const { attributes } = actor.system;
    const death = attributes.death ?? {};
    const movement = attributes.movement ?? {};
    const units = movement.units ?? "ft";
    const speeds = ["walk", "fly", "swim", "climb", "burrow"]
      .filter(k => movement[k])
      .map(k => (k === "walk" ? `${movement[k]} ${units}` : `${game.i18n.localize(CONFIG.DND5E.movementTypes[k]?.label ?? k)} ${movement[k]}`));

    const conditions = CONFIG.statusEffects
      .filter(s => s.hud !== false && CONFIG.DND5E.conditionTypes?.[s.id] && !CONFIG.DND5E.conditionTypes[s.id].pseudo)
      .map(s => ({ id: s.id, label: game.i18n.localize(s.name), img: s.img, active: actor.statuses.has(s.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

    const hd = attributes.hd;
    return {
      dying: attributes.hp.value <= 0,
      death: {
        success: Array.from({ length: 3 }, (_, i) => i < (death.success ?? 0)),
        failure: Array.from({ length: 3 }, (_, i) => i < (death.failure ?? 0))
      },
      prof: signed(attributes.prof ?? 0),
      speed: speeds.join(", ") || "—",
      hitDice: hd ? `${hd.value ?? 0}/${hd.max ?? 0}` : null,
      inspiration: attributes.inspiration,
      conditions
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  changeTab(tab, group, options) {
    super.changeTab(tab, group, options);
    ui.chat.popout?.close();
    if ( this.document.sheet?.rendered ) this.document.sheet.close();
    game.settings.set(MODULE_ID, "lastTab", tab);
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

  static #onUseActivity(event, target) {
    const row = target.closest("[data-item-id]");
    const item = this.document.items.get(row.dataset.itemId);
    item?.system.activities?.get(row.dataset.activityId)?.use({ event });
  }

  static #onToggleInfo(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    if ( !this.#expanded.delete(key) ) this.#expanded.add(key);
    this.render({ parts: ["actions"] });
  }

  static #onToggleGroup(event, target) {
    const id = target.dataset.id;
    if ( !this.#collapsed.delete(id) ) this.#collapsed.add(id);
    this.render({ parts: ["actions"] });
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
    const popout = ui.chat.popout;
    if ( popout?.rendered ) popout.close();
    else ui.chat.renderPopout();
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
