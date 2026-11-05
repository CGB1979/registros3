/*
  Feriados argentinos.
  La lista incorporada permite que la app funcione sin internet.
  La consulta externa queda preparada, pero no se afirma que existe
  sincronización mientras CONFIG.FUENTE_FERIADOS_URL esté vacía.
*/
import { CONFIG } from "./config.js";

export function holidaysForYear(year) {
  const result = {};

  const add = (date, name, type = "feriado") => {
    result[date] = { name, type };
  };

  // Fechas fijas oficiales conocidas; revisar/actualizar la lista si cambia la legislación.
  add(`${year}-01-01`, "Año Nuevo");
  add(`${year}-03-24`, "Día Nacional de la Memoria por la Verdad y la Justicia");
  add(`${year}-04-02`, "Día del Veterano y de los Caídos en la Guerra de Malvinas");
  add(`${year}-05-01`, "Día del Trabajador");
  add(`${year}-05-25`, "Día de la Revolución de Mayo");
  add(`${year}-06-20`, "Paso a la Inmortalidad del General Manuel Belgrano");
  add(`${year}-07-09`, "Día de la Independencia");
  add(`${year}-12-08`, "Inmaculada Concepción de María");
  add(`${year}-12-25`, "Navidad");

  // Fechas móviles: se agregan mediante algoritmo de Pascua.
  const easter = easterDate(year);
  const addDays = (date, days) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    return isoDate(d);
  };
  add(addDays(easter, -2), "Viernes Santo");
  add(addDays(easter, -48), "Carnaval");
  add(addDays(easter, -47), "Carnaval");

  return result;
}

function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

export function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

export function getHolidays(state, year) {
  return { ...holidaysForYear(year), ...(state.holidays.known || {}) };
}

export async function updateExternalHolidays(state) {
  if (!CONFIG.FUENTE_FERIADOS_URL) return { updated: false, reason: "sin_fuente_configurada" };
  try {
    const url = CONFIG.FUENTE_FERIADOS_URL.replace("{year}", String(new Date().getFullYear()));
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Formato de feriados no válido");
    const normalized = {};
    for (const item of data) {
      if (!item?.fecha) continue;
      normalized[item.fecha] = { name: item.nombre || "Feriado", type: item.tipo || "feriado" };
    }
    state.holidays.known = { ...state.holidays.known, ...normalized };
    state.holidays.lastUpdate = new Date().toISOString();
    state.holidays.source = url;
    return { updated: true };
  } catch (error) {
    console.warn("No se pudo actualizar feriados", error);
    return { updated: false, reason: error.message };
  }
}
