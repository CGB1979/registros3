export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function openModal(html) {
  const root = document.getElementById("cl-modal-root");
  root.innerHTML = `<div class="cl-modal-backdrop" data-modal-backdrop><section class="cl-modal" role="dialog" aria-modal="true">${html}</section></div>`;
  const backdrop = root.querySelector("[data-modal-backdrop]");
  backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });
  root.querySelectorAll("[data-close-modal]").forEach(btn => btn.addEventListener("click", closeModal));
  return root.querySelector(".cl-modal");
}

export function closeModal() {
  document.getElementById("cl-modal-root").innerHTML = "";
}

export function modalHead(title, subtitle = "") {
  return `<div class="cl-modal-head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<div class="cl-muted cl-small">${escapeHtml(subtitle)}</div>` : ""}</div><button class="cl-close" data-close-modal type="button" aria-label="Cerrar">×</button></div>`;
}

export function confirmAction(message, onConfirm) {
  const modal = openModal(`${modalHead("Confirmar")}
    <p>${escapeHtml(message)}</p>
    <div class="cl-modal-actions"><button class="cl-btn cl-btn-secondary" data-close-modal>Cancelar</button><button class="cl-btn cl-btn-danger" id="cl-confirm">Confirmar</button></div>`);
  modal.querySelector("#cl-confirm").addEventListener("click", () => { closeModal(); onConfirm(); });
}
