# Phone Sheet

A Foundry VTT (v13–14) module for in-person play: players open Foundry in their phone's browser and get a
phone-first character sheet instead of the tabletop.

- Skips loading the canvas on phones (session only; the core setting isn't changed).
- **dnd5e:** a custom single-column sheet with Character, Skills, Actions (grouped by action type, then by source:
  weapons, spells, items, features), Inventory and Spellbook (only for actors with spells) tabs, plus chat and the
  full system sheet one tap away. Spell attack, spell save DC and class feature DCs stay visible in the header.
  NPCs and vehicles use the same sheet; groups and encounters get Party, Inventory and Description tabs.
  Swipe sideways to change tabs. Your own roll results pop up above the tab bar, so chat doesn't have to be open; attack results ask
  whether the attack hit, and a hit rolls damage.
- **Game Invitation Links** (GM, desktop) shows QR codes for the local and internet links side by side, with only
  one sharp at a time (the internet one starts blurred), so players can join by scanning.
- **Other systems, and actor types added by modules:** the system's own sheet, full screen, with a small toolbar.

## Installation

Only the GM (whoever runs the Foundry server) installs the module. Players don't need to install anything; they
just open the game's invitation link in their phone's browser.

### From the manifest URL (recommended)

1. In Foundry's setup screen, open **Add-on Modules** and click **Install Module**.
2. Paste this into the **Manifest URL** field at the bottom and click **Install**:

   ```
   https://github.com/Unosami/foundryvtt-phone-sheet/releases/latest/download/module.json
   ```

3. Launch your world, go to **Game Settings → Manage Modules**, tick **Phone Sheet** and save.

Installing this way lets Foundry tell you when an update is out, and update the module for you.

### Manually

1. Download `module.zip` from the [latest release](https://github.com/Unosami/foundryvtt-phone-sheet/releases/latest).
2. Unzip it into a folder named `phone-sheet` inside your Foundry user data's `Data/modules/` folder, so that
   `Data/modules/phone-sheet/module.json` exists.
3. Restart Foundry, then enable the module in your world as in step 3 above.

## Usage

Players log in from their phone as usual. On a phone-sized touch screen the module switches on by itself and opens
the player's character. GMs on a desktop can use **Game Invitation Links** to show join QR codes.

## Settings

**Phone Sheet mode** (per device): *Auto* turns on for non-GM users on phone-sized touch screens; *Always on* /
*Always off* override that. Set *Always on* on a desktop to preview the phone layout.

## Notes

An activity that overrides its item's activation with a blank one (some importers do this) is grouped by the item's
activation instead.

The phone's screen is kept awake only when Foundry is served over HTTPS; browsers don't allow it on plain http.

The login (join) page only loads Foundry's core files, so modules can't give it a phone layout.

## Credits

QR codes use [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT),
vendored in `vendor/qrcode.mjs`.
