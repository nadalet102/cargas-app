// routes/comerciales.js
const router = require('express').Router();
const { pool } = require('../db');

router.get('/api/comerciales', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM comerciales WHERE activo=true ORDER BY nombre');
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/comerciales', async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO comerciales(nombre) VALUES($1) RETURNING *',[req.body.nombre]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete('/api/comerciales/:id', async (req, res) => {
  try {
    await pool.query('UPDATE comerciales SET activo=false WHERE id=$1',[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
