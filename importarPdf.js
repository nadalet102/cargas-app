// routes/clientesAuto.js — Clientes que generan automáticamente tareas de Big Bag.
const router = require('express').Router();
const { pool } = require('../db');

router.get('/api/clientes-auto', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM clientes_auto ORDER BY nombre')).rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/clientes-auto', async (req, res) => {
  try { const r = await pool.query('INSERT INTO clientes_auto(nombre) VALUES($1) RETURNING *', [(req.body.nombre||'').trim()]); res.json(r.rows[0]); }
  catch(e) { res.status(500).json({error:e.message}); }
});
router.delete('/api/clientes-auto/:id', async (req, res) => {
  try { await pool.query('DELETE FROM clientes_auto WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
router.patch('/api/clientes-auto/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await pool.query('UPDATE clientes_auto SET nombre=COALESCE($1,nombre), min_bb=COALESCE($2,min_bb) WHERE id=$3 RETURNING *',
      [b.nombre!=null?(''+b.nombre).trim():null, b.min_bb!=null?Math.max(1,Number(b.min_bb)||1):null, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
