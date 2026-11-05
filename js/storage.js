const STORAGE_KEY = "control_laboral_v1";

function estadoInicial() {
  return {
    version: 1,
    records: {},
    leaves: {
      fullGenerated: [],
      fullUsed: [],
      fullDebt: [],
      halfGenerated: [],
      halfUsed: [],
      halfDebt: []
    },
    holidays: {
      known: {},
      lastUpdate: null,
      source: "integrados"
    },
    settings: {},
    audit: []
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return estadoInicial();
    const parsed = JSON.parse(raw);
    return normalizarEstado(parsed);
  } catch (error) {
    console.error("No se pudo leer el almacenamiento local", error);
    return estadoInicial();
  }
}

function normalizarEstado(state) {
  const base = estadoInicial();
  return {
    ...base,
    ...state,
    records: state.records && typeof state.records === "object" ? state.records : {},
    leaves: { ...base.leaves, ...(state.leaves || {}) },
    holidays: { ...base.holidays, ...(state.holidays || {}) },
    settings: state.settings || {},
    audit: Array.isArray(state.audit) ? state.audit : []
  };
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("No se pudo guardar el estado", error);
    alert("No se pudieron guardar los datos en este navegador. Revisá el espacio disponible.");
    return false;
  }
}

export function exportState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `control-laboral-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importState(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.records || !parsed.leaves) {
    throw new Error("El archivo no parece ser un respaldo válido de Control Laboral.");
  }
  return normalizarEstado(parsed);
}

export function addAudit(state, action, details = {}) {
  state.audit.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    timestamp: new Date().toISOString(),
    action,
    details
  });
  if (state.audit.length > 500) state.audit.length = 500;
}

export { STORAGE_KEY };
