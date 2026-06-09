// routes/copias.js — Copia de seguridad: descargar, restaurar y snapshots automáticos.
const router = require('express').Router();
const { pool } = require('../db');
const { BACKUP_TABLES, _dumpDatos, hacerSnapshot } = require('../services/copias');

// Descargar copia: vuelca todas las tablas a un JSON
router.get('/api/backup', async (req, res) => {
  try { res.json(await _dumpDatos()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Restaurar copia: reemplaza TODOS los datos por los del JSON (en una transacción)
router.post('/api/restore', async (req, res) => {
  const data = req.body || {};
  // comprobación mínima de que parece una copia válida
  if (!data.pedidos && !data.cargas) return res.status(400).json({ error: 'El archivo no parece una copia válida' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // borrar de hijos a padres
    for (const t of [...BACKUP_TABLES].reverse()) {
      try { await client.query('DELETE FROM '+t); } catch(e) {}
    }
    // insertar de padres a hijos, conservando los IDs
    for (const t of BACKUP_TABLES) {
      const rows = Array.isArray(data[t]) ? data[t] : [];
      for (const row of rows) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        const vals = cols.map(c => {
          const v = row[c];
          return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v; // jsonb
        });
        const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
        await client.query('INSERT INTO "' + t + '" (' + cols.map(c => '"' + c + '"').join(',') + ') VALUES (' + ph + ')', vals);
      }
      // recolocar la secuencia del id (si la tabla tiene id serial)
      try { await client.query("SELECT setval(pg_get_serial_sequence('" + t + "','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM " + t + "),1))"); } catch(e) {}
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch(e) {
    try { await client.query('ROLLBACK'); } catch(_) {}
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// listar copias (sin los datos, para no cargar de más)
router.get('/api/backups', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, fecha, tipo FROM backups ORDER BY fecha DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// obtener una copia concreta (con datos)
router.get('/api/backups/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, fecha, tipo, datos FROM backups WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// forzar una copia ahora
router.post('/api/backups', async (req, res) => {
  await hacerSnapshot('manual');
  res.json({ ok: true });
});

module.exports = router;
