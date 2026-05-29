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

// Conceptos que NO son mercancía a preparar (se detecta por la referencia):
// gasoil, portes, gastos, recargos, financiación, anticipos, abonos, descuentos,
// saco suelto (accesorio) y envases/palets de jardinería (ENVA…).
const RE_CONCEPTO = /^(GASOIL|PORT|GASTO|RECARG|FINAN|ANTICIP|ABONO|DTOPP|SACOSUELTO|ENVA)/i;

// Un código de artículo real es mayúsculas/dígitos sin espacios (SCCR0046, BBGJ0059,
// SACOSUELTO, GASOIL…). Sirve para descartar el pie de página (Importe, Forma de pago,
// textos legales…) que se cuela cuando la tabla no tiene fila "Totales".
const RE_CODIGO = /^[A-Z][A-Z0-9]{3,}$/;

// Limpia una nota: quita los asteriscos (de los bordes o de en medio) y espacios
// sobrantes, dejando el texto que hubiera entre ellos. Devuelve '' si no queda nada
// útil (p.ej. una línea que era solo "*****").
function limpiarNota(t) {
  const s = String(t || '').replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim();
  const alnum = (s.match(/[\p{L}\p{N}]/gu) || []).length;
  return alnum < 2 ? '' : s;
}

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
    if (yHeader !== null && f[0].y > yHeader && /(Totales|Suma y sigue|Forma de pago|Base IVA)/i.test(txt)) {
      yTotales = f[0].y; break;
    }
  }
  if (yHeader === null) return [];   // formato inesperado
  const B = bandas(tieneDto);

  const lineas = [];
  let notaAbajo = [];   // notas que van al artículo de ABAJO (asteriscos, o notas antes de la 1ª línea)

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

    // fila SIN código de artículo válido = nota / continuación / línea de asteriscos
    if (!RE_CODIGO.test(codigo)) {
      const raw = [codigo, desc].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const tieneAsteriscos = raw.includes('*');
      const texto = limpiarNota(raw);
      if (!texto) continue;                    // p.ej. "*****" sin texto dentro
      if (tieneAsteriscos) {
        // lo que va entre asteriscos -> observación del artículo de ABAJO
        notaAbajo.push(texto);
      } else if (lineas.length) {
        // nota normal / continuación -> artículo de arriba
        const prev = lineas[lineas.length - 1];
        prev.observaciones = (prev.observaciones ? prev.observaciones + ' ' : '') + texto;
      } else {
        notaAbajo.push(texto);                 // antes de la 1ª línea -> al de abajo
      }
      continue;
    }

    // línea de producto (código válido)
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
    if (notaAbajo.length) {             // notas de asteriscos / previas -> este artículo
      linea.observaciones = notaAbajo.join(' ');
      notaAbajo = [];
    }
    lineas.push(linea);
  }
  return lineas;
}

/**
 * Extrae las líneas de TODAS las páginas de un PDF parseado.
 * @param {Array|object} pages  -> data.Pages (array) o una sola página
 */
function extraerTodasLineas(pages) {
  if (!Array.isArray(pages)) return extraerLineas(pages);
  const out = [];
  for (const pg of pages) out.push(...extraerLineas(pg));
  return out;
}

module.exports = { extraerLineas, extraerTodasLineas, esNum, extraerCliente };

// Nombre del cliente por POSICIÓN: la fila justo debajo de "Cliente:" en la
// columna izquierda. Más fiable que la regex sobre texto plano (que fallaba
// con acentos/ç y se tragaba la dirección en clientes-persona).
function extraerCliente(page) {
  const W = page.Texts
    .map(t => ({ x: t.x, y: t.y, s: dec(t.R.map(r => r.T).join('')).trim() }))
    .filter(w => w.s)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  // la etiqueta buena lleva ":" ("Cliente:"); la cabecera de la tabla es "Cliente" sin ":"
  const lab = W.find(w => /^cliente\s*:$/i.test(w.s));
  if (!lab) return null;
  // primer texto en la misma columna (x cercana) por debajo de la etiqueta
  const col = W
    .filter(w => Math.abs(w.x - lab.x) < 3 && w.y > lab.y + 0.2)
    .sort((a, b) => a.y - b.y);
  if (!col.length) return null;
  const nombre = col[0].s.replace(/\s+/g, ' ').trim();
  return nombre || null;
}
