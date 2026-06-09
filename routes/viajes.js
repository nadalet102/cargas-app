// routes/viajes.js — Camión: viajes de suministro a silos / acopio.
const router = require('express').Router();
const { pool } = require('../db');

router.get('/api/viajes', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT v.*, mp.nombre AS material, s.nombre AS silo_nombre, ds.nombre AS destino_silo_nombre
       FROM viajes v
       LEFT JOIN materias_primas mp ON mp.id = v.mp_id
       LEFT JOIN silos s ON s.id = v.silo_id
       LEFT JOIN silos ds ON ds.id = v.destino_silo_id
       ORDER BY (v.estado='hecho'), v.creado DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// crear N viajes (cola)
router.post('/api/viajes', async (req, res) => {
  const b = req.body || {};
  const n = Math.max(1, parseInt(b.n_viajes) || 1);
  try {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const r = await pool.query(
        `INSERT INTO viajes(mp_id,kg,silo_id,origen,notas,hora,estado) VALUES($1,$2,$3,$4,$5,$6,'pendiente') RETURNING id`,
        [b.mp_id||null, Number(b.kg)||0, b.silo_id||null, b.origen||'manual', b.notas||null, b.hora||null]);
      ids.push(r.rows[0].id);
    }
    res.json({ ok:true, ids });
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put('/api/viajes/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await pool.query('UPDATE viajes SET mp_id=$1, kg=$2, silo_id=$3, notas=$4, hora=COALESCE($5,hora) WHERE id=$6 RETURNING *',
      [b.mp_id||null, Number(b.kg)||0, b.silo_id||null, b.notas||null, b.hora||null, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// completar viaje: descarga a silo (suma kg + fija material) o a acopio
router.patch('/api/viajes/:id/completar', async (req, res) => {
  const { destino_tipo, destino_silo_id, kg_final, acopio } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const v = (await client.query('SELECT * FROM viajes WHERE id=$1', [req.params.id])).rows[0];
    await client.query(
      `UPDATE viajes SET estado='hecho', hecho_at=now(), destino_tipo=$1, destino_silo_id=$2, kg_final=$3, acopio=$4 WHERE id=$5`,
      [destino_tipo||null, destino_tipo==='silo'?(destino_silo_id||null):null, Number(kg_final)||0, destino_tipo==='acopio'?(acopio||null):null, req.params.id]);
    if (destino_tipo === 'silo' && destino_silo_id) {
      const s = (await client.query('SELECT * FROM silos WHERE id=$1', [destino_silo_id])).rows[0];
      if (s) {
        const nuevoMp = (s.mp_id && Number(s.kg_actual) > 0) ? s.mp_id : (v.mp_id || s.mp_id);
        const nuevoKg = Math.min(Number(s.capacidad_kg), Number(s.kg_actual) + (Number(kg_final)||0));
        await client.query('UPDATE silos SET mp_id=$1, kg_actual=$2 WHERE id=$3', [nuevoMp, nuevoKg, destino_silo_id]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
router.delete('/api/viajes/:id', async (req, res) => {
  try { await pool.query('DELETE FROM viajes WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
