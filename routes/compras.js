// routes/compras.js — Pedidos de compra (cabecera + líneas).
const router = require('express').Router();
const { pool } = require('../db');

// listar todas las compras, cada una con su array de líneas
router.get('/api/compras', async (req, res) => {
  try {
    const cab = await pool.query('SELECT * FROM compras ORDER BY (fecha_prevista IS NULL), fecha_prevista, creado DESC');
    const lin = await pool.query('SELECT * FROM compra_lineas ORDER BY id');
    const porCompra = {};
    lin.rows.forEach(l => { (porCompra[l.compra_id] = porCompra[l.compra_id] || []).push(l); });
    res.json(cab.rows.map(c => ({ ...c, lineas: porCompra[c.id] || [] })));
  } catch(e) { res.status(500).json({error:e.message}); }
});
// crear un pedido de compra con sus líneas
router.post('/api/compras', async (req, res) => {
  const c = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO compras(proveedor,estado,fecha_prevista,tolva,transportista,transportista_tel,pedidos_rel,prioridad,notas,tipo_produccion,kg_bb,kg_saco,hora,formato)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [c.proveedor||null, c.estado||'por_pedir', c.fecha_prevista||null, c.tolva||null,
       c.transportista||null, c.transportista_tel||null, c.pedidos_rel||null, c.prioridad||'normal', c.notas||null,
       c.tipo_produccion||null, c.kg_bb!=null?Number(c.kg_bb):null, c.kg_saco!=null?Number(c.kg_saco):null, c.hora||null, c.formato||'granel']);
    const compra = r.rows[0];
    for (const l of (c.lineas||[])) {
      await client.query(
        `INSERT INTO compra_lineas(compra_id,referencia,descripcion,cantidad,unidad,falta_linea_id)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [compra.id, l.referencia||null, l.descripcion||null, Number(l.cantidad)||0, l.unidad||null, l.falta_linea_id||null]);
    }
    await client.query('COMMIT');
    res.json({ ok:true, id: compra.id });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
// editar cabecera + reemplazar líneas
router.put('/api/compras/:id', async (req, res) => {
  const c = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE compras SET proveedor=$1,estado=$2,fecha_prevista=$3,tolva=$4,transportista=$5,
       transportista_tel=$6,pedidos_rel=$7,prioridad=$8,notas=$9,tipo_produccion=$11,kg_bb=$12,kg_saco=$13,hora=$14,formato=$15 WHERE id=$10`,
      [c.proveedor||null, c.estado||'por_pedir', c.fecha_prevista||null, c.tolva||null,
       c.transportista||null, c.transportista_tel||null, c.pedidos_rel||null, c.prioridad||'normal', c.notas||null, req.params.id,
       c.tipo_produccion||null, c.kg_bb!=null?Number(c.kg_bb):null, c.kg_saco!=null?Number(c.kg_saco):null, c.hora||null, c.formato||'granel']);
    await client.query('DELETE FROM compra_lineas WHERE compra_id=$1', [req.params.id]);
    for (const l of (c.lineas||[])) {
      await client.query(
        `INSERT INTO compra_lineas(compra_id,referencia,descripcion,cantidad,unidad,falta_linea_id)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [req.params.id, l.referencia||null, l.descripcion||null, Number(l.cantidad)||0, l.unidad||null, l.falta_linea_id||null]);
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
// cambiar estado (al recibir: quita la falta y avisa en el pedido de venta)
router.patch('/api/compras/:id/estado', async (req, res) => {
  const estado = req.body.estado;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recibido = estado === 'recibido';
    await client.query('UPDATE compras SET estado=$1, fecha_recibido=$2, tolva=COALESCE($4,tolva) WHERE id=$3',
      [estado, recibido ? new Date() : null, req.params.id, req.body.tolva||null]);
    if (recibido) {
      const lin = await client.query('SELECT * FROM compra_lineas WHERE compra_id=$1', [req.params.id]);
      for (const l of lin.rows) {
        if (!l.falta_linea_id) continue;
        const pl = await client.query('SELECT pedido_id, descripcion FROM pedido_lineas WHERE id=$1', [l.falta_linea_id]);
        if (!pl.rows.length) continue;
        const pedidoId = pl.rows[0].pedido_id;
        await client.query('UPDATE pedido_lineas SET falta=0 WHERE id=$1', [l.falta_linea_id]);
        const aviso = '🟢 Llegó material que faltaba: ' + (l.descripcion || pl.rows[0].descripcion || '') + (l.cantidad ? ' (' + l.cantidad + (l.unidad ? ' ' + l.unidad : '') + ')' : '');
        const fecha = new Date().toLocaleDateString('es-ES');
        await client.query(
          `UPDATE pedidos SET tiene_cambios=true,
             cambios = $1 || E'\n' || COALESCE(cambios,'') WHERE id=$2`,
          ['[' + fecha + '] ' + aviso, pedidoId]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
router.delete('/api/compras/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM compra_lineas WHERE compra_id=$1', [req.params.id]);
    await pool.query('DELETE FROM compras WHERE id=$1', [req.params.id]);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
