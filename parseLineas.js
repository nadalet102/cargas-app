// ─────────────────────────────────────────────────────────────────────────────
// Parser de LÍNEAS por posición de columna para los albaranes/pedidos de Arisac.
//
// Sustituye al bloque de regex de /api/importar-pdf. En vez de aplastar la página
// a texto y adivinar columnas por espacios, usa las coordenadas X/Y que pdf2json
// ya entrega: agrupa fragmentos por fila (Y) y asigna cada uno a su columna (X)
// usando la cabecera como referencia.
//
// Salida por línea: { referencia, descripcion, cantidad, observaciones, es_articulo }
//   - referencia / descripcion / cantidad: lo que pides para preparar.
//   - observaciones: notas sin código de la tabla (p.ej. "DESCÀRREGA CV-700…",
//     "MERCANCÍA MAXIMO A SERVIR POR AGENCIA"), adjuntadas a su línea.
//   - es_articulo: false para conceptos que NO se preparan en almacén
//     (GASOIL, PORTES, descuentos…). La UI puede ocultarlos del picking.
// ─────────────────────────────────────────────────────────────────────────────

const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };

// "1.234,56" -> 1234.56 ; "" / "0" -> número o null
function esNum(s) {
  if (s == null) return null;
  s = String(s).trim();
  if (s === '' || s === '-') return null;
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

// Conceptos que no son mercancía a preparar (se detecta por la referencia)
const RE_CONCEPTO = /^(GASOIL|PORT|GASTO|RECARG|FINAN|ANTICIP|ABONO|DTOPP)/i;

// Bandas de columna en unidades pdf2json (estables en estos documentos)
function bandas(tieneDto) {
  return {
    codigo:    [-Infinity, 4.0],
    descrip:   [4.0, 16.0],
    cantidad:  [16.0, 19.6],
    kgs:       [19.6, 22.0],
    m3:        [22.0, 23.4],
    embalaje:  [23.4, 27.5],
    precio:    [27.5, tieneDto ? 29.7 : 31.5],
    pct_dto:   tieneDto ? [29.7, 32.5] : null,
    importe:   [tieneDto ? 32.5 : 31.5, Infinity],
  };
}
function colDe(x, B) {
  for (const k of Object.keys(B)) {
    const band = B[k];
    if (band && x >= band[0] && x < band[1]) return k;
  }
  return null;
}

// Agrupa los fragmentos de una página en filas visuales por Y
function filasPorY(texts, tol = 0.5) {
  const items = texts
    .map(t => ({ x: t.x, y: t.y, s: dec(t.R.map(r => r.T).join('')).trim() }))
    .filter(it => it.s !== '')
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const filas = [];
  let cur = [], cy = null;
  for (const it of items) {
    if (cy === null || Math.abs(it.y - cy) <= tol) { cur.push(it); cy = cy ?? it.y; }
    else { filas.push(cur); cur = [it]; cy = it.y; }
  }
  if (cur.length) filas.push(cur);
  return filas;
}

/**
 * Extrae las líneas de pedido de la primera página de un PDF ya parseado.
 * @param {object} page  -> data.Pages[0] de pdf2json
 * @returns {Array} líneas { referencia, descripcion, cantidad, observaciones, es_articulo }
 */
function extraerLineas(page) {
  const filas = filasPorY(page.Texts);

  // localizar cabecera (fila con "Cantidad") y "Totales" para acotar la tabla
  let yHeader = null, yTotales = Infinity, tieneDto = false;
  for (const f of filas) {
    const txt = f.map(i => i.s).join(' ');
    if (yHeader === null && /Cantidad/.test(txt) && /Embalaje/.test(txt)) {
      yHeader = f[0].y;
      tieneDto = /Dto\./.test(txt);
    }
    if (yHeader !== null && f[0].y > yHeader && /Totales/.test(txt)) {
      yTotales = f[0].y; break;
    }
  }
  if (yHeader === null) return [];   // formato inesperado
  const B = bandas(tieneDto);

  const lineas = [];
  let notasBuffer = [];   // notas que aparecen antes de la 1ª línea con artículo

  for (const f of filas) {
    const y = f[0].y;
    if (y <= yHeader + 0.4 || y >= yTotales) continue;  // fuera de la tabla

    // repartir tokens por columna
    const cel = {};
    for (const it of f) {
      const c = colDe(it.x, B);
      if (c) (cel[c] = cel[c] || []).push(it.s);
    }
    const get = k => (cel[k] || []).join(' ').trim();

    const codigo = get('codigo');
    const desc = get('descrip');
    const cantidad = esNum(get('cantidad'));
    const embalaje = get('embalaje').replace(/^0$/, '').trim() || null; // "12 PALET" | null
    const kgs = esNum(get('kgs'));

    // fila de relleno (solo ceros / vacía) -> ignorar
    if (!codigo && !desc) continue;

    // fila SIN código = nota / continuación de descripción -> observación
    if (!codigo) {
      const texto = desc.replace(/\s+/g, ' ').trim();
      if (!texto) continue;
      if (lineas.length) {
        // continuación de la nota anterior o nota nueva de la última línea
        const prev = lineas[lineas.length - 1];
        prev.observaciones = (prev.observaciones ? prev.observaciones + ' ' : '') + texto;
      } else {
        notasBuffer.push(texto);
      }
      continue;
    }

    // línea de producto
    const linea = {
      referencia: codigo.replace(/\s+/g, ' ').trim(),
      descripcion: desc.replace(/\s+/g, ' ').trim(),
      cantidad: cantidad != null ? cantidad : 0,
      observaciones: null,
      es_articulo: !RE_CONCEPTO.test(codigo),
      // secundarios (útiles para quien carga; la UI puede ignorarlos)
      embalaje,   // p.ej. "12 PALET"
      kgs,        // peso de la línea
    };
    if (notasBuffer.length) {           // notas previas -> primera línea
      linea.observaciones = notasBuffer.join(' ');
      notasBuffer = [];
    }
    lineas.push(linea);
  }
  return lineas;
}

module.exports = { extraerLineas, esNum };
