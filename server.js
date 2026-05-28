const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({limit:'20mb'}));
app.use(express.urlencoded({extended:true,limit:'20mb'}));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS transportistas (
      id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, contacto TEXT, telefono TEXT,
      email TEXT, nif TEXT, color TEXT DEFAULT '#185FA5', tarifas JSONB DEFAULT '[]',
      notas TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS cargas (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, codigo_orden TEXT,
      truck_id INTEGER REFERENCES transportistas(id) ON DELETE SET NULL,
      fecha DATE, status TEXT DEFAULT 'pendiente', color_idx INTEGER DEFAULT 0,
      coste NUMERIC, coste_modo TEXT DEFAULT 'pendiente',
      mat_camion TEXT, mat_remolque TEXT, notas TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS pedidos (
      id SERIAL PRIMARY KEY, num TEXT NOT NULL, cliente TEXT NOT NULL,
      destino TEXT NOT NULL, ubicacion TEXT, estado_prep TEXT DEFAULT 'sin_preparar',
      fecha DATE, kg NUMERIC DEFAULT 0, porte NUMERIC DEFAULT 0,
      prio TEXT DEFAULT 'normal', paradas INTEGER DEFAULT 1, obs TEXT,
      carga_id INTEGER REFERENCES cargas(id) ON DELETE SET NULL,
      orden_carga INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS categorias (
      id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, color TEXT DEFAULT '#334155'
    )`,
    `ALTER TABLE cargas ADD COLUMN IF NOT EXISTS codigo_orden TEXT`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ubicacion TEXT`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS estado_prep TEXT DEFAULT 'sin_preparar'`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS orden_carga INTEGER`,
    `ALTER TABLE cargas ADD COLUMN IF NOT EXISTS mat_camion TEXT`,
    `ALTER TABLE cargas ADD COLUMN IF NOT EXISTS mat_remolque TEXT`,
    `ALTER TABLE cargas ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS maps_url TEXT`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS direccion_descarga TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS cif TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS direccion TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS cp TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS ciudad TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'España'`,
    `CREATE TABLE IF NOT EXISTS bc_config (key TEXT PRIMARY KEY, value JSONB DEFAULT '[]')`,
    `CREATE TABLE IF NOT EXISTS bc_inbox (
      num TEXT PRIMARY KEY,
      cliente TEXT,
      destino TEXT,
      direccion_descarga TEXT,
      fecha DATE,
      kg NUMERIC,
      porte NUMERIC,
      lineas JSONB DEFAULT '[]',
      estado TEXT DEFAULT 'pendiente',
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];
  for (const sql of stmts) {
    try { await pool.query(sql); }
    catch(e) { console.warn('initDB warning:', e.message); }
  }
  console.log('DB ready');
}

// ── TRANSPORTISTAS ────────────────────────────────────────────────────────────
app.get('/api/transportistas', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM transportistas ORDER BY nombre')).rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/transportistas', async (req, res) => {
  const { nombre, contacto, telefono, email, nif, color, tarifas, notas } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO transportistas (nombre,contacto,telefono,email,nif,color,tarifas,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nombre,contacto,telefono,email,nif,color||'#185FA5',JSON.stringify(tarifas||[]),notas]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/transportistas/:id', async (req, res) => {
  const { nombre, contacto, telefono, email, nif, cif, direccion, cp, ciudad, pais, color, tarifas, notas } = req.body;
  try {
    const r = await pool.query(
      `UPDATE transportistas SET nombre=$1,contacto=$2,telefono=$3,email=$4,nif=$5,cif=$6,direccion=$7,cp=$8,ciudad=$9,pais=$10,color=$11,tarifas=$12,notas=$13 WHERE id=$14 RETURNING *`,
      [nombre,contacto,telefono,email,nif,cif||null,direccion||null,cp||null,ciudad||null,pais||'España',color,JSON.stringify(tarifas||[]),notas,req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/transportistas/:id', async (req, res) => {
  try { await pool.query('DELETE FROM transportistas WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CARGAS ────────────────────────────────────────────────────────────────────
app.get('/api/cargas', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.*, t.nombre as truck_nombre, t.color as truck_color
      FROM cargas c LEFT JOIN transportistas t ON c.truck_id=t.id
      ORDER BY c.created_at DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/cargas', async (req, res) => {
  const { name, codigo_orden, truck_id, fecha, status, color_idx, coste, coste_modo, notas } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO cargas (name,codigo_orden,truck_id,fecha,status,color_idx,coste,coste_modo,mat_camion,mat_remolque,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name,codigo_orden||null,truck_id||null,fecha||null,status||'pendiente',color_idx||0,coste||null,coste_modo||'pendiente',req.body.mat_camion||null,req.body.mat_remolque||null,notas]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/cargas/:id', async (req, res) => {
  const { name, codigo_orden, truck_id, fecha, status, color_idx, coste, coste_modo, notas, categoria_id } = req.body;
  try {
    // Leer estado anterior para detectar cambio
    const prev = (await pool.query('SELECT status FROM cargas WHERE id=$1',[req.params.id])).rows[0];
    const estadoAnterior = prev ? prev.status : null;

    const r = await pool.query(
      `UPDATE cargas SET name=$1,codigo_orden=$2,truck_id=$3,fecha=$4,status=$5,color_idx=$6,coste=$7,coste_modo=$8,mat_camion=$9,mat_remolque=$10,notas=$11,categoria_id=$12 WHERE id=$13 RETURNING *`,
      [name,codigo_orden||null,truck_id||null,fecha||null,status,color_idx,coste||null,coste_modo,req.body.mat_camion||null,req.body.mat_remolque||null,notas,categoria_id||null,req.params.id]
    );

    // Si el estado cambió, disparar alerta por email (sin bloquear la respuesta)
    if(estadoAnterior && status && estadoAnterior !== status){
      enviarAlertaCambioEstado(r.rows[0], estadoAnterior, status).catch(e=>console.warn('Alerta error:',e.message));
    }

    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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
app.delete('/api/cargas/:id', async (req, res) => {
  try {
    await pool.query('UPDATE pedidos SET carga_id=NULL WHERE carga_id=$1',[req.params.id]);
    await pool.query('DELETE FROM cargas WHERE id=$1',[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PEDIDOS ───────────────────────────────────────────────────────────────────
app.get('/api/pedidos', async (req, res) => {
  try { res.json((await pool.query('SELECT p.*,cat.nombre as categoria_nombre,cat.color as categoria_color FROM pedidos p LEFT JOIN categorias cat ON cat.id=p.categoria_id ORDER BY p.created_at DESC')).rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/pedidos', async (req, res) => {
  const { num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO pedidos (num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [num,cliente,destino,ubicacion||null,estado_prep||'sin_preparar',fecha||null,kg||0,porte||0,prio||'normal',paradas||1,obs,carga_id||null,orden_carga||null,categoria_id||null,maps_url||null,direccion_descarga||null]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/pedidos/:id', async (req, res) => {
  const { num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga } = req.body;
  try {
    const r = await pool.query(
      `UPDATE pedidos SET num=$1,cliente=$2,destino=$3,ubicacion=$4,estado_prep=$5,fecha=$6,kg=$7,porte=$8,prio=$9,paradas=$10,obs=$11,carga_id=$12,orden_carga=$13,categoria_id=$14,maps_url=$15,direccion_descarga=$16 WHERE id=$17 RETURNING *`,
      [num,cliente,destino,ubicacion||null,estado_prep||'sin_preparar',fecha||null,kg||0,porte||0,prio||'normal',paradas||1,obs,carga_id||null,orden_carga||null,categoria_id||null,maps_url||null,direccion_descarga||null,req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/pedidos/:id', async (req, res) => {
  try { await pool.query('DELETE FROM pedidos WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/pedidos/:id/carga', async (req, res) => {
  const { carga_id } = req.body;
  try {
    const r = await pool.query('UPDATE pedidos SET carga_id=$1 WHERE id=$2 RETURNING *',[carga_id||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/pedidos/:id/prep', async (req, res) => {
  const { estado_prep } = req.body;
  try {
    const r = await pool.query('UPDATE pedidos SET estado_prep=$1 WHERE id=$2 RETURNING *',[estado_prep,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/pedidos/:id/orden', async (req, res) => {
  const { orden_carga } = req.body;
  try {
    const r = await pool.query('UPDATE pedidos SET orden_carga=$1 WHERE id=$2 RETURNING *',[orden_carga,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/categorias', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM categorias ORDER BY nombre')).rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/categorias', async (req, res) => {
  try { res.json((await pool.query('INSERT INTO categorias (nombre,color) VALUES ($1,$2) RETURNING *',[req.body.nombre,req.body.color||'#334155'])).rows[0]); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/categorias/:id', async (req, res) => {
  try { res.json((await pool.query('UPDATE categorias SET nombre=$1,color=$2 WHERE id=$3 RETURNING *',[req.body.nombre,req.body.color,req.params.id])).rows[0]); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/categorias/:id', async (req, res) => {
  try { await pool.query('DELETE FROM categorias WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── IMPORTAR PDF BC ───────────────────────────────────────────────────────────
app.post('/api/importar-pdf', async (req, res) => {
  const { base64 } = req.body;
  if(!base64) return res.status(400).json({error:'No se recibió el PDF'});

  const PDFParser = require('pdf2json');
  const buf = Buffer.from(base64, 'base64');

  try {
    const text = await new Promise((resolve, reject) => {
      const parser = new PDFParser(null, 1);
      parser.on('pdfParser_dataError', e => reject(new Error(e.parserError)));
      parser.on('pdfParser_dataReady', data => {
        const t = data.Pages.map(page =>
          page.Texts.map(t => {
            try { return decodeURIComponent(t.R.map(r => r.T).join('')); }
            catch(e) { return t.R.map(r => r.T).join(''); }
          }).join(' ')
        ).join('\\n');
        resolve(t);
      });
      parser.parseBuffer(buf);
    });

    // Nº Pedido BC
    const numMatch = text.match(/(PV\d{2}\/\d{5})/);
    const num = numMatch ? numMatch[1] : null;

    // Fecha
    const fechaMatch = text.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
    let fecha_pedido = null;
    if(fechaMatch) {
      const y = fechaMatch[3].length===2 ? '20'+fechaMatch[3] : fechaMatch[3];
      fecha_pedido = y+'-'+fechaMatch[2].padStart(2,'0')+'-'+fechaMatch[1].padStart(2,'0');
    }

    // Cliente nombre (limpio — solo empresa hasta dirección)
    const clienteMatch = text.match(/Cliente:\s*([\w\s\.\,\-]+?)(?:\s{2,}|CIF:|Avda|Calle|Plaza|Pza|\d{5})/i);
    const cliente_nombre = clienteMatch ? clienteMatch[1].trim().replace(/\s+/g,' ') : null;

    // CIF cliente
    const cifMatch = text.match(/CIF:\s*([A-Z]\d{7}[A-Z0-9])/i);
    const cif_cliente = cifMatch ? cifMatch[1] : null;

    // Dirección de descarga completa
    const destiMatch = text.match(/Direcci[oó]n de descarga:\s*([\s\S]+?)(?:Cliente:|Tlf:|España\s+CIF|$)/i);
    let direccion_descarga = null;
    let destino_texto = null;
    if(destiMatch) {
      const raw = destiMatch[1].replace(/\n/g,' ').replace(/\s+/g,' ').trim();
      // Remove company name duplicate and get city/address
      direccion_descarga = raw.split(/España/i)[0].trim();
      // Short destino: city from postal code line
      const cpMatch = raw.match(/(\d{5})\s+([A-ZÁÉÍÓÚ][a-záéíóúñ\s]+)/);
      destino_texto = cpMatch ? cpMatch[2].trim()+' ('+cpMatch[1]+')' : raw.substring(0,50);
    }

    // Kg totales
    const kgMatch = text.match(/Totales\s+([\d\.]+)/);
    const kg = kgMatch ? parseFloat(kgMatch[1].replace('.','')) : null;

    // Porte — línea PORT0001 Portes Obra: último número es el importe total
    let porte = null;
    const portMatch = text.match(/PORT\w+\s+Portes?\s+Obra\s+[\d,]+\s+\d+\s+\d+\s+[\d,\.]+\s+([\d\.]+,\d{2})/i);
    if(portMatch){
      porte = parseFloat(portMatch[1].replace(/\./g,'').replace(',','.'));
    }

    // Nº documento externo (obra/ref)
    const obraMatch = text.match(/externo\s+([A-Z][^\n]{2,40}?)(?:\s{2,}|Direcci)/i);
    const obs = obraMatch ? obraMatch[1].trim() : null;

    res.json({ num, cliente_nombre, cif_cliente, destino_texto, direccion_descarga, fecha_pedido, kg, porte, obs });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ── BC CONFIG (excluidos, ignorados) ─────────────────────────────────────────
app.get('/api/bc/config/:key', async (req, res) => {
  try {
    const r = await pool.query('SELECT value FROM bc_config WHERE key=$1',[req.params.key]);
    res.json(r.rows[0]?.value || []);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/bc/config/:key', async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO bc_config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
      [req.params.key, JSON.stringify(req.body.value||[])]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── BUSINESS CENTRAL API ──────────────────────────────────────────────────────
const BC_TENANT   = process.env.BC_TENANT_ID;
const BC_CLIENT   = process.env.BC_CLIENT_ID;
const BC_SECRET   = process.env.BC_SECRET;
const BC_COMPANY  = process.env.BC_COMPANY     || 'ENVASADOS ARISAC%2C S.L.';
let   bcToken     = null;
let   bcTokenExp  = 0;

console.log('[BC] TENANT:', BC_TENANT);
console.log('[BC] CLIENT:', BC_CLIENT);
console.log('[BC] SECRET length:', BC_SECRET ? BC_SECRET.length : 'MISSING');

async function getBCToken(){
  if(bcToken && Date.now() < bcTokenExp - 60000) return bcToken;
  const https = require('https');
  const body = new URLSearchParams({
    grant_type:'client_credentials', client_id:BC_CLIENT,
    client_secret:BC_SECRET, scope:'https://api.businesscentral.dynamics.com/.default'
  }).toString();
  const data = await new Promise((res,rej)=>{
    const req=https.request({
      hostname:'login.microsoftonline.com',
      path:`/${BC_TENANT}/oauth2/v2.0/token`,
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}
    },r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));});
    req.on('error',rej);req.write(body);req.end();
  });
  if(data.error) throw new Error(data.error_description);
  bcToken = data.access_token;
  bcTokenExp = Date.now() + data.expires_in*1000;
  return bcToken;
}

async function bcRequest(path){
  const https = require('https');
  const token = await getBCToken();
  const result = await new Promise((res,rej)=>{
    const req=https.request({
      hostname:'api.businesscentral.dynamics.com',
      path,method:'GET',
      headers:{'Authorization':'Bearer '+token,'Accept':'application/json'}
    },r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}));});
    req.on('error',rej);req.end();
  });
  if(result.status!==200) throw new Error('BC API '+result.status+': '+result.body.substring(0,200));
  return JSON.parse(result.body);
}

// Get company GUID (no spaces, avoids URL escaping issues)
let bcCompanyId = null;
async function getBCCompanyId(){
  if(bcCompanyId) return bcCompanyId;
  const data = await bcRequest(`/v2.0/${BC_TENANT}/production/api/v2.0/companies`);
  const company = data.value.find(c=>c.name && c.name.includes('ARISAC')) || data.value[0];
  bcCompanyId = company.id;
  return bcCompanyId;
}

// ── BANDEJA BC (sincronizada via Power Automate) ──────────────────────────────

// POST /api/bc/sync — recibe pedidos desde Power Automate (cabeceras + lineas)
app.post('/api/bc/sync', async (req, res) => {
  try {
    const cabeceras = req.body.cabeceras || [];
    const lineas = req.body.lineas || [];

    // Agrupar líneas por documentId
    const lineasPorDoc = {};
    for(const l of lineas){
      const docId = l.documentId;
      if(!docId) continue;
      if(!lineasPorDoc[docId]) lineasPorDoc[docId] = [];
      lineasPorDoc[docId].push({
        ref_bc: l.lineObjectNumber || l.lineObjectNumber || null,
        descripcion: l.description || null,
        cantidad: l.quantity || 0,
        precio_unidad: l.unitPrice || 0,
        peso: l.netWeight || 0
      });
    }

    let nuevos = 0;
    for(const o of cabeceras){
      if(!o.number) continue;
      const lns = lineasPorDoc[o.id] || [];
      const destino = [o.shipToName, o.shipToCity].filter(Boolean).join(' — ');
      const direccion = [o.shipToAddress, o.shipToPostCode, o.shipToCity].filter(Boolean).join(', ');
      const fecha = o.shipmentDate || o.requestedDeliveryDate || null;
      // kg total: suma de pesos de líneas si existe
      const kg = lns.reduce((s,l)=>s+(l.peso||0)*(l.cantidad||0),0) || null;
      // porte: línea cuyo ref empiece por PORT
      const porteLn = lns.find(l=>(l.ref_bc||'').toUpperCase().startsWith('PORT'));
      const porte = porteLn ? (porteLn.precio_unidad*porteLn.cantidad) : null;

      const r = await pool.query(
        `INSERT INTO bc_inbox (num,cliente,destino,direccion_descarga,fecha,kg,porte,lineas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(num) DO UPDATE SET
           cliente=$2,destino=$3,direccion_descarga=$4,fecha=$5,kg=$6,porte=$7,lineas=$8,synced_at=NOW()
         WHERE bc_inbox.estado='pendiente'
         RETURNING (xmax=0) AS inserted`,
        [o.number, o.customerName||o.sellToCustomerName||null, destino, direccion,
         fecha, kg, porte, JSON.stringify(lns)]
      );
      if(r.rows[0] && r.rows[0].inserted) nuevos++;
    }
    res.json({ok:true, cabeceras:cabeceras.length, lineas:lineas.length, nuevos});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET /api/bc/pedidos — lista los pedidos pendientes de la bandeja (desde BD)
app.get('/api/bc/pedidos', async (req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT * FROM bc_inbox WHERE estado='pendiente' ORDER BY fecha NULLS LAST, num DESC`
    )).rows;
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET /api/bc/pedido/:num — detalle de un pedido de la bandeja
app.get('/api/bc/pedido/:num', async (req, res) => {
  try {
    const row = (await pool.query('SELECT * FROM bc_inbox WHERE num=$1',[req.params.num])).rows[0];
    if(!row) return res.status(404).json({error:'No encontrado'});
    res.json(row);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST /api/bc/pedido/:num/estado — marcar como añadido o rechazado
app.post('/api/bc/pedido/:num/estado', async (req, res) => {
  try {
    await pool.query('UPDATE bc_inbox SET estado=$1 WHERE num=$2',[req.body.estado||'rechazado',req.params.num]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST /api/bc/sincronizar — dispara el flujo de Power Automate manualmente
app.post('/api/bc/sincronizar', async (req, res) => {
  const FLOW_URL = process.env.PA_SYNC_URL;
  if(!FLOW_URL) return res.status(500).json({error:'PA_SYNC_URL no configurada'});
  try {
    const flowUrl = new URL(FLOW_URL);
    const result = await new Promise((resolve, reject) => {
      const r = require('https').request({
        hostname: flowUrl.hostname,
        path: flowUrl.pathname + flowUrl.search,
        method: 'POST',
        headers: {'Content-Type':'application/json','Content-Length':2}
      }, resp => { let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve({status:resp.statusCode,body:d})); });
      r.on('error', reject); r.write('{}'); r.end();
    });
    if(result.status<200||result.status>=300) throw new Error('PA respondió '+result.status);
    res.json({ok:true});
  } catch(e) { res.status(502).json({error:e.message}); }
});

// ─────────────────────────────────────────────────────────────────────────────
// (endpoints antiguos de API directa — ya no se usan, reemplazados por sync)
app.get('/api/bc/pedidos-old', async (req, res) => {
  try {
    const companyId = await getBCCompanyId();
    const base = `/v2.0/${BC_TENANT}/production/api/v2.0/companies(${companyId})/salesOrders`;
    const filter = `$filter=status eq 'Open'&$select=number,customerName,shipToName,shipToAddress,shipToCity,shipToPostCode,shipmentDate,requestedDeliveryDate,currencyCode&$top=100&$orderby=number desc`;
    const data = await bcRequest(`${base}?${filter}`);

    const pedidos = data.value.map(o => ({
      num: o.number,
      cliente: o.customerName,
      destino: [o.shipToName, o.shipToCity].filter(Boolean).join(' — '),
      direccion_descarga: [o.shipToAddress, o.shipToPostCode, o.shipToCity].filter(Boolean).join(', '),
      fecha: o.shipmentDate || o.requestedDeliveryDate || null,
    }));

    res.json(pedidos);
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/bc/pedido-old/:num — get full order with lines (API directa, sin uso)
app.get('/api/bc/pedido-old/:num', async (req, res) => {
  try {
    const companyId = await getBCCompanyId();
    const num = encodeURIComponent(req.params.num);
    const base = `/v2.0/${BC_TENANT}/production/api/v2.0/companies(${companyId})/salesOrders`;
    const data = await bcRequest(`${base}?$filter=number eq '${num}'&$expand=salesOrderLines`);
    if(!data.value.length) return res.status(404).json({error:'Pedido no encontrado'});
    const o = data.value[0];
    const lines = (o.salesOrderLines||[]);

    // Find porte line
    const porteLine = lines.find(l => l.lineType==='Item' && (l.itemId||'').toString().toUpperCase().startsWith('PORT'));
    const porte = porteLine ? porteLine.lineAmount : null;

    // Total kg (gross weight)
    const kg = lines.reduce((s,l) => s + (l.shipmentQuantity||l.quantity||0) * (l.unitWeight||0), 0) || null;

    res.json({
      num: o.number,
      cliente: o.customerName,
      destino: [o.shipToName, o.shipToCity].filter(Boolean).join(' — '),
      direccion_descarga: [o.shipToAddress, o.shipToPostCode, o.shipToCity].filter(Boolean).join(', '),
      fecha: o.shipmentDate||o.requestedDeliveryDate||null,
      porte,
      kg,
      obs: o.externalDocumentNumber||null,
    });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log(`Server on port ${PORT}`)));
