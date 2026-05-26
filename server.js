const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
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
  const { nombre, contacto, telefono, email, nif, color, tarifas, notas } = req.body;
  try {
    const r = await pool.query(
      `UPDATE transportistas SET nombre=$1,contacto=$2,telefono=$3,email=$4,nif=$5,color=$6,tarifas=$7,notas=$8 WHERE id=$9 RETURNING *`,
      [nombre,contacto,telefono,email,nif,color,JSON.stringify(tarifas||[]),notas,req.params.id]
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
    const r = await pool.query(
      `UPDATE cargas SET name=$1,codigo_orden=$2,truck_id=$3,fecha=$4,status=$5,color_idx=$6,coste=$7,coste_modo=$8,mat_camion=$9,mat_remolque=$10,notas=$11,categoria_id=$12 WHERE id=$13 RETURNING *`,
      [name,codigo_orden||null,truck_id||null,fecha||null,status,color_idx,coste||null,coste_modo,req.body.mat_camion||null,req.body.mat_remolque||null,notas,categoria_id||null,req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log(`Server on port ${PORT}`)));
