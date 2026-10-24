import qrcode from "../vendor/qrcode.mjs";

/**
 * Adds scannable QR codes to the core Game Invitation Links window, so players can join from a phone
 * without typing the address. The codes sit side by side and only one is sharp at a time, so a phone
 * can't pick up the wrong one. The internet link starts blurred, as the link itself starts hidden.
 */
export function initInviteQR() {
  Hooks.on("renderInvitationLinks", (app, element) => {
    const { local, remote } = game.data.addresses ?? {};
    const codes = [];
    if ( local ) codes.push({ url: local, caption: "PHONESHEET.QR.Local", show: "PHONESHEET.QR.ShowLocal" });
    if ( remote ) codes.push({ url: remote, caption: "PHONESHEET.QR.Internet", show: "PHONESHEET.QR.ShowInternet" });
    if ( !codes.length ) return;

    const section = document.createElement("div");
    section.className = "phone-sheet-qr";
    const row = document.createElement("div");
    row.className = "codes";
    const figures = codes.map(code => qrFigure(code.url, code.caption));
    row.append(...figures);
    const button = document.createElement("button");
    button.type = "button";
    section.append(row, button);

    // Which code is sharp, or null for none (only the internet link, which starts hidden).
    let shown = local ? 0 : null;
    const update = () => {
      figures.forEach((f, i) => f.classList.toggle("blurred", i !== shown));
      const next = codes.length > 1 ? (shown + 1) % codes.length : (shown === null ? 0 : null);
      button.dataset.next = next ?? "";
      const label = next === null ? "PHONESHEET.QR.Hide" : codes[next].show;
      button.innerHTML = `<i class="fa-solid fa-qrcode"></i> ${game.i18n.localize(label)}`;
    };
    button.addEventListener("click", () => {
      shown = button.dataset.next === "" ? null : Number(button.dataset.next);
      update();
    });
    figures.forEach((figure, i) => figure.addEventListener("click", () => {
      shown = i;
      update();
    }));
    update();

    element.querySelector(".window-content")?.append(section);
    app.setPosition({ height: "auto" });
  });
}

function qrFigure(url, caption) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const figure = document.createElement("figure");
  figure.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  const label = document.createElement("figcaption");
  label.textContent = game.i18n.localize(caption);
  figure.append(label);
  return figure;
}
