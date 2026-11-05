import { CONFIG, MESES } from "./config.js";
import { loadState } from "./storage.js";
import { calculateBillingCycle, billingRange, formatHours } from "./summary.js";
import { getHolidays } from "./holidays.js";
import { buildIntervals, minutesFromTime, estimatedSchedule } from "./time.js";

// Keep the existing app and its storage/calc modules; this layer only enhances
// the billing card and adds an XLSX download when its title is double-tapped.
await import("./app.js");

const main = document.getElementById("cl-main");
let timer;
let cyclePosition = 0;
let activeCard = null;
let touchStartX = null;
let lastTitleTap = 0;
let lastStatTap = new WeakMap();
const AUTO_RETURN_MS = 10 * 60 * 1000;

function dateKeyDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function previousDate(date) { const result = new Date(date); result.setDate(result.getDate() - 1); return result; }
function dateLabel(date) { return date.toLocaleDateString("es-AR"); }
function keyInCycle(key, start, end) { const d = dateKeyDate(key); return d >= start && d <= end; }
function availableCycles(state, currentDate) {
  const current = billingRange(currentDate);
  const cycles = [{ ...current, isCurrent: true }];
  const earliest = Object.keys(state.records || {}).sort()[0];
  if (!earliest) return cycles;
  const oldest = dateKeyDate(earliest);
  let candidate = billingRange(previousDate(current.start));
  let guard = 0;
  while (candidate.end >= oldest && guard++ < 1200) {
    if (Object.keys(state.records || {}).some(key => keyInCycle(key, candidate.start, candidate.end))) cycles.push({ ...candidate, isCurrent: false });
    candidate = billingRange(previousDate(candidate.start));
  }
  return cycles;
}
function cycleForCurrentView() {
  const state = loadState();
  const cycles = availableCycles(state, new Date());
  cyclePosition = Math.min(cyclePosition, cycles.length - 1);
  return { state, cycles, cycle: cycles[cyclePosition] };
}
function dateTime(date) { return date.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }); }
function cardMarkup(cycle, totals) {
  return `<button type="button" class="cl-cycle-title" data-cycle-title>Resumen del ciclo de facturación</button>
    <div class="cl-muted cl-small">${dateLabel(cycle.start)} al ${dateLabel(cycle.end)}${cycle.isCurrent ? " · Ciclo actual" : " · Ciclo anterior"}</div>
    <div class="cl-grid-3" style="margin-top:10px">
      <button type="button" class="cl-stat cl-stat-action" data-cycle-stat="jornales"><div class="value">${totals.jornales}</div><div class="label">Jornales</div></button>
      <button type="button" class="cl-stat cl-stat-action" data-cycle-stat="extra50"><div class="value">${formatHours(totals.extra50)}</div><div class="label">Extras 50%</div></button>
      <button type="button" class="cl-stat cl-stat-action" data-cycle-stat="extra100"><div class="value">${formatHours(totals.extra100)}</div><div class="label">Extras 100%</div></button>
    </div>`;
}
function showCycle() {
  if (!main || document.getElementById("cl-screen-title")?.textContent !== "Calendario") return;
  const card = [...main.querySelectorAll(".cl-card")].find(el => el.querySelector("h3")?.textContent.trim() === "Resumen del ciclo de facturación");
  if (!card) return;
  activeCard = card;
  const { state, cycles, cycle } = cycleForCurrentView();
  if (!cycle) return;
  const result = calculateBillingCycle(state, cycle.start);
  card.innerHTML = cardMarkup(cycle, result.totals);
  card.dataset.cyclePosition = String(cyclePosition);
  card.setAttribute("aria-label", `Resumen del ciclo ${dateLabel(cycle.start)} al ${dateLabel(cycle.end)}. Deslizá para cambiar de ciclo.`);
  if (cyclePosition > 0 && !timer) timer = setTimeout(() => { cyclePosition = 0; timer = null; showCycle(); }, AUTO_RETURN_MS);
  if (cyclePosition === 0 && timer) { clearTimeout(timer); timer = null; }
  attachCardEvents(card, cycles);
}
function attachCardEvents(card, cycles) {
  card.querySelector("[data-cycle-title]")?.addEventListener("click", event => {
    event.preventDefault();
    const now = Date.now();
    if (now - lastTitleTap < 420) { lastTitleTap = 0; exportCycle(); }
    else lastTitleTap = now;
  });
  card.querySelectorAll("[data-cycle-stat]").forEach(button => button.addEventListener("click", event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const now = Date.now(), last = lastStatTap.get(button) || 0;
    if (now - last < 420) { lastStatTap.set(button, 0); showStatDetail(button.dataset.cycleStat); }
    else lastStatTap.set(button, now);
  }, true));
  card.addEventListener("touchstart", event => { touchStartX = event.changedTouches[0]?.clientX ?? null; }, { passive: true });
  card.addEventListener("touchend", event => {
    if (touchStartX === null) return;
    const delta = event.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(delta) < 45) return;
    const total = cycles.length;
    if (delta < 0 && cyclePosition > 0) cyclePosition--;
    else if (delta > 0 && cyclePosition < total - 1) cyclePosition++;
    showCycle();
  }, { passive: true });
}
function showStatDetail(kind) {
  const { state, cycle } = cycleForCurrentView();
  const result = calculateBillingCycle(state, cycle.start);
  const matching = kind === "jornales" ? result.rows.filter(r => (r.record.leaveMode === "medio_franco") || (r.calc.worked && (r.calc.sunday || r.calc.holidayWorked)) || (r.calc.countedMinutes >= 480 && !r.record.leaveMode)) :
    result.rows.filter(r => kind === "extra50" ? r.calc.extra50Minutes > 0 : r.calc.extra100Minutes > 0);
  const title = kind === "jornales" ? "Días computados como jornales" : kind === "extra50" ? "Días con extras al 50%" : "Días con extras al 100%";
  const rows = matching.map(r => `<tr><td>${dateTime(r.date)}</td><td>${kind === "jornales" ? "Jornal" : formatHours(kind === "extra50" ? r.calc.extra50Minutes : r.calc.extra100Minutes)}</td></tr>`).join("");
  const modal = document.getElementById("cl-modal-root");
  modal.innerHTML = `<div class="cl-modal-backdrop" data-modal-backdrop><section class="cl-modal" role="dialog" aria-modal="true"><div class="cl-modal-head"><h2>${title}</h2><button class="cl-close" data-close-cycle-modal type="button">×</button></div>${rows ? `<table class="cl-table"><tbody>${rows}</tbody></table>` : `<div class="cl-note">No hay días registrados para este concepto en el ciclo.</div>`}</section></div>`;
  modal.querySelector("[data-close-cycle-modal]").addEventListener("click", () => { modal.innerHTML = ""; });
}
async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";
    script.onload = resolve; script.onerror = () => reject(new Error("No se pudo cargar el generador Excel. Revisá la conexión a internet e intentá nuevamente."));
    document.head.appendChild(script);
  });
  return window.XLSX;
}
function timeRange(record) {
  const intervals = buildIntervals(record);
  if (!intervals.length) return "";
  return intervals.map(i => `${String(Math.floor(i.start / 60)).padStart(2,"0")}:${String(i.start % 60).padStart(2,"0")}–${String(Math.floor(i.end / 60)).padStart(2,"0")}:${String(i.end % 60).padStart(2,"0")}`).join(" / ");
}
function dayType(row) {
  const { date, record, calc, holiday } = row;
  if (record.leaveMode === "franco_entero") return "Franco entero";
  if (record.leaveMode === "medio_franco_dia_completo") return "Franco (3 medios)";
  if (holiday && !calc.worked) return "Feriado no trabajado";
  if (holiday && calc.worked) return "Feriado trabajado";
  if (date.getDay() === 0) return "Domingo";
  if (date.getDay() === 6) return record.saturdayType === "voluntario" ? "Sábado (voluntario)" : "Sábado (obligatorio)";
  return "Laborable";
}
function rowFill(row) {
  if (row.record.leaveMode === "franco_entero" || row.record.leaveMode === "medio_franco_dia_completo") return "F4B183";
  if (row.holiday && !row.calc.worked) return "FCE4D6";
  if (row.holiday && row.calc.worked || row.calc.sunday && row.calc.worked) return "A9D08E";
  if (row.date.getDay() === 6) return row.record.saturdayType === "voluntario" ? "E2F0D9" : "FCE4D6";
  return null;
}
async function exportCycle() {
  try {
    const XLSX = await loadXlsx();
    const { state, cycle } = cycleForCurrentView();
    const result = calculateBillingCycle(state, cycle.start);
    const dataRows = [["Fecha", "Tipo de día", "Entrada–salida", "Horas totales", "Extra 50%", "Extra 100%", "Jornal", "Franco aplicado", "Observaciones"]];
    const rowMeta = [];
    for (const row of result.rows) {
      const punches = (row.record.punches || []).slice().sort((a,b) => a.timestamp - b.timestamp);
      const holidayWorked = row.calc.holidayWorked || row.calc.sunday && row.calc.worked;
      const holidayNotWorked = row.holiday && !row.calc.worked;
      const bold = row.date.getDay() === 6 && row.calc.worked || row.calc.sunday && row.calc.worked || row.holiday && row.calc.worked || holidayNotWorked;
      dataRows.push([row.date, dayType(row), timeRange(row.record), row.calc.realMinutes / 60, row.calc.extra50Minutes / 60, row.calc.extra100Minutes / 60, row.calc.worked || row.record.leaveMode ? "Sí" : "No", row.record.leaveMode || "", row.holiday?.name || ""]);
      rowMeta.push({ fill: rowFill(row), bold: Boolean(bold), extra50: row.calc.extra50Minutes > 0, extra100: row.calc.extra100Minutes > 0, punches });
    }
    const detail = XLSX.utils.aoa_to_sheet(dataRows);
    detail["!cols"] = [{wch:27},{wch:25},{wch:22},{wch:15},{wch:13},{wch:13},{wch:10},{wch:22},{wch:36}];
    detail["!autofilter"] = { ref: `A1:I${dataRows.length}` };
    const headStyle = { fill:{fgColor:{rgb:"4472C4"}}, font:{bold:true,color:{rgb:"FFFFFF"}}, alignment:{horizontal:"center",vertical:"center"}, border:{bottom:{style:"thin",color:{rgb:"203864"}}} };
    for (let c=0;c<9;c++) detail[XLSX.utils.encode_cell({r:0,c})].s = headStyle;
    rowMeta.forEach((meta,index) => {
      const r=index+1;
      for(let c=0;c<9;c++) {
        const cell=detail[XLSX.utils.encode_cell({r,c})];
        cell.s = { ...(meta.fill ? {fill:{fgColor:{rgb:meta.fill}}} : {}), ...(meta.bold || c===4 && meta.extra50 || c===5 && meta.extra100 ? {font:{bold:true}} : {}), alignment:{vertical:"center",horizontal:c===0?"left":"center"}, border:{bottom:{style:"hair",color:{rgb:"D9E1F2"}}} };
      }
      detail[XLSX.utils.encode_cell({r,c:0})].z = "dddd, dd/mm/yyyy";
      for (const c of [3,4,5]) detail[XLSX.utils.encode_cell({r,c})].z = "0.00";
    });
    const count = (predicate) => result.rows.filter(predicate).length;
    const workedSatMandatory = count(r => r.date.getDay()===6 && r.record.saturdayType!=="voluntario" && r.calc.worked);
    const workedSatVoluntary = count(r => r.date.getDay()===6 && r.record.saturdayType==="voluntario" && r.calc.worked);
    const workedSundays = count(r => r.date.getDay()===0 && r.calc.worked);
    const workedHolidays = count(r => r.holiday && r.calc.worked);
    const unworkedHolidays = count(r => r.holiday && !r.calc.worked);
    const cycleLeaveFull = (state.leaves.fullGenerated||[]).filter(x=>keyInCycle(x.date,cycle.start,cycle.end)).length;
    const cycleLeaveHalf = (state.leaves.halfGenerated||[]).filter(x=>keyInCycle(x.date,cycle.start,cycle.end)).length;
    const leaves = state.leaves || {};
    const fullAvailable = (leaves.fullGenerated||[]).filter(x=>x.status==="disponible").length;
    const halfAvailable = (leaves.halfGenerated||[]).filter(x=>x.status==="disponible").length;
    const fullDebt = (leaves.fullDebt||[]).filter(x=>x.status==="pendiente").length;
    const halfDebt = (leaves.halfDebt||[]).filter(x=>x.status==="pendiente").length;
    const summaryRows = [["RESUMEN DEL CICLO DE FACTURACIÓN",""],["Período",`${dateLabel(cycle.start)} al ${dateLabel(cycle.end)}`],["Indicador","Resultado"],["Jornales",result.totals.jornales],["Horas extra al 50 %",formatHours(result.totals.extra50)],["Horas extra al 100 %",formatHours(result.totals.extra100)],["Feriados trabajados",workedHolidays],["Feriados no trabajados",unworkedHolidays],["Sábados obligatorios",workedSatMandatory],["Sábados voluntarios",workedSatVoluntary],["Domingos trabajados",workedSundays],["",""],["Francos generados dentro del ciclo","Cantidad"],["Francos enteros",cycleLeaveFull],["Medios francos",cycleLeaveHalf],["Saldo acumulado","Cantidad"],["Francos enteros disponibles",fullAvailable],["Medios francos disponibles",halfAvailable],["Francos enteros adeudados",fullDebt],["Medios francos adeudados",halfDebt]];
    const summary = XLSX.utils.aoa_to_sheet(summaryRows);
    summary["!merges"] = [{s:{r:0,c:0},e:{r:0,c:1}}]; summary["!cols"]=[{wch:42},{wch:30}];
    for(let r=0;r<summaryRows.length;r++) for(let c=0;c<2;c++) { const cell=summary[XLSX.utils.encode_cell({r,c})]; if(cell) cell.s={alignment:{horizontal:"center",vertical:"center"},border:{top:{style:"thin",color:{rgb:"000000"}},bottom:{style:"thin",color:{rgb:"000000"}},left:{style:"thin",color:{rgb:"000000"}},right:{style:"thin",color:{rgb:"000000"}}}}; }
    summary["A1"].s={fill:{fgColor:{rgb:"244062"}},font:{bold:true,color:{rgb:"FFFFFF"},sz:14},alignment:{horizontal:"center"},border:{top:{style:"thin",color:{rgb:"000000"}},bottom:{style:"thin",color:{rgb:"000000"}},left:{style:"thin",color:{rgb:"000000"}},right:{style:"thin",color:{rgb:"000000"}}}};
    [2,12,15].forEach(r=>[0,1].forEach(c=>{const cell=summary[XLSX.utils.encode_cell({r,c})];if(cell)cell.s={fill:{fgColor:{rgb:"4472C4"}},font:{bold:true,color:{rgb:"FFFFFF"}},alignment:{horizontal:"center"}};}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,detail,"Detalle diario"); XLSX.utils.book_append_sheet(wb,summary,"Resumen del ciclo");
    const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array",cellStyles:true});
    const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const url=URL.createObjectURL(blob), a=document.createElement("a"); a.href=url; a.download=`planilla_ciclo_${cycle.start.toISOString().slice(0,10)}_a_${cycle.end.toISOString().slice(0,10)}.xlsx`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error) { alert(error.message || "No se pudo generar la planilla Excel."); }
}
const style = document.createElement("style");
style.textContent = `.cl-cycle-title{display:block;border:0;background:transparent;color:inherit;padding:0;margin:0 0 8px;font:inherit;font-weight:800;font-size:18px;text-align:left;cursor:pointer;touch-action:pan-y}.cl-cycle-title:focus-visible{outline:2px solid var(--cl-primary);outline-offset:3px;border-radius:4px}.cl-card:has(.cl-cycle-title){touch-action:pan-y}`;
document.head.append(style);
const observer = new MutationObserver(() => { if (document.getElementById("cl-screen-title")?.textContent === "Calendario") showCycle(); });
observer.observe(main,{childList:true,subtree:true});
setTimeout(showCycle,0);
