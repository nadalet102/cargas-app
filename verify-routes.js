// verify-routes.js — Comprueba que todos los routers cargan y lista el inventario
// de rutas registradas. No conecta a la BD ni arranca el servidor.
const express = require('express');
const path = require('path');
const app = express();

app.get('/api/health', (req, res) => res.json({ ok: true }));
const ROUTERS = ['transportistas','cargas','pedidos','lineas','categorias','mantenimiento','importarPdf','preparadores','comerciales','copias','calendarios','compras','materiasPrimas','silos','producciones','viajes','pedidosCli','clientesAuto','businessCentral'];
for (const r of ROUTERS) app.use(require('./routes/' + r));
app.get('*', (req, res) => {});

const out = [];
function walk(stack) {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m]).map(m => m.toUpperCase());
      out.push(methods.join(',') + ' ' + layer.route.path);
    } else if (layer.handle && layer.handle.stack) {
      walk(layer.handle.stack);
    }
  }
}
walk(app._router.stack);
out.sort();
console.log(out.join('\n'));
console.log('\nTOTAL: ' + out.length + ' rutas');
