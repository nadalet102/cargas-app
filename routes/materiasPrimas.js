// routes/materiasPrimas.js — Catálogo de materias primas.
const router = require('express').Router();
const { pool } = require('../db');

router.get('/api/materias-primas', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM materias_primas ORDER BY activo DESC, nombre')).rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/materias-primas', async (req, res) => {
  try {
    const nombre = (req.body.nombre||'').trim();
    if (!nombre) return res.status(400).json({error:'nombre vacío'});
    // si ya existe uno igual (ignorando mayúsculas y espacios), reutilizarlo en vez de duplicar
    const ya = await pool.query(
      "SELECT * FROM materias_primas WHERE regexp_replace(lower(trim(nombre)),'\\s+',' ','g') = regexp_replace(lower(trim($1)),'\\s+',' ','g') LIMIT 1",
      [nombre]);
    if (ya.rows.length) return res.json(ya.rows[0]);
    const r = await pool.query('INSERT INTO materias_primas(nombre) VALUES($1) RETURNING *', [nombre]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put('/api/materias-primas/:id', async (req, res) => {
  try {
    const r = await pool.query('UPDATE materias_primas SET nombre=$1, activo=$2 WHERE id=$3 RETURNING *',
      [(req.body.nombre||'').trim(), req.body.activo!==false, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete('/api/materias-primas/:id', async (req, res) => {
  try { await pool.query('DELETE FROM materias_primas WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
