// routes/lineas.js — Operaciones sobre líneas individuales de pedido (pedido_lineas).
const router = require('express').Router();
const { pool } = require('../db');

// PATCH marcar línea como cargada / no cargada
router.patch('/api/lineas/:id/cargada', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET cargada=$1 WHERE id=$2 RETURNING *',[!!req.body.cargada,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH marcar línea como preparada/no preparada
router.patch('/api/lineas/:id/prep', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET preparada=$1 WHERE id=$2 RETURNING *',[!!req.body.preparada,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH observaciones de una línea
router.patch('/api/lineas/:id/obs', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET observaciones=$1 WHERE id=$2 RETURNING *',[req.body.observaciones||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH embalaje (palets) de una línea
router.patch('/api/lineas/:id/embalaje', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET embalaje=$1 WHERE id=$2 RETURNING *',[req.body.embalaje||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH falta (unidades que faltan) de una línea
router.patch('/api/lineas/:id/falta', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET falta=$1 WHERE id=$2 RETURNING *',[Number(req.body.falta)||0,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
