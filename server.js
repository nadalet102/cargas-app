const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
let PDFParser = null;
try { PDFParser = require('pdf2json'); } catch(e) { console.warn('pdf2json not available:', e.message); }

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productos (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL DEFAULT 'gavion',
      referencia TEXT,
      largo NUMERIC, ancho NUMERIC, alto NUMERIC,
      descripcion TEXT, unidad TEXT DEFAULT 'ud',
      activo BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stock (
      id SERIAL PRIMARY KEY,
      producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
      cantidad NUMERIC DEFAULT 0,
      ubicacion TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS movimientos_stock (
      id SERIAL PRIMARY KEY,
      producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      cantidad NUMERIC NOT NULL,
      motivo TEXT,
      referencia_doc TEXT,
      fecha DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL, contacto TEXT, telefono TEXT,
      email TEXT, direccion TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pedidos (
      id SERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      cliente_nombre TEXT,
      fecha_pedido DATE DEFAULT CURRENT_DATE,
      fecha_entrega DATE,
      estado TEXT DEFAULT 'pendiente',
      tipo_fabricacion TEXT DEFAULT 'bajo_pedido',
      obra TEXT, notas TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lineas_pedido (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
      producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
      cantidad NUMERIC NOT NULL,
      precio_ud NUMERIC, notas TEXT
    );
    CREATE TABLE IF NOT EXISTS entregas_parciales (
      id SERIAL PRIMARY KEY,
      linea_pedido_id INTEGER REFERENCES lineas_pedido(id) ON DELETE CASCADE,
      fecha_carga DATE NOT NULL,
      cantidad NUMERIC NOT NULL,
      estado TEXT DEFAULT 'pendiente',
      transportista TEXT,
      mat_camion TEXT,
      mat_remolque TEXT,
      carga_grupo_id TEXT,
      notas TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE entregas_parciales ADD COLUMN IF NOT EXISTS transportista TEXT;
    ALTER TABLE entregas_parciales ADD COLUMN IF NOT EXISTS carga_grupo_id TEXT;
    ALTER TABLE entregas_parciales ADD COLUMN IF NOT EXISTS mat_camion TEXT;
    ALTER TABLE entregas_parciales ADD COLUMN IF NOT EXISTS mat_remolque TEXT;
    CREATE TABLE IF NOT EXISTS partes_produccion (
      id SERIAL PRIMARY KEY,
      fecha DATE NOT NULL,
      estado TEXT DEFAULT 'abierto',
      notas TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS partes_lineas (
      id SERIAL PRIMARY KEY,
      parte_id INTEGER REFERENCES partes_produccion(id) ON DELETE CASCADE,
      producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
      cantidad NUMERIC DEFAULT 0
    );
    ALTER TABLE movimientos_stock ADD COLUMN IF NOT EXISTS referencia_doc TEXT;
    ALTER TABLE movimientos_stock ADD COLUMN IF NOT EXISTS fecha DATE DEFAULT CURRENT_DATE;

    INSERT INTO productos (tipo,referencia,largo,ancho,alto,descripcion,unidad)
    SELECT * FROM (VALUES
      ('gavion','GAV-1x1x1',1.0,1.0,1.0,'Gavión 1×1×1 m','ud'),
      ('gavion','GAV-2x1x1',2.0,1.0,1.0,'Gavión 2×1×1 m','ud'),
      ('gavion','GAV-3x1x1',3.0,1.0,1.0,'Gavión 3×1×1 m','ud'),
      ('gavion','GAV-2x1x0.5',2.0,1.0,0.5,'Gavión 2×1×0.5 m','ud'),
      ('gavion','GAV-4x1x1',4.0,1.0,1.0,'Gavión 4×1×1 m','ud'),
      ('accesorio','GRAPA-STD',NULL,NULL,NULL,'Grapas de cierre (bolsa 100ud)','bolsa'),
      ('accesorio','ALAMBRE-ATD',NULL,NULL,NULL,'Alambre de atado (rollo 50m)','rollo'),
      ('colchoneta','COL-6x2x0.17',6.0,2.0,0.17,'Colchoneta Reno 6×2×0.17 m','ud'),
      ('colchoneta','COL-4x2x0.17',4.0,2.0,0.17,'Colchoneta Reno 4×2×0.17 m','ud')
    ) AS v(tipo,referencia,largo,ancho,alto,descripcion,unidad)
    WHERE NOT EXISTS (SELECT 1 FROM productos LIMIT 1);

    INSERT INTO stock (producto_id, cantidad)
    SELECT id, 0 FROM productos
    WHERE id NOT IN (SELECT producto_id FROM stock WHERE producto_id IS NOT NULL);
  `);
  console.log('DB ready');
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
async function stockMovimiento(client, producto_id, tipo, cantidad, motivo, referencia_doc, fecha) {
  const delta = tipo === 'entrada' ? +cantidad : -Math.abs(+cantidad);
  await client.query(
    `INSERT INTO movimientos_stock (producto_id,tipo,cantidad,motivo,referencia_doc,fecha) VALUES ($1,$2,$3,$4,$5,$6)`,
    [producto_id, tipo, Math.abs(+cantidad), motivo, referencia_doc||null, fecha||new Date().toISOString().slice(0,10)]
  );
  await client.query(
    `UPDATE stock SET cantidad=GREATEST(0,cantidad+$1), updated_at=NOW() WHERE producto_id=$2`,
    [delta, producto_id]
  );
}

// ── PRODUCTOS ──────────────────────────────────────────────────────────────────
app.get('/api/productos', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*, COALESCE(s.cantidad,0) as stock_actual, s.ubicacion as stock_ubicacion
      FROM productos p LEFT JOIN stock s ON s.producto_id=p.id
      WHERE p.activo=true ORDER BY p.tipo,p.largo DESC,p.ancho DESC,p.alto DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/productos', async (req, res) => {
  const {tipo,referencia,largo,ancho,alto,descripcion,unidad} = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO productos (tipo,referencia,largo,ancho,alto,descripcion,unidad) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tipo||'gavion',referencia,largo||null,ancho||null,alto||null,descripcion,unidad||'ud']
    );
    await pool.query('INSERT INTO stock (producto_id,cantidad) VALUES ($1,0)',[r.rows[0].id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/productos/:id', async (req, res) => {
  const {tipo,referencia,largo,ancho,alto,descripcion,unidad,activo} = req.body;
  try {
    const r = await pool.query(
      `UPDATE productos SET tipo=$1,referencia=$2,largo=$3,ancho=$4,alto=$5,descripcion=$6,unidad=$7,activo=$8 WHERE id=$9 RETURNING *`,
      [tipo,referencia,largo||null,ancho||null,alto||null,descripcion,unidad,activo!==false,req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── STOCK ──────────────────────────────────────────────────────────────────────
app.get('/api/stock', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.*, p.referencia,p.descripcion,p.tipo,p.largo,p.ancho,p.alto,p.unidad
      FROM stock s JOIN productos p ON p.id=s.producto_id
      WHERE p.activo=true ORDER BY p.tipo,p.largo DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/stock/movimientos', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT m.*,p.referencia,p.descripcion
      FROM movimientos_stock m JOIN productos p ON p.id=m.producto_id
      ORDER BY m.created_at DESC LIMIT 300`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/stock/movimiento', async (req, res) => {
  const {producto_id,tipo,cantidad,motivo,referencia_doc,fecha} = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await stockMovimiento(client,producto_id,tipo,cantidad,motivo,referencia_doc,fecha);
    await client.query('COMMIT');
    const r = await pool.query('SELECT * FROM stock WHERE producto_id=$1',[producto_id]);
    res.json(r.rows[0]);
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// ── CLIENTES ───────────────────────────────────────────────────────────────────
app.get('/api/clientes', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM clientes ORDER BY nombre')).rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/clientes', async (req, res) => {
  const {nombre,contacto,telefono,email,direccion} = req.body;
  try {
    res.json((await pool.query(
      `INSERT INTO clientes (nombre,contacto,telefono,email,direccion) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nombre,contacto,telefono,email,direccion]
    )).rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/clientes/:id', async (req, res) => {
  const {nombre,contacto,telefono,email,direccion} = req.body;
  try {
    res.json((await pool.query(
      `UPDATE clientes SET nombre=$1,contacto=$2,telefono=$3,email=$4,direccion=$5 WHERE id=$6 RETURNING *`,
      [nombre,contacto,telefono,email,direccion,req.params.id]
    )).rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/clientes/:id', async (req, res) => {
  try { await pool.query('DELETE FROM clientes WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── PEDIDOS ────────────────────────────────────────────────────────────────────
app.get('/api/pedidos-gav', async (req, res) => {
  try {
    const pedidos = (await pool.query(`
      SELECT p.*,c.nombre as cliente_nombre_rel
      FROM pedidos p LEFT JOIN clientes c ON c.id=p.cliente_id
      ORDER BY p.created_at DESC`)).rows;
    const lineas = (await pool.query(`
      SELECT l.*,pr.referencia,pr.descripcion,pr.tipo,pr.largo,pr.ancho,pr.alto,pr.unidad
      FROM lineas_pedido l JOIN productos pr ON pr.id=l.producto_id`)).rows;
    const entregas = (await pool.query(`SELECT * FROM entregas_parciales ORDER BY fecha_carga`)).rows;
    pedidos.forEach(p => {
      p.lineas = lineas.filter(l=>l.pedido_id===p.id).map(l=>({
        ...l,
        entregas: entregas.filter(e=>e.linea_pedido_id===l.id)
      }));
    });
    res.json(pedidos);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/pedidos-gav', async (req, res) => {
  const {numero,cliente_id,cliente_nombre,fecha_pedido,fecha_entrega,estado,tipo_fabricacion,obra,notas,lineas} = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO pedidos (numero,cliente_id,cliente_nombre,fecha_pedido,fecha_entrega,estado,tipo_fabricacion,obra,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [numero,cliente_id||null,cliente_nombre,fecha_pedido||null,fecha_entrega||null,estado||'pendiente',tipo_fabricacion||'bajo_pedido',obra,notas]
    );
    const pedido = r.rows[0];
    if(lineas&&lineas.length) {
      for(const l of lineas) {
        await client.query(
          `INSERT INTO lineas_pedido (pedido_id,producto_id,cantidad,precio_ud,notas) VALUES ($1,$2,$3,$4,$5)`,
          [pedido.id,l.producto_id,l.cantidad,l.precio_ud||null,l.notas||null]
        );
      }
    }
    await client.query('COMMIT');
    res.json(pedido);
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
app.put('/api/pedidos-gav/:id', async (req, res) => {
  const {numero,cliente_id,cliente_nombre,fecha_pedido,fecha_entrega,estado,tipo_fabricacion,obra,notas,lineas} = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE pedidos SET numero=$1,cliente_id=$2,cliente_nombre=$3,fecha_pedido=$4,fecha_entrega=$5,estado=$6,tipo_fabricacion=$7,obra=$8,notas=$9 WHERE id=$10 RETURNING *`,
      [numero,cliente_id||null,cliente_nombre,fecha_pedido||null,fecha_entrega||null,estado,tipo_fabricacion,obra,notas,req.params.id]
    );
    if(lineas) {
      // Keep existing entregas — only delete lineas without entregas
      const existing = (await client.query('SELECT id FROM lineas_pedido WHERE pedido_id=$1',[req.params.id])).rows;
      for(const el of existing) {
        const hasEntregas = (await client.query('SELECT id FROM entregas_parciales WHERE linea_pedido_id=$1 LIMIT 1',[el.id])).rows.length>0;
        if(!hasEntregas) await client.query('DELETE FROM lineas_pedido WHERE id=$1',[el.id]);
      }
      for(const l of lineas) {
        if(l.id) {
          await client.query('UPDATE lineas_pedido SET producto_id=$1,cantidad=$2,precio_ud=$3,notas=$4 WHERE id=$5',
            [l.producto_id,l.cantidad,l.precio_ud||null,l.notas||null,l.id]);
        } else {
          await client.query('INSERT INTO lineas_pedido (pedido_id,producto_id,cantidad,precio_ud,notas) VALUES ($1,$2,$3,$4,$5)',
            [req.params.id,l.producto_id,l.cantidad,l.precio_ud||null,l.notas||null]);
        }
      }
    }
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
app.delete('/api/pedidos-gav/:id', async (req, res) => {
  try {
    const lineas = (await pool.query('SELECT id FROM lineas_pedido WHERE pedido_id=$1',[req.params.id])).rows;
    for(const l of lineas) await pool.query('DELETE FROM entregas_parciales WHERE linea_pedido_id=$1',[l.id]);
    await pool.query('DELETE FROM lineas_pedido WHERE pedido_id=$1',[req.params.id]);
    await pool.query('DELETE FROM pedidos WHERE id=$1',[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.patch('/api/pedidos-gav/:id/estado', async (req, res) => {
  try {
    res.json((await pool.query('UPDATE pedidos SET estado=$1 WHERE id=$2 RETURNING *',[req.body.estado,req.params.id])).rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── ENTREGAS PARCIALES ────────────────────────────────────────────────────────
app.get('/api/entregas', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT e.*,
        l.cantidad as linea_cantidad, l.pedido_id,
        pr.referencia, pr.descripcion, pr.largo, pr.ancho, pr.alto, pr.unidad,
        pe.numero as pedido_numero, pe.cliente_nombre, pe.obra
      FROM entregas_parciales e
      JOIN lineas_pedido l ON l.id=e.linea_pedido_id
      JOIN productos pr ON pr.id=l.producto_id
      JOIN pedidos pe ON pe.id=l.pedido_id
      WHERE pe.estado NOT IN ('cancelado')
      ORDER BY e.fecha_carga, pe.numero`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/entregas', async (req, res) => {
  const {linea_pedido_id,fecha_carga,cantidad,notas,transportista,mat_camion,mat_remolque,carga_grupo_id} = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO entregas_parciales (linea_pedido_id,fecha_carga,cantidad,estado,transportista,mat_camion,mat_remolque,carga_grupo_id,notas) VALUES ($1,$2,$3,'pendiente',$4,$5,$6,$7,$8) RETURNING *`,
      [linea_pedido_id,fecha_carga,cantidad,notas||null,transportista||null,mat_camion||null,mat_remolque||null,carga_grupo_id||null]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/entregas/:id', async (req, res) => {
  const {fecha_carga,cantidad,notas,estado,transportista,mat_camion,mat_remolque,carga_grupo_id} = req.body;
  try {
    const r = await pool.query(
      `UPDATE entregas_parciales SET fecha_carga=$1,cantidad=$2,notas=$3,estado=$4,transportista=$5,mat_camion=$6,mat_remolque=$7,carga_grupo_id=$8 WHERE id=$9 RETURNING *`,
      [fecha_carga,cantidad,notas||null,estado||'pendiente',transportista||null,mat_camion||null,mat_remolque||null,carga_grupo_id||null,req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.patch('/api/entregas/:id/confirmar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const e = (await client.query(
      `SELECT e.*,l.producto_id,l.pedido_id,pe.numero as pedido_numero
       FROM entregas_parciales e
       JOIN lineas_pedido l ON l.id=e.linea_pedido_id
       JOIN pedidos_gav pe ON pe.id=l.pedido_id
       WHERE e.id=$1`,[req.params.id]
    )).rows[0];
    if(!e) throw new Error('Entrega no encontrada');
    if(e.estado==='confirmada') throw new Error('Ya confirmada');
    await client.query(`UPDATE entregas_parciales SET estado='confirmada' WHERE id=$1`,[req.params.id]);
    await stockMovimiento(client,e.producto_id,'salida',e.cantidad,'Entrega confirmada ped. '+e.pedido_numero,'ENT-'+req.params.id,e.fecha_carga);

    // Check if ALL lines of the pedido are now fully delivered
    const pedidoId = e.pedido_id;
    const check = await client.query(`
      SELECT
        COALESCE(SUM(l.cantidad),0) as total_pedido,
        COALESCE(SUM(CASE WHEN ep.estado='confirmada' THEN ep.cantidad ELSE 0 END),0) as total_entregado
      FROM lineas_pedido l
      LEFT JOIN entregas_parciales ep ON ep.linea_pedido_id=l.id
      WHERE l.pedido_id=$1
    `,[pedidoId]);
    const {total_pedido, total_entregado} = check.rows[0];
    let pedidoAutoEntregado = false;
    if(+total_pedido > 0 && +total_entregado >= +total_pedido) {
      await client.query(`UPDATE pedidos_gav SET estado='entregado' WHERE id=$1 AND estado NOT IN ('cancelado','entregado')`,[pedidoId]);
      pedidoAutoEntregado = true;
    }

    await client.query('COMMIT');
    res.json({ok:true, pedidoAutoEntregado, pedidoId});
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
app.patch('/api/entregas/:id/anular', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const e = (await client.query(
      'SELECT e.*,l.producto_id,pe.numero as pedido_numero FROM entregas_parciales e JOIN lineas_pedido l ON l.id=e.linea_pedido_id JOIN pedidos pe ON pe.id=l.pedido_id WHERE e.id=$1',
      [req.params.id]
    )).rows[0];
    if(!e) throw new Error('Entrega no encontrada');
    if(e.estado!=='confirmada') throw new Error('Solo se pueden anular entregas confirmadas');
    await client.query(`UPDATE entregas_parciales SET estado='pendiente' WHERE id=$1`,[req.params.id]);
    await stockMovimiento(client,e.producto_id,'entrada',e.cantidad,'Anulacion entrega ped. '+e.pedido_numero,'ANUL-'+req.params.id,new Date().toISOString().slice(0,10));
    await client.query('COMMIT');
    res.json({ok:true});
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.patch('/api/entregas/:id/fecha', async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE entregas_parciales SET fecha_carga=$1 WHERE id=$2 RETURNING *',
      [req.body.fecha_carga, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/entregas/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // If confirmed, reverse the stock movement
    const e = (await client.query('SELECT e.*,l.producto_id FROM entregas_parciales e JOIN lineas_pedido l ON l.id=e.linea_pedido_id WHERE e.id=$1',[req.params.id])).rows[0];
    if(!e) throw new Error('Entrega no encontrada');
    if(e.estado==='confirmada'){
      // Return stock
      await stockMovimiento(client,e.producto_id,'entrada',e.cantidad,'Anulación entrega confirmada','ANUL-'+req.params.id,new Date().toISOString().slice(0,10));
    }
    await client.query('DELETE FROM entregas_parciales WHERE id=$1',[req.params.id]);
    await client.query('COMMIT');
    res.json({ok:true, stockRevertido: e.estado==='confirmada'});
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// ── PARTES DE PRODUCCIÓN ───────────────────────────────────────────────────────
app.get('/api/partes', async (req, res) => {
  try {
    const partes = (await pool.query('SELECT * FROM partes_produccion ORDER BY fecha DESC LIMIT 60')).rows;
    const lineas = (await pool.query(`
      SELECT pl.*,p.referencia,p.descripcion,p.largo,p.ancho,p.alto,p.unidad
      FROM partes_lineas pl JOIN productos p ON p.id=pl.producto_id`)).rows;
    partes.forEach(p=>{ p.lineas=lineas.filter(l=>l.parte_id===p.id); });
    res.json(partes);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/partes/hoy', async (req, res) => {
  const fecha = new Date().toISOString().slice(0,10);
  try {
    let parte = (await pool.query("SELECT * FROM partes_produccion WHERE fecha=$1 AND estado='abierto' LIMIT 1",[fecha])).rows[0];
    if(!parte) {
      parte = (await pool.query("INSERT INTO partes_produccion (fecha,estado) VALUES ($1,'abierto') RETURNING *",[fecha])).rows[0];
      const prods = (await pool.query("SELECT id FROM productos WHERE activo=true AND tipo!='accesorio'")).rows;
      for(const p of prods) {
        await pool.query('INSERT INTO partes_lineas (parte_id,producto_id,cantidad) VALUES ($1,$2,0)',[parte.id,p.id]);
      }
    }
    const lineas = (await pool.query(`
      SELECT pl.*,p.referencia,p.descripcion,p.largo,p.ancho,p.alto,p.unidad,p.tipo
      FROM partes_lineas pl JOIN productos p ON p.id=pl.producto_id
      WHERE pl.parte_id=$1 ORDER BY p.tipo,p.largo DESC`,[parte.id])).rows;
    parte.lineas = lineas;
    res.json(parte);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.patch('/api/partes/:id/linea', async (req, res) => {
  const {producto_id, cantidad} = req.body;
  try {
    const r = await pool.query(
      'UPDATE partes_lineas SET cantidad=$1 WHERE parte_id=$2 AND producto_id=$3 RETURNING *',
      [cantidad, req.params.id, producto_id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/partes/:id/add-producto', async (req, res) => {
  const { producto_id } = req.body;
  try {
    const exists = await pool.query(
      'SELECT id FROM partes_lineas WHERE parte_id=$1 AND producto_id=$2',
      [req.params.id, producto_id]
    );
    if(exists.rows.length) return res.json({ok:true, already:true});
    await pool.query(
      'INSERT INTO partes_lineas (parte_id,producto_id,cantidad) VALUES ($1,$2,0)',
      [req.params.id, producto_id]
    );
    res.json({ok:true, already:false});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/partes/:id/linea/:producto_id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM partes_lineas WHERE parte_id=$1 AND producto_id=$2',
      [req.params.id, req.params.producto_id]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/partes/:id/cerrar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const parte = (await client.query('SELECT * FROM partes_produccion WHERE id=$1',[req.params.id])).rows[0];
    if(!parte) throw new Error('Parte no encontrado');
    if(parte.estado==='cerrado') throw new Error('Ya cerrado');
    const lineas = (await client.query('SELECT * FROM partes_lineas WHERE parte_id=$1',[req.params.id])).rows;
    for(const l of lineas) {
      if(+l.cantidad>0) {
        await stockMovimiento(client,l.producto_id,'entrada',l.cantidad,'Parte producción '+parte.fecha,'PARTE-'+parte.id,parte.fecha);
      }
    }
    await client.query("UPDATE partes_produccion SET estado='cerrado' WHERE id=$1",[req.params.id]);
    await client.query('COMMIT');
    res.json({ok:true});
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// ── NECESIDADES ────────────────────────────────────────────────────────────────
app.get('/api/necesidades', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        pr.id as producto_id, pr.referencia, pr.descripcion, pr.tipo,
        pr.largo, pr.ancho, pr.alto, pr.unidad,
        COALESCE(s.cantidad,0) as stock_actual,
        -- Total pedido: suma de lineas de pedidos activos (sin duplicar por entregas)
        COALESCE((
          SELECT SUM(l.cantidad)
          FROM lineas_pedido l
          JOIN pedidos pe ON pe.id=l.pedido_id
          WHERE l.producto_id=pr.id
          AND pe.estado NOT IN ('entregado','cancelado')
        ),0) as pedido_total,
        -- Ya entregado: entregas confirmadas
        COALESCE((
          SELECT SUM(e.cantidad)
          FROM entregas_parciales e
          JOIN lineas_pedido l ON l.id=e.linea_pedido_id
          JOIN pedidos pe ON pe.id=l.pedido_id
          WHERE l.producto_id=pr.id
          AND e.estado='confirmada'
          AND pe.estado NOT IN ('cancelado')
        ),0) as entregado_total,
        -- Programado pendiente: entregas pendientes de confirmar
        COALESCE((
          SELECT SUM(e.cantidad)
          FROM entregas_parciales e
          JOIN lineas_pedido l ON l.id=e.linea_pedido_id
          JOIN pedidos pe ON pe.id=l.pedido_id
          WHERE l.producto_id=pr.id
          AND e.estado='pendiente'
          AND pe.estado NOT IN ('cancelado')
        ),0) as programado_pendiente
      FROM productos pr
      LEFT JOIN stock s ON s.producto_id=pr.id
      WHERE pr.activo=true
      ORDER BY pr.tipo,pr.largo DESC`);
    res.json(r.rows.map(row=>({
      ...row,
      pendiente_entregar: Math.max(0, +row.pedido_total - +row.entregado_total),
      necesidad_neta: Math.max(0, +row.pedido_total - +row.entregado_total - +row.stock_actual)
    })));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/partes/:id/reabrir', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const parte = (await client.query('SELECT * FROM partes_produccion WHERE id=$1',[req.params.id])).rows[0];
    if(!parte) throw new Error('Parte no encontrado');
    if(parte.estado!=='cerrado') throw new Error('El parte no esta cerrado');
    // Reverse all stock movements from this parte
    const lineas = (await client.query('SELECT * FROM partes_lineas WHERE parte_id=$1',[req.params.id])).rows;
    for(const l of lineas){
      if(+l.cantidad>0){
        await stockMovimiento(client,l.producto_id,'salida',l.cantidad,'Reapertura parte '+parte.fecha,'REAB-'+req.params.id,new Date().toISOString().slice(0,10));
      }
    }
    await client.query("UPDATE partes_produccion SET estado='abierto' WHERE id=$1",[req.params.id]);
    await client.query('COMMIT');
    res.json({ok:true});
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.get('/api/historial', async (req, res) => {
  try {
    const pedidosHist = (await pool.query(`
      SELECT p.*,c.nombre as cliente_nombre_rel
      FROM pedidos p LEFT JOIN clientes c ON c.id=p.cliente_id
      WHERE p.estado IN ('entregado','cancelado')
      ORDER BY p.created_at DESC LIMIT 100`)).rows;
    const lineas = (await pool.query(`
      SELECT l.*,pr.referencia,pr.descripcion,pr.tipo,pr.largo,pr.ancho,pr.alto,pr.unidad
      FROM lineas_pedido l JOIN productos pr ON pr.id=l.producto_id`)).rows;
    const entregas = (await pool.query(`
      SELECT e.*,l.cantidad as linea_cantidad,l.pedido_id,
        pr.referencia,pr.descripcion,pr.largo,pr.ancho,pr.alto,pr.unidad,
        pe.numero as pedido_numero,pe.cliente_nombre,pe.obra
      FROM entregas_parciales e
      JOIN lineas_pedido l ON l.id=e.linea_pedido_id
      JOIN productos pr ON pr.id=l.producto_id
      JOIN pedidos pe ON pe.id=l.pedido_id
      WHERE e.estado='confirmada'
      ORDER BY e.fecha_carga DESC LIMIT 200`)).rows;
    pedidosHist.forEach(p=>{
      p.lineas=lineas.filter(l=>l.pedido_id===p.id);
    });
    res.json({pedidos:pedidosHist, entregas});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── IMPORTAR PDF BC ───────────────────────────────────────────────────────────
app.post('/api/importar-pdf', async (req, res) => {
  const { base64 } = req.body;
  if(!base64) return res.status(400).json({error:'No se recibio el PDF'});

  if(!PDFParser) return res.status(500).json({error:'pdf2json no disponible en este servidor'});
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
        ).join('\n');
        resolve(t);
      });
      parser.parseBuffer(buf);
    });

    // Extract fields with regex
    const numMatch = text.match(/N[oº°]\s*Pedido[^\n]*?\n[^\n]*(PV\d{2}\/\d{5})/i)
                  || text.match(/(PV\d{2}\/\d{5})/);
    const numero = numMatch ? numMatch[1] : null;

    const fechaMatch = text.match(/(\d{2}\/\d{2}\/\d{2,4})/);
    let fecha_pedido = null;
    if(fechaMatch) {
      const parts = fechaMatch[1].split('/');
      if(parts[2].length===2) parts[2]='20'+parts[2];
      fecha_pedido = parts[2]+'-'+parts[1].padStart(2,'0')+'-'+parts[0].padStart(2,'0');
    }

    // Cliente: just the company name (up to street address or CIF)
    const clienteMatch = text.match(/Cliente:\s*((?:(?!CIF:|Direcci|Calle|Avda|Plaza|Pza|\d{5}).)+ )/i);
    const cliente_nombre = clienteMatch
      ? clienteMatch[1].trim().replace(/\s+/g,' ').split(/\s{2,}/)[0].trim()
      : null;

    // Obra: "Nº documento externo" value — take first word/phrase before next keyword
    const obraMatch = text.match(/externo\s+([A-Z][^\n]{2,40}?)(?:\s{2,}|Direcci|Cliente)/i);
    const obra = obraMatch ? obraMatch[1].trim() : null;

    // Destino: company name + location from "Dirección de descarga:"
    const destiMatch = text.match(/Direcci[oó]n de descarga:\s*([^\n]+)/i);
    let destino = null;
    if(destiMatch) {
      // Take first meaningful segment (company name + city)
      const raw = destiMatch[1].replace(/https?:\/\/\S+/g,'').trim();
      destino = raw.split(/\s{3,}/)[0].trim().replace(/\s+/g,' ');
    }

    // Lines: GVIBRF references
    // Pattern: GVIBRF... <description> <quantity>
    const lineaRegex = /\b(GVIBRF\w+)\b\s+([^\n]+?)\s+(\d+)[,.]?(\d{2})\s+\d/g;
    const lineas = [];
    let m;
    while((m = lineaRegex.exec(text)) !== null) {
      const ref = m[1];
      const desc = m[2].trim();
      const cant = parseFloat(m[3] + '.' + (m[4]||'00'));
      if(cant > 0 && !lineas.find(l => l.referencia === ref)) {
        lineas.push({ referencia: ref, descripcion: desc, cantidad: Math.round(cant) });
      }
    }

    // Fallback: simpler pattern
    if(!lineas.length) {
      const simple = /\b(GVIBRF\w+)\b[^\n]*?(\d{1,4})[,\.](\d{2})\s/g;
      while((m = simple.exec(text)) !== null) {
        const ref = m[1];
        const cant = parseInt(m[2]);
        if(cant > 0 && !lineas.find(l => l.referencia === ref)) {
          lineas.push({ referencia: ref, descripcion: '', cantidad: cant });
        }
      }
    }

    res.json({ numero, cliente_nombre, obra, destino, fecha_pedido, lineas });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// OLD ANTHROPIC ENDPOINT (disabled - using pdf2json instead)
app.post('/api/importar-pdf-DISABLED', async (req, res) => {
  const { base64, media_type } = req.body;
  if(!base64) return res.status(400).json({error:'No se recibio el PDF'});
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if(!apiKey) return res.status(500).json({error:'ANTHROPIC_API_KEY no configurada en Railway'});

  const https = require('https');
  const payload = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: media_type||'application/pdf', data: base64 } },
        { type: 'text', text: 'Extrae los datos de este pedido de Business Central y devuelve SOLO un JSON sin markdown:\n{"numero":"PV26/XXXXX","cliente_nombre":"nombre","obra":"campo Nº documento externo","destino":"direccion de descarga","fecha_pedido":"YYYY-MM-DD","lineas":[{"referencia":"GVIBRF024","descripcion":"descripcion","cantidad":71}]}\nIMPORTANTE: lineas solo con referencias GVIBRF. NO incluyas PORT, PROT ni lineas sin cantidad. Si no existe un campo pon null.' }
      ]
    }]
  });

  const options = {
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  };

  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request(options, (httpRes) => {
        let data = '';
        httpRes.on('data', chunk => data += chunk);
        httpRes.on('end', () => resolve({ status: httpRes.statusCode, body: data }));
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });

    if(result.status !== 200) {
      return res.status(502).json({error: 'Claude API ' + result.status + ': ' + result.body.substring(0,300)});
    }
    const data = JSON.parse(result.body);
    const txt = data.content.map(c => c.text||'').join('').replace(/```json|```/g,'').trim();
    res.json(JSON.parse(txt));
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ── IMPORTAR PRODUCTOS DESDE EXCEL BC ─────────────────────────────────────────
app.post('/api/importar-productos', async (req, res) => {
  const { base64 } = req.body;
  if(!base64) return res.status(400).json({error:'No se recibio el archivo'});
  try {
    const buf = Buffer.from(base64, 'base64');
    const wb = XLSX.read(buf, {type:'buffer'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1});

    // Skip header row
    const productos = [];
    for(let i=1; i<rows.length; i++){
      const row = rows[i];
      if(!row||!row[0]) continue;
      const referencia = String(row[0]).trim();
      const descripcion = String(row[1]||'').trim();
      const unidad = String(row[9]||'ud').trim().toLowerCase()||'ud';

      // Extract dimensions from description e.g. "100x30x50cm" or "200x100x100"
      const dimMatch = descripcion.match(/(\d+(?:[.,]\d+)?)[xX×](\d+(?:[.,]\d+)?)[xX×](\d+(?:[.,]\d+)?)\s*cm/i)
                    || descripcion.match(/(\d+(?:[.,]\d+)?)[xX×](\d+(?:[.,]\d+)?)[xX×](\d+(?:[.,]\d+)?)/);
      let largo=null, ancho=null, alto=null;
      if(dimMatch){
        largo = parseFloat(dimMatch[1].replace(',','.'))/100;
        ancho = parseFloat(dimMatch[2].replace(',','.'))/100;
        alto  = parseFloat(dimMatch[3].replace(',','.'))/100;
      }

      // Determine tipo from referencia or grupo
      const grupo = String(row[2]||'').toUpperCase();
      let tipo = 'gavion';
      if(referencia.startsWith('COL')||referencia.startsWith('REN')) tipo='colchoneta';
      else if(referencia.startsWith('PROT')||referencia.startsWith('MAL')) tipo='malla';
      else if(referencia.startsWith('PORT')||referencia.startsWith('ACCE')) tipo='accesorio';
      else if(grupo.includes('COLCHON')||grupo.includes('RENO')) tipo='colchoneta';
      else if(grupo.includes('ACCESO')) tipo='accesorio';

      // Normalize unit
      let unidadNorm = 'ud';
      if(unidad==='uds'||unidad==='ud'||unidad==='unidades') unidadNorm='ud';
      else if(unidad==='kg') unidadNorm='kg';
      else if(unidad==='m2'||unidad==='m²') unidadNorm='m2';
      else if(unidad==='m') unidadNorm='m';

      productos.push({referencia, descripcion, tipo, largo, ancho, alto, unidad:unidadNorm});
    }

    // Check existing products to avoid duplicates
    const existing = (await pool.query('SELECT referencia FROM productos')).rows.map(r=>r.referencia);
    const nuevos = productos.filter(p=>!existing.includes(p.referencia));
    const duplicados = productos.filter(p=>existing.includes(p.referencia));

    // Insert new ones
    for(const p of nuevos){
      const r = await pool.query(
        `INSERT INTO productos (tipo,referencia,largo,ancho,alto,descripcion,unidad) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [p.tipo,p.referencia,p.largo,p.ancho,p.alto,p.descripcion,p.unidad]
      );
      await pool.query('INSERT INTO stock (producto_id,cantidad) VALUES ($1,0)',[r.rows[0].id]);
    }

    res.json({
      total: productos.length,
      importados: nuevos.length,
      duplicados: duplicados.length,
      refs_duplicadas: duplicados.map(p=>p.referencia)
    });
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ── CATEGORÍAS CARGA ──────────────────────────────────────────────────────────
app.get('/api/categorias', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM categorias_carga ORDER BY nombre')).rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/categorias', async (req, res) => {
  const {nombre, color} = req.body;
  try { res.json((await pool.query('INSERT INTO categorias_carga (nombre,color) VALUES ($1,$2) RETURNING *',[nombre,color||'#334155'])).rows[0]); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/categorias/:id', async (req, res) => {
  const {nombre, color} = req.body;
  try { res.json((await pool.query('UPDATE categorias_carga SET nombre=$1,color=$2 WHERE id=$3 RETURNING *',[nombre,color,req.params.id])).rows[0]); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/categorias/:id', async (req, res) => {
  try { await pool.query('DELETE FROM categorias_carga WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT = process.env.PORT||3000;
initDB().then(()=>app.listen(PORT,()=>console.log(`Server on port ${PORT}`)));
