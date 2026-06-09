// services/produccion.js — Helpers compartidos de producción (fabricante por silo
// y recálculo del estado de un pedido de cliente).
const { pool } = require('../db');

// Fabricante según el número de silo (solo aplica a sacos)
function _fabricantePorSilo(numero, tipo){
  if(tipo!=='saco') return null;
  const n=Number(numero);
  if(n===0||n===1) return 'PKT';
  if(n===3||n===4||n===5) return 'ESSEGI';
  return null;
}

// Recalcula el estado del pedido de cliente: pasa a 'preparado' cuando TODAS las líneas
// (menos los palets) están preparadas; vuelve a 'revision' si no. No toca carga/cargado.
async function _recalcEstadoCli(pedidoId){
  const lins = (await pool.query('SELECT descripcion, preparado FROM pedidos_cli_lineas WHERE pedido_id=$1',[pedidoId])).rows;
  const cur = (await pool.query('SELECT estado FROM pedidos_cli WHERE id=$1',[pedidoId])).rows[0];
  if (!cur || (cur.estado!=='revision' && cur.estado!=='preparado')) return;
  const noPalet = lins.filter(l => !/pal[eé]/i.test(l.descripcion||''));
  const todo = noPalet.length>0 && noPalet.every(l => l.preparado);
  const nuevo = todo ? 'preparado' : 'revision';
  if (nuevo !== cur.estado) await pool.query('UPDATE pedidos_cli SET estado=$1 WHERE id=$2',[nuevo,pedidoId]);
}

module.exports = { _fabricantePorSilo, _recalcEstadoCli };
