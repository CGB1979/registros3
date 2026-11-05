import { CONFIG, MESES, VERSION_APP } from "./config.js";
import { loadState, saveState, addAudit, exportState, importState } from "./storage.js";
import { isoDate, calculateDay, minutesFromTime, timeFromMinutes, suggestLateOrShift, estimatedSchedule } from "./time.js";
import { getHolidays, updateExternalHolidays } from "./holidays.js";
import { renderCalendar, bindCalendar } from "./calendar.js";
import { renderSummary, calculateMonth, calculateBillingCycle, formatHours } from "./summary.js";
import { syncAllGenerated, syncSaturdayClassifications, syncGeneratedForDay, useFullLeave, useHalfLeave, useThreeHalvesForFullDay, leaveTotals, availableFull, availableHalf, debtFull, debtHalf, markDebtPaid, rollbackLeaveUsageForDate } from "./leaves.js";
import { openModal, closeModal, modalHead, escapeHtml, confirmAction } from "./ui.js";
import { startTutorial, resetTutorial } from "./tutorial.js";

const state = loadState();
const view = { screen: "calendar", year: new Date().getFullYear(), month: new Date().getMonth(), selected: isoDate(new Date()) };
const main = document.getElementById("cl-main");

function save() { saveState(state); }
function dateFromKey(key) { const [y,m,d] = key.split("-").map(Number); return new Date(y, m-1, d); }
function formatDate(key) { return dateFromKey(key).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); }
function currentTime() { return new Date().toTimeString().slice(0,5); }

function applyTheme(theme = state.settings.theme || "light") {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.clTheme = normalized;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", normalized === "dark" ? "#0f1720" : "#ffffff");
}

function ensureSaturdayClassifications() {
  syncSaturdayClassifications(state);
}

function render() {
  document.querySelectorAll(".cl-nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.screen === view.screen));
  document.getElementById("cl-screen-title").textContent = {
    calendar: "Calendario", summary: "Jornales y horas extras", leaves: "Francos", history: "Historial"
  }[view.screen] || "Calendario";

  if (view.screen === "calendar") renderCalendarScreen();
  if (view.screen === "summary") renderSummaryScreen();
  if (view.screen === "leaves") renderLeavesScreen();
  if (view.screen === "history") renderHistoryScreen();
}

function renderCalendarScreen() {
  syncAllGenerated(state);
  save();
  const calendar = renderCalendar(state, view);
  const holidays = getHolidays(state, view.year);
  const today = isoDate(new Date());
  const { start, end, totals, rows } = calculateBillingCycle(state, new Date(view.year, view.month, 15));
  main.innerHTML = `${calendar}
    <section class="cl-card">
      <h3>Resumen del ciclo de facturación</h3>
      <div class="cl-muted cl-small">${start.toLocaleDateString("es-AR")} al ${end.toLocaleDateString("es-AR")}</div>
      <div class="cl-grid-3">
        <button type="button" class="cl-stat cl-stat-action" data-summary-detail="jornales"><div class="value">${totals.jornales}</div><div class="label">Jornales</div></button>
        <button type="button" class="cl-stat cl-stat-action" data-summary-detail="extra50"><div class="value">${formatHours(totals.extra50)}</div><div class="label">Extras 50%</div></button>
        <button type="button" class="cl-stat cl-stat-action" data-summary-detail="extra100"><div class="value">${formatHours(totals.extra100)}</div><div class="label">Extras 100%</div></button>
      </div>
    </section>
    <section class="cl-note">Hoy: ${today}. Última actualización de feriados: ${state.holidays.lastUpdate ? new Date(state.holidays.lastUpdate).toLocaleString("es-AR") : "lista integrada / sin actualización externa"}.</section>`;

  bindCalendar(main, view, openDayModal);
  bindSummaryDetailButtons(main, { start, end, rows, totals });
  main.querySelector("[data-calendar-prev]").addEventListener("click", () => changeMonth(-1));
  main.querySelector("[data-calendar-next]").addEventListener("click", () => changeMonth(1));
}

function changeMonth(delta) {
  view.month += delta;
  if (view.month < 0) { view.month = 11; view.year--; }
  if (view.month > 11) { view.month = 0; view.year++; }
  render();
}

function openDayModal(dateKey) {
  view.selected = dateKey;
  const date = dateFromKey(dateKey);
  const holiday = getHolidays(state, date.getFullYear())[dateKey];
  const record = state.records[dateKey] || { punches: [], saturdayType: null, leaveMode: null, lateDecision: null, needsReview: false };
  state.records[dateKey] = record;
  const calc = calculateDay(record, date, holiday, state.settings);
  syncGeneratedForDay(state, dateKey, calc);
  save();

  const status = record.leaveMode ? "leave" : holiday && !calc.worked ? "holiday" : calc.review ? "review" : "normal";
  const estimated = estimatedSchedule(state, date);
  const statusText = record.leaveMode === "franco_entero" ? "Cubierto con franco entero" :
    record.leaveMode === "medio_franco_dia_completo" ? "Cubierto con 3 medios francos" :
    record.leaveMode === "medio_franco" ? "Jornada reducida con medio franco" :
    holiday ? (calc.worked ? "Domingo / feriado trabajado" : `Feriado: ${holiday.name}`) :
    record.saturdayType === "mandatory" ? "Sábado obligatorio" : record.saturdayType === "voluntario" ? "Sábado voluntario" : "Jornada normal";

  const punches = [...(record.punches || [])].sort((a,b) => a.timestamp - b.timestamp);
  const punchHtml = punches.length ? punches.map((p, i) => `
    <div class="cl-time-row">
      <div class="cl-time-icon ${p.type === "entrada" ? "in" : "out"}">${p.type === "entrada" ? "→" : "←"}</div>
      <div><div class="cl-time-main">${p.type === "entrada" ? "Entrada" : "Salida"}: ${escapeHtml(p.time)}</div><div class="cl-time-ref">Ref. cálculo: ${escapeHtml(p.referenceTime || p.time)} · ${p.source === "manual" ? "manual" : "real"}</div></div>
      <div class="cl-time-actions"><button type="button" data-edit-punch="${i}">✎</button></div>
    </div>`).join("") : `<div class="cl-note">Todavía no hay marcaciones.</div>`;

  openModal(`${modalHead(formatDate(dateKey), holiday ? holiday.name : "")}
    <div class="cl-status ${status}">${statusText}</div>
    <section class="cl-card" style="box-shadow:none;margin:0 0 10px;padding:12px">
      <div class="cl-row"><strong>Horarios registrados</strong><span class="cl-muted cl-small">Real: ${formatHours(calc.realMinutes)}</span></div>
      ${punchHtml}
      <div class="cl-grid-2" style="margin-top:10px"><div class="cl-stat"><div class="value">${formatHours(calc.countedMinutes)}</div><div class="label">Jornal computado</div></div><div class="cl-stat"><div class="value">${formatHours(calc.extra50Minutes + calc.extra100Minutes)}</div><div class="label">Horas extras</div></div></div>
    </section>
    <div class="cl-action-stack">
      <div class="cl-action-grid">
        <button class="cl-btn cl-btn-success" id="cl-register-in" type="button">Registrar entrada</button>
        <button class="cl-btn cl-btn-danger" id="cl-register-out" type="button">Registrar salida</button>
      </div>
      <div class="cl-action-grid">
        <button class="cl-btn cl-btn-outline" id="cl-use-full" type="button">Usar franco</button>
        <button class="cl-btn cl-btn-purple" id="cl-use-half" type="button">Medio franco</button>
      </div>
      ${date.getDay() === 6 ? `<div class="cl-action-grid"><button class="cl-btn cl-btn-secondary" id="cl-sat-mandatory">Sábado obligatorio</button><button class="cl-btn cl-btn-secondary" id="cl-sat-voluntary">Sábado voluntario</button></div>` : ""}
      ${holiday ? `<button class="cl-btn cl-btn-secondary cl-btn-full" id="cl-holiday-no-work">Registrar que no se trabajó por feriado</button>` : ""}
      <button class="cl-btn cl-btn-secondary cl-btn-full" id="cl-delete-day">Eliminar registro del día</button>
    </div>
    ${estimated ? `<div class="cl-note">Horario estimado: <strong>${escapeHtml(estimated.nombre)}</strong>. Se estima automáticamente con las últimas 3 jornadas; una marcación aislada diferente no cambia el turno.</div>` : `<div class="cl-note">Todavía no hay suficientes jornadas para estimar un turno. La aplicación no cambia de horario por una sola marcación diferente.</div>`}
    <div class="cl-note">Un toque en entrada/salida registra la hora actual. Si el botón ya tiene un registro, hacé triple toque para abrir la corrección. Las horas reales quedan conservadas por separado.</div>`);

  bindRegisterButton("cl-register-in", dateKey, "entrada", record);
  bindRegisterButton("cl-register-out", dateKey, "salida", record);
  document.getElementById("cl-use-full").addEventListener("click", () => useFullForDay(dateKey));
  document.getElementById("cl-use-half").addEventListener("click", () => openHalfOptions(dateKey));
  const satMandatory = document.getElementById("cl-sat-mandatory");
  const satVoluntary = document.getElementById("cl-sat-voluntary");
  if (satMandatory) satMandatory.addEventListener("click", () => { record.saturdayType = "mandatory"; record.saturdayClassification = "manual"; save(); closeModal(); openDayModal(dateKey); });
  if (satVoluntary) satVoluntary.addEventListener("click", () => { record.saturdayType = "voluntario"; record.saturdayClassification = "manual"; save(); closeModal(); openDayModal(dateKey); });
  const noWork = document.getElementById("cl-holiday-no-work");
  if (noWork) noWork.addEventListener("click", () => { record.holidayNoWork = true; save(); closeModal(); render(); });
  document.getElementById("cl-delete-day").addEventListener("click", () => {
    confirmAction("¿Eliminar todas las marcaciones y datos de prueba de este día? Esta acción está pensada para las pruebas actuales.", () => {
      rollbackLeaveUsageForDate(state, dateKey);
      delete state.records[dateKey];
      addAudit(state, "registro_dia_eliminado", { date: dateKey });
      save(); closeModal(); render();
    });
  });
  mainEditPunchHandlers(dateKey);
}

function mainEditPunchHandlers(dateKey) {
  document.querySelectorAll("[data-edit-punch]").forEach(btn => {
    btn.addEventListener("click", () => openCorrectionModal(dateKey, Number(btn.dataset.editPunch)));
  });
}

function bindRegisterButton(id, dateKey, type, record) {
  const button = document.getElementById(id);
  if (!button) return;
  const already = record.punches?.some(p => p.type === type);
  if (already) {
    button.classList.add("cl-btn-secondary");
    button.textContent = `✓ ${type === "entrada" ? "Entrada" : "Salida"} registrada`;
    button.setAttribute("aria-label", "Triple toque para corregir");
  }

  let taps = [];
  button.addEventListener("click", () => {
    const now = Date.now();
    taps = taps.filter(t => now - t < 800);
    taps.push(now);

    if (already) {
      if (taps.length >= 3) {
        taps = [];
        openCorrectionChoice(dateKey, type);
      }
      return;
    }

    // Un toque: abre una confirmación con la hora actual.
    // El registro se guarda recién al pulsar GUARDAR.
    if (taps.length === 1) {
      openAutomaticTimeModal(dateKey, type);
    }
  });
}

function openAutomaticTimeModal(dateKey, type) {
  const time = currentTime();
  openModal(`${modalHead(`Registrar ${type}`, "Hora actual del teléfono")}
    <div class="cl-card" style="text-align:center;box-shadow:none;margin:0;background:#f5f8fb">
      <div class="cl-muted cl-small">La hora actual es</div>
      <div style="font-size:34px;font-weight:850;margin-top:5px">${time}</div>
    </div>
    <div class="cl-modal-actions">
      <button class="cl-btn cl-btn-secondary" data-close-modal>Cancelar</button>
      <button class="cl-btn cl-btn-primary" id="cl-save-current">Guardar</button>
    </div>`);
  document.getElementById("cl-save-current").addEventListener("click", () => {
    savePunch(dateKey, type, time, "real");
  });
}

function savePunch(dateKey, type, time, source) {
  const record = state.records[dateKey] || { punches: [] };
  state.records[dateKey] = record;
  record.punches = record.punches || [];
  if (record.punches.some(p => p.type === type)) {
    closeModal();
    openDayModal(dateKey);
    return;
  }
  record.punches.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    type, time, referenceTime: time, source, timestamp: Date.now()
  });
  addAudit(state, "marcacion_registrada", { date: dateKey, type, time, source });
  save();
  closeModal();
  const suggestion = type === "entrada" ? suggestLateOrShift(state, dateFromKey(dateKey), time) : null;
  if (suggestion) openLateShiftModal(dateKey, suggestion);
  else openDayModal(dateKey);
}

function openCorrectionChoice(dateKey, type) {
  openModal(`${modalHead(`Corregir horario de ${type}` , "Triple toque detectado")}
    <p>Elegí cómo querés corregir esta marcación.</p>
    <div class="cl-action-stack">
      <button class="cl-btn cl-btn-outline cl-btn-full" id="cl-correct-now">Usar hora actual</button>
      <button class="cl-btn cl-btn-purple cl-btn-full" id="cl-correct-manual">Ingresar hora manualmente</button>
    </div>`);
  document.getElementById("cl-correct-now").addEventListener("click", () => applyCorrection(dateKey, type, currentTime(), "real"));
  document.getElementById("cl-correct-manual").addEventListener("click", () => openManualTimeModal(dateKey, type));
}

function openCorrectionModal(dateKey, index) {
  const record = state.records[dateKey];
  const punch = record?.punches?.[index];
  if (!punch) return;
  openCorrectionChoice(dateKey, punch.type);
}

function openManualTimeModal(dateKey, type) {
  openModal(`${modalHead(`Ingresar ${type} manualmente`)}
    <div class="cl-form-group"><label for="cl-manual-time">Hora</label><input id="cl-manual-time" class="cl-input" type="time" value="${escapeHtml(currentTime())}"></div>
    <div class="cl-modal-actions"><button class="cl-btn cl-btn-secondary" data-close-modal>Cancelar</button><button class="cl-btn cl-btn-primary" id="cl-save-time">Guardar</button></div>`);
  document.getElementById("cl-save-time").addEventListener("click", () => {
    const value = document.getElementById("cl-manual-time").value;
    if (minutesFromTime(value) === null) return alert("Ingresá una hora válida.");
    applyCorrection(dateKey, type, value, "manual");
  });
}

function applyCorrection(dateKey, type, time, source) {
  const record = state.records[dateKey];
  const target = record?.punches?.find(p => p.type === type);
  if (!target) return;
  const previous = { ...target };
  target.time = time;
  target.referenceTime = time;
  target.source = source;
  target.correctedAt = new Date().toISOString();
  addAudit(state, "marcacion_corregida", { date: dateKey, type, previous, current: target });
  save(); closeModal(); openDayModal(dateKey);
}

function openLateShiftModal(dateKey, suggestion) {
  openModal(`${modalHead("Revisar entrada")}
    <p>La entrada registrada es <strong>${timeFromMinutes(suggestion.actual)}</strong> y la referencia inferida es <strong>${timeFromMinutes(suggestion.usual)}</strong>.</p>
    <div class="cl-note cl-warning">Esto es solo una sospecha. Puede tratarse de una llegada tarde o de un cambio de turno.</div>
    <div class="cl-action-stack">
      <button class="cl-btn cl-btn-outline cl-btn-full" id="cl-late">Fue una llegada tarde</button>
      <button class="cl-btn cl-btn-purple cl-btn-full" id="cl-shift">Cambié de turno</button>
    </div>`);
  document.getElementById("cl-late").addEventListener("click", () => {
    state.records[dateKey].lateDecision = "tarde";
    state.records[dateKey].needsReview = true;
    save(); closeModal(); openDayModal(dateKey);
  });
  document.getElementById("cl-shift").addEventListener("click", () => openShiftModal(dateKey));
}

function openShiftModal(dateKey) {
  openModal(`${modalHead("Nuevo horario habitual")}
    <div class="cl-form-group"><label for="cl-shift-time">Nueva entrada habitual</label><input id="cl-shift-time" class="cl-input" type="time" value="08:00"></div>
    <div class="cl-modal-actions"><button class="cl-btn cl-btn-secondary" data-close-modal>Cancelar</button><button class="cl-btn cl-btn-primary" id="cl-save-shift">Guardar</button></div>`);
  document.getElementById("cl-save-shift").addEventListener("click", () => {
    const value = document.getElementById("cl-shift-time").value;
    if (minutesFromTime(value) === null) return alert("Ingresá una hora válida.");
    state.records[dateKey].lateDecision = "cambio_turno";
    state.records[dateKey].provisionalShift = value;
    addAudit(state, "cambio_turno", { date: dateKey, newReference: value });
    save(); closeModal(); openDayModal(dateKey);
  });
}

function openHalfOptions(dateKey) {
  const available = availableHalf(state).length;
  openModal(`${modalHead("Usar medio franco")}
    <p>¿Qué querés hacer?</p>
    <div class="cl-action-stack">
      <button class="cl-btn cl-btn-outline cl-btn-full" id="cl-one-half">Usar medio franco <span class="cl-muted">(${available} disponibles)</span></button>
      <button class="cl-btn cl-btn-success cl-btn-full" id="cl-three-halves">Cubrir el día <span class="cl-muted">(gasta 3 medios)</span></button>
    </div>
    <div class="cl-note">Para cubrir un día entero con medios francos se necesitan 3. Se permite adelantar solo el tercero si ya hay 2 disponibles. No se permiten 3 medios adelantados.</div>`);
  document.getElementById("cl-one-half").addEventListener("click", () => {
    state.records[dateKey] = state.records[dateKey] || { punches: [] };
    const result = useHalfLeave(state, dateKey);
    if (!result.ok) return alert(result.reason);
    state.records[dateKey].leaveMode = "medio_franco";
    save(); closeModal(); openDayModal(dateKey);
  });
  document.getElementById("cl-three-halves").addEventListener("click", () => {
    state.records[dateKey] = state.records[dateKey] || { punches: [] };
    const result = useThreeHalvesForFullDay(state, dateKey);
    if (!result.ok) return alert(result.reason);
    state.records[dateKey].leaveMode = "medio_franco_dia_completo";
    save(); closeModal(); openDayModal(dateKey);
  });
}

function useFullForDay(dateKey) {
  const result = useFullLeave(state, dateKey);
  if (!result.ok) return alert(result.reason);
  state.records[dateKey] = state.records[dateKey] || { punches: [] };
  state.records[dateKey].leaveMode = "franco_entero";
  save(); closeModal(); openDayModal(dateKey);
}

function renderSummaryScreen() {
  const cycle = calculateBillingCycle(state, new Date());
  main.innerHTML = renderSummary(state);
  bindSummaryDetailButtons(main, cycle);
}

function bindSummaryDetailButtons(root, cycle) {
  root.querySelectorAll("[data-summary-detail]").forEach(button => {
    bindDoubleTap(button, () => openSummaryDetail(button.dataset.summaryDetail, cycle));
  });
  root.querySelectorAll("[data-review-detail]").forEach(button => {
    bindDoubleTap(button, () => openReviewList(cycle));
  });
}

function openSummaryDetail(kind, cycle) {
  const rows = cycle.rows || [];
  let title = "Detalle";
  let items = [];

  if (kind === "jornales") {
    title = "Días computados como jornales";
    items = rows.filter(row => {
      if (row.record.leaveMode === "medio_franco") return true;
      if (row.calc.worked && (row.calc.sunday || row.calc.holidayWorked)) return true;
      return row.calc.countedMinutes >= 8 * 60 && !row.record.leaveMode;
    }).map(row => ({ date: row.key, detail: jornalReason(row) }));
  } else if (kind === "extra50") {
    title = "Días con horas extras al 50%";
    items = rows.filter(row => row.calc.extra50Minutes > 0).map(row => ({ date: row.key, detail: formatHours(row.calc.extra50Minutes) }));
  } else if (kind === "extra100") {
    title = "Días con horas extras al 100%";
    items = rows.filter(row => row.calc.extra100Minutes > 0).map(row => ({ date: row.key, detail: formatHours(row.calc.extra100Minutes) }));
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  const listHtml = items.length ? items.map(item => `
    <button type="button" class="cl-list-item cl-summary-detail-item" data-summary-date="${escapeHtml(item.date)}">
      <span class="cl-list-dot"></span>
      <span class="cl-list-content">
        <span class="cl-list-title">${escapeHtml(formatDate(item.date))}</span>
        <span class="cl-list-meta">${escapeHtml(item.detail)}</span>
      </span>
      <span>›</span>
    </button>`).join("") : `<div class="cl-note">No hay días registrados para este concepto en el ciclo.</div>`;

  openModal(`${modalHead(title)}
    <div class="cl-list">${listHtml}</div>
    <div class="cl-note">Doble toque sobre una fecha para abrir el registro de ese día en el calendario.</div>`);

  document.querySelectorAll("[data-summary-date]").forEach(button => {
    bindDoubleTap(button, () => goToCalendarDate(button.dataset.summaryDate));
  });
}

function jornalReason(row) {
  if (row.record.leaveMode === "medio_franco") return "Jornal cubierto con medio franco";
  if (row.calc.holidayWorked && row.calc.sunday) return "Domingo trabajado";
  if (row.calc.holidayWorked) return "Feriado trabajado";
  if (row.calc.sunday) return "Domingo trabajado";
  if (row.record.saturdayType === "voluntario") return "Sábado voluntario trabajado";
  if (row.record.saturdayType === "mandatory") return "Sábado obligatorio trabajado";
  return "Jornada normal trabajada";
}

function reviewReason(row) {
  const record = row.record || {};
  const calc = row.calc || {};
  if (record.lateDecision === "tarde") return "Llegada tarde marcada para revisión";
  if (record.lateDecision === "cambio_turno") return "Posible cambio de turno indicado";
  if (record.needsReview) return "Marcación indicada manualmente para revisión";
  if (!record.leaveMode && calc.referenceMinutes < calc.requiredMinutes) {
    const missing = Math.max(0, calc.requiredMinutes - calc.referenceMinutes);
    return `Jornada incompleta: faltan ${formatHours(missing)}`;
  }
  return "La jornada requiere revisión según las reglas de control";
}

function openReviewList(cycle) {
  const items = (cycle.rows || []).filter(row => row.calc.review).sort((a, b) => b.key.localeCompare(a.key));
  const listHtml = items.length ? items.map(row => `
    <button type="button" class="cl-list-item cl-summary-detail-item" data-review-date="${escapeHtml(row.key)}">
      <span class="cl-list-dot"></span>
      <span class="cl-list-content">
        <span class="cl-list-title">${escapeHtml(formatDate(row.key))}</span>
        <span class="cl-list-meta">${escapeHtml(reviewReason(row))}</span>
      </span>
      <span>›</span>
    </button>`).join("") : `<div class="cl-note">No hay revisiones en el ciclo.</div>`;

  openModal(`${modalHead("Días con revisión")}
    <div class="cl-list">${listHtml}</div>
    <div class="cl-note">Doble toque sobre una fecha para abrir el registro de ese día en el calendario.</div>`);

  document.querySelectorAll("[data-review-date]").forEach(button => {
    bindDoubleTap(button, () => goToCalendarDate(button.dataset.reviewDate));
  });
}

function renderLeavesScreen() {
  syncAllGenerated(state);
  save();
  const totals = leaveTotals(state);
  main.innerHTML = `
    <section class="cl-card"><h2>Control acumulativo</h2><div class="cl-muted cl-small">Se actualiza cada vez que se genera, usa o adeuda un franco.</div></section>
    <section class="cl-card"><h3>Francos enteros</h3>
      <div class="cl-grid-2">
        <div class="cl-stat"><div class="value">${totals.fullAvailable}</div><div class="label">Disponibles</div></div>
        <div class="cl-stat"><div class="value">${totals.fullDebt}</div><div class="label">Adeudados</div></div>
      </div>
      <button class="cl-btn cl-btn-outline cl-btn-full" style="margin-top:10px" id="cl-list-full">Ver días donde se generaron</button>
      <button class="cl-btn cl-btn-secondary cl-btn-full" style="margin-top:8px" id="cl-list-debt-full">Ver francos adeudados</button>
    </section>
    <section class="cl-card"><h3>Medios francos</h3>
      <div class="cl-grid-2">
        <div class="cl-stat"><div class="value">${totals.halfAvailable}</div><div class="label">Disponibles</div></div>
        <div class="cl-stat"><div class="value">${totals.halfDebt}</div><div class="label">Adeudados</div></div>
      </div>
      <button class="cl-btn cl-btn-outline cl-btn-full" style="margin-top:10px" id="cl-list-half">Ver días donde se generaron</button>
      <button class="cl-btn cl-btn-secondary cl-btn-full" style="margin-top:8px" id="cl-list-debt-half">Ver medios adeudados</button>
    </section>`;

  document.getElementById("cl-list-full").addEventListener("click", () => openLeaveList("Francos generados", state.leaves.fullGenerated, "franco"));
  document.getElementById("cl-list-half").addEventListener("click", () => openLeaveList("Medios francos generados", state.leaves.halfGenerated, "medio_franco"));
  document.getElementById("cl-list-debt-full").addEventListener("click", () => openLeaveList("Francos adeudados", state.leaves.fullDebt, "franco", true));
  document.getElementById("cl-list-debt-half").addEventListener("click", () => openLeaveList("Medios francos adeudados", state.leaves.halfDebt, "medio_franco", true));
}

function goToCalendarDate(dateKey) {
  const date = dateFromKey(dateKey);
  view.screen = "calendar";
  view.year = date.getFullYear();
  view.month = date.getMonth();
  view.selected = dateKey;
  closeModal();
  render();
  // Desde cualquier lista de francos, la fecha seleccionada debe abrir
  // directamente el mismo modal de entrada/salida que se abre desde
  // un doble toque en el calendario.
  openDayModal(dateKey);
}

function openLeaveDateDetail(item) {
  const generatedDate = item.date;
  const usedDate = item.usedOn;

  openModal(`${modalHead("Detalle del franco")}
    <section class="cl-card" style="box-shadow:none;margin:0;padding:4px 0">
      <button type="button" class="cl-detail-date" id="cl-generated-date">
        <span class="cl-detail-label">Fecha generada</span>
        <strong>${escapeHtml(formatDate(generatedDate))}</strong>
        <span class="cl-detail-hint">Doble toque para ir a ese día</span>
      </button>
      <button type="button" class="cl-detail-date" id="cl-used-date">
        <span class="cl-detail-label">Fecha usada</span>
        <strong>${escapeHtml(formatDate(usedDate))}</strong>
        <span class="cl-detail-hint">Doble toque para ir a ese día</span>
      </button>
    </section>`);

  bindDoubleTap(document.getElementById("cl-generated-date"), () => goToCalendarDate(generatedDate));
  bindDoubleTap(document.getElementById("cl-used-date"), () => goToCalendarDate(usedDate));
}

function bindDoubleTap(button, onDoubleTap) {
  if (!button) return;
  let lastTap = 0;
  button.addEventListener("click", () => {
    const now = Date.now();
    if (now - lastTap < 420) {
      lastTap = 0;
      onDoubleTap();
    } else {
      lastTap = now;
    }
  });
}

function openLeaveList(title, items, type, debts = false) {
  const sorted = [...items].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  const listHtml = sorted.length ? sorted.map(item => {
    const used = !debts && item.status === "usado";
    const cls = used ? " cl-list-item-used" : " cl-list-item-available";
    const statusText = debts ? "Pendiente / adelantado" : used ? `Usado el ${formatDate(item.usedOn)}` : "Disponible";
    const statusClass = used ? "cl-used-label" : "cl-available-label";
    const usedAttrs = used ? `data-used-date="${escapeHtml(item.usedOn)}"` : "";
    return `<button type="button" class="cl-list-item${cls}" data-leave-date="${escapeHtml(item.date)}" ${usedAttrs} data-leave-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(formatDate(item.date))}">
      <span class="cl-list-dot"></span>
      <span class="cl-list-content">
        <span class="cl-list-title">${escapeHtml(formatDate(item.date))}</span>
        <span class="cl-list-meta ${statusClass}">${escapeHtml(statusText)}</span>
      </span>
      <span>›</span>
    </button>`;
  }).join("") : `<div class="cl-note">No hay registros.</div>`;

  openModal(`${modalHead(title)}
    <div class="cl-list">${listHtml}</div>
    <div class="cl-note">Doble toque sobre un disponible para ir a la fecha generada. Doble toque sobre un usado para ver las fechas generada y usada.</div>`);

  document.querySelectorAll("[data-leave-date]").forEach(button => {
    bindDoubleTap(button, () => {
      const item = sorted.find(x => x.id === button.dataset.leaveId);
      if (!item) return;
      if (!debts && item.status === "usado" && item.usedOn) {
        openLeaveDateDetail(item);
      } else {
        goToCalendarDate(item.date);
      }
    });
  });
}

function renderHistoryScreen() {
  const audit = state.audit.slice(0, 100);
  main.innerHTML = `<section class="cl-card"><h2>Historial</h2><div class="cl-muted cl-small">Cambios de horarios, registros y movimientos de francos.</div></section>
    <section class="cl-card"><div class="cl-list">${audit.length ? audit.map(x => {
      const details = formatHistoryDetails(x);
      const stamp = new Date(x.timestamp).toLocaleString("es-AR");
      return `<div class="cl-list-item cl-history-item">
        <span class="cl-list-dot"></span>
        <span class="cl-list-content">
          <span class="cl-list-title">${escapeHtml(historyLabel(x.action))}</span>
          <span class="cl-list-meta">${escapeHtml(stamp)}</span>
          ${details ? `<span class="cl-history-detail">${details}</span>` : ""}
        </span>
      </div>`;
    }).join("") : `<div class="cl-note">Todavía no hay movimientos.</div>`}</div></section>`;
}

function historyDate(value) {
  if (!value) return "";
  const date = dateFromKey(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatDate(value);
}

function historyTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function formatHistoryDetails(item) {
  const d = item?.details || {};
  switch (item.action) {
    case "marcacion_registrada":
      return `Fecha: <strong>${escapeHtml(historyDate(d.date))}</strong> · ${d.type === "entrada" ? "Entrada" : "Salida"}: <strong>${escapeHtml(historyTime(d.time))}</strong>`;
    case "marcacion_corregida": {
      const previous = d.previous || {};
      const current = d.current || {};
      return `Fecha: <strong>${escapeHtml(historyDate(d.date))}</strong> · ${d.type === "entrada" ? "Entrada" : "Salida"}: <strong>${escapeHtml(historyTime(previous.time))}</strong> → <strong>${escapeHtml(historyTime(current.time))}</strong>`;
    }
    case "registro_dia_eliminado":
      return `Fecha eliminada: <strong>${escapeHtml(historyDate(d.date))}</strong>`;
    case "franco_generado":
      return `Fecha generada: <strong>${escapeHtml(historyDate(d.date))}</strong>${d.reason ? ` · ${escapeHtml(d.reason)}` : ""}`;
    case "franco_usado":
      return `Fecha generada: <strong>${escapeHtml(historyDate(d.generatedDate))}</strong> · Fecha usada: <strong>${escapeHtml(historyDate(d.usedOn))}</strong>`;
    case "franco_adeudado":
      return `Fecha usada/adeudada: <strong>${escapeHtml(historyDate(d.date))}</strong>${d.reason ? ` · ${escapeHtml(d.reason)}` : ""}`;
    case "medio_franco_generado":
      return `Fecha generada: <strong>${escapeHtml(historyDate(d.date))}</strong>${d.reason ? ` · ${escapeHtml(d.reason)}` : ""}`;
    case "medio_franco_usado":
      return `Fecha generada: <strong>${escapeHtml(historyDate(d.generatedDate))}</strong> · Fecha usada: <strong>${escapeHtml(historyDate(d.usedOn))}</strong>`;
    case "medio_franco_adeudado":
      return `Fecha usada/adeudada: <strong>${escapeHtml(historyDate(d.date))}</strong>${d.reason ? ` · ${escapeHtml(d.reason)}` : ""}`;
    case "tres_medios_usados":
      return `Fecha cubierta: <strong>${escapeHtml(historyDate(d.date))}</strong> · ${d.adelantado ? "1 medio fue adelantado" : "3 medios disponibles"}`;
    case "cambio_turno":
      return `Fecha: <strong>${escapeHtml(historyDate(d.date))}</strong> · Nueva entrada habitual: <strong>${escapeHtml(historyTime(d.newReference))}</strong>`;
    case "deuda_compensada":
      return `${d.type === "franco" ? "Franco" : "Medio franco"} · deuda compensada`;
    case "configuracion_actualizada":
      return `Se actualizaron las preferencias de la aplicación.`;
    case "consumos_francos_revertidos":
      return `Fecha: <strong>${escapeHtml(historyDate(d.date))}</strong> · Se revirtieron consumos asociados a pruebas.`;
    default:
      return "";
  }
}

function historyLabel(action) {
  return ({
    marcacion_registrada: "Registro de horario",
    marcacion_corregida: "Corrección de horario",
    registro_dia_eliminado: "Eliminación de registro",
    franco_generado: "Franco generado",
    franco_usado: "Franco usado",
    franco_adeudado: "Franco adelantado / adeudado",
    medio_franco_generado: "Medio franco generado",
    medio_franco_usado: "Medio franco usado",
    medio_franco_adeudado: "Medio franco adelantado / adeudado",
    tres_medios_usados: "Tres medios francos aplicados",
    cambio_turno: "Cambio de turno",
    deuda_compensada: "Deuda compensada",
    configuracion_actualizada: "Configuración actualizada",
    consumos_francos_revertidos: "Consumos de francos revertidos"
  })[action] || action;
}

function renderSettings() {
  const draft = {
    tolerance: Number(state.settings.tolerance ?? CONFIG.TOLERANCIA_MINUTOS),
    roundIn: state.settings.roundIn ?? CONFIG.REDONDEO_ENTRADA,
    roundOut: state.settings.roundOut ?? CONFIG.REDONDEO_SALIDA,
    feriadoExcesoGeneraFranco: Boolean(state.settings.feriadoExcesoGeneraFranco ?? CONFIG.FERIADO_EXCESO_GENERA_FRANCO),
    theme: state.settings.theme === "dark" ? "dark" : "light"
  };

  openModal(`${modalHead("Configuración")}
    <section class="cl-card" style="box-shadow:none;margin:0 0 10px"><h3>Reglas laborales</h3>
      <div class="cl-form-group"><label>Jornal normal</label><input class="cl-input" value="${CONFIG.JORNAL_NORMAL_HORAS}" disabled></div>
      <div class="cl-form-group"><label>Tolerancia (minutos)</label><input id="cl-setting-tolerance" class="cl-input" type="number" min="0" value="${draft.tolerance}"></div>
      <div class="cl-form-group"><label>Redondeo de entrada</label><select id="cl-setting-round-in" class="cl-input"><option value="ninguno">Sin redondeo</option><option value="abajo">Abajo</option><option value="arriba">Arriba</option><option value="cercano">Más cercano</option></select></div>
      <div class="cl-form-group"><label>Redondeo de salida</label><select id="cl-setting-round-out" class="cl-input"><option value="ninguno">Sin redondeo</option><option value="abajo">Abajo</option><option value="arriba">Arriba</option><option value="cercano">Más cercano</option></select></div>
      <div class="cl-form-group"><label>Feriado trabajado genera franco si supera 8 h</label><select id="cl-setting-holiday-leave" class="cl-input"><option value="false">No</option><option value="true">Sí</option></select></div>
    </section>
    <section class="cl-card" style="box-shadow:none;margin:0 0 10px"><h3>Apariencia</h3>
      <div class="cl-form-group"><label for="cl-setting-theme">Tema de la aplicación</label><select id="cl-setting-theme" class="cl-input"><option value="light">Modo claro</option><option value="dark">Modo oscuro</option></select></div>
      <div class="cl-note">El tema modifica solamente la apariencia. Tus registros y cálculos no cambian.</div>
    </section>
    <section class="cl-card" style="box-shadow:none;margin:0"><h3>Datos</h3>
      <button class="cl-btn cl-btn-outline cl-btn-full" id="cl-export">Exportar respaldo JSON</button>
      <label class="cl-btn cl-btn-secondary cl-btn-full" style="display:block;text-align:center;margin-top:8px;cursor:pointer">Importar respaldo <input id="cl-import" type="file" accept="application/json" hidden></label>
      <button class="cl-btn cl-btn-secondary cl-btn-full" id="cl-show-tutorial" type="button" style="margin-top:8px">Ver tutorial nuevamente</button>
      <div class="cl-note cl-danger-note">El almacenamiento local no sincroniza automáticamente entre dispositivos. Borrar los datos del navegador puede provocar pérdida de información si no tenés un respaldo.</div>
    </section>
    <div class="cl-modal-actions">
      <button class="cl-btn cl-btn-secondary" id="cl-settings-cancel" type="button">Cancelar</button>
      <button class="cl-btn cl-btn-primary" id="cl-settings-save" type="button">Guardar</button>
    </div>`);

  const rIn = document.getElementById("cl-setting-round-in");
  const rOut = document.getElementById("cl-setting-round-out");
  const holidayLeave = document.getElementById("cl-setting-holiday-leave");
  const theme = document.getElementById("cl-setting-theme");
  rIn.value = draft.roundIn;
  rOut.value = draft.roundOut;
  holidayLeave.value = String(draft.feriadoExcesoGeneraFranco);
  theme.value = draft.theme;
  theme.addEventListener("change", () => applyTheme(theme.value));

  document.getElementById("cl-settings-cancel").addEventListener("click", () => { applyTheme(draft.theme); closeModal(); });
  document.getElementById("cl-settings-save").addEventListener("click", () => {
    state.settings.tolerance = Math.max(0, Number(document.getElementById("cl-setting-tolerance").value) || 0);
    state.settings.roundIn = rIn.value;
    state.settings.roundOut = rOut.value;
    state.settings.feriadoExcesoGeneraFranco = holidayLeave.value === "true";
    state.settings.theme = theme.value === "dark" ? "dark" : "light";
    addAudit(state, "configuracion_actualizada", { ...state.settings });
    save();
    applyTheme(state.settings.theme);
    closeModal();
    render();
  });

  document.getElementById("cl-export").addEventListener("click", () => exportState(state));
  document.getElementById("cl-import").addEventListener("change", async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const imported = await importState(file);
      if (!confirm("Esto reemplazará los datos actuales de esta app. ¿Continuar?")) return;
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, imported);
      applyTheme(state.settings.theme);
      save(); closeModal(); render();
    } catch (error) { alert(error.message); }
  });

  document.getElementById("cl-show-tutorial").addEventListener("click", () => {
    closeModal();
    resetTutorial();
    setTimeout(() => startTutorial({ onNavigate: (screen) => { view.screen = screen; render(); }, openSettings: renderSettings, closeModal }), 80);
  });
}

document.querySelectorAll(".cl-nav-btn").forEach(btn => btn.addEventListener("click", () => { view.screen = btn.dataset.screen; render(); }));
document.getElementById("btn-settings").addEventListener("click", renderSettings);

// Actualización automática de archivos de la aplicación.
// La versión se guarda separada de los registros: actualizar archivos
// nunca borra los datos personales guardados en localStorage.
async function comprobarVersionYActualizar() {
  const VERSION_KEY = "control_laboral_app_version";
  const instalada = localStorage.getItem(VERSION_KEY);
  localStorage.setItem(VERSION_KEY, VERSION_APP);
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    await registration.update();
    if (instalada && instalada !== VERSION_APP) sessionStorage.setItem("control_laboral_actualizacion_pendiente", "1");
  } catch (error) {
    console.warn("No se pudo comprobar la actualización de la aplicación:", error);
  }
}

navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (sessionStorage.getItem("control_laboral_actualizacion_pendiente") === "1") {
    sessionStorage.removeItem("control_laboral_actualizacion_pendiente");
    window.location.reload();
  }
});

applyTheme(state.settings.theme || "light");
comprobarVersionYActualizar();
updateExternalHolidays(state).then(result => { if (result.updated) { save(); if (view.screen === "calendar") render(); } });

render();
setTimeout(() => startTutorial({
  onNavigate: (screen) => { view.screen = screen; render(); },
  openSettings: renderSettings,
  closeModal
}), 250);
