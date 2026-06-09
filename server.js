// server.js — Punto de entrada. Configura Express, monta los routers por dominio
// (ver carpeta routes/) e inicializa la base de datos. La lógica vive en routes/* y
// services/*; aquí solo queda el cableado.
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db');
const { API_VERSION } = require('./version');
const { hacerSnapshot } = require('./services/copias');

const app = express();
app.use(cors());
app.use(express.json({limit:'20mb'}));
app.use(express.urlencoded({extended:true,limit:'20mb'}));
app.use(express.static(path.join(__dirname, 'public')));

// Salud / versión del servidor (para detectar despliegues desactualizados)
app.get('/api/health', (req, res) => res.json({ ok: true, version: API_VERSION }));

// ── Rutas por dominio ─────────────────────────────────────────────────────────
app.use(require('./routes/transportistas'));
app.use(require('./routes/cargas'));
app.use(require('./routes/pedidos'));
app.use(require('./routes/lineas'));
app.use(require('./routes/categorias'));
app.use(require('./routes/mantenimiento'));
app.use(require('./routes/importarPdf'));
app.use(require('./routes/preparadores'));
app.use(require('./routes/comerciales'));
app.use(require('./routes/copias'));
app.use(require('./routes/calendarios'));
app.use(require('./routes/compras'));
app.use(require('./routes/materiasPrimas'));
app.use(require('./routes/silos'));
app.use(require('./routes/producciones'));
app.use(require('./routes/viajes'));
app.use(require('./routes/pedidosCli'));
app.use(require('./routes/clientesAuto'));
app.use(require('./routes/businessCentral'));

// SPA fallback: cualquier otra ruta sirve la app
app.get('*', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`Server on port ${PORT}`));
  // copia de seguridad automática: una al arrancar y otra cada 24h
  setTimeout(() => hacerSnapshot('auto'), 5000);
  setInterval(() => hacerSnapshot('auto'), 24 * 60 * 60 * 1000);
});
