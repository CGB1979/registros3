import { MESES, CONFIG } from "./config.js";
import { calculateDay, isoDate } from "./time.js";
import { getHolidays } from "./holidays.js";
import { leaveTotals } from "./leaves.js";

export function billingRange(date = new Date()) {
  const startDay = CONFIG.DIA_INICIO_FACTURACION;
  const start = new Date(date.getFullYear(), date.getMonth(), startDay);
  if (date.getDate() < startDay) start.setMonth(start.getMonth() - 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, startDay - 1);
  return { start, end };
}

export function monthRecords(state, year, month) {
  const holidays = getHolidays(state, year);
  const days = new Date(year, month + 1, 0).getDate();
  const result = [];
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, month, d);
    const key = isoDate(date);
    const record = state.records[key];
    if (!record) continue;
    result.push({ key, date, record, calc: calculateDay(record, date, holidays[key], state.settings), holiday: holidays[key] });
  }
  return result;
}

export function calculateMonth(state, year, month) {
  const rows = monthRecords(state, year, month);
  const totals = { real: 0, counted: 0, extra50: 0, extra100: 0, jornales: 0, reviews: 0, holidayWorked: 0, holidayNotWorked: 0 };
  for (const row of rows) {
    totals.real += row.calc.realMinutes;
    totals.counted += row.calc.countedMinutes;
    totals.extra50 += row.calc.extra50Minutes;
    totals.extra100 += row.calc.extra100Minutes;
    if (row.record.leaveMode === "medio_franco") totals.jornales += 1;
    else if (row.calc.worked && (row.calc.sunday || row.calc.holidayWorked)) totals.jornales += 1;
    else if (row.calc.countedMinutes >= 8 * 60 && !row.record.leaveMode) totals.jornales += 1;
    if (row.calc.review) totals.reviews += 1;
    if (row.holiday && row.calc.worked) totals.holidayWorked += 1;
    if (row.holiday && !row.calc.worked) totals.holidayNotWorked += 1;
  }
  return { rows, totals };
}

export function calculateBillingCycle(state, date = new Date()) {
  const { start, end } = billingRange(date);
  const totals = { real: 0, counted: 0, extra50: 0, extra100: 0, jornales: 0, reviews: 0, holidayWorked: 0, holidayNotWorked: 0 };
  const rows = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = isoDate(cursor);
    const record = state.records[key];
    const holidays = getHolidays(state, cursor.getFullYear());
    if (record) {
      const holiday = holidays[key];
      const calc = calculateDay(record, new Date(cursor), holiday, state.settings);
      const row = { key, date: new Date(cursor), record, calc, holiday };
      rows.push(row);
      totals.real += calc.realMinutes;
      totals.counted += calc.countedMinutes;
      totals.extra50 += calc.extra50Minutes;
      totals.extra100 += calc.extra100Minutes;
      if (record.leaveMode === "medio_franco") totals.jornales += 1;
      else if (calc.worked && (calc.sunday || calc.holidayWorked)) totals.jornales += 1;
      else if (calc.countedMinutes >= 8 * 60 && !record.leaveMode) totals.jornales += 1;
      if (calc.review) totals.reviews += 1;
      if (holiday && calc.worked) totals.holidayWorked += 1;
      if (holiday && !calc.worked) totals.holidayNotWorked += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { start, end, rows, totals };
}

export function renderSummary(state, date = new Date()) {
  const { start, end, totals } = calculateBillingCycle(state, date);
  const leaves = leaveTotals(state);

  return `
    <section class="cl-card">
      <div class="cl-row"><div><h2>Resumen del mes</h2><div class="cl-muted cl-small">${start.toLocaleDateString("es-AR")} al ${end.toLocaleDateString("es-AR")}</div></div><span class="cl-muted cl-small">Facturación en curso</span></div>
    </section>
    <section class="cl-card">
      <h3>Jornales</h3>
      <button type="button" class="cl-stat cl-stat-action" data-summary-detail="jornales"><div class="value">${totals.jornales}</div><div class="label">jornales enteros de 8 horas</div></button>
    </section>
    <section class="cl-card">
      <h3>Horas extras</h3>
      <div class="cl-grid-2">
        <button type="button" class="cl-stat cl-stat-action" data-summary-detail="extra50"><div class="value">${formatHours(totals.extra50)}</div><div class="label">Al 50 %</div></button>
        <button type="button" class="cl-stat cl-stat-action" data-summary-detail="extra100"><div class="value">${formatHours(totals.extra100)}</div><div class="label">Al 100 %</div></button>
      </div>
    </section>
    <section class="cl-card">
      <h3>Control de jornada</h3>
      <div class="cl-grid-2">
        <div class="cl-stat"><div class="value">${formatHours(totals.real)}</div><div class="label">Horas reales</div></div>
        <div class="cl-stat"><div class="value">${formatHours(totals.counted)}</div><div class="label">Horas computadas</div></div>
        <button type="button" class="cl-stat cl-stat-action" data-review-detail><div class="value">${totals.reviews}</div><div class="label">Revisiones</div></button>
        <div class="cl-stat"><div class="value">${totals.holidayWorked}</div><div class="label">Feriados trabajados</div></div>
      </div>
    </section>
    <section class="cl-card">
      <h3>Francos acumulados</h3>
      <div class="cl-grid-2">
        <div class="cl-stat"><div class="value">${leaves.fullAvailable}</div><div class="label">Francos disponibles</div></div>
        <div class="cl-stat"><div class="value">${leaves.halfAvailable}</div><div class="label">Medios disponibles</div></div>
      </div>
    </section>
    <div class="cl-note">Las horas reales se conservan separadas de las horas computadas. El resumen de jornales muestra cantidad de jornales, no horas.</div>
  `;
}

export function formatHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2,"0")}`;
}
