// routes/businessCentral.js — Configuración BC y bandeja de pedidos sincronizada
// desde Business Central vía Power Automate.
const router = require('express').Router();
const { pool } = require('../db');

// ── BC CONFIG (excluidos, ignorados) ─────────────────────────────────────────
router.get('/api/bc/config/:key', async (req, res) => {
  try {
    const r = await pool.query('SELECT value FROM bc_config WHERE key=$1',[req.params.key]);
    res.json(r.rows[0]?.value || []);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/bc/config/:key', async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO bc_config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
      [req.params.key, JSON.stringify(req.body.value||[])]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── BANDEJA BC (sincronizada via Power Automate) ──────────────────────────────

// POST /api/bc/sync — recibe pedidos desde Power Automate (cabeceras + lineas)
router.post('/api/bc/sync', async (req, res) => {
  try {
    const cabeceras = req.body.cabeceras || [];
    const lineas = req.body.lineas || [];

    // Agrupar líneas por documentId
    const lineasPorDoc = {};
    for(const l of lineas){
      const docId = l.documentId;
      if(!docId) continue;
      if(!lineasPorDoc[docId]) lineasPorDoc[docId] = [];
      lineasPorDoc[docId].push({
        ref_bc: l.lineObjectNumber || null,
        descripcion: l.description || null,
        cantidad: l.quantity || 0,
        precio_unidad: l.unitPrice || 0,
        peso: l.netWeight || 0
      });
    }

    let nuevos = 0;
    for(const o of cabeceras){
      if(!o.number) continue;
      const lns = lineasPorDoc[o.id] || [];
      const destino = [o.shipToName, o.shipToCity].filter(Boolean).join(' — ');
      const direccion = [o.shipToAddress, o.shipToPostCode, o.shipToCity].filter(Boolean).join(', ');
      const fecha = o.shipmentDate || o.requestedDeliveryDate || null;
      // kg total: suma de pesos de líneas si existe
      const kg = lns.reduce((s,l)=>s+(l.peso||0)*(l.cantidad||0),0) || null;
      // porte: línea cuyo ref empiece por PORT
      const porteLn = lns.find(l=>(l.ref_bc||'').toUpperCase().startsWith('PORT'));
      const porte = porteLn ? (porteLn.precio_unidad*porteLn.cantidad) : null;

      const r = await pool.query(
        `INSERT INTO bc_inbox (num,cliente,destino,direccion_descarga,fecha,kg,porte,lineas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(num) DO UPDATE SET
           cliente=$2,destino=$3,direccion_descarga=$4,fecha=$5,kg=$6,porte=$7,lineas=$8,synced_at=NOW()
         WHERE bc_inbox.estado='pendiente'
         RETURNING (xmax=0) AS inserted`,
        [o.number, o.customerName||o.sellToCustomerName||null, destino, direccion,
         fecha, kg, porte, JSON.stringify(lns)]
      );
      if(r.rows[0] && r.rows[0].inserted) nuevos++;
    }
    res.json({ok:true, cabeceras:cabeceras.length, lineas:lineas.length, nuevos});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET /api/bc/pedidos — lista los pedidos pendientes de la bandeja (desde BD)
router.get('/api/bc/pedidos', async (req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT * FROM bc_inbox WHERE estado='pendiente' ORDER BY fecha NULLS LAST, num DESC`
    )).rows;
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET /api/bc/pedido/:num — detalle de un pedido de la bandeja
router.get('/api/bc/pedido/:num', async (req, res) => {
  try {
    const row = (await pool.query('SELECT * FROM bc_inbox WHERE num=$1',[req.params.num])).rows[0];
    if(!row) return res.status(404).json({error:'No encontrado'});
    res.json(row);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST /api/bc/pedido/:num/estado — marcar como añadido o rechazado
router.post('/api/bc/pedido/:num/estado', async (req, res) => {
  try {
    await pool.query('UPDATE bc_inbox SET estado=$1 WHERE num=$2',[req.body.estado||'rechazado',req.params.num]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST /api/bc/sincronizar — dispara el flujo de Power Automate manualmente
router.post('/api/bc/sincronizar', async (req, res) => {
  const FLOW_URL = process.env.PA_SYNC_URL;
  if(!FLOW_URL) return res.status(500).json({error:'PA_SYNC_URL no configurada'});
  try {
    const flowUrl = new URL(FLOW_URL);
    const result = await new Promise((resolve, reject) => {
      const r = require('https').request({
        hostname: flowUrl.hostname,
        path: flowUrl.pathname + flowUrl.search,
        method: 'POST',
        headers: {'Content-Type':'application/json','Content-Length':2}
      }, resp => { let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve({status:resp.statusCode,body:d})); });
      r.on('error', reject); r.write('{}'); r.end();
    });
    if(result.status<200||result.status>=300) throw new Error('PA respondió '+result.status);
    res.json({ok:true});
  } catch(e) { res.status(502).json({error:e.message}); }
});

module.exports = router;
