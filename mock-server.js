// mock-server.js — Servidor de DESARROLLO para iterar el rediseño SIN Postgres.
// No toca la base de datos real. Sirve public/ y responde a /api/* con datos
// semilla en memoria. Arrancar:  node mock-server.js   (http://localhost:3000)
//
// Solo usa módulos nativos de Node (http, fs, path) — no requiere npm install.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const API_VERSION = 44;

// ── Datos semilla (en memoria) ────────────────────────────────────────────────
const hoy = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(hoy); d.setDate(d.getDate() + n); return iso(d); };

const db = {
  transportistas: [
    { id: 1, nombre: 'Transportes García', contacto: 'Luis García', telefono: '600111222', email: 'luis@tgarcia.es', nif: 'B12345678', color: '#185FA5', tarifas: [{ destino: 'Madrid', precio: 320 }, { destino: 'Valencia', precio: 280 }], notas: '', cif: 'B12345678', direccion: 'Pol. Ind. Norte 4', cp: '28001', ciudad: 'Madrid', pais: 'España' },
    { id: 2, nombre: 'Logística Mediterráneo', contacto: 'Ana Pérez', telefono: '600333444', email: 'ana@logmed.es', nif: 'B87654321', color: '#0F6E56', tarifas: [{ destino: 'Barcelona', precio: 410 }], notas: 'Frigorífico disponible', cif: 'B87654321', direccion: 'Av. del Puerto 12', cp: '46011', ciudad: 'Valencia', pais: 'España' },
    { id: 3, nombre: 'Cargas del Sur', contacto: 'Pedro Ruiz', telefono: '600555666', email: 'pedro@cargasur.es', nif: 'B11223344', color: '#854F0B', tarifas: [], notas: '', cif: 'B11223344', direccion: 'Ctra. Sevilla km 3', cp: '41080', ciudad: 'Sevilla', pais: 'España' },
    { id: 4, nombre: 'Trans Aragón', contacto: 'Marta Gil', telefono: '600777888', email: 'marta@transaragon.es', nif: 'B99887766', color: '#534AB7', tarifas: [], notas: '', cif: 'B99887766', direccion: 'Pol. Malpica 22', cp: '50016', ciudad: 'Zaragoza', pais: 'España' },
  ],
  categorias: [
    { id: 1, nombre: 'Urgente', color: '#A32D2D' },
    { id: 2, nombre: 'Obra', color: '#185FA5' },
    { id: 3, nombre: 'Agencia', color: '#854F0B' },
  ],
  preparadores: [
    { id: 1, nombre: 'José', activo: true },
    { id: 2, nombre: 'Carmen', activo: true },
    { id: 3, nombre: 'Antonio', activo: true },
  ],
  comerciales: [
    { id: 1, nombre: 'Sandra López', activo: true },
    { id: 2, nombre: 'Miguel Torres', activo: true },
  ],
  cargas: [
    { id: 1, name: 'Ruta Madrid', codigo_orden: 'ORD-2024-0012', truck_id: 1, fecha: addDays(1), status: 'planificada', color_idx: 0, coste: 320, coste_modo: 'fijo', mat_camion: '1234 ABC', mat_remolque: 'R-5678', notas: 'Salida 6:00', categoria_id: 2, created_at: addDays(-1) },
    { id: 2, name: 'Ruta Levante', codigo_orden: '', truck_id: 2, fecha: addDays(2), status: 'pendiente', color_idx: 1, coste: null, coste_modo: 'pendiente', mat_camion: '', mat_remolque: '', notas: '', categoria_id: null, created_at: addDays(-2) },
    { id: 3, name: 'Ruta Andalucía', codigo_orden: 'ORD-2024-0009', truck_id: 3, fecha: addDays(-1), status: 'entregada', color_idx: 2, coste: 540, coste_modo: 'fijo', mat_camion: '5678 DEF', mat_remolque: '', notas: '', categoria_id: null, created_at: addDays(-4) },
    { id: 4, name: 'Ruta Cataluña', codigo_orden: 'ORD-2024-0007', truck_id: 4, fecha: addDays(-3), status: 'entregada', color_idx: 4, coste: null, coste_modo: 'pendiente', mat_camion: '9012 GHI', mat_remolque: '', notas: '', categoria_id: null, created_at: addDays(-6) },
  ],
  pedidos: [
    { id: 1, num: 'PV24/00101', cliente: 'Construcciones Vega S.L.', destino: 'Madrid (28001)', ubicacion: 'Muelle 3', estado_prep: 'preparado', fecha: addDays(1), kg: 12400, porte: 320, prio: 'urgente', paradas: 1, obs: 'Llamar antes', carga_id: 1, orden_carga: 1, categoria_id: 2, maps_url: '', direccion_descarga: 'Av. de la Industria 45, 28001 Madrid', preparador: 'José', obs_prep: '', es_agencia: false, medidas: '', cambios: '', tiene_cambios: false, comercial: 'Sandra López', entregado_at: null },
    { id: 2, num: 'PV24/00102', cliente: 'Reformas Atlántico', destino: 'Madrid (28045)', ubicacion: '', estado_prep: 'carga', fecha: addDays(1), kg: 8600, porte: 0, prio: 'normal', paradas: 2, obs: '', carga_id: 1, orden_carga: 2, categoria_id: null, maps_url: '', direccion_descarga: 'C/ Mayor 8, 28045 Madrid', preparador: 'Carmen', obs_prep: 'Cuidado material frágil', es_agencia: false, medidas: '', cambios: '', tiene_cambios: false, comercial: 'Miguel Torres', entregado_at: null },
    { id: 3, num: 'PV24/00103', cliente: 'Obras Levante S.A.', destino: 'Valencia (46011)', ubicacion: '', estado_prep: 'sin_preparar', fecha: addDays(2), kg: 21000, porte: 280, prio: 'normal', paradas: 1, obs: '', carga_id: 2, orden_carga: 1, categoria_id: 2, maps_url: '', direccion_descarga: 'Pol. Fuente del Jarro, 46988 Paterna', preparador: '', obs_prep: '', es_agencia: false, medidas: '', cambios: '', tiene_cambios: false, comercial: 'Sandra López', entregado_at: null },
    { id: 4, num: 'PV24/00104', cliente: 'Distribuciones Norte', destino: 'Bilbao (48001)', ubicacion: '', estado_prep: 'sin_preparar', fecha: addDays(3), kg: 5400, porte: 0, prio: 'baja', paradas: 1, obs: '', carga_id: null, orden_carga: null, categoria_id: null, maps_url: '', direccion_descarga: '', preparador: '', obs_prep: '', es_agencia: true, medidas: '120x80x100', cambios: '', tiene_cambios: false, comercial: '', entregado_at: null },
    { id: 5, num: 'PV24/00105', cliente: 'Áridos del Centro', destino: 'Toledo (45003)', ubicacion: '', estado_prep: 'preparado', fecha: addDays(2), kg: 16800, porte: 0, prio: 'normal', paradas: 1, obs: '', carga_id: null, orden_carga: null, categoria_id: 1, maps_url: '', direccion_descarga: '', preparador: 'Antonio', obs_prep: '', es_agencia: false, medidas: '', cambios: '[03/06] Llegó material que faltaba', tiene_cambios: true, comercial: 'Miguel Torres', entregado_at: null },
    { id: 6, num: 'PV24/00106', cliente: 'Construcciones Vega S.L.', destino: 'Sevilla (41080)', ubicacion: '', estado_prep: 'entregado', fecha: addDays(-1), kg: 9200, porte: 540, prio: 'normal', paradas: 1, obs: '', carga_id: 3, orden_carga: 1, categoria_id: null, maps_url: '', direccion_descarga: 'Av. de Andalucía 100, 41080 Sevilla', preparador: 'José', obs_prep: '', es_agencia: false, medidas: '', cambios: '', tiene_cambios: false, comercial: 'Sandra López', entregado_at: addDays(-1) },
    { id: 7, num: 'PV24/00107', cliente: 'Materiales Aragón', destino: 'Zaragoza (50016)', ubicacion: 'Pasillo B', estado_prep: 'sin_preparar', fecha: addDays(4), kg: 13500, porte: 0, prio: 'normal', paradas: 1, obs: '', carga_id: null, orden_carga: null, categoria_id: null, maps_url: '', direccion_descarga: '', preparador: '', obs_prep: '', es_agencia: false, medidas: '', cambios: '', tiene_cambios: false, comercial: '', entregado_at: null },
  ],
  pedido_lineas: {
    1: [
      { id: 11, pedido_id: 1, referencia: 'CEM-001', descripcion: 'Cemento gris 25kg', cantidad: 40, preparada: true, observaciones: '', orden: 0, embalaje: 'Palet', kgs: 1000, falta: 0, cargada: false },
      { id: 12, pedido_id: 1, referencia: 'ARE-010', descripcion: 'Arena fina big bag', cantidad: 8, preparada: true, observaciones: 'Revisar humedad', orden: 1, embalaje: 'Big Bag', kgs: 8000, falta: 0, cargada: false },
    ],
    2: [
      { id: 21, pedido_id: 2, referencia: 'YES-002', descripcion: 'Yeso proyección', cantidad: 30, preparada: false, observaciones: '', orden: 0, embalaje: 'Saco', kgs: 750, falta: 5, cargada: false },
    ],
    3: [
      { id: 31, pedido_id: 3, referencia: 'GRA-100', descripcion: 'Gravilla 6-12', cantidad: 20, preparada: false, observaciones: '', orden: 0, embalaje: 'Big Bag', kgs: 20000, falta: 0, cargada: false },
    ],
  },
  materias_primas: [
    { id: 1, nombre: 'Arena silícea', activo: true },
    { id: 2, nombre: 'Cemento gris', activo: true },
    { id: 3, nombre: 'Cal hidratada', activo: true },
    { id: 4, nombre: 'Yeso', activo: true },
  ],
  silos: [
    { id: 1, numero: 0, nombre: 'Tolva 0', capacidad_kg: 25000, mp_id: 1, kg_actual: 18000, vaciando: false, producto: 'Arena silícea' },
    { id: 2, numero: 1, nombre: 'Tolva 1', capacidad_kg: 50000, mp_id: 2, kg_actual: 42000, vaciando: false, producto: 'Cemento gris' },
    { id: 3, numero: 2, nombre: 'Tolva 2', capacidad_kg: 50000, mp_id: 3, kg_actual: 9000, vaciando: true, producto: 'Cal hidratada' },
    { id: 4, numero: 3, nombre: 'Tolva 3', capacidad_kg: 50000, mp_id: null, kg_actual: 0, vaciando: false, producto: null },
    { id: 5, numero: 4, nombre: 'Tolva 4', capacidad_kg: 50000, mp_id: 4, kg_actual: 31000, vaciando: false, producto: 'Yeso' },
    { id: 6, numero: 5, nombre: 'Tolva 5', capacidad_kg: 25000, mp_id: null, kg_actual: 0, vaciando: false, producto: null },
  ],
  producciones: [
    { id: 1, tipo: 'bb', mp_id: 1, unidades: 10, kg_unidad: 1000, kg_total: 10000, silo_id: 1, estado: 'pendiente', notas: '', fecha: addDays(0), hecho_at: null, origen_linea_id: null, material: 'Arena silícea', silo_nombre: 'Tolva 0', cliente: 'Construcciones Vega S.L.', fabricante: null, orden: 3 },
    { id: 4, tipo: 'bb', mp_id: 1, unidades: 8, kg_unidad: 1000, kg_total: 8000, silo_id: 1, estado: 'en_proceso', notas: '', fecha: addDays(0), hecho_at: null, origen_linea_id: null, material: 'Arena silícea', silo_nombre: 'Tolva 0', cliente: 'Hormigones del Sur', fabricante: null, orden: 5 },
    { id: 5, tipo: 'bb', mp_id: 1, unidades: 12, kg_unidad: 1000, kg_total: 12000, silo_id: 1, estado: 'pendiente', notas: '', fecha: addDays(0), hecho_at: null, origen_linea_id: null, material: 'Arena silícea', silo_nombre: 'Tolva 0', cliente: null, fabricante: null, orden: 2 },
    { id: 2, tipo: 'saco', mp_id: 2, unidades: 200, kg_unidad: 25, kg_total: 5000, silo_id: 2, estado: 'pendiente', notas: '', fecha: addDays(0), hecho_at: null, origen_linea_id: null, material: 'Cemento gris', silo_nombre: 'Tolva 1', cliente: null, fabricante: 'PKT', orden: 1 },
    { id: 6, tipo: 'saco', mp_id: 2, unidades: 150, kg_unidad: 25, kg_total: 3750, silo_id: 2, estado: 'pendiente', notas: '', fecha: addDays(0), hecho_at: null, origen_linea_id: null, material: 'Cemento gris', silo_nombre: 'Tolva 1', cliente: 'Obras Levante S.A.', fabricante: 'PKT', orden: 4 },
    { id: 7, tipo: 'bb', mp_id: 4, unidades: 6, kg_unidad: 1000, kg_total: 6000, silo_id: null, estado: 'pendiente', notas: '', fecha: addDays(0), hecho_at: null, origen_linea_id: null, material: 'Yeso', silo_nombre: null, cliente: 'Reformas Atlántico', fabricante: null, orden: 0 },
    { id: 8, tipo: 'bb', mp_id: null, unidades: 5, kg_unidad: 1000, kg_total: 5000, silo_id: null, estado: 'pendiente', notas: 'Big Bag Arena Silícea 0-2 1000kg', fecha: addDays(0), hecho_at: null, origen_linea_id: null, material: null, silo_nombre: null, cliente: 'Áridos del Norte SL', fabricante: null, orden: 1 },
    { id: 3, tipo: 'bb', mp_id: 3, unidades: 6, kg_unidad: 1000, kg_total: 6000, silo_id: 3, estado: 'hecho', notas: '', fecha: addDays(0), hecho_at: addDays(0), origen_linea_id: null, material: 'Cal hidratada', silo_nombre: 'Tolva 2', cliente: null, fabricante: null, orden: 0 },
  ],
  viajes: [
    { id: 1, mp_id: 1, kg: 25000, silo_id: null, fecha: addDays(0), estado: 'pendiente', destino_tipo: null, destino_silo_id: null, kg_final: null, acopio: null, origen: 'manual', notas: '', hora: '08:30', material: 'Arena silícea', silo_nombre: null, destino_silo_nombre: null },
    { id: 2, mp_id: 2, kg: 24000, silo_id: null, fecha: addDays(-1), estado: 'hecho', destino_tipo: 'silo', destino_silo_id: 2, kg_final: 23800, acopio: null, origen: 'manual', notas: '', hora: '10:00', material: 'Cemento gris', silo_nombre: null, destino_silo_nombre: 'Tolva 1' },
  ],
  compras: [
    { id: 1, proveedor: 'Cementos del Centro', estado: 'por_pedir', fecha_prevista: addDays(2), fecha_recibido: null, tolva: 'Tolva 1', transportista: 'Transportes García', transportista_tel: '600111222', pedidos_rel: 'PV24/00102', prioridad: 'alta', notas: '', hora: '09:00', formato: 'granel', tipo_produccion: 'saco', kg_bb: null, kg_saco: 25, lineas: [{ id: 1, compra_id: 1, referencia: 'CEM-001', descripcion: 'Cemento gris', cantidad: 24000, unidad: 'kg', falta_linea_id: 21 }] },
    { id: 2, proveedor: 'Áridos Levante', estado: 'pedido', fecha_prevista: addDays(1), fecha_recibido: null, tolva: 'Tolva 0', transportista: '', transportista_tel: '', pedidos_rel: '', prioridad: 'normal', notas: 'Confirmado por teléfono', hora: '', formato: 'granel', tipo_produccion: 'bb', kg_bb: 1000, kg_saco: null, lineas: [{ id: 2, compra_id: 2, referencia: 'ARE-010', descripcion: 'Arena silícea', cantidad: 25000, unidad: 'kg', falta_linea_id: null }] },
  ],
  pedidos_cli: [
    { id: 1, cliente: 'Construcciones Vega S.L.', notas: '', estado: 'revision', nombre_carga: null, creado: addDays(0), lineas: [
      { id: 1, pedido_id: 1, descripcion: 'Big bag arena silícea', cantidad: 10, unidad: 'ud', estado: 'pendiente', preparado: false, cargada: false },
      { id: 2, pedido_id: 1, descripcion: 'Palet sacos cemento', cantidad: 2, unidad: 'palet', estado: 'pendiente', preparado: false, cargada: false },
    ] },
    { id: 2, cliente: 'Obras Levante S.A.', notas: 'Recogen ellos', estado: 'preparado', nombre_carga: null, creado: addDays(-1), lineas: [
      { id: 3, pedido_id: 2, descripcion: 'Big bag cal', cantidad: 4, unidad: 'ud', estado: 'hecho', preparado: true, cargada: false },
    ] },
  ],
  clientes_auto: [
    { id: 1, nombre: 'Construcciones Vega', min_bb: 1 },
    { id: 2, nombre: 'Obras Levante', min_bb: 2 },
  ],
  bc_inbox: [
    { num: 'PV24/00108', cliente: 'Nuevos Materiales S.L.', destino: 'Murcia — Murcia', direccion_descarga: 'Pol. Oeste 5, 30100 Murcia', fecha: addDays(3), kg: 14000, porte: 300, lineas: [{ descripcion: 'Cemento blanco', cantidad: 100, ref_bc: 'CEM-BL' }], estado: 'pendiente' },
  ],
  mant_items: [
    { id: 1, nombre: 'Nivel aceite motor', periodicidad: 'semanal', orden: 0, activo: true },
    { id: 2, nombre: 'Presión neumáticos', periodicidad: 'semanal', orden: 1, activo: true },
    { id: 3, nombre: 'Engrase', periodicidad: 'mensual', orden: 2, activo: true },
  ],
  mant_registros: [
    { id: 1, item_id: 1, item_nombre: 'Nivel aceite motor', periodicidad: 'semanal', vehiculo: 'Camión', fecha: addDays(-3), km: 125000, horas: null, notas: '', creado: addDays(-3) },
  ],
  mant_reparaciones: [],
};

// joins calculados al vuelo
function cargasJoin() {
  return db.cargas.map((c) => {
    const t = db.transportistas.find((x) => x.id === c.truck_id);
    return { ...c, truck_nombre: t ? t.nombre : null, truck_color: t ? t.color : null };
  });
}
function pedidosJoin() {
  return db.pedidos.map((p) => {
    const cat = db.categorias.find((x) => x.id === p.categoria_id);
    return { ...p, categoria_nombre: cat ? cat.nombre : null, categoria_color: cat ? cat.color : null };
  });
}
function faltas() {
  const out = [];
  for (const pid in db.pedido_lineas) {
    for (const l of db.pedido_lineas[pid]) {
      if ((l.falta || 0) > 0) {
        const p = db.pedidos.find((x) => x.id === l.pedido_id);
        out.push({ linea_id: l.id, referencia: l.referencia, descripcion: l.descripcion, cantidad: l.cantidad, falta: l.falta, embalaje: l.embalaje, pedido_id: l.pedido_id, pedido_num: p ? p.num : '', cliente: p ? p.cliente : '', fecha: p ? p.fecha : null, comercial: p ? p.comercial : '' });
      }
    }
  }
  return out;
}
function prepPendiente() {
  const out = [];
  for (const pid in db.pedido_lineas) {
    for (const l of db.pedido_lineas[pid]) {
      if (!l.preparada) {
        const p = db.pedidos.find((x) => x.id === l.pedido_id);
        out.push({ linea_id: l.id, referencia: l.referencia, descripcion: l.descripcion, cantidad: l.cantidad, embalaje: l.embalaje, falta: l.falta || 0, pedido_id: l.pedido_id, pedido_num: p ? p.num : '', cliente: p ? p.cliente : '', fecha: p ? p.fecha : null });
      }
    }
  }
  return out;
}

// ── Router ────────────────────────────────────────────────────────────────────
let nextId = 1000;
function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// Rutas GET exactas → función que devuelve datos
const GET_ROUTES = {
  '/api/health': () => ({ ok: true, version: API_VERSION }),
  '/api/transportistas': () => db.transportistas,
  '/api/cargas': cargasJoin,
  '/api/pedidos': pedidosJoin,
  '/api/categorias': () => db.categorias,
  '/api/preparadores': () => db.preparadores,
  '/api/comerciales': () => db.comerciales,
  '/api/materias-primas': () => db.materias_primas,
  '/api/silos': () => db.silos,
  '/api/producciones': () => db.producciones,
  '/api/viajes': () => db.viajes,
  '/api/compras': () => db.compras,
  '/api/pedidos-cli': () => db.pedidos_cli,
  '/api/clientes-auto': () => db.clientes_auto,
  '/api/faltas': faltas,
  '/api/preparacion-pendiente': prepPendiente,
  '/api/bc/pedidos': () => db.bc_inbox,
  '/api/backups': () => [],
  '/api/cal-token': () => ({ token: 'demo-token' }),
  '/api/mant/items': () => db.mant_items,
  '/api/mant/registros': () => db.mant_registros,
  '/api/mant/reparaciones': () => db.mant_reparaciones,
};

function handleApi(req, res, body) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const m = req.method;

  // GET exactos
  if (m === 'GET' && GET_ROUTES[p]) return send(res, 200, GET_ROUTES[p]());

  // GET líneas de un pedido
  let mm;
  if (m === 'GET' && (mm = p.match(/^\/api\/pedidos\/(\d+)\/lineas$/))) {
    return send(res, 200, db.pedido_lineas[mm[1]] || []);
  }
  if (m === 'GET' && (mm = p.match(/^\/api\/bc\/config\/(.+)$/))) return send(res, 200, []);
  if (m === 'GET' && (mm = p.match(/^\/api\/bc\/pedido\/(.+)$/))) {
    const row = db.bc_inbox.find((x) => x.num === decodeURIComponent(mm[1]));
    return row ? send(res, 200, row) : send(res, 404, { error: 'No encontrado' });
  }

  // Mutaciones: respuesta genérica plausible para que la UI no rompa.
  // POST que crea → devuelve objeto con id; PATCH/PUT → eco del body; DELETE → ok.
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    if (m === 'DELETE') return send(res, 200, { ok: true });
    const obj = (body && typeof body === 'object') ? body : {};
    // si la ruta pide preparado/estado, devolver coherente
    return send(res, 200, { ok: true, id: ++nextId, ...obj });
  }

  return send(res, 404, { error: 'Mock: ruta no implementada ' + m + ' ' + p });
}

// ── Estáticos ─────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  const u = new URL(req.url, 'http://localhost');
  let fp = path.join(PUBLIC, decodeURIComponent(u.pathname));
  // archivos del root (manifest, sw, iconos) servidos también
  if (!fp.startsWith(PUBLIC)) fp = path.join(PUBLIC, 'index.html');
  fs.stat(fp, (err, st) => {
    if (!err && st.isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      return fs.createReadStream(fp).pipe(res);
    }
    // intentar en el root del proyecto (sw.js, manifest.json, iconos)
    const rootFp = path.join(__dirname, decodeURIComponent(u.pathname));
    if (rootFp.startsWith(__dirname) && fs.existsSync(rootFp) && fs.statSync(rootFp).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rootFp)] || 'application/octet-stream' });
      return fs.createReadStream(rootFp).pipe(res);
    }
    // SPA fallback
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(PUBLIC, 'index.html')).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch (_) {}
      try { handleApi(req, res, body); }
      catch (e) { send(res, 500, { error: e.message }); }
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => console.log(`Mock server on http://localhost:${PORT}`));
