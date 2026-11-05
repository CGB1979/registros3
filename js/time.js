import { CONFIG } from "./config.js";
import { horarioMasCercano, detectarHorarioHabitual } from "./horarios.js";

export function minutesFromTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || "")) return null;
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function timeFromMinutes(total) {
  const safe = Math.max(0, Math.round(total));
  const h = Math.floor(safe / 60) % 24;
  const m = safe % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

export function roundMinutes(value, mode, step = CONFIG.REDONDEO_MINUTOS) {
  if (mode === "ninguno" || !step) return value;
  if (mode === "abajo") return Math.floor(value / step) * step;
  if (mode === "arriba") return Math.ceil(value / step) * step;
  return Math.round(value / step) * step;
}

export function referenceMinutes(realMinutes, type) {
  const mode = type === "entrada" ? CONFIG.REDONDEO_ENTRADA : CONFIG.REDONDEO_SALIDA;
  return roundMinutes(realMinutes, mode);
}

export function buildIntervals(record) {
  const punches = [...(record?.punches || [])].sort((a,b) => a.timestamp - b.timestamp);
  const intervals = [];
  let pendingIn = null;
  for (const punch of punches) {
    if (punch.type === "entrada") {
      if (pendingIn === null) pendingIn = punch;
    } else if (punch.type === "salida" && pendingIn) {
      const start = minutesFromTime(pendingIn.time);
      const end = minutesFromTime(punch.time);
      if (start !== null && end !== null && end >= start) intervals.push({ start, end, sourceIn: pendingIn, sourceOut: punch });
      pendingIn = null;
    }
  }
  return intervals;
}

export function realWorkedMinutes(record) {
  return buildIntervals(record).reduce((sum, x) => sum + (x.end - x.start), 0);
}

export function effectiveReferenceMinutes(record) {
  return buildIntervals(record).reduce((sum, x) => {
    const start = referenceMinutes(x.start, "entrada");
    const end = referenceMinutes(x.end, "salida");
    return sum + Math.max(0, end - start);
  }, 0);
}

export function isSunday(date) { return date.getDay() === 0; }
export function isSaturday(date) { return date.getDay() === 6; }
export function iso(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
export const isoDate = iso;
export function classifySaturday(record) { return record?.saturdayType || null; }

export function roundExtraMinutes(minutes, tolerance = CONFIG.TOLERANCIA_REDONDEO_EXTRA_MINUTOS) {
  const value = Math.max(0, Math.round(minutes || 0));
  if (!value) return 0;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (remainder <= tolerance) return hours * 60;
  if (remainder >= 60 - tolerance) return (hours + 1) * 60;
  return Math.round(value / 60) * 60;
}

export function roundExtraBuckets(extra50, extra100) {
  const total = Math.max(0, (extra50 || 0) + (extra100 || 0));
  if (!total) return { extra50: 0, extra100: 0 };
  const roundedTotal = roundExtraMinutes(total);
  if (!roundedTotal) return { extra50: 0, extra100: 0 };
  const raw50 = Math.max(0, extra50 || 0), raw100 = Math.max(0, extra100 || 0);
  if (!raw50) return { extra50: 0, extra100: roundedTotal };
  if (!raw100) return { extra50: roundedTotal, extra100: 0 };
  const rounded50 = roundExtraMinutes(raw50), rounded100 = roundExtraMinutes(raw100);
  if (rounded50 + rounded100 === roundedTotal) return { extra50: rounded50, extra100: rounded100 };
  const base50 = Math.floor(raw50 / 60) * 60;
  return { extra50: Math.min(base50, roundedTotal), extra100: Math.max(0, roundedTotal - base50) };
}

export function estimatedSchedule(state, date) {
  const dateKey = iso(date), habitual = detectarHorarioHabitual(state, dateKey);
  if (habitual) return habitual;
  const entry = state?.records?.[dateKey]?.punches?.filter(p => p.type === "entrada").sort((a,b) => a.timestamp - b.timestamp)[0];
  if (!entry) return null;
  return horarioMasCercano(minutesFromTime(entry.referenceTime || entry.time));
}

function estimatedScheduleFromRecord(record, date) {
  const entry = record?.punches?.filter(p => p.type === "entrada").sort((a,b) => a.timestamp - b.timestamp)[0];
  if (!entry) return null;
  return horarioMasCercano(minutesFromTime(entry.referenceTime || entry.time));
}

// Para las horas computadas, una entrada anterior al turno no adelanta el
// inicio del cómputo. Las horas reales siguen saliendo de las marcaciones
// originales y no se modifican. Se usa el turno estimado existente, nunca
// una hora fija como 08:00.
function referenceIntervals(record, schedule) {
  const scheduledStart = schedule ? minutesFromTime(schedule.entrada) : null;
  return buildIntervals(record).map(interval => {
    let start = referenceMinutes(interval.start, "entrada");
    const end = referenceMinutes(interval.end, "salida");
    if (scheduledStart !== null) start = Math.max(start, scheduledStart);
    return { start, end: Math.max(start, end) };
  }).filter(interval => interval.end > interval.start);
}

export function calculateDay(record, date, holiday, settings = {}) {
  const real = realWorkedMinutes(record);
  const schedule = estimatedScheduleFromRecord(record, date);
  const referenceIntervalsForDay = referenceIntervals(record, schedule);
  const reference = referenceIntervalsForDay.reduce((sum, interval) => sum + interval.end - interval.start, 0);
  const hasWork = real > 0;
  const sunday = isSunday(date), saturday = isSaturday(date);
  const holidayWorked = !!holiday && hasWork;
  const feriadoExcesoGeneraFranco = settings.feriadoExcesoGeneraFranco ?? CONFIG.FERIADO_EXCESO_GENERA_FRANCO;
  let required = CONFIG.JORNAL_NORMAL_HORAS * 60, counted = 0, extra50 = 0, extra100 = 0, review = false;
  const leaveMode = record?.leaveMode || null;

  if (record?.leaveMode === "franco_entero") {
    counted = required;
  } else if (record?.leaveMode === "medio_franco") {
    required = CONFIG.JORNADA_MEDIO_FRANCO_HORAS * 60;
    counted = required;
    if (CONFIG.HORAS_EXTRAS_DESPUES_DE_MEDIO_FRANCO && reference > required) extra50 = reference - required;
  } else if (record?.leaveMode === "medio_franco_dia_completo") {
    counted = required;
  } else if (sunday || holidayWorked) {
    counted = required;
    extra100 = roundExtraMinutes(reference);
  } else if (saturday) {
    const type = record?.saturdayType || "provisional";
    if (type === "voluntario") {
      const before13 = referenceIntervalsForDay.reduce((sum, interval) => sum + Math.max(0, Math.min(interval.end, 13 * 60) - Math.max(interval.start, 0)), 0);
      const after13 = Math.max(0, reference - before13);
      extra50 = before13;
      extra100 = after13;
      counted = reference;
    } else {
      counted = Math.min(reference, CONFIG.JORNAL_SABADO_OBLIGATORIO * 60);
      const overtime = distributeSaturdayOvertime(referenceIntervalsForDay, reference);
      extra50 = overtime.before13;
      extra100 = overtime.after13;
    }
  } else {
    const scheduledEnd = schedule ? minutesFromTime(schedule.salida) : null;
    if (scheduledEnd !== null) {
      const intervals = buildIntervals(record);
      const lastEnd = intervals.reduce((max, x) => Math.max(max, x.end), -Infinity);
      const effectiveEnd = Number.isFinite(lastEnd) ? lastEnd : reference;
      counted = Math.min(reference, required);
      if (effectiveEnd > scheduledEnd) extra50 = roundExtraMinutes(effectiveEnd - scheduledEnd);
    } else {
      counted = Math.min(reference, required);
      extra50 = Math.max(0, reference - required);
    }
  }

  // Regla especial del turno 06:00-14:00, conservada sin cambios.
  if (!leaveMode && hasWork && schedule?.id === "06-14" && !sunday && !holidayWorked && !saturday) {
    const specialEnd = minutesFromTime(schedule.salida);
    const specialMinimum = minutesFromTime(schedule.salidaMinimaJornal || "13:30");
    const lastEnd = buildIntervals(record).reduce((max, x) => Math.max(max, x.end), 0);
    if (lastEnd >= specialMinimum && lastEnd <= specialEnd) {
      counted = required; extra50 = 0; extra100 = 0;
    } else if (lastEnd > specialEnd) {
      counted = required; extra50 = roundExtraMinutes(lastEnd - specialEnd); extra100 = 0;
    } else if (lastEnd < specialMinimum) counted = Math.min(required, reference);
  }

  // Redondear las extras del sábado por ciclo diario, sin arrastrar minutos.
  // En sábados voluntarios el total computado debe coincidir con la suma de
  // esos tramos ya redondeados, para que la pantalla y el Excel no muestren
  // minutos excedentes que no aparecen en las horas extra.
  if (!sunday && !holidayWorked && !leaveMode && (extra50 > 0 || extra100 > 0) && saturday) {
    const rounded = roundExtraBuckets(extra50, extra100);
    extra50 = rounded.extra50;
    extra100 = rounded.extra100;
    if (record?.saturdayType === "voluntario") counted = extra50 + extra100;
  }

  if (!record?.leaveMode && required > 0 && reference < required) review = required - reference > CONFIG.TOLERANCIA_MINUTOS;
  if (record?.needsReview || record?.lateDecision === "tarde" || record?.lateDecision === "cambio_turno") review = true;
  return {
    realMinutes: real, referenceMinutes: reference, requiredMinutes: required,
    countedMinutes: counted, extra50Minutes: extra50, extra100Minutes: extra100,
    review, worked: hasWork, sunday, saturday, holidayWorked,
    feriadoExcesoGeneraFranco, leaveMode, saturdayType: record?.saturdayType || null,
    estimatedSchedule: schedule
  };
}

function distributeSaturdayOvertime(intervals, reference) {
  const required = CONFIG.JORNAL_SABADO_OBLIGATORIO * 60;
  if (reference <= required) return { before13: 0, after13: 0 };
  let worked = 0, before13 = 0, after13 = 0;
  for (const interval of intervals) {
    for (let minute = interval.start; minute < interval.end && worked < reference; minute++) {
      if (worked >= required) {
        if (minute < 13 * 60) before13++;
        else after13++;
      }
      worked++;
    }
  }
  if (!CONFIG.SABADO_OBLIGATORIO_ANTES_13_AL_50) { after13 += before13; before13 = 0; }
  if (!CONFIG.SABADO_OBLIGATORIO_DESPUES_13_AL_100) { before13 += after13; after13 = 0; }
  return { before13, after13 };
}

export function inferUsualEntry(state, date) {
  const schedule = detectarHorarioHabitual(state, iso(date));
  return schedule ? minutesFromTime(schedule.entrada) : null;
}

export function suggestLateOrShift(state, date, entryTime) {
  const usual = inferUsualEntry(state, date), actual = minutesFromTime(entryTime);
  if (usual === null || actual === null) return null;
  const difference = actual - usual;
  if (difference < CONFIG.DIFERENCIA_MINIMA_PARA_SUGERIR_TURNO) return null;
  return { usual, actual, difference, withinLateLimit: difference <= CONFIG.MAX_RETRASO_INFERIDO_MINUTOS };
}
