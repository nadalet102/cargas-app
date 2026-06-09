// routes/categorias.js
const router = require('express').Router();
const { pool } = require('../db');

router.get('/api/categorias', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM categorias ORDER BY nombre')).rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/categorias', async (req, res) => {
  try { res.json((await pool.query('INSERT INTO categorias (nombre,color) VALUES ($1,$2) RETURNING *',[req.body.nombre,req.body.color||'#334155'])).rows[0]); }
  catch(e) { res.status(500).json({error:e.message}); }
});
router.put('/api/categorias/:id', async (req, res) => {
  try { res.json((await pool.query('UPDATE categorias SET nombre=$1,color=$2 WHERE id=$3 RETURNING *',[req.body.nombre,req.body.color,req.params.id])).rows[0]); }
  catch(e) { res.status(500).json({error:e.message}); }
});
router.delete('/api/categorias/:id', async (req, res) => {
  try { await pool.query('DELETE FROM categorias WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
