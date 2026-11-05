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
      else {
        // Dos entradas seguidas: conserva la primera y registra la segunda como evento, sin inventar una salida.
      }
    } else if (punch.type === "salida" && pendingIn) {
      const start = minutesFromTime(pendingIn.time);
      const end = minutesFromTime(punch.time);
      if (start !== null && end !== null && end >= start) {
        intervals.push({ start, end, sourceIn: pendingIn, sourceOut: punch });
      }
      pendingIn = null;
    }
  }
  return intervals;
}

export function realWorkedMinutes(record) {
  return buildIntervals(record).reduce((sum, x) => sum + (x.end - x.start), 0);
}

export function effectiveReferenceMinutes(record) {
  const intervals = buildIntervals(record);
  return intervals.reduce((sum, x) => {
    const start = referenceMinutes(x.start, "entrada");
    const end = referenceMinutes(x.end, "salida");
    return sum + Math.max(0, end - start);
  }, 0);
}

export function isSunday(date) { return date.getDay() === 0; }
export function isSaturday(date) { return date.getDay() === 6; }
export function iso(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
export const isoDate = iso;

export function classifySaturday(record) {
  return record?.saturdayType || null;
}


export function roundExtraMinutes(minutes, tolerance = CONFIG.TOLERANCIA_REDONDEO_EXTRA_MINUTOS) {
  const value = Math.max(0, Math.round(minutes || 0));
  if (!value) return 0;

  // Bloques enteros por jornal. La tolerancia permite considerar completa
  // una hora cuando faltan hasta N minutos para llegar al bloque siguiente,
  // y también cuando se excede hasta N minutos del bloque exacto.
  const hours = Math.floor(value / 60);
  const remainder = value % 60;

  if (remainder <= tolerance) return hours * 60;
  if (remainder >= 60 - tolerance) return (hours + 1) * 60;

  // Entre ambos márgenes se conserva la hora más cercana.
  return Math.round(value / 60) * 60;
}

export function roundExtraBuckets(extra50, extra100) {
  const total = Math.max(0, (extra50 || 0) + (extra100 || 0));
  if (!total) return { extra50: 0, extra100: 0 };

  const roundedTotal = roundExtraMinutes(total);
  if (!roundedTotal) return { extra50: 0, extra100: 0 };

  // Conserva la clasificación de cada tramo tanto como sea posible.
  // El tramo al 100 % se prioriza cuando es el que completa el último
  // bloque horario; así no se cambia artificialmente una hora de tasa.
  const raw50 = Math.max(0, extra50 || 0);
  const raw100 = Math.max(0, extra100 || 0);

  if (!raw50) return { extra50: 0, extra100: roundedTotal };
  if (!raw100) return { extra50: roundedTotal, extra100: 0 };

  const rounded50 = roundExtraMinutes(raw50);
  const rounded100 = roundExtraMinutes(raw100);

  if (rounded50 + rounded100 === roundedTotal) {
    return { extra50: rounded50, extra100: rounded100 };
  }

  // Si el redondeo independiente no coincide con el total, mantiene
  // los bloques completos del 50 % y coloca el resto en 100 %.
  const base50 = Math.floor(raw50 / 60) * 60;
  const remaining = Math.max(0, roundedTotal - base50);
  return {
    extra50: Math.min(base50, roundedTotal),
    extra100: Math.max(0, remaining)
  };
}

export function estimatedSchedule(state, date) {
  const dateKey = iso(date);
  const habitual = detectarHorarioHabitual(state, dateKey);
  if (habitual) return habitual;

  const current = state?.records?.[dateKey];
  const entry = current?.punches
    ?.filter(p => p.type === "entrada")
    ?.sort((a, b) => a.timestamp - b.timestamp)[0];

  if (!entry) return null;
  return horarioMasCercano(minutesFromTime(entry.referenceTime || entry.time));
}

export function calculateDay(record, date, holiday, settings = {}) {
  const real = realWorkedMinutes(record);
  const reference = effectiveReferenceMinutes(record);
  const hasWork = real > 0;
  const sunday = isSunday(date);
  const saturday = isSaturday(date);
  const holidayWorked = !!holiday && hasWork;
  const feriadoExcesoGeneraFranco = settings.feriadoExcesoGeneraFranco ?? CONFIG.FERIADO_EXCESO_GENERA_FRANCO;

  let required = CONFIG.JORNAL_NORMAL_HORAS * 60;
  let counted = 0;
  let extra50 = 0;
  let extra100 = 0;
  let review = false;
  const leaveMode = record?.leaveMode || null;

  if (record?.leaveMode === "franco_entero") {
    counted = required;
  } else if (record?.leaveMode === "medio_franco") {
    required = CONFIG.JORNADA_MEDIO_FRANCO_HORAS * 60;
    counted = required;
    if (CONFIG.HORAS_EXTRAS_DESPUES_DE_MEDIO_FRANCO && reference > required) {
      extra50 = reference - required;
    }
  } else if (record?.leaveMode === "medio_franco_dia_completo") {
    counted = required;
  } else if (sunday || holidayWorked) {
    // Domingo/feriado: el día trabajado cuenta como 1 jornal para el
    // registro de jornadas, pero todas las horas se clasifican al 100 %.
    // El total del día se redondea a horas enteras; no se arrastran
    // minutos sobrantes entre jornadas. Con la tolerancia actual de 10 min,
    // 07:50 -> 16:00 (8h10) computa como 8h al 100 %.
    counted = required;
    extra100 = roundExtraMinutes(reference);
  } else if (saturday) {
    const type = record?.saturdayType || "provisional";
    if (type === "voluntario") {
      const before13 = overlapMinutes(record, 0, 13 * 60);
      const after13 = Math.max(0, reference - before13);
      extra50 = before13;
      extra100 = after13;
      counted = reference;
    } else {
      counted = Math.min(reference, CONFIG.JORNAL_SABADO_OBLIGATORIO * 60);
      const overtimeStart = distributeSaturdayOvertime(record, reference);
      extra50 = overtimeStart.before13;
      extra100 = overtimeStart.after13;
    }
  } else {
    // Jornada normal: la entrada anticipada no genera extra. Las extras
    // comienzan recién después del horario de salida del turno estimado.
    const schedule = estimatedScheduleFromRecord(record, date);
    const scheduledEnd = schedule ? minutesFromTime(schedule.salida) : null;
    const scheduledStart = schedule ? minutesFromTime(schedule.entrada) : null;

    if (scheduledEnd !== null) {
      const intervals = buildIntervals(record);
      const workStart = intervals.reduce((min, x) => Math.min(min, x.start), Infinity);
      const lastEnd = intervals.reduce((max, x) => Math.max(max, x.end), -Infinity);
      const firstStart = Number.isFinite(workStart) ? workStart : scheduledStart;
      // Para decidir si hubo extra se compara la hora de salida real con
      // la hora de salida del turno, no la duración total del intervalo.
      // Esto evita que una entrada anticipada convierta minutos tempranos
      // en horas extra.
      const effectiveEnd = Number.isFinite(lastEnd) ? lastEnd : reference;

      counted = Math.min(required, Math.max(0, reference));

      // La llegada antes de hora nunca se convierte en extra.
      // El jornal normal se limita a 8 h.
      counted = Math.min(reference, required);

      if (effectiveEnd > scheduledEnd) {
        const rawExtra = effectiveEnd - scheduledEnd;
        // En una jornada normal, todo el excedente posterior al horario
        // oficial de salida corresponde a horas extra al 50 %.
        extra50 = roundExtraMinutes(rawExtra);
      }
    } else {
      counted = Math.min(reference, required);
      extra50 = Math.max(0, reference - required);
    }
  }

  // Tratamiento especial del turno 06:00-14:00:
  // si la entrada corresponde al turno 06-14 y la salida llega a 13:30,
  // la empresa considera completo el jornal. Las extras comienzan recién
  // después de las 14:00.
  const scheduleForSpecial = estimatedScheduleFromRecord(record, date);
  if (!leaveMode && hasWork && scheduleForSpecial?.id === "06-14" && !sunday && !holidayWorked && !saturday) {
    const specialStart = minutesFromTime(scheduleForSpecial.entrada);
    const specialEnd = minutesFromTime(scheduleForSpecial.salida);
    const specialMinimum = minutesFromTime(scheduleForSpecial.salidaMinimaJornal || "13:30");
    const lastEnd = buildIntervals(record).reduce((max, x) => Math.max(max, x.end), 0);

    if (lastEnd >= specialMinimum && lastEnd <= specialEnd) {
      counted = required;
      extra50 = 0;
      extra100 = 0;
    } else if (lastEnd > specialEnd) {
      counted = required;
      extra50 = roundExtraMinutes(lastEnd - specialEnd);
      extra100 = 0;
    } else if (specialStart !== null && lastEnd < specialMinimum) {
      counted = Math.min(required, reference);
    }
  }

  // Para extras mixtas (p. ej. sábados), redondear por jornal sin acumular
  // minutos de un día a otro.
  if (!sunday && !holidayWorked && !leaveMode && (extra50 > 0 || extra100 > 0) && saturday) {
    const rounded = roundExtraBuckets(extra50, extra100);
    extra50 = rounded.extra50;
    extra100 = rounded.extra100;
  }

  // Tolerancia de cumplimiento del jornal, separada del redondeo de extras.
  if (!record?.leaveMode && required > 0 && reference < required) {
    const missing = required - reference;
    review = missing > CONFIG.TOLERANCIA_MINUTOS;
  }

  if (record?.needsReview) review = true;
  if (record?.lateDecision === "tarde" || record?.lateDecision === "cambio_turno") review = true;

  return {
    realMinutes: real,
    referenceMinutes: reference,
    requiredMinutes: required,
    countedMinutes: counted,
    extra50Minutes: extra50,
    extra100Minutes: extra100,
    review,
    worked: hasWork,
    sunday,
    saturday,
    holidayWorked,
    feriadoExcesoGeneraFranco,
    leaveMode,
    saturdayType: record?.saturdayType || null,
    estimatedSchedule: estimatedScheduleFromRecord(record, date)
  };
}

function estimatedScheduleFromRecord(record, date) {
  const entry = record?.punches
    ?.filter(p => p.type === "entrada")
    ?.sort((a, b) => a.timestamp - b.timestamp)[0];

  if (!entry) return null;
  return horarioMasCercano(minutesFromTime(entry.referenceTime || entry.time));
}

function overlapMinutes(record, startLimit, endLimit) {
  return buildIntervals(record).reduce((sum, interval) => {
    return sum + Math.max(0, Math.min(interval.end, endLimit) - Math.max(interval.start, startLimit));
  }, 0);
}

function distributeSaturdayOvertime(record, reference) {
  const required = CONFIG.JORNAL_SABADO_OBLIGATORIO * 60;
  const intervals = buildIntervals(record);
  let remaining = Math.max(0, reference - required);
  if (!remaining) return { before13: 0, after13: 0 };

  // Recorremos el tiempo trabajado después de completar las 8 horas.
  // Para no inventar una distribución cuando el turno cruza las 13:00,
  // usamos los minutos reales/referenciales por intervalo.
  let worked = 0;
  let before13 = 0;
  let after13 = 0;
  for (const interval of intervals) {
    const start = referenceMinutes(interval.start, "entrada");
    const end = referenceMinutes(interval.end, "salida");
    for (let minute = start; minute < end && worked < reference; minute++) {
      const isExtra = worked >= required;
      if (isExtra) {
        if (minute < 13 * 60) before13++;
        else after13++;
      }
      worked++;
    }
  }
  // Aplicar constantes para que realmente controlen la clasificación.
  if (!CONFIG.SABADO_OBLIGATORIO_ANTES_13_AL_50) {
    const swap = before13; before13 = 0; after13 += swap;
  }
  if (!CONFIG.SABADO_OBLIGATORIO_DESPUES_13_AL_100) {
    const swap = after13; after13 = 0; before13 += swap;
  }
  return { before13, after13 };
}

export function inferUsualEntry(state, date) {
  const schedule = detectarHorarioHabitual(state, iso(date));
  return schedule ? minutesFromTime(schedule.entrada) : null;
}

export function suggestLateOrShift(state, date, entryTime) {
  const usual = inferUsualEntry(state, date);
  const actual = minutesFromTime(entryTime);
  if (usual === null || actual === null) return null;
  const difference = actual - usual;
  if (difference < CONFIG.DIFERENCIA_MINIMA_PARA_SUGERIR_TURNO) return null;
  return {
    usual,
    actual,
    difference,
    withinLateLimit: difference <= CONFIG.MAX_RETRASO_INFERIDO_MINUTOS
  };
}
