// routes/cargas.js
const router = require('express').Router();
const { pool } = require('../db');
const { enviarAlertaCambioEstado } = require('../services/notificaciones');

router.get('/api/cargas', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.*, t.nombre as truck_nombre, t.color as truck_color
      FROM cargas c LEFT JOIN transportistas t ON c.truck_id=t.id
      ORDER BY c.created_at DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/api/cargas', async (req, res) => {
  const { name, codigo_orden, truck_id, fecha, status, color_idx, coste, coste_modo, notas, categoria_id, clasif } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO cargas (name,codigo_orden,truck_id,fecha,status,color_idx,coste,coste_modo,mat_camion,mat_remolque,notas,categoria_id,clasif) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name,codigo_orden||null,truck_id||null,fecha||null,status||'pendiente',color_idx||0,coste||null,coste_modo||'pendiente',req.body.mat_camion||null,req.body.mat_remolque||null,notas,categoria_id||null,clasif||null]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.put('/api/cargas/:id', async (req, res) => {
  const { name, codigo_orden, truck_id, fecha, status, color_idx, coste, coste_modo, notas, categoria_id } = req.body;
  try {
    // Leer estado anterior para detectar cambio
    const prev = (await pool.query('SELECT status FROM cargas WHERE id=$1',[req.params.id])).rows[0];
    const estadoAnterior = prev ? prev.status : null;

    const r = await pool.query(
      `UPDATE cargas SET name=$1,codigo_orden=$2,truck_id=$3,fecha=$4,status=$5,color_idx=$6,coste=$7,coste_modo=$8,mat_camion=$9,mat_remolque=$10,notas=$11,categoria_id=$12,clasif=COALESCE($14,clasif) WHERE id=$13 RETURNING *`,
      [name,codigo_orden||null,truck_id||null,fecha||null,status,color_idx,coste||null,coste_modo,req.body.mat_camion||null,req.body.mat_remolque||null,notas,categoria_id||null,req.params.id,req.body.clasif!==undefined?req.body.clasif:null]
    );

    // Si el estado cambió, disparar alerta por email (sin bloquear la respuesta)
    if(estadoAnterior && status && estadoAnterior !== status){
      enviarAlertaCambioEstado(r.rows[0], estadoAnterior, status).catch(e=>console.warn('Alerta error:',e.message));
      // Si la carga pasa a entregada, marcar sus pedidos como entregados
      if(status==='entregada'){
        await pool.query("UPDATE pedidos SET estado_prep='entregado', entregado_at=now() WHERE carga_id=$1",[req.params.id]);
      }
      // Si se revierte una entrega, devolver sus pedidos a 'preparado'
      else if(estadoAnterior==='entregada'){
        await pool.query("UPDATE pedidos SET estado_prep='preparado', entregado_at=NULL WHERE carga_id=$1",[req.params.id]);
      }
    }

    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.delete('/api/cargas/:id', async (req, res) => {
  try {
    await pool.query('UPDATE pedidos SET carga_id=NULL WHERE carga_id=$1',[req.params.id]);
    await pool.query('DELETE FROM cargas WHERE id=$1',[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
