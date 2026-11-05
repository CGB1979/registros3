/*
  HORARIOS LABORALES
  ---------------------------------------------------------------
  Para agregar un nuevo turno, agregá otra entrada al arreglo HORARIOS.
  No hace falta seleccionar manualmente el turno: la app lo estima
  observando las últimas 3 jornadas con entrada registrada.
*/

export const HORARIOS = [
  {
    id: "06-14",
    entrada: "06:00",
    salida: "14:00",
    nombre: "06:00 a 14:00",
    // Acuerdo interno: desde las 13:30 se considera completado el jornal.
    salidaMinimaJornal: "13:30"
  },
  {
    id: "08-16",
    entrada: "08:00",
    salida: "16:00",
    nombre: "08:00 a 16:00"
  },
  {
    id: "10-18",
    entrada: "10:00",
    salida: "18:00",
    nombre: "10:00 a 18:00"
  },
  {
    id: "14-22",
    entrada: "14:00",
    salida: "22:00",
    nombre: "14:00 a 22:00"
  }
];

export function minutos(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

export function horarioMasCercano(minutosEntrada) {
  if (minutosEntrada === null || minutosEntrada === undefined) return null;

  return HORARIOS
    .map(horario => ({
      ...horario,
      diferencia: Math.abs(minutos(horario.entrada) - minutosEntrada)
    }))
    .sort((a, b) => a.diferencia - b.diferencia)[0] || null;
}

/*
  Devuelve el turno que aparece de forma consistente en las últimas
  3 jornadas con entrada. Una sola llegada diferente no cambia el turno.
*/
export function detectarHorarioHabitual(state, dateKey) {
  const registros = Object.entries(state?.records || {})
    .filter(([key, record]) =>
      key < dateKey &&
      record?.punches?.some(p => p.type === "entrada")
    )
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 3);

  if (registros.length < 3) return null;

  const candidatos = registros.map(([, record]) => {
    const entrada = record.punches
      .filter(p => p.type === "entrada")
      .sort((a, b) => a.timestamp - b.timestamp)[0];

    return horarioMasCercano(minutos(entrada?.referenceTime || entrada?.time));
  });

  if (candidatos.some(x => !x)) return null;

  const primero = candidatos[0];
  const mismoTurno = candidatos.every(x => x.id === primero.id);

  return mismoTurno ? primero : null;
}
