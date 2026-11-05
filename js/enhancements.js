import { CONFIG, MESES } from "./config.js";
import { loadState } from "./storage.js";
import { calculateBillingCycle, billingRange, formatHours } from "./summary.js";
import { buildIntervals, minutesFromTime, estimatedSchedule } from "./time.js";

// Run the established app unchanged, then add the billing-cycle interactions.
await import("./app.js");
const main = document.getElementById("cl-main");
let cyclePosition = 0, returnTimer = null, startX = null, titleTap = 0;
const statTaps = new WeakMap();
const RESET_AFTER = 10 * 60 * 1000;
const dateFromKey = key => { const [y,m,d]=key.split("-").map(Number); return new Date(y,m-1,d); };
const keyInCycle = (key,start,end) => { const d=dateFromKey(key); return d>=start&&d<=end; };
const dayBefore = d => { const x=new Date(d); x.setDate(x.getDate()-1); return x; };
const label = d => d.toLocaleDateString("es-AR");
function cyclesAvailable(state) {
  const current=billingRange(new Date()), cycles=[{...current,isCurrent:true}];
  const keys=Object.keys(state.records||{}).sort(); if(!keys.length) return cycles;
  const earliest=dateFromKey(keys[0]); let range=billingRange(dayBefore(current.start)), guard=0;
  while(range.end>=earliest&&guard++<1200){
    if(keys.some(k=>keyInCycle(k,range.start,range.end))) cycles.push({...range,isCurrent:false});
    range=billingRange(dayBefore(range.start));
  }
  return cycles;
}
function visible() {
  const state=loadState(), cycles=cyclesAvailable(state);
  cyclePosition=Math.min(cyclePosition,cycles.length-1);
  return {state,cycles,cycle:cycles[cyclePosition]};
}
function refreshCard() {
  if(document.getElementById("cl-screen-title")?.textContent!=="Calendario") return;
  const card=[...main.querySelectorAll(".cl-card")].find(el=>el.querySelector("h3")?.textContent.trim()==="Resumen del ciclo de facturación"||el.dataset.billingCard==="true");
  if(!card) return;
  const {state,cycles,cycle}=visible(); if(!cycle) return;
  const {totals}=calculateBillingCycle(state,cycle.start);
  card.dataset.billingCard="true";
  card.innerHTML=`<button type="button" class="cl-cycle-title" data-cycle-title>Resumen del ciclo de facturación</button>
    <div class="cl-muted cl-small">${label(cycle.start)} al ${label(cycle.end)}${cycle.isCurrent?" · Ciclo actual":" · Ciclo anterior"}</div>
    <div class="cl-grid-3" style="margin-top:10px">
      <button type="button" class="cl-stat cl-stat-action" data-cycle-stat="jornales"><div class="value">${totals.jornales}</div><div class="label">Jornales</div></button>
      <button type="button" class="cl-stat cl-stat-action" data-cycle-stat="extra50"><div class="value">${formatHours(totals.extra50)}</div><div class="label">Extras 50%</div></button>
      <button type="button" class="cl-stat cl-stat-action" data-cycle-stat="extra100"><div class="value">${formatHours(totals.extra100)}</div><div class="label">Extras 100%</div></button>
    </div>`;
  card.setAttribute("aria-label",`Resumen del ciclo ${label(cycle.start)} al ${label(cycle.end)}. Deslizá para cambiar de ciclo.`);
  if(cyclePosition>0&&!returnTimer) returnTimer=setTimeout(()=>{cyclePosition=0;returnTimer=null;refreshCard();},RESET_AFTER);
  if(cyclePosition===0&&returnTimer){clearTimeout(returnTimer);returnTimer=null;}
  card.querySelector("[data-cycle-title]").addEventListener("click",()=>{const now=Date.now();if(now-titleTap<420){titleTap=0;exportCycle();}else titleTap=now;});
  card.querySelectorAll("[data-cycle-stat]").forEach(btn=>btn.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();const now=Date.now(),last=statTaps.get(btn)||0;if(now-last<420){statTaps.set(btn,0);openDetail(btn.dataset.cycleStat);}else statTaps.set(btn,now);},true));
  card.ontouchstart=e=>{startX=e.changedTouches[0]?.clientX??null;};
  card.ontouchend=e=>{if(startX===null)return;const delta=e.changedTouches[0].clientX-startX;startX=null;if(Math.abs(delta)<45)return;if(delta<0&&cyclePosition>0)cyclePosition--;else if(delta>0&&cyclePosition<cycles.length-1)cyclePosition++;refreshCard();};
}
function openDetail(kind){
  const {state,cycle}=visible(), result=calculateBillingCycle(state,cycle.start);
  const rows=result.rows.filter(r=>kind==="jornales"?(r.record.leaveMode==="medio_franco"||(r.calc.worked&&(r.calc.sunday||r.calc.holidayWorked))||(r.calc.countedMinutes>=480&&!r.record.leaveMode)):kind==="extra50"?r.calc.extra50Minutes>0:r.calc.extra100Minutes>0);
  const title=kind==="jornales"?"Días computados como jornales":kind==="extra50"?"Días con horas extras al 50%":"Días con horas extras al 100%";
  const body=rows.length?`<div class="cl-list">${rows.map(r=>`<div class="cl-list-item"><span class="cl-list-dot"></span><span>${r.date.toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"})}</span><strong>${kind==="jornales"?"Jornal":formatHours(kind==="extra50"?r.calc.extra50Minutes:r.calc.extra100Minutes)}</strong></div>`).join("")}</div>`:`<div class="cl-note">No hay días registrados para este concepto en el ciclo.</div>`;
  const root=document.getElementById("cl-modal-root");root.innerHTML=`<div class="cl-modal-backdrop"><section class="cl-modal" role="dialog" aria-modal="true"><div class="cl-modal-head"><h2>${title}</h2><button class="cl-close" data-close>×</button></div>${body}</section></div>`;root.querySelector("[data-close]").onclick=()=>root.innerHTML="";
}
async function xlsx(){if(window.XLSX)return window.XLSX;await new Promise((ok,no)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";s.onload=ok;s.onerror=()=>no(Error("No se pudo cargar el generador Excel. Revisá la conexión e intentá nuevamente."));document.head.append(s);});return window.XLSX;}
function intervalText(record){return buildIntervals(record).map(i=>`${String(Math.floor(i.start/60)).padStart(2,"0")}:${String(i.start%60).padStart(2,"0")}–${String(Math.floor(i.end/60)).padStart(2,"0")}:${String(i.end%60).padStart(2,"0")}`).join(" / ");}
function typeOf(r){if(r.record.leaveMode?.includes("franco"))return "Franco entero";if(r.holiday&&!r.calc.worked)return "Feriado no trabajado";if(r.holiday&&r.calc.worked)return "Feriado trabajado";if(r.date.getDay()===0)return "Domingo";if(r.date.getDay()===6)return r.record.saturdayType==="voluntario"?"Sábado (voluntario)":"Sábado (obligatorio)";return "Laborable";}
function fillOf(r){if(r.record.leaveMode?.includes("franco"))return "F4B183";if(r.holiday&&!r.calc.worked)return "FCE4D6";if((r.holiday||r.calc.sunday)&&r.calc.worked)return "A9D08E";if(r.date.getDay()===6)return r.record.saturdayType==="voluntario"?"E2F0D9":"FCE4D6";return null;}
async function exportCycle(){try{
  const XLSX=await xlsx(),{state,cycle}=visible(),result=calculateBillingCycle(state,cycle.start);
  const data=[["Fecha","Tipo de día","Entrada–salida","Horas totales","Extra 50%","Extra 100%","Jornal","Franco aplicado","Observaciones"]],meta=[];
  result.rows.forEach(r=>{const bold=Boolean((r.date.getDay()===6&&r.calc.worked)||(r.date.getDay()===0&&r.calc.worked)||(r.holiday&&r.calc.worked)||(r.holiday&&!r.calc.worked));data.push([r.date,typeOf(r),intervalText(r.record),r.calc.countedMinutes/60,r.calc.extra50Minutes/60,r.calc.extra100Minutes/60,r.calc.worked||r.record.leaveMode?"Sí":"No",r.record.leaveMode||"",r.holiday?.name||""]);meta.push({fill:fillOf(r),bold,e50:r.calc.extra50Minutes>0,e100:r.calc.extra100Minutes>0});});
  const detail=XLSX.utils.aoa_to_sheet(data);detail["!cols"]=[{wch:28},{wch:25},{wch:24},{wch:15},{wch:13},{wch:13},{wch:10},{wch:22},{wch:38}];detail["!autofilter"]={ref:`A1:I${data.length}`};
  const header={fill:{fgColor:{rgb:"4472C4"}},font:{bold:true,color:{rgb:"FFFFFF"}},alignment:{horizontal:"center",vertical:"center"}};for(let c=0;c<9;c++)detail[XLSX.utils.encode_cell({r:0,c})].s=header;
  meta.forEach((m,i)=>{for(let c=0;c<9;c++){const cell=detail[XLSX.utils.encode_cell({r:i+1,c})];cell.s={...(m.fill?{fill:{fgColor:{rgb:m.fill}}}:{}),...(m.bold||c===4&&m.e50||c===5&&m.e100?{font:{bold:true}}:{}),alignment:{vertical:"center",horizontal:c===0?"left":"center"}};}detail[XLSX.utils.encode_cell({r:i+1,c:0})].z="dddd, dd/mm/yyyy";for(const c of [3,4,5])detail[XLSX.utils.encode_cell({r:i+1,c})].z="0.00";});
  const count=fn=>result.rows.filter(fn).length,L=state.leaves||{},within=x=>keyInCycle(x.date,cycle.start,cycle.end);
  const summaries=[["RESUMEN DEL CICLO DE FACTURACIÓN",""],["Período",`${label(cycle.start)} al ${label(cycle.end)}`],["Indicador","Resultado"],["Jornales",result.totals.jornales],["Horas extra al 50 %",formatHours(result.totals.extra50)],["Horas extra al 100 %",formatHours(result.totals.extra100)],["Feriados trabajados",count(r=>r.holiday&&r.calc.worked)],["Feriados no trabajados",count(r=>r.holiday&&!r.calc.worked)],["Sábados obligatorios",count(r=>r.date.getDay()===6&&r.record.saturdayType!=="voluntario"&&r.calc.worked)],["Sábados voluntarios",count(r=>r.date.getDay()===6&&r.record.saturdayType==="voluntario"&&r.calc.worked)],["Domingos trabajados",count(r=>r.date.getDay()===0&&r.calc.worked)],["",""],["Francos generados dentro del ciclo","Cantidad"],["Francos enteros",(L.fullGenerated||[]).filter(within).length],["Medios francos",(L.halfGenerated||[]).filter(within).length],["Saldo acumulado","Cantidad"],["Francos enteros disponibles",(L.fullGenerated||[]).filter(x=>x.status==="disponible").length],["Medios francos disponibles",(L.halfGenerated||[]).filter(x=>x.status==="disponible").length],["Francos enteros adeudados",(L.fullDebt||[]).filter(x=>x.status==="pendiente").length],["Medios francos adeudados",(L.halfDebt||[]).filter(x=>x.status==="pendiente").length]];
  const summary=XLSX.utils.aoa_to_sheet(summaries);summary["!merges"]=[{s:{r:0,c:0},e:{r:0,c:1}}];summary["!cols"]=[{wch:42},{wch:30}];summary["A1"].s={fill:{fgColor:{rgb:"244062"}},font:{bold:true,color:{rgb:"FFFFFF"},sz:14},alignment:{horizontal:"center"}};[2,12,15].forEach(r=>[0,1].forEach(c=>{const x=summary[XLSX.utils.encode_cell({r,c})];if(x)x.s={fill:{fgColor:{rgb:"4472C4"}},font:{bold:true,color:{rgb:"FFFFFF"}},alignment:{horizontal:"center"}};}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,detail,"Detalle diario");XLSX.utils.book_append_sheet(wb,summary,"Resumen del ciclo");const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array",cellStyles:true});const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})),a=document.createElement("a");a.href=url;a.download=`planilla_ciclo_${cycle.start.toISOString().slice(0,10)}_a_${cycle.end.toISOString().slice(0,10)}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}catch(e){alert(e.message||"No se pudo generar la planilla Excel.");}}
const style=document.createElement("style");style.textContent=".cl-cycle-title{display:block;border:0;background:transparent;color:inherit;padding:0;margin:0 0 8px;font:inherit;font-weight:800;font-size:18px;text-align:left;cursor:pointer;touch-action:pan-y}.cl-cycle-title:focus-visible{outline:2px solid var(--cl-primary);outline-offset:3px}";document.head.append(style);
new MutationObserver(refreshCard).observe(main,{childList:true,subtree:true});setTimeout(refreshCard,0);
