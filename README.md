# Control Laboral — GitHub Pages

Proyecto estático: no requiere compilación ni `.github/workflows`.

## Estructura

- `index.html`
- `css/app.css`
- `js/config.js`
- `js/storage.js`
- `js/holidays.js`
- `js/time.js`
- `js/calendar.js`
- `js/summary.js`
- `js/leaves.js`
- `js/ui.js`
- `js/app.js`
- `manifest.json`
- `service-worker.js`

## Publicación

Subir los archivos conservando exactamente las carpetas `css/` y `js/`.
GitHub Pages sirve directamente `index.html`; no hace falta compilar.

## PWA

`manifest.json` y `service-worker.js` están incluidos como preparación. Para registrar el service worker hay que añadir al final de `app.js`:

```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js');
}
```

El registro se mantiene separado para que la app principal pueda probarse primero.

## Datos

Los registros se guardan en `localStorage` del navegador. Exportar JSON genera un respaldo manual.
