// services/notificaciones.js — Alertas vía Power Automate (cambios de estado y
// agrupación de pedidos en una carga). Si PA_ALERT_URL no está configurada, no hace nada.
const { pool } = require('../db');

// Enviar alerta de cambio de estado vía Power Automate
async function enviarAlertaCambioEstado(carga, estadoAnterior, estadoNuevo){
  const FLOW_URL = process.env.PA_ALERT_URL;
  if(!FLOW_URL) return; // si no está configurada, no hace nada

  const estadoLabel={pendiente:'Pendiente',planificada:'Planificada',ruta:'En ruta',entregada:'Entregada'};

  // Datos del transportista y pedidos
  let transportista = 'Sin asignar';
  if(carga.truck_id){
    const tr = (await pool.query('SELECT nombre FROM transportistas WHERE id=$1',[carga.truck_id])).rows[0];
    if(tr) transportista = tr.nombre;
  }
  const peds = (await pool.query('SELECT num,cliente,destino FROM pedidos WHERE carga_id=$1 ORDER BY orden_carga',[carga.id])).rows;
  const pedidosTxt = peds.length
    ? peds.map(p=>`• ${p.num||''} - ${p.cliente} (${p.destino||'—'})`).join('\n')
    : 'Sin pedidos';

  const payload = {
    carga: carga.name || 'Sin nombre',
    estado_anterior: estadoLabel[estadoAnterior] || estadoAnterior,
    estado_nuevo: estadoLabel[estadoNuevo] || estadoNuevo,
    transportista,
    fecha: carga.fecha ? new Date(carga.fecha).toLocaleDateString('es-ES') : 'Sin fecha',
    pedidos: pedidosTxt
  };

  const flowUrl = new URL(FLOW_URL);
  const body = JSON.stringify(payload);
  await new Promise((resolve,reject)=>{
    const r = require('https').request({
      hostname: flowUrl.hostname,
      path: flowUrl.pathname + flowUrl.search,
      method: 'POST',
      headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, resp=>{ let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve(d)); });
    r.on('error',reject); r.write(body); r.end();
  });
}

// Enviar alerta cuando se agrupan pedidos en una carga
async function enviarAlertaAgrupacion(cargaId, pedidoNuevo){
  const FLOW_URL = process.env.PA_ALERT_URL;
  if(!FLOW_URL) return;

  const carga = (await pool.query('SELECT * FROM cargas WHERE id=$1',[cargaId])).rows[0];
  if(!carga) return;

  let transportista = 'Sin asignar';
  if(carga.truck_id){
    const tr = (await pool.query('SELECT nombre FROM transportistas WHERE id=$1',[carga.truck_id])).rows[0];
    if(tr) transportista = tr.nombre;
  }
  const peds = (await pool.query('SELECT num,cliente,destino FROM pedidos WHERE carga_id=$1 ORDER BY orden_carga',[cargaId])).rows;
  const pedidosTxt = peds.map(p=>`• ${p.num||''} - ${p.cliente} (${p.destino||'—'})`).join('\n');

  const payload = {
    carga: carga.name || 'Sin nombre',
    estado_anterior: 'Pedidos agrupados',
    estado_nuevo: `Se ha añadido ${pedidoNuevo.cliente} (${peds.length} pedidos en total)`,
    transportista,
    fecha: carga.fecha ? new Date(carga.fecha).toLocaleDateString('es-ES') : 'Sin fecha',
    pedidos: pedidosTxt
  };

  const flowUrl = new URL(FLOW_URL);
  const body = JSON.stringify(payload);
  await new Promise((resolve,reject)=>{
    const r = require('https').request({
      hostname: flowUrl.hostname,
      path: flowUrl.pathname + flowUrl.search,
      method: 'POST',
      headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, resp=>{ let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve(d)); });
    r.on('error',reject); r.write(body); r.end();
  });
}

module.exports = { enviarAlertaCambioEstado, enviarAlertaAgrupacion };
