const TUTORIAL_KEY = "control_laboral_tutorial_v1";

export function shouldShowTutorial() {
  return localStorage.getItem(TUTORIAL_KEY) !== "1";
}

export function resetTutorial() {
  localStorage.removeItem(TUTORIAL_KEY);
}

export function startTutorial({ onNavigate, openSettings, closeModal }) {
  if (!shouldShowTutorial()) return;

  const steps = [
    {
      title: "Tu calendario",
      text: "Esta es la pantalla principal. Acá vas a ver el ciclo de facturación y el estado de cada jornada.",
      selector: ".cl-month-nav"
    },
    {
      title: "Registrar un día",
      text: "Hacé doble toque sobre un día para abrir su registro de entrada y salida.",
      selector: ".cl-day:not(.outside)"
    },
    {
      title: "Jornales",
      text: "El resumen muestra cuántos jornales corresponden al ciclo. Hacé doble toque para ver qué días los generaron.",
      selector: '[data-summary-detail="jornales"]'
    },
    {
      title: "Horas extras",
      text: "Las horas al 50 % y al 100 % se muestran por separado. Hacé doble toque para consultar los días que las generaron.",
      selector: '[data-summary-detail="extra50"]'
    },
    {
      title: "Francos",
      text: "Desde Francos podés consultar francos y medios francos disponibles, utilizados y adeudados.",
      selector: '[data-screen="leaves"]',
      before: () => onNavigate("leaves")
    },
    {
      title: "Revisiones",
      text: "En Jornales, la sección Revisiones muestra las jornadas que necesitan atención y el motivo. También podés hacer doble toque para abrir el día.",
      selector: '[data-screen="summary"]',
      before: () => onNavigate("summary")
    },
    {
      title: "Configuración",
      text: "Desde Configuración podés ajustar las reglas de la app, guardar los cambios y elegir el modo claro u oscuro.",
      selector: "#btn-settings",
      before: () => { closeModal?.(); onNavigate("calendar"); }
    },
    {
      title: "Modo claro u oscuro",
      text: "Elegí el tema que prefieras. El cambio es visual y no modifica tus registros.",
      selector: "#cl-setting-theme",
      before: () => openSettings()
    }
  ];

  let index = 0;
  let overlay = null;

  function finish() {
    localStorage.setItem(TUTORIAL_KEY, "1");
    if (overlay) overlay.remove();
    overlay = null;
    closeModal?.();
    onNavigate("calendar");
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "cl-tutorial-overlay";
    overlay.innerHTML = `
      <div class="cl-tutorial-dim"></div>
      <div class="cl-tutorial-focus" aria-hidden="true"></div>
      <section class="cl-tutorial-card" role="dialog" aria-modal="true" aria-label="Tutorial">
        <div class="cl-tutorial-step" id="cl-tutorial-step"></div>
        <h2 id="cl-tutorial-title"></h2>
        <p id="cl-tutorial-text"></p>
        <div class="cl-tutorial-actions">
          <button type="button" class="cl-btn cl-btn-secondary" id="cl-tutorial-skip">Saltar</button>
          <div class="cl-tutorial-progress" id="cl-tutorial-progress"></div>
          <button type="button" class="cl-btn cl-btn-primary" id="cl-tutorial-next">Siguiente</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#cl-tutorial-skip").addEventListener("click", finish);
    overlay.querySelector("#cl-tutorial-next").addEventListener("click", () => {
      if (index >= steps.length - 1) finish();
      else { index += 1; showStep(); }
    });
  }

  function position() {
    if (!overlay) return;
    const step = steps[index];
    const target = document.querySelector(step.selector);
    const focus = overlay.querySelector(".cl-tutorial-focus");
    if (!target) {
      focus.style.display = "none";
      return;
    }
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const rect = target.getBoundingClientRect();
    const pad = 7;
    focus.style.display = "block";
    focus.style.left = `${Math.max(6, rect.left - pad)}px`;
    focus.style.top = `${Math.max(6, rect.top - pad)}px`;
    focus.style.width = `${Math.min(window.innerWidth - 12, rect.width + pad * 2)}px`;
    focus.style.height = `${Math.min(window.innerHeight - 12, rect.height + pad * 2)}px`;
  }

  function showStep() {
    const step = steps[index];
    step.before?.();
    ensureOverlay();
    const title = overlay.querySelector("#cl-tutorial-title");
    const text = overlay.querySelector("#cl-tutorial-text");
    const stepNo = overlay.querySelector("#cl-tutorial-step");
    const progress = overlay.querySelector("#cl-tutorial-progress");
    const next = overlay.querySelector("#cl-tutorial-next");
    stepNo.textContent = `${index + 1} de ${steps.length}`;
    title.textContent = step.title;
    text.textContent = step.text;
    progress.innerHTML = steps.map((_, i) => `<span class="${i === index ? "active" : ""}"></span>`).join("");
    next.textContent = index === steps.length - 1 ? "Finalizar" : "Siguiente";
    requestAnimationFrame(position);
  }

  window.addEventListener("resize", position);
  showStep();
}
