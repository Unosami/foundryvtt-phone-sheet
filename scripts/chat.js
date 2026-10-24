/**
 * The chat "tab" is the core chat popout, rendered once and then shown or hidden with a body class.
 * Re-rendering the popout on every open meant rebuilding the message log each time, which was slow.
 */

const SHOWN = "phone-sheet-chat";

export function isChatShown() {
  return document.body.classList.contains(SHOWN);
}

/** Render the popout in the background, so the first open is as quick as the rest. */
export function preloadChat() {
  if ( !ui.chat.popout?.rendered ) ui.chat.renderPopout();
}

export async function showChat() {
  document.body.classList.add(SHOWN);
  const popout = ui.chat.popout;
  if ( popout?.rendered ) popout.scrollBottom();
  else await ui.chat.renderPopout();
}

export function hideChat() {
  document.body.classList.remove(SHOWN);
  document.activeElement?.blur();
}

export function toggleChat() {
  if ( isChatShown() ) hideChat();
  else showChat();
}

// If the popout gets closed some other way, don't leave the Chat button lit.
Hooks.on("closeChatLog", app => {
  if ( app.isPopout ) document.body.classList.remove(SHOWN);
});
