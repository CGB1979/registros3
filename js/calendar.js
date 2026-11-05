import { DIAS_SEMANA, MESES } from "./config.js";
import { isoDate, isSaturday, isSunday, calculateDay } from "./time.js";
import { getHolidays } from "./holidays.js";

export function monthKey(year, month) { return `${year}-${String(month + 1).padStart(2,"0")}`; }

export function renderCalendar(state, view, onOpenDay) {
  const { year, month, selected } = view;
  const holidays = getHolidays(state, year);
  const first = new Date(year, month, 1);
  const firstMondayIndex = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let cells = "";
  for (let i = 0; i < 42; i++) {
    const dayNumber = i - firstMondayIndex + 1;
    const date = new Date(year, month, dayNumber);
    const key = isoDate(date);
    const inMonth = date.getMonth() === month;
    const record = state.records[key] || { punches: [] };
    const holiday = holidays[key];
    const calc = calculateDay(record, date, holiday, state.settings);
    const sat = isSaturday(date);
    const sun = isSunday(date);

    let classes = ["cl-day"];
    if (!inMonth) classes.push("outside");
    if (key === selected) classes.push("selected");
    if (sun) classes.push("sunday");
    if (holiday) classes.push("holiday");
    if (sat) classes.push("saturday");
    if (record.saturdayType === "mandatory") classes.push("mandatory");
    if (record.saturdayType === "voluntario") classes.push("voluntary");
    if (calc.worked && sun) classes.push("worked-sunday");
    if (calc.worked && holiday) classes.push("worked-holiday");
    if (calc.review) classes.push("review");
    if (record.punches?.length) classes.push("has-record");

    cells += `<button class="${classes.join(" ")}" data-date="${key}" type="button" aria-label="${key}">
      <span class="num">${date.getDate()}</span><span class="dot"></span>
    </button>`;
  }

  return `
    <section class="cl-card">
      <div class="cl-month-nav">
        <button data-calendar-prev type="button" aria-label="Mes anterior">‹</button>
        <div class="cl-month-title">${MESES[month]} ${year}</div>
        <button data-calendar-next type="button" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cl-weekdays">${DIAS_SEMANA.map(d => `<div class="cl-weekday">${d}</div>`).join("")}</div>
      <div class="cl-calendar-grid">${cells}</div>
      <div class="cl-legend">
        <div class="cl-legend-item"><span class="cl-legend-dot" style="background:#e7f7ef"></span>Domingo/feriado trabajado</div>
        <div class="cl-legend-item"><span class="cl-legend-dot" style="background:#fff1df"></span>Sábado obligatorio</div>
        <div class="cl-legend-item"><span class="cl-legend-dot" style="background:#dff5e9"></span>Sábado voluntario</div>
        <div class="cl-legend-item"><span class="cl-legend-dot" style="background:#ffe8eb"></span>Domingo / feriado</div>
        <div class="cl-legend-item"><span class="cl-legend-dot" style="background:#fff6d8"></span>Requiere revisión</div>
        <div class="cl-legend-item"><span class="cl-legend-dot" style="background:#1677d2"></span>Con registros</div>
      </div>
    </section>
  `;
}

export function bindCalendar(container, view, onOpenDay) {
  container.querySelectorAll("[data-date]").forEach(button => {
    let lastTap = 0;
    button.addEventListener("click", () => {
      const now = Date.now();
      const date = button.dataset.date;
      if (now - lastTap < 420) {
        onOpenDay(date);
        lastTap = 0;
      } else {
        view.selected = date;
        container.querySelectorAll(".cl-day.selected").forEach(x => x.classList.remove("selected"));
        button.classList.add("selected");
        lastTap = now;
      }
    });
  });
}
