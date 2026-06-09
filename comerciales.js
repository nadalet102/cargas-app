// routes/calendarios.js — Feeds ICS (suscripción en Outlook/Google, solo lectura).
const router = require('express').Router();
const { pool } = require('../db');
const { _icsWrap, _calTokenOk } = require('../services/ics');

router.get('/api/cal-token', async (req, res) => {
  try { const r=await pool.query("SELECT value#>>'{}' AS token FROM bc_config WHERE key='cal_token'"); res.json({ token: r.rows[0]?r.rows[0].token:null }); }
  catch(e){ res.status(500).json({error:e.message}); }
});
router.get('/api/cal/:token/compras.ics', async (req, res) => {
  try {
    if(!await _calTokenOk(req.params.token)) return res.status(403).send('Forbidden');
    const rows=(await pool.query(
      `SELECT c.*, to_char(c.fecha_prevista,'YYYYMMDD') AS dstart, to_char(c.fecha_prevista + INTERVAL '1 day','YYYYMMDD') AS dend,
        (SELECT string_agg(COALESCE(NULLIF(cl.descripcion,''),cl.referencia), ', ') FROM compra_lineas cl WHERE cl.compra_id=c.id) AS mats
       FROM compras c WHERE c.fecha_prevista IS NOT NULL ORDER BY c.fecha_prevista`)).rows;
    const evs=rows.map(c=>{
      const est=c.estado==='recibido'?'OK ':(c.estado==='pedido'?'En camino ':'Por pedir ');
      const tipo=c.tipo_produccion==='bb'?' [Big Bag]':c.tipo_produccion==='saco'?' [Sacos]':c.tipo_produccion==='ambos'?' [BB+Sacos]':'';
      const summary=est+(c.proveedor||'Compra')+(c.mats?(' · '+c.mats):'')+tipo;
      const desc=[c.mats?('Material: '+c.mats):'', c.tolva?('Tolva: '+c.tolva):'', 'Estado: '+(c.estado||''), c.notas||''].filter(Boolean).join('\n');
      return { uid:'compra-'+c.id+'@cargas-arisac', start:c.dstart, end:c.dend, summary, desc };
    });
    res.set('Content-Type','text/calendar; charset=utf-8'); res.set('Cache-Control','no-cache, no-store, max-age=0');
    res.send(_icsWrap('Arisac · Compras', evs));
  } catch(e){ console.error('ICS error:',e.message); res.status(500).send('ICS error: '+e.message); }
});
router.get('/api/cal/:token/cargas.ics', async (req, res) => {
  try {
    if(!await _calTokenOk(req.params.token)) return res.status(403).send('Forbidden');
    const rows=(await pool.query(
      `SELECT c.*, t.nombre AS transp,
        to_char(c.fecha,'YYYYMMDD') AS dstart, to_char(c.fecha + INTERVAL '1 day','YYYYMMDD') AS dend,
        (SELECT string_agg(DISTINCT p.cliente, ', ') FROM pedidos p WHERE p.carga_id=c.id) AS clientes,
        (SELECT string_agg(COALESCE(p.num,'?') || ' · ' || COALESCE(p.cliente,''), E'\n' ORDER BY p.orden_carga NULLS LAST, p.num) FROM pedidos p WHERE p.carga_id=c.id) AS pedidos_txt,
        (SELECT COUNT(*) FROM pedidos p WHERE p.carga_id=c.id) AS npedidos
       FROM cargas c LEFT JOIN transportistas t ON t.id=c.truck_id
       WHERE c.fecha IS NOT NULL ORDER BY c.fecha`)).rows;
    const evs=rows.map(c=>{
      const summary=(c.clientes||c.name||'Carga')+(c.transp?(' · '+c.transp):'');
      const lineas=[];
      if(c.transp) lineas.push('Transportista: '+c.transp);
      if(c.mat_camion) lineas.push('Matrícula camión: '+c.mat_camion);
      if(c.mat_remolque) lineas.push('Matrícula remolque: '+c.mat_remolque);
      lineas.push(c.pedidos_txt ? ('Pedidos:\n'+c.pedidos_txt) : ((c.npedidos||0)+' pedido(s)'));
      if(c.notas) lineas.push('Notas: '+c.notas);
      return { uid:'carga-'+c.id+'@cargas-arisac', start:c.dstart, end:c.dend, summary, desc:lineas.join('\n') };
    });
    res.set('Content-Type','text/calendar; charset=utf-8'); res.set('Cache-Control','no-cache, no-store, max-age=0');
    res.send(_icsWrap('Arisac · Cargas', evs));
  } catch(e){ console.error('ICS error:',e.message); res.status(500).send('ICS error: '+e.message); }
});

module.exports = router;
