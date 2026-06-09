// routes/mantenimiento.js — Items, registros y reparaciones del camión.
const router = require('express').Router();
const { pool } = require('../db');

router.get('/api/mant/items', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM mant_items WHERE activo=true ORDER BY orden, id'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
router.get('/api/mant/registros', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT g.*, i.nombre AS item_nombre, i.periodicidad
       FROM mant_registros g LEFT JOIN mant_items i ON i.id=g.item_id
       ORDER BY g.fecha DESC, g.creado DESC`);
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.post('/api/mant/registros', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await pool.query(
      'INSERT INTO mant_registros(item_id,vehiculo,fecha,km,horas,notas) VALUES($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6) RETURNING *',
      [b.item_id||null, b.vehiculo||'Camión', b.fecha||null, b.km!=null?Number(b.km):null, b.horas!=null?Number(b.horas):null, b.notas||null]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.delete('/api/mant/registros/:id', async (req, res) => {
  try { await pool.query('DELETE FROM mant_registros WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
router.get('/api/mant/reparaciones', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM mant_reparaciones ORDER BY fecha DESC, creado DESC'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
router.post('/api/mant/reparaciones', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await pool.query(
      'INSERT INTO mant_reparaciones(vehiculo,fecha,concepto,km,horas) VALUES($1,COALESCE($2,CURRENT_DATE),$3,$4,$5) RETURNING *',
      [b.vehiculo||'Camión', b.fecha||null, b.concepto||null, b.km!=null?Number(b.km):null, b.horas!=null?Number(b.horas):null]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.delete('/api/mant/reparaciones/:id', async (req, res) => {
  try { await pool.query('DELETE FROM mant_reparaciones WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

module.exports = router;
