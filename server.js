const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { extraerLineas, extraerTodasLineas, extraerCliente } = require('./parseLineas');

// Versión de la API: súbela cuando cambie server.js. La app compara con la que
// necesita y avisa si el servidor desplegado se quedó atrás (no reiniciado).
const API_VERSION = 21;

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
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS preparador TEXT`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS obs_prep TEXT`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS es_agencia BOOLEAN DEFAULT false`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS medidas TEXT`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cambios TEXT`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tiene_cambios BOOLEAN DEFAULT false`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS comercial TEXT`,
    `CREATE TABLE IF NOT EXISTS comerciales (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, activo BOOLEAN DEFAULT true)`,
    `CREATE TABLE IF NOT EXISTS backups (id SERIAL PRIMARY KEY, fecha TIMESTAMPTZ DEFAULT now(), tipo TEXT DEFAULT 'auto', datos JSONB)`,
    `CREATE TABLE IF NOT EXISTS compras (
      id SERIAL PRIMARY KEY,
      proveedor TEXT,
      estado TEXT DEFAULT 'por_pedir',
      fecha_prevista DATE,
      fecha_recibido DATE,
      tolva TEXT,
      transportista TEXT,
      transportista_tel TEXT,
      pedidos_rel TEXT,
      prioridad TEXT DEFAULT 'normal',
      notas TEXT,
      creado TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS compra_lineas (
      id SERIAL PRIMARY KEY,
      compra_id INTEGER REFERENCES compras(id) ON DELETE CASCADE,
      referencia TEXT,
      descripcion TEXT,
      cantidad NUMERIC DEFAULT 0,
      unidad TEXT,
      falta_linea_id INTEGER
    )`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS cif TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS direccion TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS cp TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS ciudad TEXT`,
    `ALTER TABLE transportistas ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'España'`,
    `CREATE TABLE IF NOT EXISTS bc_config (key TEXT PRIMARY KEY, value JSONB DEFAULT '[]')`,
    `CREATE TABLE IF NOT EXISTS pedido_lineas (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
      referencia TEXT,
      descripcion TEXT,
      cantidad NUMERIC DEFAULT 0,
      preparada BOOLEAN DEFAULT false,
      observaciones TEXT,
      orden INTEGER DEFAULT 0
    )`,
    `ALTER TABLE pedido_lineas ADD COLUMN IF NOT EXISTS observaciones TEXT`,
    `ALTER TABLE pedido_lineas ADD COLUMN IF NOT EXISTS embalaje TEXT`,
    `ALTER TABLE pedido_lineas ADD COLUMN IF NOT EXISTS kgs NUMERIC`,
    `ALTER TABLE pedido_lineas ADD COLUMN IF NOT EXISTS falta NUMERIC DEFAULT 0`,
    `ALTER TABLE producciones ADD COLUMN IF NOT EXISTS origen_linea_id INTEGER`,
    `ALTER TABLE viajes ADD COLUMN IF NOT EXISTS hora TEXT`,
    `CREATE TABLE IF NOT EXISTS pedidos_cli (
      id SERIAL PRIMARY KEY,
      cliente TEXT,
      notas TEXT,
      creado TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS pedidos_cli_lineas (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER REFERENCES pedidos_cli(id) ON DELETE CASCADE,
      descripcion TEXT,
      cantidad NUMERIC DEFAULT 0,
      unidad TEXT,
      estado TEXT DEFAULT 'pendiente'
    )`,
    `CREATE TABLE IF NOT EXISTS clientes_auto (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      creado TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS preparadores (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      activo BOOLEAN DEFAULT true
    )`,
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
    `CREATE TABLE IF NOT EXISTS materias_primas (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      activo BOOLEAN DEFAULT true,
      creado TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS silos (
      id SERIAL PRIMARY KEY,
      numero INTEGER,
      nombre TEXT,
      capacidad_kg NUMERIC DEFAULT 50000,
      mp_id INTEGER,
      kg_actual NUMERIC DEFAULT 0,
      vaciando BOOLEAN DEFAULT false
    )`,
    `CREATE TABLE IF NOT EXISTS producciones (
      id SERIAL PRIMARY KEY,
      tipo TEXT,
      mp_id INTEGER,
      unidades NUMERIC DEFAULT 0,
      kg_unidad NUMERIC DEFAULT 0,
      kg_total NUMERIC DEFAULT 0,
      silo_id INTEGER,
      estado TEXT DEFAULT 'pendiente',
      notas TEXT,
      fecha DATE DEFAULT CURRENT_DATE,
      hecho_at TIMESTAMPTZ,
      origen_linea_id INTEGER,
      creado TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS viajes (
      id SERIAL PRIMARY KEY,
      mp_id INTEGER,
      kg NUMERIC DEFAULT 0,
      silo_id INTEGER,
      fecha DATE DEFAULT CURRENT_DATE,
      estado TEXT DEFAULT 'pendiente',
      destino_tipo TEXT,
      destino_silo_id INTEGER,
      kg_final NUMERIC,
      acopio TEXT,
      origen TEXT DEFAULT 'manual',
      notas TEXT,
      hora TEXT,
      hecho_at TIMESTAMPTZ,
      creado TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS compras_mp (
      id SERIAL PRIMARY KEY,
      mp_id INTEGER,
      proveedor TEXT,
      kg NUMERIC DEFAULT 0,
      estado TEXT DEFAULT 'pendiente',
      fecha DATE,
      hora TEXT,
      silo_id INTEGER,
      kg_recibido NUMERIC,
      recibido_at TIMESTAMPTZ,
      notas TEXT,
      creado TIMESTAMPTZ DEFAULT now()
    )`,
  ];
  for (const sql of stmts) {
    try { await pool.query(sql); }
    catch(e) { console.warn('initDB warning:', e.message); }
  }
  // sembrar 5 silos la primera vez (1-4: 50.000 kg · 5: 25.000 kg)
  try {
    const c = await pool.query('SELECT COUNT(*)::int AS n FROM silos');
    if (c.rows[0].n === 0) {
      for (let i = 1; i <= 5; i++) {
        await pool.query('INSERT INTO silos(numero,nombre,capacidad_kg) VALUES($1,$2,$3)', [i, 'Silo ' + i, i === 5 ? 25000 : 50000]);
      }
    }
  } catch(e) { console.warn('seed silos:', e.message); }
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
      // Si la carga pasa a entregada, marcar sus pedidos como entregados
      if(status==='entregada'){
        await pool.query("UPDATE pedidos SET estado_prep='entregado' WHERE carga_id=$1",[req.params.id]);
      }
      // Si se revierte una entrega, devolver sus pedidos a 'preparado'
      else if(estadoAnterior==='entregada'){
        await pool.query("UPDATE pedidos SET estado_prep='preparado' WHERE carga_id=$1",[req.params.id]);
      }
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
  const { num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga,comercial } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO pedidos (num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga,comercial) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [num,cliente,destino,ubicacion||null,estado_prep||'sin_preparar',fecha||null,kg||0,porte||0,prio||'normal',paradas||1,obs,carga_id||null,orden_carga||null,categoria_id||null,maps_url||null,direccion_descarga||null,comercial||null]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/pedidos/:id', async (req, res) => {
  const { num,cliente,destino,ubicacion,estado_prep,fecha,kg,porte,prio,paradas,obs,carga_id,orden_carga,categoria_id,maps_url,direccion_descarga,comercial } = req.body;
  try {
    const r = await pool.query(
      `UPDATE pedidos SET num=$1,cliente=$2,destino=$3,ubicacion=$4,estado_prep=$5,fecha=$6,kg=$7,porte=$8,prio=$9,paradas=$10,obs=$11,carga_id=$12,orden_carga=$13,categoria_id=$14,maps_url=$15,direccion_descarga=$16,comercial=$17 WHERE id=$18 RETURNING *`,
      [num,cliente,destino,ubicacion||null,estado_prep||'sin_preparar',fecha||null,kg||0,porte||0,prio||'normal',paradas||1,obs,carga_id||null,orden_carga||null,categoria_id||null,maps_url||null,direccion_descarga||null,comercial||null,req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    // Borrar primero las líneas (por si la FK en producción no tiene ON DELETE CASCADE)
    await pool.query('DELETE FROM pedido_lineas WHERE pedido_id=$1',[req.params.id]);
    await pool.query('DELETE FROM pedidos WHERE id=$1',[req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/pedidos/:id/carga', async (req, res) => {
  const { carga_id } = req.body;
  try {
    // Contar pedidos que ya tiene la carga ANTES de añadir este
    let yaTenia = 0;
    if(carga_id){
      const cnt = await pool.query('SELECT COUNT(*) FROM pedidos WHERE carga_id=$1 AND id<>$2',[carga_id,req.params.id]);
      yaTenia = parseInt(cnt.rows[0].count);
    }

    const r = await pool.query('UPDATE pedidos SET carga_id=$1 WHERE id=$2 RETURNING *',[carga_id||null,req.params.id]);

    // Si se añade a una carga que YA tenía al menos un pedido → alerta de agrupación
    if(carga_id && yaTenia >= 1){
      enviarAlertaAgrupacion(carga_id, r.rows[0]).catch(e=>console.warn('Alerta agrupación error:',e.message));
    }

    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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
    const { text, page0, pages } = await new Promise((resolve, reject) => {
      const parser = new PDFParser(null, 1);
      parser.on('pdfParser_dataError', e => reject(new Error(e.parserError)));
      parser.on('pdfParser_dataReady', data => {
        const t = data.Pages.map(page =>
          page.Texts.map(t => {
            try { return decodeURIComponent(t.R.map(r => r.T).join('')); }
            catch(e) { return t.R.map(r => r.T).join(''); }
          }).join(' ')
        ).join('\\n');
        resolve({ text: t, page0: data.Pages[0], pages: data.Pages });
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

    // Cliente: por posición (fila bajo "Cliente:"); regex de respaldo
    const clienteMatch = text.match(/Cliente:\s*([\w\s\.\,\-]+?)(?:\s{2,}|CIF:|Avda|Calle|Plaza|Pza|\d{5})/i);
    const cliente_nombre = extraerCliente(page0) || (clienteMatch ? clienteMatch[1].trim().replace(/\s+/g,' ') : null);

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

    // Líneas del pedido: parser por POSICIÓN DE COLUMNA (coordenadas pdf2json)
    // Devuelve { referencia, descripcion, cantidad, observaciones, es_articulo, embalaje, kgs }
    const lineas = extraerTodasLineas(pages);

    res.json({ num, cliente_nombre, cif_cliente, destino_texto, direccion_descarga, fecha_pedido, kg, porte, obs, lineas });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LÍNEAS DE PEDIDO (preparación) ────────────────────────────────────────────

// GET líneas de un pedido
app.get('/api/pedidos/:id/lineas', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM pedido_lineas WHERE pedido_id=$1 ORDER BY orden,id',[req.params.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST guardar líneas de un pedido (reemplaza todas)
app.post('/api/pedidos/:id/lineas', async (req, res) => {
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

// ── PREPARADORES (CRUD) ───────────────────────────────────────────────────────
app.get('/api/preparadores', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM preparadores WHERE activo=true ORDER BY nombre');
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/preparadores', async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO preparadores(nombre) VALUES($1) RETURNING *',[req.body.nombre]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/preparadores/:id', async (req, res) => {
  try {
    await pool.query('UPDATE preparadores SET activo=false WHERE id=$1',[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── COMERCIALES (CRUD) ────────────────────────────────────────────────────────
app.get('/api/comerciales', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM comerciales WHERE activo=true ORDER BY nombre');
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/comerciales', async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO comerciales(nombre) VALUES($1) RETURNING *',[req.body.nombre]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/comerciales/:id', async (req, res) => {
  try {
    await pool.query('UPDATE comerciales SET activo=false WHERE id=$1',[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH asignar comercial a un pedido
app.patch('/api/pedidos/:id/comercial', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET comercial=$1 WHERE id=$2 RETURNING *',[req.body.comercial||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Salud / versión del servidor (para detectar despliegues desactualizados)
app.get('/api/health', (req, res) => res.json({ ok: true, version: API_VERSION }));

// ── COPIA DE SEGURIDAD ────────────────────────────────────────────────────────
const BACKUP_TABLES = ['bc_config','transportistas','categorias','preparadores','comerciales','materias_primas','silos','producciones','viajes','compras_mp','compras','cargas','pedidos','pedido_lineas','compra_lineas','pedidos_cli','pedidos_cli_lineas','clientes_auto','bc_inbox'];

// Construye el volcado completo de la base de datos
async function _dumpDatos() {
  const data = { _meta: { version: API_VERSION, fecha: new Date().toISOString() } };
  for (const t of BACKUP_TABLES) {
    try { const r = await pool.query('SELECT * FROM ' + t); data[t] = r.rows; }
    catch(e) { data[t] = []; }
  }
  return data;
}

// Descargar copia: vuelca todas las tablas a un JSON
app.get('/api/backup', async (req, res) => {
  try { res.json(await _dumpDatos()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Restaurar copia: reemplaza TODOS los datos por los del JSON (en una transacción)
app.post('/api/restore', async (req, res) => {
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

// ── COPIAS AUTOMÁTICAS (guardadas en la BD) ───────────────────────────────────
async function hacerSnapshot(tipo) {
  try {
    const datos = await _dumpDatos();
    await pool.query('INSERT INTO backups(tipo, datos) VALUES($1, $2)', [tipo || 'auto', datos]);
    // conservar solo las últimas 14
    await pool.query('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY fecha DESC LIMIT 14)');
  } catch(e) { console.error('snapshot error:', e.message); }
}

// listar copias (sin los datos, para no cargar de más)
app.get('/api/backups', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, fecha, tipo FROM backups ORDER BY fecha DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// obtener una copia concreta (con datos)
app.get('/api/backups/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, fecha, tipo, datos FROM backups WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// forzar una copia ahora
app.post('/api/backups', async (req, res) => {
  await hacerSnapshot('manual');
  res.json({ ok: true });
});

// PATCH asignar preparador a un pedido
app.patch('/api/pedidos/:id/preparador', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET preparador=$1 WHERE id=$2 RETURNING *',[req.body.preparador||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH registro de cambios del pedido (memoria de actualizaciones por PDF)
app.patch('/api/pedidos/:id/cambios', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET cambios=$1, tiene_cambios=$2 WHERE id=$3 RETURNING *',[req.body.cambios||null, !!req.body.tiene_cambios, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH observación global del pedido (notas para el carretillero)
app.patch('/api/pedidos/:id/obs_prep', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET obs_prep=$1 WHERE id=$2 RETURNING *',[req.body.obs_prep||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH marca de agencia + medidas (largo x ancho x alto)
app.patch('/api/pedidos/:id/agencia', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos SET es_agencia=$1, medidas=$2 WHERE id=$3 RETURNING *',[!!req.body.es_agencia, req.body.medidas||null, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH marcar línea como preparada/no preparada
app.patch('/api/lineas/:id/prep', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET preparada=$1 WHERE id=$2 RETURNING *',[req.body.preparada,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH observaciones de una línea
app.patch('/api/lineas/:id/obs', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET observaciones=$1 WHERE id=$2 RETURNING *',[req.body.observaciones||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH embalaje (palets) de una línea
app.patch('/api/lineas/:id/embalaje', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET embalaje=$1 WHERE id=$2 RETURNING *',[req.body.embalaje||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH falta (unidades que faltan) de una línea
app.patch('/api/lineas/:id/falta', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedido_lineas SET falta=$1 WHERE id=$2 RETURNING *',[Number(req.body.falta)||0,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Listado de faltas (para Compras): líneas con falta>0 + datos de su pedido
app.get('/api/faltas', async (req, res) => {
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

// ── COMPRAS (pedidos de compra) ───────────────────────────────────────────────
// listar todas las compras, cada una con su array de líneas
app.get('/api/compras', async (req, res) => {
  try {
    const cab = await pool.query('SELECT * FROM compras ORDER BY (fecha_prevista IS NULL), fecha_prevista, creado DESC');
    const lin = await pool.query('SELECT * FROM compra_lineas ORDER BY id');
    const porCompra = {};
    lin.rows.forEach(l => { (porCompra[l.compra_id] = porCompra[l.compra_id] || []).push(l); });
    res.json(cab.rows.map(c => ({ ...c, lineas: porCompra[c.id] || [] })));
  } catch(e) { res.status(500).json({error:e.message}); }
});
// crear un pedido de compra con sus líneas
app.post('/api/compras', async (req, res) => {
  const c = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO compras(proveedor,estado,fecha_prevista,tolva,transportista,transportista_tel,pedidos_rel,prioridad,notas)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [c.proveedor||null, c.estado||'por_pedir', c.fecha_prevista||null, c.tolva||null,
       c.transportista||null, c.transportista_tel||null, c.pedidos_rel||null, c.prioridad||'normal', c.notas||null]);
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
app.put('/api/compras/:id', async (req, res) => {
  const c = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE compras SET proveedor=$1,estado=$2,fecha_prevista=$3,tolva=$4,transportista=$5,
       transportista_tel=$6,pedidos_rel=$7,prioridad=$8,notas=$9 WHERE id=$10`,
      [c.proveedor||null, c.estado||'por_pedir', c.fecha_prevista||null, c.tolva||null,
       c.transportista||null, c.transportista_tel||null, c.pedidos_rel||null, c.prioridad||'normal', c.notas||null, req.params.id]);
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
app.patch('/api/compras/:id/estado', async (req, res) => {
  const estado = req.body.estado;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recibido = estado === 'recibido';
    await client.query('UPDATE compras SET estado=$1, fecha_recibido=$2 WHERE id=$3',
      [estado, recibido ? new Date() : null, req.params.id]);
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
app.delete('/api/compras/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM compra_lineas WHERE compra_id=$1', [req.params.id]);
    await pool.query('DELETE FROM compras WHERE id=$1', [req.params.id]);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── MATERIAS PRIMAS (catálogo) ────────────────────────────────────────────────
app.get('/api/materias-primas', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM materias_primas ORDER BY activo DESC, nombre')).rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/materias-primas', async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO materias_primas(nombre) VALUES($1) RETURNING *', [(req.body.nombre||'').trim()]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/materias-primas/:id', async (req, res) => {
  try {
    const r = await pool.query('UPDATE materias_primas SET nombre=$1, activo=$2 WHERE id=$3 RETURNING *',
      [(req.body.nombre||'').trim(), req.body.activo!==false, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/materias-primas/:id', async (req, res) => {
  try { await pool.query('DELETE FROM materias_primas WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── SILOS / TOLVAS ────────────────────────────────────────────────────────────
app.get('/api/silos', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, mp.nombre AS producto
       FROM silos s LEFT JOIN materias_primas mp ON mp.id = s.mp_id
       ORDER BY s.numero, s.id`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// editar ajustes del silo (nombre / capacidad)
app.put('/api/silos/:id', async (req, res) => {
  try {
    const r = await pool.query('UPDATE silos SET nombre=$1, capacidad_kg=$2 WHERE id=$3 RETURNING *',
      [req.body.nombre||null, Number(req.body.capacidad_kg)||0, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// llenar manualmente: fija el material (si se indica) y suma kg, tope la capacidad
app.post('/api/silos/:id/llenar', async (req, res) => {
  try {
    const s = (await pool.query('SELECT * FROM silos WHERE id=$1', [req.params.id])).rows[0];
    if (!s) return res.status(404).json({error:'No existe'});
    const mp_id = req.body.mp_id || s.mp_id || null;
    const add = Number(req.body.kg) || 0;
    const nuevo = Math.min(Number(s.capacidad_kg), Number(s.kg_actual) + add);
    const r = await pool.query('UPDATE silos SET mp_id=$1, kg_actual=$2 WHERE id=$3 RETURNING *', [mp_id, nuevo, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// vaciar (deja el silo a 0 y sin material)
app.post('/api/silos/:id/vaciar', async (req, res) => {
  try {
    const r = await pool.query('UPDATE silos SET kg_actual=0, mp_id=NULL, vaciando=false WHERE id=$1 RETURNING *', [req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// producir desde el silo: registra producción (a Producción Final) y descuenta los kg
app.post('/api/silos/:id/producir', async (req, res) => {
  const b = req.body || {};
  const kgt = (Number(b.unidades)||0) * (Number(b.kg_unidad)||0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = (await client.query('SELECT * FROM silos WHERE id=$1', [req.params.id])).rows[0];
    if (!s) { await client.query('ROLLBACK'); return res.status(404).json({error:'No existe'}); }
    await client.query(
      `INSERT INTO producciones(tipo,mp_id,unidades,kg_unidad,kg_total,silo_id,estado,hecho_at,notas)
       VALUES($1,$2,$3,$4,$5,$6,'hecho',now(),$7)`,
      [b.tipo||'saco', s.mp_id||null, Number(b.unidades)||0, Number(b.kg_unidad)||0, kgt, s.id, b.notas||null]);
    await client.query('UPDATE silos SET kg_actual = GREATEST(0, kg_actual - $1) WHERE id=$2', [kgt, s.id]);
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
// marcar / desmarcar "estoy vaciando"
app.patch('/api/silos/:id/vaciando', async (req, res) => {
  try {
    const r = await pool.query('UPDATE silos SET vaciando=$1 WHERE id=$2 RETURNING *', [!!req.body.vaciando, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// traspasar kg de un silo a otro
app.post('/api/silos/:id/traspasar', async (req, res) => {
  const { destino_silo_id, kg } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const o = (await client.query('SELECT * FROM silos WHERE id=$1', [req.params.id])).rows[0];
    const d = (await client.query('SELECT * FROM silos WHERE id=$1', [destino_silo_id])).rows[0];
    if (!o || !d) { await client.query('ROLLBACK'); return res.status(404).json({error:'No existe'}); }
    const pedido = Math.max(0, Number(kg)||0);
    const disponible = Math.min(pedido, Number(o.kg_actual)||0);            // no más de lo que hay
    const dNew = Math.min(Number(d.capacidad_kg), Number(d.kg_actual) + disponible); // tope capacidad destino
    const movido = dNew - Number(d.kg_actual);
    const oNew = Number(o.kg_actual) - movido;
    const dMp = (d.mp_id && Number(d.kg_actual) > 0) ? d.mp_id : (o.mp_id || d.mp_id);
    await client.query('UPDATE silos SET kg_actual=$1, mp_id=$2 WHERE id=$3', [dNew, dMp, destino_silo_id]);
    await client.query('UPDATE silos SET kg_actual=$1, mp_id=CASE WHEN $1<=0 THEN NULL ELSE mp_id END WHERE id=$2', [oNew, req.params.id]);
    await client.query('COMMIT');
    res.json({ ok:true, movido });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// ── PRODUCCIÓN (BB / Sacos) ───────────────────────────────────────────────────
app.get('/api/producciones', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, mp.nombre AS material, s.nombre AS silo_nombre
       FROM producciones p
       LEFT JOIN materias_primas mp ON mp.id = p.mp_id
       LEFT JOIN silos s ON s.id = p.silo_id
       ORDER BY (p.estado='hecho'), p.creado DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/producciones', async (req, res) => {
  const b = req.body || {};
  const kgt = (Number(b.unidades)||0) * (Number(b.kg_unidad)||0);
  try {
    const r = await pool.query(
      `INSERT INTO producciones(tipo,mp_id,unidades,kg_unidad,kg_total,notas,estado,origen_linea_id)
       VALUES($1,$2,$3,$4,$5,$6,'pendiente',$7) RETURNING *`,
      [b.tipo||'saco', b.mp_id||null, Number(b.unidades)||0, Number(b.kg_unidad)||0, kgt, b.notas||null, b.origen_linea_id||null]);
    if (b.origen_linea_id) {
      await pool.query("UPDATE pedidos_cli_lineas SET estado='en_produccion' WHERE id=$1", [b.origen_linea_id]);
    }
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/producciones/:id', async (req, res) => {
  const b = req.body || {};
  const kgt = (Number(b.unidades)||0) * (Number(b.kg_unidad)||0);
  try {
    const r = await pool.query(
      `UPDATE producciones SET mp_id=$1, unidades=$2, kg_unidad=$3, kg_total=$4, notas=$5 WHERE id=$6 RETURNING *`,
      [b.mp_id||null, Number(b.unidades)||0, Number(b.kg_unidad)||0, kgt, b.notas||null, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// cambiar estado; al pasar a 'hecho' con descontar+silo_id, resta los kg del silo
app.patch('/api/producciones/:id/estado', async (req, res) => {
  const { estado, descontar, silo_id } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hecho = estado === 'hecho';
    const p = (await client.query('SELECT * FROM producciones WHERE id=$1', [req.params.id])).rows[0];
    await client.query('UPDATE producciones SET estado=$1, hecho_at=$2, silo_id=$3 WHERE id=$4',
      [estado, hecho ? new Date() : null, hecho ? (silo_id || p.silo_id || null) : p.silo_id, req.params.id]);
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
app.delete('/api/producciones/:id', async (req, res) => {
  try { await pool.query('DELETE FROM producciones WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── CAMIÓN (viajes de suministro) ─────────────────────────────────────────────
app.get('/api/viajes', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT v.*, mp.nombre AS material, s.nombre AS silo_nombre, ds.nombre AS destino_silo_nombre
       FROM viajes v
       LEFT JOIN materias_primas mp ON mp.id = v.mp_id
       LEFT JOIN silos s ON s.id = v.silo_id
       LEFT JOIN silos ds ON ds.id = v.destino_silo_id
       ORDER BY (v.estado='hecho'), v.creado DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// crear N viajes (cola)
app.post('/api/viajes', async (req, res) => {
  const b = req.body || {};
  const n = Math.max(1, parseInt(b.n_viajes) || 1);
  try {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const r = await pool.query(
        `INSERT INTO viajes(mp_id,kg,silo_id,origen,notas,hora) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [b.mp_id||null, Number(b.kg)||0, b.silo_id||null, b.origen||'manual', b.notas||null, b.hora||null]);
      ids.push(r.rows[0].id);
    }
    res.json({ ok:true, ids });
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/viajes/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await pool.query('UPDATE viajes SET mp_id=$1, kg=$2, silo_id=$3, notas=$4, hora=COALESCE($5,hora) WHERE id=$6 RETURNING *',
      [b.mp_id||null, Number(b.kg)||0, b.silo_id||null, b.notas||null, b.hora||null, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// completar viaje: descarga a silo (suma kg + fija material) o a acopio
app.patch('/api/viajes/:id/completar', async (req, res) => {
  const { destino_tipo, destino_silo_id, kg_final, acopio } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const v = (await client.query('SELECT * FROM viajes WHERE id=$1', [req.params.id])).rows[0];
    await client.query(
      `UPDATE viajes SET estado='hecho', hecho_at=now(), destino_tipo=$1, destino_silo_id=$2, kg_final=$3, acopio=$4 WHERE id=$5`,
      [destino_tipo||null, destino_tipo==='silo'?(destino_silo_id||null):null, Number(kg_final)||0, destino_tipo==='acopio'?(acopio||null):null, req.params.id]);
    if (destino_tipo === 'silo' && destino_silo_id) {
      const s = (await client.query('SELECT * FROM silos WHERE id=$1', [destino_silo_id])).rows[0];
      if (s) {
        const nuevoMp = (s.mp_id && Number(s.kg_actual) > 0) ? s.mp_id : (v.mp_id || s.mp_id);
        const nuevoKg = Math.min(Number(s.capacidad_kg), Number(s.kg_actual) + (Number(kg_final)||0));
        await client.query('UPDATE silos SET mp_id=$1, kg_actual=$2 WHERE id=$3', [nuevoMp, nuevoKg, destino_silo_id]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
app.delete('/api/viajes/:id', async (req, res) => {
  try { await pool.query('DELETE FROM viajes WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── COMPRAS DE MATERIA PRIMA ──────────────────────────────────────────────────
app.get('/api/compras-mp', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.*, mp.nombre AS material, s.nombre AS silo_nombre
       FROM compras_mp c
       LEFT JOIN materias_primas mp ON mp.id = c.mp_id
       LEFT JOIN silos s ON s.id = c.silo_id
       ORDER BY (c.estado='recibido'), c.fecha NULLS LAST, c.hora NULLS LAST, c.creado DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
function estadoCompraMp(b){ if (b.estado === 'recibido') return 'recibido'; return b.fecha ? 'programado' : 'pendiente'; }
app.post('/api/compras-mp', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await pool.query(
      `INSERT INTO compras_mp(mp_id,proveedor,kg,fecha,hora,silo_id,notas,estado)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.mp_id||null, b.proveedor||null, Number(b.kg)||0, b.fecha||null, b.hora||null, b.silo_id||null, b.notas||null, estadoCompraMp(b)]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/compras-mp/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const cur = (await pool.query('SELECT estado FROM compras_mp WHERE id=$1', [req.params.id])).rows[0] || {};
    const est = cur.estado === 'recibido' ? 'recibido' : estadoCompraMp(b);
    const r = await pool.query(
      `UPDATE compras_mp SET mp_id=$1,proveedor=$2,kg=$3,fecha=$4,hora=$5,silo_id=$6,notas=$7,estado=$8 WHERE id=$9 RETURNING *`,
      [b.mp_id||null, b.proveedor||null, Number(b.kg)||0, b.fecha||null, b.hora||null, b.silo_id||null, b.notas||null, est, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
// recibir: marca recibido + cuenta kg; opcionalmente añade los kg al silo asignado
app.patch('/api/compras-mp/:id/recibir', async (req, res) => {
  const { kg_recibido, fill_silo } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = (await client.query('SELECT * FROM compras_mp WHERE id=$1', [req.params.id])).rows[0];
    await client.query('UPDATE compras_mp SET estado=$1, kg_recibido=$2, recibido_at=now() WHERE id=$3',
      ['recibido', Number(kg_recibido)||0, req.params.id]);
    if (fill_silo && c && c.silo_id) {
      const s = (await client.query('SELECT * FROM silos WHERE id=$1', [c.silo_id])).rows[0];
      if (s) {
        const nuevoMp = (s.mp_id && Number(s.kg_actual) > 0) ? s.mp_id : (c.mp_id || s.mp_id);
        const nuevoKg = Math.min(Number(s.capacidad_kg), Number(s.kg_actual) + (Number(kg_recibido)||0));
        await client.query('UPDATE silos SET mp_id=$1, kg_actual=$2 WHERE id=$3', [nuevoMp, nuevoKg, c.silo_id]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
app.delete('/api/compras-mp/:id', async (req, res) => {
  try { await pool.query('DELETE FROM compras_mp WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── PEDIDOS DE CLIENTE (construcción) ─────────────────────────────────────────
app.get('/api/pedidos-cli', async (req, res) => {
  try {
    const ped = (await pool.query('SELECT * FROM pedidos_cli ORDER BY creado DESC')).rows;
    const lins = (await pool.query('SELECT * FROM pedidos_cli_lineas ORDER BY id')).rows;
    ped.forEach(p => p.lineas = lins.filter(l => l.pedido_id === p.id));
    res.json(ped);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/pedidos-cli', async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = (await client.query('INSERT INTO pedidos_cli(cliente,notas) VALUES($1,$2) RETURNING *', [b.cliente||null, b.notas||null])).rows[0];
    // ¿cliente automático? (coincidencia por nombre, sin distinguir mayúsculas)
    let auto = false;
    if (b.cliente) {
      const ca = (await client.query('SELECT 1 FROM clientes_auto WHERE lower(trim(nombre))=lower(trim($1)) LIMIT 1', [b.cliente])).rows;
      auto = ca.length > 0;
    }
    let autoTareas = 0;
    for (const l of (b.lineas||[])) {
      const lin = (await client.query('INSERT INTO pedidos_cli_lineas(pedido_id,descripcion,cantidad,unidad) VALUES($1,$2,$3,$4) RETURNING *',
        [p.id, l.descripcion||null, Number(l.cantidad)||0, l.unidad||null])).rows[0];
      if (auto) {
        // intentar emparejar material por nombre; si no, queda sin material
        let mp_id = null;
        if (l.descripcion) {
          const m = (await client.query("SELECT id FROM materias_primas WHERE lower(nombre)=lower($1) LIMIT 1", [l.descripcion])).rows[0];
          mp_id = m ? m.id : null;
        }
        // kg por big bag = kg de la línea / nº de unidades (lo que pone el pedido)
        const uni = Number(l.cantidad) || 0;
        const kgsLinea = Number(l.kgs) || 0;
        const kgu = (uni > 0 && kgsLinea > 0) ? Math.round((kgsLinea / uni) * 100) / 100 : 0;
        const kgt = kgsLinea > 0 ? kgsLinea : uni * kgu;
        await client.query(
          `INSERT INTO producciones(tipo,mp_id,unidades,kg_unidad,kg_total,estado,notas,origen_linea_id)
           VALUES('bb',$1,$2,$3,$4,'pendiente',$5,$6)`,
          [mp_id, uni, kgu, kgt, l.descripcion||null, lin.id]);
        await client.query("UPDATE pedidos_cli_lineas SET estado='en_produccion' WHERE id=$1", [lin.id]);
        autoTareas++;
      }
    }
    await client.query('COMMIT');
    res.json({ ...p, auto, autoTareas });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
app.put('/api/pedidos-cli/:id', async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE pedidos_cli SET cliente=$1, notas=$2 WHERE id=$3', [b.cliente||null, b.notas||null, req.params.id]);
    // conservar estados existentes por id; reemplazar el conjunto de líneas
    const prev = (await client.query('SELECT * FROM pedidos_cli_lineas WHERE pedido_id=$1', [req.params.id])).rows;
    await client.query('DELETE FROM pedidos_cli_lineas WHERE pedido_id=$1', [req.params.id]);
    for (const l of (b.lineas||[])) {
      const est = (l.id && prev.find(x => x.id === l.id)) ? prev.find(x => x.id === l.id).estado : 'pendiente';
      await client.query('INSERT INTO pedidos_cli_lineas(pedido_id,descripcion,cantidad,unidad,estado) VALUES($1,$2,$3,$4,$5)',
        [req.params.id, l.descripcion||null, Number(l.cantidad)||0, l.unidad||null, est]);
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
app.delete('/api/pedidos-cli/:id', async (req, res) => {
  try { await pool.query('DELETE FROM pedidos_cli WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── CLIENTES AUTOMÁTICOS (→ Big Bag) ──────────────────────────────────────────
app.get('/api/clientes-auto', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM clientes_auto ORDER BY nombre')).rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/clientes-auto', async (req, res) => {
  try { const r = await pool.query('INSERT INTO clientes_auto(nombre) VALUES($1) RETURNING *', [(req.body.nombre||'').trim()]); res.json(r.rows[0]); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/clientes-auto/:id', async (req, res) => {
  try { await pool.query('DELETE FROM clientes_auto WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
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
initDB().then(() => {
  app.listen(PORT, () => console.log(`Server on port ${PORT}`));
  // copia de seguridad automática: una al arrancar y otra cada 24h
  setTimeout(() => hacerSnapshot('auto'), 5000);
  setInterval(() => hacerSnapshot('auto'), 24 * 60 * 60 * 1000);
});
