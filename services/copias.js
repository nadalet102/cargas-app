// services/copias.js — Copia de seguridad: volcado completo de la BD y snapshots.
const { pool } = require('../db');
const { API_VERSION } = require('../version');

const BACKUP_TABLES = ['bc_config','transportistas','categorias','preparadores','comerciales','materias_primas','silos','producciones','viajes','compras','cargas','pedidos','pedido_lineas','compra_lineas','pedidos_cli','pedidos_cli_lineas','clientes_auto','bc_inbox','mant_items','mant_registros','mant_reparaciones'];

// Construye el volcado completo de la base de datos
async function _dumpDatos() {
  const data = { _meta: { version: API_VERSION, fecha: new Date().toISOString() } };
  for (const t of BACKUP_TABLES) {
    try { const r = await pool.query('SELECT * FROM ' + t); data[t] = r.rows; }
    catch(e) { data[t] = []; }
  }
  return data;
}

// Copia automática guardada en la BD (conserva solo las últimas 14)
async function hacerSnapshot(tipo) {
  try {
    const datos = await _dumpDatos();
    await pool.query('INSERT INTO backups(tipo, datos) VALUES($1, $2)', [tipo || 'auto', datos]);
    await pool.query('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY fecha DESC LIMIT 14)');
  } catch(e) { console.error('snapshot error:', e.message); }
}

module.exports = { BACKUP_TABLES, _dumpDatos, hacerSnapshot };
