/* ==========================================================
   CONFIGURACIÓN LABORAL CENTRALIZADA
   Modificá principalmente esta sección. Las reglas confirmadas
   están activas; las pendientes quedan explícitamente configurables.
========================================================== */

export const CONFIG = {
  // Jornada normal confirmada.
  JORNAL_NORMAL_HORAS: 8,
  JORNADA_MEDIO_FRANCO_HORAS: 4,

  // Tolerancia para marcar una jornada como revisión.
  // Ej.: 5 minutos permite 7:55 como caso a revisar, no como incumplimiento automático.
  TOLERANCIA_MINUTOS: 5,

  // Tolerancia específica para redondear horas extras por jornal.
  // 10 minutos antes/después del bloque horario permiten conservar
  // la hora entera más cercana sin acumular minutos entre jornadas.
  TOLERANCIA_REDONDEO_EXTRA_MINUTOS: 10,

  // Redondeo: "ninguno", "abajo", "arriba" o "cercano".
  // Se aplica solo a la referencia de cálculo, NUNCA destruye la hora real.
  REDONDEO_ENTRADA: "ninguno",
  REDONDEO_SALIDA: "ninguno",
  REDONDEO_MANUAL: "ninguno",
  REDONDEO_MINUTOS: 5,

  // ==========================================================
  // CONFIGURACIÓN DE SÁBADOS OBLIGATORIOS
  // ==========================================================
  CANTIDAD_SABADOS_OBLIGATORIOS: 2,
  JORNAL_SABADO_OBLIGATORIO: 8,

  // ANTES DE LAS 13:00
  // true = horas extras al 50 % (regla confirmada)
  // false = horas extras al 100 %
  SABADO_OBLIGATORIO_ANTES_13_AL_50: true,

  // DESPUÉS DE LAS 13:00
  // true = horas extras al 100 % (regla confirmada)
  // false = horas extras al 50 %
  SABADO_OBLIGATORIO_DESPUES_13_AL_100: true,

  // ==========================================================
  // ///// ACA CAMBIAR SI SE HABILITAN LAS HORAS EXTRAS
  // ///// DESPUES DE UTILIZAR UN MEDIO FRANCO
  // ==========================================================
  // false = DESACTIVADO: no calcula horas extras por el excedente
  // trabajado después de las 4 horas del medio franco.
  // true = ACTIVADO: habilita el cálculo de horas extras según
  // las reglas que se definan para este caso.
  // IMPORTANTE: cambiar esto NO modifica horarios reales.
  // ==========================================================
  HORAS_EXTRAS_DESPUES_DE_MEDIO_FRANCO: false,

  // Inicio del mes de facturación. 1 = mes calendario.
  // Si luego necesitás, por ejemplo, del 21 al 20, cambiar a 21.
  DIA_INICIO_FACTURACION: 25,

  // Detección de llegada tarde/cambio de turno.
  MAX_RETRASO_INFERIDO_MINUTOS: 25,
  MIN_REGISTROS_PARA_INFERIR_TURNO: 3,
  DIFERENCIA_MINIMA_PARA_SUGERIR_TURNO: 10,

  // Compensación automática de deudas: pendiente de definir.
  // false evita descontar deudas sin una decisión explícita.
  COMPENSAR_DEUDAS_AUTOMATICAMENTE: false,

  // Fuente opcional de feriados. Dejar vacío para usar los feriados
  // incorporados y la actualización manual. No se simula conexión.
  FUENTE_FERIADOS_URL: "https://api.argentinadatos.com/v1/feriados/{year}",
};

export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

// Por defecto: NO. Puede activarse desde la configuración.
export const VERSION_APP = "1.0.14";
export const FERIADO_EXCESO_GENERA_FRANCO = false;
