// db.js — Conexión a PostgreSQL e inicialización del esquema.
const { Pool } = require('pg');

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
    `ALTER TABLE pedido_lineas ADD COLUMN IF NOT EXISTS cargada BOOLEAN DEFAULT false`,
    `ALTER TABLE pedidos_cli ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'revision'`,
    `ALTER TABLE pedidos_cli ADD COLUMN IF NOT EXISTS nombre_carga TEXT`,
    `ALTER TABLE pedidos_cli ADD COLUMN IF NOT EXISTS cargado_at TIMESTAMPTZ`,
    `ALTER TABLE pedidos_cli_lineas ADD COLUMN IF NOT EXISTS cargada BOOLEAN DEFAULT false`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS hora TEXT`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS formato TEXT DEFAULT 'granel'`,
    `ALTER TABLE clientes_auto ADD COLUMN IF NOT EXISTS min_bb INTEGER DEFAULT 1`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_at TIMESTAMPTZ`,
    `CREATE TABLE IF NOT EXISTS mant_items (
      id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, periodicidad TEXT DEFAULT 'semanal',
      orden INTEGER DEFAULT 0, activo BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS mant_registros (
      id SERIAL PRIMARY KEY, item_id INTEGER REFERENCES mant_items(id) ON DELETE CASCADE,
      vehiculo TEXT DEFAULT 'Camión', fecha DATE DEFAULT CURRENT_DATE,
      km NUMERIC, horas NUMERIC, notas TEXT, creado TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS mant_reparaciones (
      id SERIAL PRIMARY KEY, vehiculo TEXT DEFAULT 'Camión', fecha DATE DEFAULT CURRENT_DATE,
      concepto TEXT, km NUMERIC, horas NUMERIC, creado TIMESTAMPTZ DEFAULT now()
    )`,
    `ALTER TABLE producciones ADD COLUMN IF NOT EXISTS origen_linea_id INTEGER`,
    `ALTER TABLE viajes ADD COLUMN IF NOT EXISTS hora TEXT`,
    `ALTER TABLE pedidos_cli_lineas ADD COLUMN IF NOT EXISTS preparado BOOLEAN DEFAULT false`,
    `ALTER TABLE producciones ADD COLUMN IF NOT EXISTS cliente TEXT`,
    `ALTER TABLE producciones ADD COLUMN IF NOT EXISTS fabricante TEXT`,
    `UPDATE viajes SET estado='pendiente' WHERE estado IS NULL`,
    `ALTER TABLE producciones ADD COLUMN IF NOT EXISTS orden INTEGER DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS tipo_produccion TEXT`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS kg_bb NUMERIC`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS kg_saco NUMERIC`,
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
      estado TEXT DEFAULT 'pendiente',
      preparado BOOLEAN DEFAULT false
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
  ];
  for (const sql of stmts) {
    try { await pool.query(sql); }
    catch(e) { console.warn('initDB warning:', e.message); }
  }
  // sembrar silos la primera vez (0-5: la 5 = 25.000 kg, resto 50.000)
  try {
    const c = await pool.query('SELECT COUNT(*)::int AS n FROM silos');
    if (c.rows[0].n === 0) {
      for (let i = 0; i <= 5; i++) {
        await pool.query('INSERT INTO silos(numero,nombre,capacidad_kg) VALUES($1,$2,$3)', [i, 'Tolva ' + i, i === 5 ? 25000 : 50000]);
      }
    }
    // asegurar que existe la Tolva 0 (para los que ya tenían silos 1-5)
    await pool.query(
      `INSERT INTO silos(numero,nombre,capacidad_kg)
       SELECT 0,'Tolva 0',25000 WHERE NOT EXISTS (SELECT 1 FROM silos WHERE numero=0)`);
  } catch(e) { console.warn('seed silos:', e.message); }
  // token para los feeds de calendario (ICS) — privado en la URL
  try {
    const t = await pool.query("SELECT 1 FROM bc_config WHERE key='cal_token'");
    if (!t.rows.length) {
      const tok = require('crypto').randomBytes(9).toString('hex');
      await pool.query("INSERT INTO bc_config(key,value) VALUES('cal_token', to_jsonb($1::text))", [tok]);
    }
  } catch(e) { console.warn('cal token:', e.message); }
  // sembrar items de mantenimiento la primera vez (según la hoja de Arisac)
  try {
    const c = await pool.query('SELECT COUNT(*)::int AS n FROM mant_items');
    if (c.rows[0].n === 0) {
      const seed = [
        ['Nivel aceite motor','semanal'],['Presión neumáticos','semanal'],['Refrigerante motor','semanal'],['Filtro aire','semanal'],
        ['Engrase','mensual'],['Nivel aceite hidráulico','mensual'],['Nivel líquido frenos','mensual'],
        ['Cambio aceite','250h'],['Cambio filtro aceite motor','250h'],['Cambio filtro gasoil','250h']
      ];
      for (let i=0;i<seed.length;i++) await pool.query('INSERT INTO mant_items(nombre,periodicidad,orden) VALUES($1,$2,$3)',[seed[i][0],seed[i][1],i]);
    }
  } catch(e) { console.warn('seed mant:', e.message); }
  console.log('DB ready');
}

module.exports = { pool, initDB };
