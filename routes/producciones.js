// routes/producciones.js — Producción (Big Bag / Sacos).
const router = require('express').Router();
const { pool } = require('../db');
const { _fabricantePorSilo } = require('../services/produccion');

router.get('/api/producciones', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, mp.nombre AS material, s.nombre AS silo_nombre, COALESCE(p.cliente, pc.cliente) AS cliente
       FROM producciones p
       LEFT JOIN materias_primas mp ON mp.id = p.mp_id
       LEFT JOIN silos s ON s.id = p.silo_id
       LEFT JOIN pedidos_cli_lineas pcl ON pcl.id = p.origen_linea_id
       LEFT JOIN pedidos_cli pc ON pc.id = pcl.pedido_id
       ORDER BY (p.estado='hecho'), p.orden DESC, p.creado DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/producciones', async (req, res) => {
  const b = req.body || {};
  const kgt = (Number(b.unidades)||0) * (Number(b.kg_unidad)||0);
  try {
    const r = await pool.query(
      `INSERT INTO producciones(tipo,mp_id,unidades,kg_unidad,kg_total,notas,estado,origen_linea_id,cliente)
       VALUES($1,$2,$3,$4,$5,$6,'pendiente',$7,$8) RETURNING *`,
      [b.tipo||'saco', b.mp_id||null, Number(b.unidades)||0, Number(b.kg_unidad)||0, kgt, b.notas||null, b.origen_linea_id||null, b.cliente||null]);
    if (b.origen_linea_id) {
      await pool.query("UPDATE pedidos_cli_lineas SET estado='en_produccion' WHERE id=$1", [b.origen_linea_id]);
    }
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put('/api/producciones/:id', async (req, res) => {
  const b = req.body || {};
  const kgt = (Number(b.unidades)||0) * (Number(b.kg_unidad)||0);
  try {
    const r = await pool.query(
      `UPDATE producciones SET mp_id=$1, unidades=$2, kg_unidad=$3, kg_total=$4, notas=$5, cliente=$6 WHERE id=$7 RETURNING *`,
      [b.mp_id||null, Number(b.unidades)||0, Number(b.kg_unidad)||0, kgt, b.notas||null, b.cliente||null, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// cambiar estado; al pasar a 'hecho' con descontar+silo_id, resta los kg del silo
router.patch('/api/producciones/:id/estado', async (req, res) => {
  const { estado, descontar, silo_id } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hecho = estado === 'hecho';
    const p = (await client.query('SELECT * FROM producciones WHERE id=$1', [req.params.id])).rows[0];
    let fab = p.fabricante || null;
    const usaSilo = hecho ? (silo_id || p.silo_id || null) : p.silo_id;
    if (hecho && p.tipo === 'saco' && usaSilo) {
      const sx = (await client.query('SELECT numero FROM silos WHERE id=$1', [usaSilo])).rows[0];
      if (sx) fab = _fabricantePorSilo(sx.numero, 'saco') || fab;
    }
    await client.query('UPDATE producciones SET estado=$1, hecho_at=$2, silo_id=$3, fabricante=$5 WHERE id=$4',
      [estado, hecho ? new Date() : null, usaSilo, req.params.id, fab]);
    if (hecho && descontar && silo_id) {
      await client.query('UPDATE silos SET kg_actual = GREATEST(0, kg_actual - $1) WHERE id=$2', [Number(p.kg_total)||0, silo_id]);
    }
    if (hecho && p.origen_linea_id) {
      await client.query("UPDATE pedidos_cli_lineas SET estado='hecho' WHERE id=$1", [p.origen_linea_id]);
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
// marcar/desmarcar como SERVIDO (stock terminado consumido / cargado)
router.patch('/api/producciones/:id/servido', async (req, res) => {
  const servido = !!(req.body && req.body.servido);
  try {
    const r = await pool.query('UPDATE producciones SET servido=$1, servido_at=$2 WHERE id=$3 RETURNING *',
      [servido, servido ? new Date() : null, req.params.id]);
    res.json(r.rows[0] || {ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete('/api/producciones/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = (await client.query('SELECT origen_linea_id FROM producciones WHERE id=$1', [req.params.id])).rows[0];
    await client.query('DELETE FROM producciones WHERE id=$1', [req.params.id]);
    // la línea del pedido vuelve a "pendiente" (si seguía esperando esta producción)
    if (p && p.origen_linea_id) {
      await client.query(
        `UPDATE pedidos_cli_lineas SET estado='pendiente' WHERE id=$1 AND estado='en_produccion'`,
        [p.origen_linea_id]);
    }
    await client.query('COMMIT');
    res.json({ok:true});
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
// reordenar prioridad: recibe ids en el orden deseado (el primero = más prioridad)
router.post('/api/producciones/reordenar', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE producciones SET orden=$1 WHERE id=$2', [ids.length - i, ids[i]]);
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

module.exports = router;
