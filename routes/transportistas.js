// routes/transportistas.js
const router = require('express').Router();
const { pool } = require('../db');

router.get('/api/transportistas', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM transportistas ORDER BY nombre')).rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/api/transportistas', async (req, res) => {
  const { nombre, contacto, telefono, email, nif, color, tarifas, notas } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO transportistas (nombre,contacto,telefono,email,nif,color,tarifas,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nombre,contacto,telefono,email,nif,color||'#185FA5',JSON.stringify(tarifas||[]),notas]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.put('/api/transportistas/:id', async (req, res) => {
  const { nombre, contacto, telefono, email, nif, cif, direccion, cp, ciudad, pais, color, tarifas, notas } = req.body;
  try {
    const r = await pool.query(
      `UPDATE transportistas SET nombre=$1,contacto=$2,telefono=$3,email=$4,nif=$5,cif=$6,direccion=$7,cp=$8,ciudad=$9,pais=$10,color=$11,tarifas=$12,notas=$13 WHERE id=$14 RETURNING *`,
      [nombre,contacto,telefono,email,nif,cif||null,direccion||null,cp||null,ciudad||null,pais||'España',color,JSON.stringify(tarifas||[]),notas,req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.delete('/api/transportistas/:id', async (req, res) => {
  try { await pool.query('DELETE FROM transportistas WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
