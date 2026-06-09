// routes/preparadores.js
const router = require('express').Router();
const { pool } = require('../db');

router.get('/api/preparadores', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM preparadores WHERE activo=true ORDER BY nombre');
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/preparadores', async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO preparadores(nombre) VALUES($1) RETURNING *',[req.body.nombre]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete('/api/preparadores/:id', async (req, res) => {
  try {
    await pool.query('UPDATE preparadores SET activo=false WHERE id=$1',[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
