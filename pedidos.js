// routes/importarPdf.js — Importar un pedido desde el PDF de Business Central.
const router = require('express').Router();
const { extraerTodasLineas, extraerCliente } = require('../parseLineas');

router.post('/api/importar-pdf', async (req, res) => {
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

module.exports = router;
