# Cargas Arisac

App de planificación logística de ENVASADOS ARISAC: pedidos, cargas, preparación,
compras, silos/tolvas, producción (big bags / sacos), viajes de camión,
mantenimiento y bandeja de pedidos sincronizada desde Business Central.

Node.js + Express + PostgreSQL. PWA (instalable, funciona offline en lectura).

## Arranque

```bash
npm install
# requiere la variable de entorno DATABASE_URL (PostgreSQL)
npm start          # node server.js  →  http://localhost:3000
```

Variables de entorno opcionales:

- `DATABASE_URL` — conexión a PostgreSQL (obligatoria en producción).
- `PORT` — puerto (por defecto 3000).
- `PA_ALERT_URL` — webhook de Power Automate para alertas de cambio de estado/agrupación.
- `PA_SYNC_URL` — webhook de Power Automate para sincronizar la bandeja de Business Central.

## Estructura

```
server.js                  Punto de entrada: configura Express y monta los routers.
version.js                 API_VERSION (la app avisa si el servidor desplegado se quedó atrás).
db.js                      Pool de PostgreSQL + initDB() (esquema y datos semilla).
routes/                    Un router por dominio (rutas /api/*):
  transportistas, cargas, pedidos, lineas, categorias, mantenimiento,
  importarPdf, preparadores, comerciales, copias, calendarios, compras,
  materiasPrimas, silos, producciones, viajes, pedidosCli, clientesAuto,
  businessCentral
services/                  Lógica compartida sin rutas:
  notificaciones.js        Alertas vía Power Automate.
  copias.js                Volcado/snapshot de la base de datos.
  ics.js                   Generación de feeds de calendario (ICS).
  produccion.js            Helpers (_fabricantePorSilo, _recalcEstadoCli).
parseLineas.js             Parser de líneas del PDF de Business Central.
public/
  index.html               Marcado de la app (una sola página, ~25 vistas).
  css/app.css              Estilos: sistema de tokens (tema claro/oscuro) + componentes.
  js/app.js                Lógica de la interfaz (scripts clásicos en ámbito global).
  manifest.json, sw.js     PWA (service worker network-first).
```

## Tema claro / oscuro

El tema se controla con el atributo `data-theme` en `<html>` (`light` | `dark`).
Un script en el `<head>` lo aplica antes de pintar (evita parpadeo) leyendo
`localStorage.tema` o, si no hay, la preferencia del sistema. El botón de la luna/sol
en la barra superior llama a `toggleTheme()`. Todo el color vive en variables CSS
definidas en `:root` (claro) y `[data-theme="dark"]` (oscuro), incluidos los colores
de estado de carga que el JS aplica en línea (`--st-*`).

## Desarrollo sin base de datos

Para iterar la interfaz sin PostgreSQL hay un servidor mock con datos de ejemplo:

```bash
node mock-server.js        # http://localhost:3000, sirve public/ y responde /api/* en memoria
```

No toca ninguna base de datos real. Útil para trabajar el diseño y la maquetación.

## Utilidades

- `verify-routes.js` — lista el inventario de rutas registradas y comprueba que todos
  los routers cargan sin errores (no conecta a la BD). `node verify-routes.js`.

## Copias de seguridad

El servidor guarda un snapshot automático en la tabla `backups` al arrancar y cada 24 h
(conserva los últimos 14). Desde la app se puede descargar/restaurar una copia completa
en JSON (`/api/backup`, `/api/restore`).
