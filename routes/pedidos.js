// routes/pedidos.js — Pedidos de venta y sus líneas de preparación.
const router = require('express').Router();
const { pool } = require('../db');
const { enviarAlertaAgrupacion } = require('../services/notificaciones');

router.get('/api/pedidos', async (req, res) => {
  try { res.json((await pool.query('SELECT p.*,cat.nombre as categoria_nombre,cat.color as categoria_color FROM pedidos p LEFT JOIN categorias cat ON cat.id=p.categoria_id ORDER BY p.created_at DESC')).rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/api/pedidos', async (req, res) => {
  const { num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga,comercial } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO pedidos (num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga,comercial) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [num,cliente,destino,ubicacion||null,estado_prep||'sin_preparar',fecha||null,kg||0,porte||0,prio||'normal',paradas||1,obs,carga_id||null,orden_carga||null,categoria_id||null,maps_url||null,direccion_descarga||null,comercial||null]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.put('/api/pedidos/:id', async (req, res) => {
  const { num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga,comercial } = req.body;
  try {
    const r = await pool.query(
      `UPDATE pedidos SET num=$1,cliente=$2,destino=$3,ubicacion=$4,estado_prep=$5,fecha=$6,kg=$7,porte=$8,prio=$9,paradas=$10,obs=$11,carga_id=$12,orden_carga=$13,categoria_id=$14,maps_url=$15,direccion_descarga=$16,comercial=$17 WHERE id=$18 RETURNING *`,
      [num,cliente,destino,ubicacion||null,estado_prep||'sin_preparar',fecha||null,kg||0,porte||0,prio||'normal',paradas||1,obs,carga_id||null,orden_carga||null,categoria_id||null,maps_url||null,direccion_descarga||null,comercial||null,req.params.id]
    );
    const row = r.rows[0];
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.delete('/api/pedidos/:id', async (req, res) => {
  try {
    // Borrar primero las líneas (por si la FK en producción no tiene ON DELETE CASCADE)
    await pool.query('DELETE FROM pedido_lineas WHERE pedido_id=$1',[req.params.id]);
    await pool.query('DELETE FROM pedidos WHERE id=$1',[req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.patch('/api/pedidos/:id/carga', async (req, res) => {
  const { carga_id } = req.body;
  try {
    // Contar pedidos que ya tiene la carga ANTES de añadir este
    let yaTenia = 0;
    if(carga_id){
      const cnt = await pool.query('SELECT COUNT(*) FROM pedidos WHERE carga_id=$1 AND id<>$2',[carga_id,req.params.id]);
      yaTenia = parseInt(cnt.rows[0].count);
    }

    const r = await pool.query('UPDATE pedidos SET carga_id=$1 WHERE id=$2 RETURNING *',[carga_id||null,req.params.id]);

    // Si el pedido ya estaba PREPARADO y se mete en una carga → pasa directo a CARGA
    if (carga_id && r.rows[0] && r.rows[0].estado_prep === 'preparado') {
      const r2 = await pool.query("UPDATE pedidos SET estado_prep='carga' WHERE id=$1 RETURNING *",[req.params.id]);
      await pool.query('UPDATE pedido_lineas SET cargada=false WHERE pedido_id=$1',[req.params.id]);
      if (r2.rows[0]) r.rows[0] = r2.rows[0];
    }

    // Si se añade a una carga que YA tenía al menos un pedido → alerta de agrupación
    if(carga_id && yaTenia >= 1){
      enviarAlertaAgrupacion(carga_id, r.rows[0]).catch(e=>console.warn('Alerta agrupación error:',e.message));
    }

    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.patch('/api/pedidos/:id/prep', async (req, res) => {
  let { estado_prep } = req.body;
  try {
    // Si se marca preparado y el pedido YA está dentro de una carga → pasa directo a CARGA
    if (estado_prep === 'preparado') {
      const cur = await pool.query('SELECT carga_id FROM pedidos WHERE id=$1',[req.params.id]);
      if (cur.rows[0] && cur.rows[0].carga_id) estado_prep = 'carga';
    }
    const r = await pool.query("UPDATE pedidos SET estado_prep=$1, entregado_at=(CASE WHEN $1='entregado' THEN now() ELSE NULL END) WHERE id=$2 RETURNING *",[estado_prep,req.params.id]);
    // al entrar en fase de carga, las líneas empiezan sin tachar (checklist de carga nuevo)
    if (estado_prep === 'carga') {
      await pool.query('UPDATE pedido_lineas SET cargada=false WHERE pedido_id=$1',[req.params.id]);
    }
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.patch('/api/pedidos/:id/orden', async (req, res) => {
  const { orden_carga } = req.body;
  try {
    const r = await pool.query('UPDATE pedidos SET orden_carga=$1 WHERE id=$2 RETURNING *',[orden_carga,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH asignar comercial a un pedido
router.patch('/api/pedidos/:id/comercial', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET comercial=$1 WHERE id=$2 RETURNING *',[req.body.comercial||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH asignar preparador a un pedido
router.patch('/api/pedidos/:id/preparador', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET preparador=$1 WHERE id=$2 RETURNING *',[req.body.preparador||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH registro de cambios del pedido (memoria de actualizaciones por PDF)
router.patch('/api/pedidos/:id/cambios', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET cambios=$1, tiene_cambios=$2 WHERE id=$3 RETURNING *',[req.body.cambios||null, !!req.body.tiene_cambios, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH observación global del pedido (notas para el carretillero)
router.patch('/api/pedidos/:id/obs_prep', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET obs_prep=$1 WHERE id=$2 RETURNING *',[req.body.obs_prep||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH marca de agencia + medidas (largo x ancho x alto)
router.patch('/api/pedidos/:id/agencia', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET es_agencia=$1, medidas=$2 WHERE id=$3 RETURNING *',[!!req.body.es_agencia, req.body.medidas||null, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── LÍNEAS DE PEDIDO (preparación) ────────────────────────────────────────────

// GET líneas de un pedido
router.get('/api/pedidos/:id/lineas', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM pedido_lineas WHERE pedido_id=$1 ORDER BY orden,id',[req.params.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST guardar líneas de un pedido (reemplaza todas)
router.post('/api/pedidos/:id/lineas', async (req, res) => {
  const { lineas } = req.body;
  try {
    await pool.query('DELETE FROM pedido_lineas WHERE pedido_id=$1',[req.params.id]);
    if(Array.isArray(lineas)){
      for(let i=0;i<lineas.length;i++){
        const l = lineas[i];
        await pool.query(
          'INSERT INTO pedido_lineas(pedido_id,referencia,descripcion,cantidad,preparada,observaciones,orden,embalaje,kgs) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [req.params.id, l.referencia||null, l.descripcion||null, l.cantidad||0, l.preparada||false, l.observaciones||null, i, l.embalaje||null, l.kgs||null]
        );
      }
    }
    const r = await pool.query('SELECT * FROM pedido_lineas WHERE pedido_id=$1 ORDER BY orden,id',[req.params.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Listado de faltas (para Compras): líneas con falta>0 + datos de su pedido
router.get('/api/faltas', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.id AS linea_id, l.referencia, l.descripcion, l.cantidad, l.falta, l.embalaje,
              p.id AS pedido_id, p.num AS pedido_num, p.cliente, p.fecha, p.comercial
       FROM pedido_lineas l JOIN pedidos p ON p.id = l.pedido_id
       WHERE COALESCE(l.falta,0) > 0
       ORDER BY p.fecha NULLS LAST, p.num, l.referencia`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// líneas pendientes de preparar (no preparadas), para el resumen por artículo
router.get('/api/preparacion-pendiente', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.id AS linea_id, l.referencia, l.descripcion, l.cantidad, l.embalaje, COALESCE(l.falta,0) AS falta,
              p.id AS pedido_id, p.num AS pedido_num, p.cliente, p.fecha
       FROM pedido_lineas l JOIN pedidos p ON p.id = l.pedido_id
       WHERE COALESCE(l.preparada,false) = false
       ORDER BY COALESCE(NULLIF(l.descripcion,''), l.referencia), p.fecha NULLS LAST, p.num`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
