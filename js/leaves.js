import { addAudit, saveState } from "./storage.js";
import { isoDate, calculateDay } from "./time.js";
import { getHolidays } from "./holidays.js";
import { CONFIG } from "./config.js";

function newItem(type, date, source = "generado") {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    type,
    date,
    status: "disponible",
    source,
    createdAt: new Date().toISOString(),
    usedOn: null
  };
}

function billingCycleKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const startDay = CONFIG.DIA_INICIO_FACTURACION;
  const start = new Date(date.getFullYear(), date.getMonth(), startDay);
  if (date.getDate() < startDay) start.setMonth(start.getMonth() - 1);
  return isoDate(start);
}

/**
 * Clasifica los sábados trabajados dentro de cada ciclo de facturación.
 * En cada ciclo, los primeros N sábados trabajados son obligatorios y los
 * siguientes son voluntarios. Una clasificación manual prevalece.
 */
export function syncSaturdayClassifications(state) {
  const groups = new Map();

  for (const [dateKey, record] of Object.entries(state.records || {})) {
    if (!record?.punches?.length) continue;
    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getDay() !== 6) continue;

    const cycle = billingCycleKey(dateKey);
    if (!groups.has(cycle)) groups.set(cycle, []);
    groups.get(cycle).push({ dateKey, record });
  }

  for (const items of groups.values()) {
    items.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    let mandatoryCount = 0;

    // Las clasificaciones manuales quedan intactas. Todas las demás se
    // calculan nuevamente dentro de su ciclo 25 -> 24.
    for (const item of items) {
      if (item.record.saturdayClassification === "manual") {
        if (item.record.saturdayType === "mandatory") mandatoryCount++;
        continue;
      }
      item.record.saturdayType = mandatoryCount < CONFIG.CANTIDAD_SABADOS_OBLIGATORIOS
        ? "mandatory"
        : "voluntario";
      item.record.saturdayClassification = "provisional";
      if (item.record.saturdayType === "mandatory") mandatoryCount++;
    }
  }
}
/**
 * Genera todos los francos/medios que correspondan a los registros existentes.
 * Es acumulativo: nunca vuelve a crear el mismo beneficio para una fecha.
 */
export function syncAllGenerated(state) {
  syncSaturdayClassifications(state);

  const entries = Object.entries(state.records || {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [dateKey, record] of entries) {
    if (!record?.punches?.length) continue;

    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const holiday = getHolidays(state, y)[dateKey];
    const dayCalc = calculateDay(record, date, holiday, state.settings);
    syncGeneratedForDay(state, dateKey, dayCalc);
  }
}

export function syncGeneratedForDay(state, dateKey, dayCalc) {
  if (!dayCalc.worked) return;
  const record = state.records[dateKey];
  if (record?.leaveMode) return;

  if (dayCalc.sunday && !state.leaves.fullGenerated.some(x => x.date === dateKey)) {
    state.leaves.fullGenerated.push(newItem("franco", dateKey));
    addAudit(state, "franco_generado", { date: dateKey, reason: "domingo trabajado" });
  }

  if (dayCalc.holidayWorked && !dayCalc.sunday && dayCalc.feriadoExcesoGeneraFranco &&
      dayCalc.referenceMinutes > CONFIG.JORNAL_NORMAL_HORAS * 60 &&
      !state.leaves.fullGenerated.some(x => x.date === dateKey)) {
    state.leaves.fullGenerated.push(newItem("franco", dateKey));
    addAudit(state, "franco_generado", { date: dateKey, reason: "feriado trabajado: supera 8 h y la opción está habilitada" });
  }

  if (dayCalc.saturday && record?.saturdayType === "voluntario" &&
      !state.leaves.halfGenerated.some(x => x.date === dateKey)) {
    state.leaves.halfGenerated.push(newItem("medio_franco", dateKey));
    addAudit(state, "medio_franco_generado", { date: dateKey, reason: "sábado voluntario trabajado" });
  }
}

function oldestAvailable(items) {
  return items
    .filter(x => x.status === "disponible")
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt))[0] || null;
}

export function availableFull(state) {
  return state.leaves.fullGenerated.filter(x => x.status === "disponible");
}
export function availableHalf(state) {
  return state.leaves.halfGenerated.filter(x => x.status === "disponible");
}
export function debtFull(state) { return state.leaves.fullDebt.filter(x => x.status === "pendiente"); }
export function debtHalf(state) { return state.leaves.halfDebt.filter(x => x.status === "pendiente"); }

export function useFullLeave(state, dateKey) {
  syncAllGenerated(state);
  const item = oldestAvailable(state.leaves.fullGenerated);
  if (item) {
    item.status = "usado";
    item.usedOn = dateKey;
    state.leaves.fullUsed.push({ ...item });
    addAudit(state, "franco_usado", { generatedDate: item.date, usedOn: dateKey });
    return { ok: true, source: "disponible" };
  }

  const debt = newItem("franco", dateKey, "adelantado");
  debt.status = "pendiente";
  state.leaves.fullDebt.push(debt);
  addAudit(state, "franco_adeudado", { date: dateKey, reason: "franco adelantado sin disponible" });
  return { ok: true, source: "adelantado" };
}

export function useHalfLeave(state, dateKey) {
  syncAllGenerated(state);
  const item = oldestAvailable(state.leaves.halfGenerated);
  if (item) {
    item.status = "usado";
    item.usedOn = dateKey;
    state.leaves.halfUsed.push({ ...item });
    addAudit(state, "medio_franco_usado", { generatedDate: item.date, usedOn: dateKey });
    return { ok: true, source: "disponible" };
  }

  const debt = newItem("medio_franco", dateKey, "adelantado");
  debt.status = "pendiente";
  state.leaves.halfDebt.push(debt);
  addAudit(state, "medio_franco_adeudado", { date: dateKey, reason: "medio franco adelantado sin disponible" });
  return { ok: true, source: "adelantado" };
}

export function useThreeHalvesForFullDay(state, dateKey) {
  syncAllGenerated(state);
  const available = availableHalf(state).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (available.length < 2) {
    return {
      ok: false,
      reason: "Se necesitan al menos 2 medios francos disponibles para cubrir un día entero con un tercero adelantado."
    };
  }

  const toUse = available.slice(0, 2);
  for (const item of toUse) {
    item.status = "usado";
    item.usedOn = dateKey;
    state.leaves.halfUsed.push({ ...item });
  }

  const third = available[2];
  if (third) {
    third.status = "usado";
    third.usedOn = dateKey;
    state.leaves.halfUsed.push({ ...third });
    addAudit(state, "tres_medios_usados", { date: dateKey, adelantado: false });
    return { ok: true, advanced: false };
  }

  const debt = newItem("medio_franco", dateKey, "adelantado_para_cubrir_dia");
  debt.status = "pendiente";
  state.leaves.halfDebt.push(debt);
  addAudit(state, "tres_medios_usados", { date: dateKey, adelantado: true });
  return { ok: true, advanced: true };
}


/**
 * Revierte los consumos de francos/medios asociados a un día que se elimina
 * durante las pruebas. Solo revierte movimientos cuyo usedOn coincide con
 * dateKey y elimina las deudas adelantadas creadas para ese día.
 */
export function rollbackLeaveUsageForDate(state, dateKey) {
  const restoreGenerated = (generated, type) => {
    const restoredIds = new Set();
    for (const item of generated) {
      if (item.status === "usado" && item.usedOn === dateKey) {
        item.status = "disponible";
        item.usedOn = null;
        restoredIds.add(item.id);
      }
    }
    return restoredIds;
  };

  restoreGenerated(state.leaves.fullGenerated, "franco");
  restoreGenerated(state.leaves.halfGenerated, "medio_franco");

  state.leaves.fullUsed = state.leaves.fullUsed.filter(item => item.usedOn !== dateKey);
  state.leaves.halfUsed = state.leaves.halfUsed.filter(item => item.usedOn !== dateKey);

  // Si se elimina el día que ORIGINÓ un franco/medio franco, ese beneficio
  // también debe desaparecer. Esto es importante en las pruebas: no alcanza
  // con borrar el registro del calendario porque syncAllGenerated es
  // acumulativo y no debe dejar beneficios huérfanos.
  const fullGeneratedIds = new Set(
    state.leaves.fullGenerated.filter(item => item.date === dateKey).map(item => item.id)
  );
  const halfGeneratedIds = new Set(
    state.leaves.halfGenerated.filter(item => item.date === dateKey).map(item => item.id)
  );

  state.leaves.fullGenerated = state.leaves.fullGenerated.filter(item => item.date !== dateKey);
  state.leaves.halfGenerated = state.leaves.halfGenerated.filter(item => item.date !== dateKey);

  // Si alguno de esos beneficios ya había sido usado en otra fecha,
  // también se elimina ese consumo porque su origen dejó de existir.
  state.leaves.fullUsed = state.leaves.fullUsed.filter(item => !fullGeneratedIds.has(item.id));
  state.leaves.halfUsed = state.leaves.halfUsed.filter(item => !halfGeneratedIds.has(item.id));

  // Las deudas adelantadas nacidas de este día también se revierten.
  state.leaves.fullDebt = state.leaves.fullDebt.filter(item => !(item.date === dateKey && item.source === "adelantado"));
  state.leaves.halfDebt = state.leaves.halfDebt.filter(item => !(item.date === dateKey && (item.source === "adelantado" || item.source === "adelantado_para_cubrir_dia")));

  addAudit(state, "consumos_francos_revertidos", { date: dateKey });
}

export function markDebtPaid(state, debtId, type) {
  const list = type === "franco" ? state.leaves.fullDebt : state.leaves.halfDebt;
  const item = list.find(x => x.id === debtId && x.status === "pendiente");
  if (!item) return false;
  item.status = "compensada";
  item.compensatedAt = new Date().toISOString();
  addAudit(state, "deuda_compensada", { type, debtId });
  return true;
}

export function leaveTotals(state) {
  return {
    fullGenerated: state.leaves.fullGenerated.length,
    fullUsed: state.leaves.fullUsed.length,
    fullAvailable: availableFull(state).length,
    halfGenerated: state.leaves.halfGenerated.length,
    halfUsed: state.leaves.halfUsed.length,
    halfAvailable: availableHalf(state).length,
    fullDebt: debtFull(state).length,
    halfDebt: debtHalf(state).length
  };
}

export function persistLeaves(state) { saveState(state); }
