// routes/pedidosCli.js — Pedidos de cliente (construcción) y sus líneas.
const router = require('express').Router();
const { pool } = require('../db');
const { _recalcEstadoCli } = require('../services/produccion');

// Detección de material a partir de la descripción libre del pedido. No exige
// el nombre completo: casa por palabras distintivas, tolerando abreviaturas y
// granulometría ("A Blanca 0-4mm" → "Arena blanca"; "Gr Forna" → "Gravilla forna").
const _MAT_STOP = new Set(['bb','big','bag','saco','sacos','palet','pallet','paleta','cliente','kg','kgs','mm','cm','ud','uds','de','del','la','el','y','con','para','x','granel']);
const _matToks = s => (''+(s||'')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9]+/).filter(Boolean);
const _matGranos = s => { const n=(''+(s||'')).toLowerCase(); const o=[]; let m; const re=/(\d+)\s*[-/]\s*(\d+)/g; while((m=re.exec(n))) o.push(m[1]+'-'+m[2]); return o; };
function matchMaterialId(desc, materias){
  const d = _matToks(desc); if(!d.length) return null;
  const dG = _matGranos(desc);
  const isNum = t => /[0-9]/.test(t);
  const has = t => d.some(w => w===t || (!isNum(w) && w.length>=3 && (w.startsWith(t)||t.startsWith(w))));
  let best=null, bestScore=-1;
  for(const m of materias){ if(m.activo===false) continue;
    const st = _matToks(m.nombre).filter(t => t.length>=2 && !isNum(t) && !_MAT_STOP.has(t));
    if(!st.length) continue;
    let matched=0, strong=0, sum=0;
    for(const t of st){ if(has(t)){ matched++; sum+=t.length; if(t.length>=4) strong++; } }
    if(!((matched===st.length)||(strong>=1&&matched>=1))) continue;
    // la granulometría debe coincidir si ambos la llevan (0-4 ≠ 0-2)
    const mG = _matGranos(m.nombre); let gScore=0;
    if(mG.length && dG.length){ if(!mG.some(g=>dG.includes(g))) continue; gScore=500; }
    const score = matched*1000+gScore+sum;
    if(score>bestScore){ best=m; bestScore=score; }
  }
  return best ? best.id : null;
}

router.get('/api/pedidos-cli', async (req, res) => {
  try {
    const ped = (await pool.query('SELECT * FROM pedidos_cli ORDER BY creado DESC')).rows;
    const lins = (await pool.query('SELECT * FROM pedidos_cli_lineas ORDER BY id')).rows;
    ped.forEach(p => p.lineas = lins.filter(l => l.pedido_id === p.id));
    res.json(ped);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/pedidos-cli', async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = (await client.query('INSERT INTO pedidos_cli(cliente,notas) VALUES($1,$2) RETURNING *', [b.cliente||null, b.notas||null])).rows[0];
    // ¿cliente automático? (match tolerante: sin mayúsculas/acentos/puntuación/"S.L.", y por contención)
    let autoCli = null;
    if (b.cliente) {
      const norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
        .replace(/[.,;:_/\\-]/g,' ').replace(/\b(s\s*l|s\s*a|s\s*l\s*u|sociedad limitada|sociedad anonima|cb|scp)\b/g,' ')
        .replace(/\s+/g,' ').trim();
      const cn = norm(b.cliente);
      const all = (await client.query('SELECT * FROM clientes_auto')).rows;
      autoCli = all.find(r => { const an = norm(r.nombre); return an && cn && (cn.includes(an) || an.includes(cn)); }) || null;
    }
    const auto = !!autoCli;
    const minBB = autoCli ? (Number(autoCli.min_bb)||1) : 1;
    const materias = auto ? (await client.query('SELECT id,nombre,activo FROM materias_primas')).rows : [];
    let autoTareas = 0;
    for (const l of (b.lineas||[])) {
      const lin = (await client.query('INSERT INTO pedidos_cli_lineas(pedido_id,descripcion,cantidad,unidad) VALUES($1,$2,$3,$4) RETURNING *',
        [p.id, l.descripcion||null, Number(l.cantidad)||0, l.unidad||null])).rows[0];
      const esPalet = /\b(palet|pallet|paleta)\b/i.test(l.descripcion||'');
      const esSaco = /\bsacos?\b/i.test((l.descripcion||'')+' '+(l.unidad||''));
      if (auto && !esPalet && !esSaco && (Number(l.cantidad)||0) >= minBB) {
        // detectar el material por palabras distintivas de la descripción
        // (tolera abreviaturas/granulometría). Si no casa, sin material.
        const mp_id = l.descripcion ? matchMaterialId(l.descripcion, materias) : null;
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
    res.json({ ...p, auto, autoTareas, cliente: b.cliente||null });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
router.put('/api/pedidos-cli/:id', async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE pedidos_cli SET cliente=$1, notas=$2 WHERE id=$3', [b.cliente||null, b.notas||null, req.params.id]);
    // conservar estados existentes por id; reemplazar el conjunto de líneas
    const prev = (await client.query('SELECT * FROM pedidos_cli_lineas WHERE pedido_id=$1', [req.params.id])).rows;
    await client.query('DELETE FROM pedidos_cli_lineas WHERE pedido_id=$1', [req.params.id]);
    for (const l of (b.lineas||[])) {
      const pr = (l.id && prev.find(x => x.id === l.id)) ? prev.find(x => x.id === l.id) : null;
      const est = pr ? pr.estado : 'pendiente';
      await client.query('INSERT INTO pedidos_cli_lineas(pedido_id,descripcion,cantidad,unidad,estado,preparado) VALUES($1,$2,$3,$4,$5,$6)',
        [req.params.id, l.descripcion||null, Number(l.cantidad)||0, l.unidad||null, est, pr ? pr.preparado : false]);
    }
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
router.delete('/api/pedidos-cli/:id', async (req, res) => {
  try { await pool.query('DELETE FROM pedidos_cli WHERE id=$1', [req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
// marcar una línea como preparada / no preparada
router.patch('/api/pedidos-cli/lineas/:id/preparado', async (req, res) => {
  try {
    const r = await pool.query('UPDATE pedidos_cli_lineas SET preparado=$1 WHERE id=$2 RETURNING pedido_id', [!!req.body.preparado, req.params.id]);
    if (r.rows[0]) await _recalcEstadoCli(r.rows[0].pedido_id);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
// marcar TODO el pedido como preparado / no preparado
router.patch('/api/pedidos-cli/:id/preparado', async (req, res) => {
  try {
    await pool.query('UPDATE pedidos_cli_lineas SET preparado=$1 WHERE pedido_id=$2', [!!req.body.preparado, req.params.id]);
    await _recalcEstadoCli(req.params.id);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
// estado del pedido de cliente (revision|preparado|carga|cargado)
router.patch('/api/pedidos-cli/:id/estado', async (req, res) => {
  const { estado, nombre_carga } = req.body || {};
  try {
    if (estado === 'carga') {
      await pool.query('UPDATE pedidos_cli_lineas SET cargada=false WHERE pedido_id=$1',[req.params.id]);
      await pool.query('UPDATE pedidos_cli SET estado=$1, nombre_carga=COALESCE($2,nombre_carga) WHERE id=$3',['carga', nombre_carga||null, req.params.id]);
    } else if (estado === 'cargado') {
      await pool.query('UPDATE pedidos_cli SET estado=$1, cargado_at=now() WHERE id=$2',['cargado', req.params.id]);
    } else {
      await pool.query('UPDATE pedidos_cli SET estado=$1 WHERE id=$2',[estado, req.params.id]);
    }
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.patch('/api/pedidos-cli/lineas/:id/cargada', async (req, res) => {
  try { await pool.query('UPDATE pedidos_cli_lineas SET cargada=$1 WHERE id=$2',[!!req.body.cargada, req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
