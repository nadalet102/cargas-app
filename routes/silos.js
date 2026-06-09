// routes/silos.js — Silos / tolvas: llenar, vaciar, producir, traspasar.
const router = require('express').Router();
const { pool } = require('../db');
const { _fabricantePorSilo } = require('../services/produccion');

router.get('/api/silos', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, mp.nombre AS producto
       FROM silos s LEFT JOIN materias_primas mp ON mp.id = s.mp_id
       ORDER BY s.numero, s.id`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// editar ajustes del silo (nombre / capacidad)
router.put('/api/silos/:id', async (req, res) => {
  try {
    const r = await pool.query('UPDATE silos SET nombre=$1, capacidad_kg=$2 WHERE id=$3 RETURNING *',
      [req.body.nombre||null, Number(req.body.capacidad_kg)||0, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// llenar manualmente: fija el material (si se indica) y suma kg, tope la capacidad
router.post('/api/silos/:id/llenar', async (req, res) => {
  try {
    const s = (await pool.query('SELECT * FROM silos WHERE id=$1', [req.params.id])).rows[0];
    if (!s) return res.status(404).json({error:'No existe'});
    const mp_id = req.body.mp_id || s.mp_id || null;
    const add = Number(req.body.kg) || 0;
    const nuevo = Math.min(Number(s.capacidad_kg), Number(s.kg_actual) + add);
    const r = await pool.query('UPDATE silos SET mp_id=$1, kg_actual=$2 WHERE id=$3 RETURNING *', [mp_id, nuevo, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// vaciar (deja el silo a 0 y sin material)
router.post('/api/silos/:id/vaciar', async (req, res) => {
  try {
    const r = await pool.query('UPDATE silos SET kg_actual=0, mp_id=NULL, vaciando=false WHERE id=$1 RETURNING *', [req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// producir desde el silo: registra producción (a Producción Final) y descuenta los kg
router.post('/api/silos/:id/producir', async (req, res) => {
  const b = req.body || {};
  const kgt = (Number(b.unidades)||0) * (Number(b.kg_unidad)||0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = (await client.query('SELECT * FROM silos WHERE id=$1', [req.params.id])).rows[0];
    if (!s) { await client.query('ROLLBACK'); return res.status(404).json({error:'No existe'}); }
    const fab = _fabricantePorSilo(s.numero, b.tipo||'saco');
    await client.query(
      `INSERT INTO producciones(tipo,mp_id,unidades,kg_unidad,kg_total,silo_id,estado,hecho_at,notas,fabricante)
       VALUES($1,$2,$3,$4,$5,$6,'hecho',now(),$7,$8)`,
      [b.tipo||'saco', s.mp_id||null, Number(b.unidades)||0, Number(b.kg_unidad)||0, kgt, s.id, b.notas||null, fab]);
    await client.query('UPDATE silos SET kg_actual = GREATEST(0, kg_actual - $1) WHERE id=$2', [kgt, s.id]);
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
// marcar / desmarcar "estoy vaciando"
router.patch('/api/silos/:id/vaciando', async (req, res) => {
  try {
    const r = await pool.query('UPDATE silos SET vaciando=$1 WHERE id=$2 RETURNING *', [!!req.body.vaciando, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// traspasar kg de un silo a otro
router.post('/api/silos/:id/traspasar', async (req, res) => {
  const { destino_silo_id, kg } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const o = (await client.query('SELECT * FROM silos WHERE id=$1', [req.params.id])).rows[0];
    const d = (await client.query('SELECT * FROM silos WHERE id=$1', [destino_silo_id])).rows[0];
    if (!o || !d) { await client.query('ROLLBACK'); return res.status(404).json({error:'No existe'}); }
    const pedido = Math.max(0, Number(kg)||0);
    const disponible = Math.min(pedido, Number(o.kg_actual)||0);            // no más de lo que hay
    const dNew = Math.min(Number(d.capacidad_kg), Number(d.kg_actual) + disponible); // tope capacidad destino
    const movido = dNew - Number(d.kg_actual);
    const oNew = Number(o.kg_actual) - movido;
    const dMp = (d.mp_id && Number(d.kg_actual) > 0) ? d.mp_id : (o.mp_id || d.mp_id);
    await client.query('UPDATE silos SET kg_actual=$1, mp_id=$2 WHERE id=$3', [dNew, dMp, destino_silo_id]);
    await client.query('UPDATE silos SET kg_actual=$1, mp_id=CASE WHEN $1<=0 THEN NULL ELSE mp_id END WHERE id=$2', [oNew, req.params.id]);
    await client.query('COMMIT');
    res.json({ ok:true, movido });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

module.exports = router;
