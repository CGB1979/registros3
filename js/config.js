/* ==========================================================
   CONFIGURACIÓN LABORAL CENTRALIZADA
   Reglas confirmadas y parámetros configurables.
========================================================== */
export const CONFIG = {
  JORNAL_NORMAL_HORAS: 8,
  JORNADA_MEDIO_FRANCO_HORAS: 4,
  TOLERANCIA_MINUTOS: 5,
  TOLERANCIA_REDONDEO_EXTRA_MINUTOS: 10,
  REDONDEO_ENTRADA: "ninguno",
  REDONDEO_SALIDA: "ninguno",
  REDONDEO_MANUAL: "ninguno",
  REDONDEO_MINUTOS: 5,
  CANTIDAD_SABADOS_OBLIGATORIOS: 2,
  JORNAL_SABADO_OBLIGATORIO: 8,
  SABADO_OBLIGATORIO_ANTES_13_AL_50: true,
  SABADO_OBLIGATORIO_DESPUES_13_AL_100: true,
  HORAS_EXTRAS_DESPUES_DE_MEDIO_FRANCO: false,
  DIA_INICIO_FACTURACION: 25,
  MAX_RETRASO_INFERIDO_MINUTOS: 25,
  MIN_REGISTROS_PARA_INFERIR_TURNO: 3,
  DIFERENCIA_MINIMA_PARA_SUGERIR_TURNO: 10,
  COMPENSAR_DEUDAS_AUTOMATICAMENTE: false,
  FUENTE_FERIADOS_URL: "https://api.argentinadatos.com/v1/feriados/{year}"
};
export const DIAS_SEMANA=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
export const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
export const VERSION_APP="1.0.16";
export const FERIADO_EXCESO_GENERA_FRANCO=false;
