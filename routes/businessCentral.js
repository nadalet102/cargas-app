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

// POST /api/bc/importar — importa UN pedido desde un flujo de Power Automate
// lanzado desde el menú "Automatizar" de Business Central. Acepta un JSON plano
// y lo deja en la bandeja "Pedidos BC" (estado pendiente) para revisar y añadir.
// Seguridad opcional: si BC_IMPORT_TOKEN está definido, exige la cabecera
// x-import-token con ese valor.
router.post('/api/bc/importar', async (req, res) => {
  const tok = process.env.BC_IMPORT_TOKEN;
  if (tok && req.get('x-import-token') !== tok) return res.status(401).json({ error: 'token inválido' });
  const b = req.body || {};
  if (!b.num) return res.status(400).json({ error: 'falta el número de pedido (num)' });
  try {
    // Las líneas pueden venir como array o como texto JSON (Power Automate, al usar
    // @{body('Seleccionar')} entre comillas, las manda "stringificadas"). Aceptamos ambas.
    let rawLineas = b.lineas;
    if (typeof rawLineas === 'string') { try { rawLineas = JSON.parse(rawLineas); } catch (e) { rawLineas = []; } }
    // Normalizar líneas. Mismas reglas que el import de PDF: la línea de portes
    // (referencia "PORT…") no es artículo (no va a la preparación) y su importe
    // se usa como porte del pedido.
    const lineas = (Array.isArray(rawLineas) ? rawLineas : []).map(l => {
      const ref = l.referencia || l.ref || l.ref_bc || null;
      const cant = Number(l.cantidad != null ? l.cantidad : l.quantity) || 0;
      const precio = Number(l.precio != null ? l.precio : l.precio_unidad) || 0;
      return {
        referencia: ref,
        descripcion: l.descripcion || l.description || null,
        cantidad: cant,
        kgs: Number(l.peso != null ? l.peso : l.kgs) || 0,
        precio,
        es_articulo: !!ref && !/^PORT/i.test(ref)
      };
    });
    // Porte: de la línea PORT (precio × cantidad) salvo que venga dado explícitamente
    const porteLn = lineas.find(l => /^PORT/i.test(l.referencia || ''));
    const porte = b.porte != null ? Number(b.porte)
                : (porteLn ? Math.round(porteLn.precio * (porteLn.cantidad || 1) * 100) / 100 : null);
    // Kg total: suma de peso × cantidad de las líneas salvo que venga dado
    const kg = b.kg != null ? Number(b.kg)
             : (lineas.reduce((s, l) => s + (l.kgs || 0) * (l.cantidad || 0), 0) || null);
    const destino = b.destino || null;
    const direccion = b.direccion_descarga || b.direccion || null;
    const r = await pool.query(
      `INSERT INTO bc_inbox (num,cliente,destino,direccion_descarga,fecha,kg,porte,lineas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(num) DO UPDATE SET
         cliente=$2,destino=$3,direccion_descarga=$4,fecha=$5,kg=$6,porte=$7,lineas=$8,synced_at=NOW()
       WHERE bc_inbox.estado='pendiente'
       RETURNING (xmax=0) AS inserted`,
      [b.num, b.cliente || null, destino, direccion, b.fecha || null, kg, porte, JSON.stringify(lineas)]
    );
    res.json({ ok: true, num: b.num, nuevo: !!(r.rows[0] && r.rows[0].inserted), lineas: lineas.length, porte, kg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
