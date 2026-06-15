const CCOLS=[
  {b:'#185FA5',bg:'#E6F1FB',t:'#0C447C'},
  {b:'#0F6E56',bg:'#E1F5EE',t:'#085041'},
  {b:'#854F0B',bg:'#FAEEDA',t:'#633806'},
  {b:'#712B13',bg:'#FAECE7',t:'#4A1B0C'},
  {b:'#534AB7',bg:'#EEEDFE',t:'#3C3489'},
];
const STATUS_CFG={
  pendiente:{label:'Pendiente',badge:'b-gray'},
  planificada:{label:'Planificada',badge:'b-blue'},
  ruta:{label:'En ruta',badge:'b-amber'},
  entregada:{label:'Entregada',badge:'b-green'},
};
// Color de la carga según su estado. Usa variables CSS para adaptarse al tema
// claro/oscuro (definiciones en css/app.css → --st-*-b / -bg / -t).
const STATUS_COL={
  pendiente:{b:'var(--st-pend-b)',bg:'var(--st-pend-bg)',t:'var(--st-pend-t)'},     // sin color (gris neutro)
  planificada:{b:'var(--st-plan-b)',bg:'var(--st-plan-bg)',t:'var(--st-plan-t)'},   // azul
  ruta:{b:'var(--st-ruta-b)',bg:'var(--st-ruta-bg)',t:'var(--st-ruta-t)'},          // ámbar
  entregada:{b:'var(--st-entr-b)',bg:'var(--st-entr-bg)',t:'var(--st-entr-t)'},     // verde
};
const MESES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DOWS=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const TRANS_COLORS=['#185FA5','#0F6E56','#854F0B','#712B13','#534AB7','#A32D2D'];

let pedidos=[],cargas=[],transportistas=[],categorias=[],preparadoresList=[],comercialesList=[];
let pdfImportLineas=null;  // líneas del último PDF importado en el modal de planificación
let dragId=null,searchQ='',prepFilter='all',catFilter='',editId=null,modalType=null,cargaN=0;
let calY=new Date().getFullYear(),calM=new Date().getMonth();
// Cargas plegadas (solo nombre + resumen). Persistente entre sesiones.
let cargasColapsadas=new Set();
try{ cargasColapsadas=new Set(JSON.parse(localStorage.getItem('cargasColapsadas')||'[]')); }catch(e){}

const fmtN=n=>Math.round(n||0).toLocaleString('es-ES');
const fmtDate=d=>{if(!d)return'';const s=String(d).substring(0,10);const[y,m,dd]=s.split('-');return dd+'/'+m+'/'+y;};
const cargaPs=id=>pedidos.filter(p=>String(p.carga_id)===String(id));
const cargaKg=id=>cargaPs(id).reduce((s,p)=>s+(+p.kg||0),0);
const cargaPortes=id=>cargaPs(id).reduce((s,p)=>s+(+p.porte||0),0);
const freePs=()=>pedidos.filter(p=>{
  if(p.carga_id) return false;
  if(prepFilter!=='all'&&p.estado_prep!==prepFilter) return false;
  if(catFilter&&String(p.categoria_id)!==catFilter) return false;
  if(searchQ&&!p.cliente.toLowerCase().includes(searchQ)&&!p.destino.toLowerCase().includes(searchQ)&&!p.num.toLowerCase().includes(searchQ)) return false;
  return true;
});
const getTrans=id=>transportistas.find(x=>String(x.id)===String(id));
const initials=n=>n.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
const kgColor=pct=>pct>=1?'#E24B4A':pct>=0.85?'#BA7517':'#3B6D11';

function setSyncStatus(state){
  const d=document.getElementById('sync-dot');
  const sub=document.getElementById('tb-sub');
  d.className='sync-dot'+(state==='ok'?'':state==='err'?' error':' syncing');
  sub.textContent=state==='ok'?'Sincronizado':state==='err'?'Error de conexión':'Sincronizando...';
}

// ── Cola offline (outbox) ──────────────────────────────────────────────────────
// Las acciones hechas sin cobertura se guardan en localStorage y se reenvían
// solas al volver la señal (evento online, cada 30 s, o tocando el chip).
const OUTBOX_KEY='arisac_outbox_v1';
const _OUTBOX_EXCLUIR=['/importar-pdf','/copias'];   // pesados o no-reintetables
function _outboxGet(){ try{ const q=JSON.parse(localStorage.getItem(OUTBOX_KEY)||'[]'); return Array.isArray(q)?q:[]; }catch(e){ return []; } }
function _outboxSet(q){ try{ localStorage.setItem(OUTBOX_KEY,JSON.stringify(q)); }catch(e){} _renderOutboxChip(); }
function _esFalloRed(e){ return (e instanceof TypeError) || /failed to fetch|networkerror|load failed|network request failed/i.test((e&&e.message)||''); }
function _renderOutboxChip(){
  const n=_outboxGet().length;
  let chip=document.getElementById('outbox-chip');
  if(!n){ if(chip) chip.remove(); return; }
  if(!chip){
    chip=document.createElement('button'); chip.id='outbox-chip';
    chip.style.cssText='position:fixed;bottom:14px;left:14px;z-index:9999;display:flex;align-items:center;gap:6px;background:var(--amber-l);color:var(--amber);border:1px solid var(--amber);border-radius:20px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18)';
    chip.title='Cambios hechos sin conexión, pendientes de enviar. Toca para reintentar.';
    chip.onclick=()=>flushOutbox();
    document.body.appendChild(chip);
  }
  chip.innerHTML='<i class="ti ti-cloud-upload"></i> '+n+' pendiente'+(n>1?'s':'');
}
let _outboxFlushing=false;
async function flushOutbox(){
  if(_outboxFlushing) return;
  let q=_outboxGet(); if(!q.length) return;
  if(navigator.onLine===false) return;
  _outboxFlushing=true;
  let enviados=0, descartados=0;
  try{
    while(q.length){
      const it=q[0];
      try{
        const r=await fetch('/api'+it.path,{method:it.method,headers:{'Content-Type':'application/json'},body:it.body!=null?JSON.stringify(it.body):undefined});
        if(r.ok) enviados++;
        else { descartados++; console.warn('Outbox: descartado',it.method,it.path,r.status); }
        q.shift(); _outboxSet(q);
      }catch(e){
        if(_esFalloRed(e)) break;            // sigue sin red: conservar y parar
        descartados++; q.shift(); _outboxSet(q);
      }
    }
  }finally{ _outboxFlushing=false; }
  if(enviados||descartados){
    log(enviados?('Enviado'+(enviados>1?'s':'')+' '+enviados+' cambio'+(enviados>1?'s':'')+' pendiente'+(enviados>1?'s':'')+(descartados?(' · '+descartados+' descartado(s)'):'')):(descartados+' cambio(s) descartado(s) por error del servidor'), enviados?'ok':'warn');
    try{ loadAll(); _runRenderer(_activeView); }catch(e){}
  }
}
window.addEventListener('online',()=>setTimeout(flushOutbox,800));

async function api(method,path,body){
  const opts={method,headers:{'Content-Type':'application/json'}};
  if(body)opts.body=JSON.stringify(body);
  try{
    const r=await fetch('/api'+path,opts);
    if(!r.ok)throw new Error(await r.text());
    return r.json();
  }catch(e){
    // sin red y es una acción (no lectura): a la cola y la app sigue
    if(method!=='GET' && _esFalloRed(e) && !path.endsWith('/partir') && !_OUTBOX_EXCLUIR.some(p=>path.startsWith(p))){
      const q=_outboxGet(); q.push({method,path,body:body!=null?body:null,ts:Date.now()}); _outboxSet(q);
      log('Sin conexión: guardado, se enviará al volver la señal','warn');
      return {__offline:true, ok:true};
    }
    throw e;
  }
}

async function loadAll(){
  setSyncStatus('loading');
  try{
    [transportistas,cargas,pedidos,categorias,preparadoresList,comercialesList]=await Promise.all([api('GET','/transportistas'),api('GET','/cargas'),api('GET','/pedidos'),api('GET','/categorias'),api('GET','/preparadores'),api('GET','/comerciales')]);
    cargaN=cargas.length;
    setSyncStatus('ok');
    renderAll();
    // si el jefe está mirando la cola de producción, refrescarla también
    // para que vea entrar pedidos/tareas nuevas sin cambiar de pestaña
    if(_activeView==='prodcola') cargarProduccionCola();
  }catch(e){setSyncStatus('err');log('Error al cargar: '+e.message,'warn');}
}

function updateCatDropdowns(){
  const opts='<option value="">Todas las categorías</option>'+categorias.map(c=>`<option value="${c.id}" ${catFilter===String(c.id)?'selected':''}>${c.nombre}</option>`).join('');
  ['filter-cat-ped','filter-cat-cal'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){const cur=el.value;el.innerHTML=opts;el.value=cur;}
  });
}
function renderAll(){renderBCList();renderCargas();updateStats();updateCatDropdowns();}

const NAV_GROUPS = {
  reparto:     { subs:[['plan','Planificación'],['bc','Bandeja BC'],['cal','Calendario'],['hist','Historial']] },
  preparacion: { subs:[['prep','Por preparar'],['preparados','Preparados'],['carga','Carga'],['histped','Histórico'],['porart','Por artículo']] },
  compras:     { subs:[['compras','']] },
  produccion:  { subs:[['prodcola','Producción'],['silos','Silos'],['matprima','Materia prima'],['pedidoscli','Pedidos'],['camion','Camión'],['prodcal','Calendario'],['prodfinal','Prod. Final']] },
  resumen:     { subs:[['dash','']] },
  ajustes:     { subs:[['trans','Transportistas'],['cats','Categorías'],['clientesauto','Clientes auto'],['calsync','Calendario']] }
};
const VIEW_GROUP = {plan:'reparto',bc:'reparto',cal:'reparto',hist:'reparto',prep:'preparacion',preparados:'preparacion',carga:'preparacion',histped:'preparacion',porart:'preparacion',compras:'compras',dash:'resumen',trans:'ajustes',cats:'ajustes',clientesauto:'ajustes',calsync:'ajustes',prodcola:'produccion',silos:'produccion',matprima:'produccion',prodbb:'produccion',prodsacos:'produccion',prodfinal:'produccion',camion:'produccion',prodcal:'produccion',pedidoscli:'produccion'};
let _activeView='plan';
function _runRenderer(t){
  if(t==='cal')renderCal();
  else if(t==='dash')renderDash();
  else if(t==='trans')renderTrans();
  else if(t==='cats')renderCats();
  else if(t==='clientesauto')cargarClientesAuto();
  else if(t==='calsync')cargarCalSync();
  else if(t==='hist')renderHist();
  else if(t==='prep'){fillPreparadorFilters();renderPrepList();}
  else if(t==='preparados'){fillPreparadorFilters();renderPreparadosList();}
  else if(t==='carga'){cargarCargaList();}
  else if(t==='porart'){cargarPrepResumen();}
  else if(t==='histped'){cargarHistPed();}
  else if(t==='compras')renderCompras();
  else if(t==='silos')cargarSilos();
  else if(t==='matprima')cargarMatPrimas(true);
  else if(t==='prodbb')cargarProd('bb');
  else if(t==='prodsacos')cargarProd('saco');
  else if(t==='prodfinal')cargarProdFinal();
  else if(t==='camion')cargarViajes();
  else if(t==='prodcal')cargarProdCal();
  else if(t==='pedidoscli')cargarPedidosCli();
  else if(t==='prodcola')cargarProduccionCola();
  else if(t==='bc'){ loadBCConfig(); loadBCPedidos(); }
}
function renderSubtabBar(g, activeView){
  const bar=document.getElementById('subtab-bar'); if(!bar) return;
  const subs=(NAV_GROUPS[g]||{}).subs||[];
  if(subs.length<=1){ bar.style.display='none'; bar.innerHTML=''; return; }
  bar.style.display='flex';
  bar.innerHTML=subs.map(([v,lbl])=>`<div class="csub ${v===activeView?'active':''}" onclick="switchView('${v}')">${lbl}</div>`).join('');
}
function switchView(t){
  _activeView=t;
  ['plan','cal','trans','cats','hist','dash','bc','prep','preparados','carga','histped','porart','compras','silos','matprima','prodcola','prodbb','prodsacos','prodfinal','camion','prodcal','pedidoscli','clientesauto','calsync'].forEach(id=>{
    const v=document.getElementById('view-'+id); if(v) v.classList.toggle('active',id===t);
  });
  const g=VIEW_GROUP[t]||'reparto';
  document.querySelectorAll('.tabs-bar .tab').forEach(e=>e.classList.remove('active'));
  document.getElementById('grp-'+g)?.classList.add('active');
  renderSubtabBar(g, t);
  _runRenderer(t);
}
function switchGroup(g){
  const subs=(NAV_GROUPS[g]||{}).subs||[];
  switchView(subs[0]?subs[0][0]:'plan');
}
// compatibilidad con llamadas antiguas
function switchTab(t){ switchView(t); }

function onSearch(v){searchQ=v.toLowerCase();renderBCList();}

function setFilter(f){
  prepFilter=f;
  document.getElementById('fb-all').className='filter-btn'+(f==='all'?' active-all':'');
  document.getElementById('fb-prep').className='filter-btn'+(f==='preparado'?' active-prep':'');
  document.getElementById('fb-noprep').className='filter-btn'+(f==='sin_preparar'?' active-noprep':'');
  renderBCList();
}

async function togglePrep(pid,current){
  const next=current==='preparado'?'sin_preparar':'preparado';
  try{
    const updated=await api('PATCH','/pedidos/'+pid+'/prep',{estado_prep:next});
    const p=pedidos.find(x=>String(x.id)===String(pid));
    if(p)p.estado_prep=updated.estado_prep;
    renderAll();log(next==='preparado'?'Pedido marcado como preparado':'Pedido marcado como sin preparar','ok');
  }catch(e){log('Error','warn');}
}

function renderBCList(){
  const fp=freePs();
  const allFree=pedidos.filter(p=>!p.carga_id);
  document.getElementById('bc-count').textContent=allFree.length;
  const el=document.getElementById('bc-list');
  if(!fp.length){
    el.innerHTML=`<div class="empty-state"><i class="ti ti-check-circle"></i>${searchQ||prepFilter!=='all'||catFilter?'Sin resultados':'Todos los pedidos asignados'}</div>`;
    return;
  }
  el.innerHTML=fp.map(p=>{
    const isPrep=_esPrep(p);
    const cardClass=`pcard prep-${isPrep?'preparado':(p.estado_prep||'sin_preparar')}${p.prio==='urgente'?' urgente':p.prio==='baja'?' baja':''}`;
    return `<div class="${cardClass}" draggable="true" id="card-${p.id}"
      ondragstart="onDragStart(event,'${p.id}')" ondragend="onDragEnd()">
      <div class="pc-top">
        <span class="pc-num">${p.num}${p.prio==='urgente'?' <span class="badge b-red" style="font-size:9px">Urgente</span>':''}</span>
        <div class="pc-acts">
          <button class="ico" onclick="event.stopPropagation();openModal('pedido','${p.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
          <button class="ico del" onclick="event.stopPropagation();confirmDelete('pedido','${p.id}')" title="Eliminar"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div class="pc-client">${p.cliente}</div>
      <div class="pc-dest"><i class="ti ti-map-pin" style="font-size:11px"></i>${p.destino}</div>
      ${p.ubicacion?`<div class="pc-ubic has-ubic"><i class="ti ti-box" style="font-size:10px"></i>${p.ubicacion}</div>`:''}
      ${p.obs?`<div style="font-size:10px;color:var(--text2);margin-top:3px;padding:3px 4px;background:rgba(0,0,0,.04);border-radius:3px;line-height:1.35"><i class="ti ti-message" style="font-size:9px"></i> ${p.obs}</div>`:''}
      ${p.categoria_nombre?`<div style="display:inline-block;margin-top:3px;background:${p.categoria_color}22;color:${p.categoria_color};font-size:9px;padding:1px 6px;border-radius:8px;font-weight:600;border:1px solid ${p.categoria_color}44">${p.categoria_nombre}</div>`:''}
      <div class="pc-footer">
        <span class="pc-kg"><i class="ti ti-weight" style="font-size:11px"></i> ${fmtN(p.kg)} kg</span>
        <span class="pc-porte">${fmtN(p.porte)} €</span>
        <button class="prep-toggle ${isPrep?'preparado':'sin_preparar'}" onclick="event.stopPropagation();togglePrep('${p.id}','${p.estado_prep||'sin_preparar'}')">${isPrep?'<i class="ti ti-check" style="font-size:10px"></i> Preparado':'<i class="ti ti-clock" style="font-size:10px"></i> Sin preparar'}</button>
      </div>
    </div>`;
  }).join('');
}

function renderCargas(){
  const filterVal=document.getElementById('filter-status').value;
  // Entregadas siempre van al historial, nunca a la pantalla principal
  const activeCargas=cargas.filter(c=>c.status!=='entregada');
  const filtered=activeCargas.filter(c=>{
    if(filterVal&&c.status!==filterVal) return false;
    if(!catFilter) return true;
    // Show if carga has the category assigned
    if(String(c.categoria_id)===catFilter) return true;
    // Also show if any pedido inside the carga has the category
    return cargaPs(c.id).some(p=>String(p.categoria_id)===catFilter);
  });
  const grid=document.getElementById('cargas-grid');
  if(!filtered.length&&!filterVal){
    grid.innerHTML=`<button class="new-carga-btn" onclick="addCarga()"><i class="ti ti-plus" style="font-size:22px;opacity:.4"></i><span>Crear primera carga</span></button>`;
    return;
  }
  grid.innerHTML=filtered.map(c=>{
    const ps=cargaPs(c.id).sort((a,b)=>(a.orden_carga||999)-(b.orden_carga||999));
    const kg=cargaKg(c.id),portes=cargaPortes(c.id);
    // Color según estado: pendiente sin color (gris), planificada azul, etc.
    const col=STATUS_COL[c.status]||STATUS_COL.pendiente;
    const t=getTrans(c.truck_id);
    const sc=STATUS_CFG[c.status]||STATUS_CFG.pendiente;
    const costeVal=c.coste!=null?+c.coste:null;
    const margen=costeVal!=null?portes-costeVal:null;
    const isPend=c.coste_modo==='pendiente';
    const nPrep=ps.filter(p=>_esPrep(p)).length;
    const nNoPre=ps.filter(p=>!_esPrep(p)).length;
    const plegada=cargasColapsadas.has(String(c.id));
    return `<div class="cc${plegada?' cc-collapsed':''}" id="col-${c.id}"
      ondragover="onDragOver(event,'${c.id}')"
      ondragleave="onDragLeave()"
      ondrop="onDrop(event,'${c.id}')">
      <div class="cc-hdr" style="background:${col.bg}">
        <div class="cc-top">
          <div class="cc-name-wrap">
            <input class="cc-name-input" style="color:${col.t}" value="${c.name}" onchange="updateCargaField('${c.id}','name',this.value)">
            <div class="cc-codigo">
              <i class="ti ti-barcode" style="font-size:11px;color:${col.t};opacity:.6"></i>
              <input type="text" placeholder="Cód. orden" value="${c.codigo_orden||''}" onchange="updateCargaField('${c.id}','codigo_orden',this.value)" style="color:${col.t}">
            </div>
            <div class="mat-row">
              <input class="mat-input" style="color:${col.t}" type="text" placeholder="Matrícula camión" value="${c.mat_camion||''}" onchange="updateCargaField('${c.id}','mat_camion',this.value)" title="Matrícula camión">
              <input class="mat-input" style="color:${col.t}" type="text" placeholder="Matrícula remolque" value="${c.mat_remolque||''}" onchange="updateCargaField('${c.id}','mat_remolque',this.value)" title="Matrícula remolque">
            </div>
          </div>
          <span class="cc-collapsed-info" style="color:${col.t}">${ps.length} ped · ${fmtN(kg)} kg</span>
          <div class="cc-acts">
            <button class="cc-btn cc-collapse-btn" onclick="toggleCargaCollapse('${c.id}')" title="Plegar / desplegar" style="color:${col.t}"><i class="ti ti-chevron-${plegada?'right':'down'}"></i></button>
            <button class="cc-btn" onclick="openPdfModal('${c.id}')" title="Generar PDF" style="color:${col.t}"><i class="ti ti-printer"></i></button>
            <button class="cc-btn" onclick="confirmDelete('carga','${c.id}')" title="Eliminar" style="color:${col.t}"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="cc-kpis">
          <div><div class="ckv" style="color:${col.t}">${fmtN(kg)} kg</div><div class="ckl">cargados</div></div>
          <div style="width:1px;background:${col.b};opacity:.2;margin:0 3px"></div>
          <div><div class="ckv" style="color:var(--green)">${fmtN(portes)} €</div><div class="ckl">portes</div></div>
          ${margen!=null?`<div style="width:1px;background:${col.b};opacity:.2;margin:0 3px"></div><div><div class="ckv" style="color:${margen>=0?'var(--green)':'var(--red)'}">${margen>=0?'+':''}${fmtN(margen)} €</div><div class="ckl">margen</div></div>`:''}
        </div>
        ${ps.length?`<div class="cc-prep-summary">
          ${nPrep?`<span class="prep-pill pp-ok"><i class="ti ti-check" style="font-size:10px"></i> ${nPrep} preparado${nPrep>1?'s':''}</span>`:''}
          ${nNoPre?`<span class="prep-pill pp-no"><i class="ti ti-clock" style="font-size:10px"></i> ${nNoPre} sin preparar</span>`:''}
        </div>`:''}
        <div class="cc-coste-box">
          <div class="cc-coste-lbl">
            <span>Coste transportista</span>
            <button class="cc-mode-btn ${isPend?'pendiente':'fijo'}" onclick="toggleCosteModo('${c.id}')">${isPend?'Pendiente factura':'Precio cerrado'}</button>
          </div>
          <div class="cc-coste-row">
            <input type="number" class="cc-coste-input" placeholder="${isPend?'A recibir':'Importe'}" value="${costeVal!=null?costeVal:''}" ${isPend?'disabled':''} onchange="updateCargaField('${c.id}','coste',this.value)" style="${isPend?'opacity:.4':''}">
            <span style="font-size:11px;color:var(--text2)">€</span>
          </div>
        </div>
        <div class="cc-meta">
          <input type="date" class="cc-date" value="${c.fecha?String(c.fecha).substring(0,10):''}" onchange="updateCargaField('${c.id}','fecha',this.value)" style="color:${col.t};border-color:${col.b}">
          <span class="badge ${sc.badge}">${sc.label}</span>
        </div>
      </div>
      <div class="carga-drop${ps.length===0?' empty-drop':''}" id="drop-${c.id}">
        ${ps.length===0
          ?`<i class="ti ti-drag-drop" style="font-size:22px;color:var(--text3)"></i><div class="drop-hint">Arrastra pedidos aquí</div>`
          :ps.map((p,idx)=>{
            const mc=_esPrep(p)?'mc-preparado':p.estado_prep==='sin_preparar'?'mc-sin_preparar':'mc-default';
            return `<div class="mini-card ${mc}">
              <div class="mini-order">${p.orden_carga||idx+1}</div>
              <div class="mini-body">
                <div class="mini-client">${p.cliente}${p.prio==='urgente'?' <span class="badge b-red" style="font-size:9px">U</span>':''}${p.estado_prep==='entregado'?' <span class="badge b-green" style="font-size:9px"><i class="ti ti-check" style="font-size:9px"></i> Cargado</span>':''}</div>
                ${p.num?`<div style="font-size:10px;color:var(--blue-d);font-weight:600;font-family:monospace;margin-top:1px">${p.num}${p.partido_de?' <span style="background:var(--amber-l);color:var(--amber);font-family:DM Sans,sans-serif;font-weight:700;padding:0 5px;border-radius:6px"><i class="ti ti-cut" style="font-size:9px"></i> resto</span>':''}</div>`:''}
                ${p.ubicacion?`<div class="mini-ubic"><i class="ti ti-box" style="font-size:10px"></i>${p.ubicacion}</div>`:''}
                <div class="mini-meta"><span>${p.destino.split(',')[0]}</span><span>·</span><span>${fmtN(p.kg)} kg</span><span>·</span><span style="color:var(--green)">${fmtN(p.porte)} €</span>${p.categoria_nombre?`<span>·</span><span style="background:${p.categoria_color}22;color:${p.categoria_color};font-size:9px;padding:1px 5px;border-radius:6px;font-weight:600">${p.categoria_nombre}</span>`:''}</div>
                ${p.obs?`<div style="font-size:10px;color:var(--text2);margin-top:2px"><i class="ti ti-message" style="font-size:9px"></i> ${p.obs}</div>`:''}
              </div>
              <div class="mini-acts">
                <input type="number" class="order-input" value="${p.orden_carga||''}" placeholder="#" title="Orden en la carga" onchange="setOrden('${p.id}',this.value)" min="1">
                ${p.estado_prep!=='entregado'?`<button class="mini-rm" style="color:#2E5811;padding:2px 4px" onclick="marcarCargadoReparto('${p.id}')" title="Marcar cargado"><i class="ti ti-checks"></i></button>`:''}
                ${p.estado_prep!=='entregado'?`<button class="mini-rm" style="color:var(--amber);padding:2px 4px" onclick="abrirFormPartir('${p.id}')" title="Partir en dos viajes (no cabe todo)"><i class="ti ti-cut"></i></button>`:''}
                <button class="mini-rm" style="color:var(--blue);padding:2px 4px" onclick="openModal('pedido','${p.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
                <button class="mini-rm" onclick="removeFromCarga('${p.id}')" title="Quitar de la carga"><i class="ti ti-x"></i></button>
              </div>
            </div>`;
          }).join('')}
      </div>
      <div class="cc-selects">
        <select class="cc-sel" onchange="updateCargaField('${c.id}','truck_id',this.value)">
          <option value="">Sin transportista</option>
          ${transportistas.map(tr=>`<option value="${tr.id}" ${String(c.truck_id)===String(tr.id)?'selected':''}>${tr.nombre}</option>`).join('')}
        </select>
        <select class="cc-sel" onchange="updateCargaField('${c.id}','categoria_id',this.value)">
          <option value="">Sin categoría</option>
          ${categorias.map(cat=>`<option value="${cat.id}" ${String(c.categoria_id)===String(cat.id)?'selected':''}>${cat.nombre}</option>`).join('')}
        </select>
        <select class="cc-sel" onchange="updateCargaField('${c.id}','status',this.value)">
          ${Object.entries(STATUS_CFG).map(([k,v])=>`<option value="${k}" ${c.status===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }).join('')+`<button class="new-carga-btn" onclick="addCarga()"><i class="ti ti-plus" style="font-size:20px;opacity:.4"></i><span>Nueva carga</span></button>`;
  _actualizarBotonPlegar();
}

async function setOrden(pid, val){
  try{
    const updated=await api('PATCH','/pedidos/'+pid+'/orden',{orden_carga:val?parseInt(val):null});
    const p=pedidos.find(x=>String(x.id)===String(pid));
    if(p)p.orden_carga=updated.orden_carga;
    renderCargas();
  }catch(e){log('Error al guardar orden','warn');}
}

// ── PDF PRINT ─────────────────────────────────────────────────────────────────
let _pdfCargaId=null;
function openPdfModal(cid){_pdfCargaId=cid;document.getElementById('pdf-modal-overlay').classList.add('open');}
function closePdfModal(){document.getElementById('pdf-modal-overlay').classList.remove('open');_pdfCargaId=null;}
function doPrint(showPrices){var cid=_pdfCargaId;closePdfModal();printCarga(cid,showPrices);}
function doOrdenTransportista(){var cid=_pdfCargaId;closePdfModal();printOrdenTransportista(cid);}

async function printOrdenTransportista(cid){
  const c=cargas.find(x=>String(x.id)===String(cid));
  if(!c) return;
  const ps=cargaPs(c.id).sort((a,b)=>(a.orden_carga||999)-(b.orden_carga||999));
  const tr=transportistas.find(x=>String(x.id)===String(c.truck_id));
  const kg=cargaKg(c.id);
  const fmtFecha=d=>{if(!d)return '—';const s=String(d).substring(0,10);const[y,m,dd]=s.split('-');return dd+'-'+m+'-'+y.slice(2);};

  // Preload QR if any pedido has maps_url
  if(ps.some(p=>p.maps_url)) await ensureQR();

  // Generate QR data URIs per pedido
  const qrMap={};
  ps.forEach(p=>{
    if(p.maps_url&&window.QRCode){
      const uri=makeQRDataUri(p.maps_url,120);
      if(uri) qrMap[p.id]=uri;
    }
  });

  // Destinos block
  const destinosHTML=ps.map((p,i)=>{
    const qr=qrMap[p.id]?`<img src="${qrMap[p.id]}" width="90" height="90" style="display:block">`:
      `<div style="width:90px;height:90px;border:2px dashed #ddd;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:10px">Sin link</div>`;
    return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;background:#fafafa;${i>0?'margin-top:10px':''}">
      <div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:4px">Parada ${ps.length>1?i+1+' de '+ps.length:''}</div>
        <div style="font-size:11px;color:#185FA5;font-weight:600;margin-bottom:2px">${p.num}</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:4px">${p.cliente}</div>
        <div style="font-size:13px;color:#444;line-height:1.4">${p.direccion_descarga||p.destino}</div>
        ${p.ubicacion?`<div style="margin-top:6px;display:inline-flex;align-items:center;gap:4px;background:#E6F1FB;color:#0C447C;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:500"><span>📦</span> ${p.ubicacion}</div>`:''}
        ${p.obs?`<div style="margin-top:8px;font-size:11px;color:#555;font-style:italic;border-left:3px solid #e5e7eb;padding-left:8px">${p.obs}</div>`:''}
      </div>
      <div style="text-align:center;flex-shrink:0">
        ${qr}
        ${qrMap[p.id]?`<div style="font-size:9px;color:#9ca3af;margin-top:4px;text-align:center">Escanear → Maps</div>`:''}
      </div>
    </div>`;
  }).join('');

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#111;background:#fff}
    @page{size:A4;margin:1.2cm}
    @media print{body{padding:0}}
    .page{max-width:740px;margin:0 auto;padding:20px}
  </style></head><body><div class="page">

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:14px;border-bottom:3px solid #0d4f7a">
    <div>
      <div style="font-size:10px;color:#6b7280;margin-bottom:2px">Envasados Arisac, S.L. · CIF: B53779021</div>
      <div style="font-size:10px;color:#9ca3af">Partida Collaet s/n · 03786 Forna, Alicante · 966 400 882</div>
    </div>
    <img src="data:image/png;base64,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" height="56" style="display:block">
  </div>

  <!-- TITLE BAND -->
  <div style="background:#0d4f7a;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.12em;opacity:.7;margin-bottom:3px">Orden de carga</div>
      <div style="font-size:22px;font-weight:700">${c.codigo_orden||c.name}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:10px;opacity:.7;margin-bottom:2px">Fecha de carga</div>
      <div style="font-size:24px;font-weight:700">${fmtFecha(c.fecha)}</div>
    </div>
  </div>

  <!-- TRANSPORTISTA + DATOS -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#f8fafc">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:6px">Transportista</div>
      <div style="font-size:16px;font-weight:700;color:#0d4f7a">${tr?tr.nombre:'Sin asignar'}</div>
      ${tr&&(tr.cif||tr.nif)?`<div style="font-size:11px;color:#444;margin-top:4px"><strong>CIF/NIF:</strong> ${tr.cif||tr.nif}</div>`:''}
      ${tr&&tr.direccion?`<div style="font-size:11px;color:#444;margin-top:2px">${tr.direccion}</div>`:''}
      ${tr&&(tr.cp||tr.ciudad)?`<div style="font-size:11px;color:#444">${[tr.cp,tr.ciudad].filter(Boolean).join(' ')}</div>`:''}
      ${tr&&tr.pais&&tr.pais!=='España'?`<div style="font-size:11px;color:#444">${tr.pais}</div>`:'<div style="font-size:11px;color:#444">España</div>'}
      ${tr&&tr.telefono?`<div style="font-size:11px;color:#6b7280;margin-top:4px">Tel: ${tr.telefono}</div>`:''}
      ${tr&&tr.email?`<div style="font-size:11px;color:#6b7280">Email: ${tr.email}</div>`:''}
      ${c.mat_camion||c.mat_remolque?`<div style="margin-top:8px;font-size:11px;font-family:monospace;background:#fff;border:1px solid #e5e7eb;border-radius:5px;padding:4px 8px;display:inline-block"><strong>Matrículas:</strong> ${[c.mat_camion,c.mat_remolque].filter(Boolean).join(' / ')}</div>`:''}
    </div>
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#f8fafc">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:6px">Datos de la carga</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><div style="font-size:9px;color:#9ca3af">Kg totales</div><div style="font-size:16px;font-weight:700">${fmtN(kg)}</div></div>
        <div><div style="font-size:9px;color:#9ca3af">Paradas</div><div style="font-size:16px;font-weight:700">${ps.length}</div></div>
        <div><div style="font-size:9px;color:#9ca3af">Ref. pedido(s)</div><div style="font-size:11px;font-weight:600;font-family:monospace;color:#185FA5">${ps.map(p=>p.num).join(', ')}</div></div>
        ${c.coste?`<div><div style="font-size:9px;color:#9ca3af">Precio acordado</div><div style="font-size:16px;font-weight:700;color:#2d7a3a">${fmtN(c.coste)} €</div></div>`:''}
      </div>
    </div>
  </div>

  <!-- LUGAR DE CARGA -->
  <div style="background:#fff8e6;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-bottom:18px;display:flex;gap:10px;align-items:center">
    <div style="font-size:18px">📍</div>
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#78350f;margin-bottom:2px">Lugar de carga</div>
      <div style="font-size:13px;font-weight:600;color:#78350f">Envasados Arisac S.L. — Partida Collaet s/n, Junto a Cantera A.Forna · 03786 FORNA, ALICANTE</div>
    </div>
  </div>

  <!-- DESTINOS -->
  <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:10px">Dirección${ps.length>1?'es':''} de descarga</div>
  ${destinosHTML}

  <!-- OBLIGACIONES -->
  <div style="margin-top:22px;border-top:2px solid #0d4f7a;padding-top:14px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:center;margin-bottom:10px;color:#0d4f7a">Obligaciones del transportista</div>
    <div style="font-size:9.5px;color:#444;line-height:1.6;columns:2;column-gap:20px">
      <p style="margin-bottom:5px">*Compromiso día de carga: en la aceptación de la presente orden, se fijará un día concreto. En caso de NO cumplimiento deberá avisar con antelación para coordinar una nueva recogida. En caso de anulaciones reiteradas, quedará fuera de la lista de proveedores.</p>
      <p style="margin-bottom:5px">*Avisar con 2 horas de antelación para coordinar entrada en las instalaciones de Arisac, S.L.</p>
      <p style="margin-bottom:5px">*No se puede llegar sin preaviso. Se le puede solicitar esperar en Pego si estuviese llena la zona de carga.</p>
      <p style="margin-bottom:5px">*Para entregas en obra con hora de cita, avisar el no cumplimiento. Penalizaciones: <strong>OBRA: 100 €/hora</strong> excedido · <strong>ALMACÉN: 50 €/hora</strong> excedido.</p>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="margin-top:16px;font-size:8px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:8px">
    ${c.name}${c.codigo_orden?' · '+c.codigo_orden:''} · Generado: ${new Date().toLocaleString('es-ES')}
  </div>

  </div>
  <script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
  </body></html>`;

  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}


// ── QR CODE GENERATOR (no external deps) ─────────────────────────────────────
function makeQRDataUri(text, size){
  try{
    var div=document.createElement('div');
    div.style.display='none';
    document.body.appendChild(div);
    new QRCode(div,{text:text,width:size,height:size,correctLevel:QRCode.CorrectLevel.M});
    var canvas=div.querySelector('canvas');
    var img=div.querySelector('img');
    var uri='';
    if(canvas) uri=canvas.toDataURL('image/png');
    else if(img) uri=img.src;
    document.body.removeChild(div);
    return uri;
  }catch(e){console.error('QR error',e);return '';}
}

async function ensureQR(){
  if(window.QRCode) return;
  await new Promise(function(res,rej){
    var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload=function(){res();};
    s.onerror=rej;
    document.head.appendChild(s);
  });
}

function printResumen(){
  // Mostrar modal de selección de estados
  const estados=[
    {k:'pendiente',label:'Pendientes',color:'#6b7280'},
    {k:'planificada',label:'Planificadas',color:'#185FA5'},
    {k:'ruta',label:'En ruta',color:'#854F0B'},
    {k:'entregada',label:'Entregadas',color:'#0F6E56'},
  ];
  const cont=document.createElement('div');
  cont.id='resumen-modal';
  cont.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  cont.innerHTML=`
    <div style="background:#fff;border-radius:10px;padding:22px;width:340px;max-width:90vw">
      <div style="font-size:16px;font-weight:600;margin-bottom:4px">Generar resumen</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:14px">Selecciona qué cargas incluir</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
        ${estados.map(e=>`
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13px">
            <input type="checkbox" class="res-est" value="${e.k}" checked style="width:16px;height:16px;cursor:pointer">
            <span style="width:11px;height:11px;border-radius:3px;background:${e.color};display:inline-block"></span>
            ${e.label}
          </label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button onclick="document.getElementById('resumen-modal').remove()" style="padding:7px 14px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:13px">Cancelar</button>
        <button onclick="generarResumen()" style="padding:7px 14px;border:none;background:#185FA5;color:#fff;border-radius:6px;cursor:pointer;font-size:13px">Generar</button>
      </div>
    </div>`;
  document.body.appendChild(cont);
}

function generarResumen(){
  const seleccionados=Array.from(document.querySelectorAll('.res-est:checked')).map(c=>c.value);
  document.getElementById('resumen-modal')?.remove();
  if(!seleccionados.length){ log('Selecciona al menos un estado','warn'); return; }

  const grupos={pendiente:[],planificada:[],ruta:[],entregada:[]};
  cargas.forEach(c=>{ (grupos[c.status]||grupos.pendiente).push(c); });

  const hoy=new Date().toLocaleDateString('es-ES',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const horaImp=new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
  const estadoLabel={pendiente:'Pendientes',planificada:'Planificadas',ruta:'En ruta',entregada:'Entregadas'};
  const estadoColor={pendiente:'#6b7280',planificada:'#185FA5',ruta:'#854F0B',entregada:'#0F6E56'};
  const estadoBg={pendiente:'#f3f4f6',planificada:'#E6F1FB',ruta:'#FAEEDA',entregada:'#E1F5EE'};

  // Cargas incluidas según filtro
  const cargasInc=cargas.filter(c=>seleccionados.includes(c.status||'pendiente'));
  const pedidosInc=cargasInc.flatMap(c=>cargaPs(c.id));

  // Totales globales
  const totalKg=cargasInc.reduce((s,c)=>s+cargaKg(c.id),0);
  const totalPedidos=pedidosInc.length;
  const totalParadas=cargasInc.reduce((s,c)=>s+cargaPs(c.id).reduce((a,p)=>a+(+p.paradas||1),0),0);
  const sinAsignar=cargasInc.filter(c=>!c.truck_id).length;
  const sinFecha=cargasInc.filter(c=>!c.fecha).length;
  const pedCarga=pedidosInc.filter(p=>p.estado_prep==='carga').length;
  const pedPrep=pedidosInc.filter(p=>_esPrep(p)).length;
  const pedSinPrep=totalPedidos-pedPrep;

  function tarjetaCarga(c){
    const ps=cargaPs(c.id).sort((a,b)=>(a.orden_carga||999)-(b.orden_carga||999));
    const kg=cargaKg(c.id);
    const tr=transportistas.find(t=>String(t.id)===String(c.truck_id));
    const cat=categorias.find(ct=>String(ct.id)===String(c.categoria_id));
    const nPrep=ps.filter(p=>_esPrep(p)).length;
    const matriculas=[c.mat_camion,c.mat_remolque].filter(Boolean).join(' / ');

    const filasPedidos=ps.length?ps.map((p,i)=>{
      const prep=_esPrep(p);
      return `<tr>
        <td style="text-align:center;color:#6b7280;font-size:10px;width:24px">${p.orden_carga||i+1}</td>
        <td style="font-family:monospace;font-size:10px;white-space:nowrap">${p.num||'—'}</td>
        <td style="font-weight:600">${p.cliente}</td>
        <td style="font-size:11px;color:#444">${p.destino||'—'}</td>
        <td style="text-align:right;white-space:nowrap">${fmtN(p.kg)} kg</td>
        <td style="text-align:center;width:80px">
          <span style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:8px;background:${prep?'#E1F5EE':'#fef2f2'};color:${prep?'#0F6E56':'#b91c1c'}">${prep?'Preparado':'Sin prep.'}</span>
        </td>
      </tr>`;
    }).join(''):`<tr><td colspan="6" style="text-align:center;color:#999;padding:10px;font-style:italic">Carga vacía</td></tr>`;

    return `
      <div style="border:1.5px solid #1a1a1a;border-radius:8px;margin-bottom:14px;overflow:hidden;break-inside:avoid">
        <div style="background:${estadoBg[c.status]||'#f3f4f6'};padding:10px 14px;border-bottom:1.5px solid #1a1a1a">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-size:15px;font-weight:700">${c.name||'Sin nombre'}
                ${cat?`<span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:8px;background:${cat.color}22;color:${cat.color};margin-left:6px">${cat.nombre}</span>`:''}
              </div>
              <div style="font-size:11px;color:#444;margin-top:3px">
                ${tr?`<strong>${tr.nombre}</strong>`:'<span style="color:#b91c1c">⚠ Sin transportista</span>'}
                ${matriculas?` · <span style="font-family:monospace">${matriculas}</span>`:''}
              </div>
            </div>
            <div style="text-align:right;font-size:11px;color:#444">
              <div style="font-size:13px;font-weight:700;color:#1a1a1a">${c.fecha?fmtDate(c.fecha):'<span style=\"color:#b91c1c\">Sin fecha</span>'}</div>
              <div style="margin-top:2px">${kg.toLocaleString('es-ES')} kg · ${ps.length} pedido${ps.length!==1?'s':''}</div>
              <div style="margin-top:1px;color:${nPrep===ps.length&&ps.length>0?'#0F6E56':'#854F0B'}">${nPrep}/${ps.length} preparados</div>
            </div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#fafafa;border-bottom:1px solid #e5e7eb">
            <th style="width:24px"></th>
            <th style="text-align:left;padding:5px 8px;font-size:10px;color:#6b7280">PEDIDO</th>
            <th style="text-align:left;padding:5px 8px;font-size:10px;color:#6b7280">CLIENTE</th>
            <th style="text-align:left;padding:5px 8px;font-size:10px;color:#6b7280">DESTINO</th>
            <th style="text-align:right;padding:5px 8px;font-size:10px;color:#6b7280">KG</th>
            <th style="text-align:center;padding:5px 8px;font-size:10px;color:#6b7280">ESTADO</th>
          </tr></thead>
          <tbody>${filasPedidos}</tbody>
        </table>
      </div>`;
  }

  function seccionEstado(estado){
    if(!seleccionados.includes(estado)) return '';
    const lista=grupos[estado];
    if(!lista.length) return '';
    const kgSec=lista.reduce((s,c)=>s+cargaKg(c.id),0);
    const pedSec=lista.reduce((s,c)=>s+cargaPs(c.id).length,0);
    return `
      <div style="margin-bottom:28px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:6px;border-bottom:3px solid ${estadoColor[estado]}">
          <div style="width:14px;height:14px;border-radius:4px;background:${estadoColor[estado]}"></div>
          <h2 style="font-size:17px;margin:0;color:${estadoColor[estado]}">${estadoLabel[estado]}</h2>
          <span style="font-size:12px;color:#6b7280;margin-left:auto">${lista.length} carga${lista.length!==1?'s':''} · ${pedSec} pedidos · ${kgSec.toLocaleString('es-ES')} kg</span>
        </div>
        ${lista.map(tarjetaCarga).join('')}
      </div>`;
  }

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Resumen de cargas</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;margin:0;padding:30px;font-size:13px}
      table td{padding:5px 8px;border-bottom:1px solid #f0f0f0}
      h1{margin:0}
      @media print{body{padding:14px}.kpi-box{break-inside:avoid}}
      @page{margin:1cm}
    </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1a1a;padding-bottom:14px;margin-bottom:20px">
      <div>
        <h1 style="font-size:24px">Resumen de Cargas</h1>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;text-transform:capitalize">${hoy} · ${horaImp}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:32px;font-weight:800;line-height:1">${cargasInc.length}</div>
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">cargas</div>
      </div>
    </div>

    <!-- KPIs -->
    <div class="kpi-box" style="display:flex;gap:12px;margin-bottom:26px;flex-wrap:wrap">
      ${[
        {label:'Pedidos totales',val:totalPedidos,color:'#185FA5'},
        {label:'Kg totales',val:totalKg.toLocaleString('es-ES'),color:'#0F6E56'},
        {label:'Paradas',val:totalParadas,color:'#854F0B'},
        {label:'Preparados',val:pedPrep+'/'+totalPedidos,color:pedSinPrep>0?'#854F0B':'#0F6E56'},
        {label:'En carga',val:pedCarga,color:pedCarga>0?'#185FA5':'#6b7280'},
        {label:'Sin transportista',val:sinAsignar,color:sinAsignar>0?'#b91c1c':'#6b7280'},
        {label:'Sin fecha',val:sinFecha,color:sinFecha>0?'#b91c1c':'#6b7280'},
      ].map(k=>`
        <div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px">
          <div style="font-size:24px;font-weight:800;color:${k.color};line-height:1">${k.val}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:4px">${k.label}</div>
        </div>`).join('')}
    </div>

    ${seccionEstado('pendiente')}
    ${seccionEstado('planificada')}
    ${seccionEstado('ruta')}
    ${seccionEstado('entregada')}

    <div style="margin-top:30px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center">
      Planificación de Cargas · Documento generado automáticamente el ${hoy} a las ${horaImp}
    </div>
  </body></html>`;

  const w=window.open('','_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(()=>w.print(),400);
}

async function printCarga(cid, showPrices){
  if(showPrices===undefined) showPrices=true;
  const c=cargas.find(x=>String(x.id)===String(cid));
  if(!c)return;
  // Load QR library if needed for chofer PDF
  if(!showPrices) await ensureQR();
  const ps=cargaPs(cid).sort((a,b)=>(a.orden_carga||999)-(b.orden_carga||999));
  const t=getTrans(c.truck_id);
  const col=CCOLS[Math.min(c.color_idx||0,CCOLS.length-1)];
  const portes=cargaPortes(cid);
  const coste=c.coste!=null?+c.coste:null;
  const margen=coste!=null?portes-coste:null;
  const fecha=fmtDate(c.fecha)||'—';

  // Build table rows safely
  let rows='';
  ps.forEach(function(p,i){
    const isPrep=_esPrep(p);
    const rowBg=isPrep?'#f0fdf4':'#fff5f5';
    const ubicCell=p.ubicacion
      ? '<span style="background:#E6F1FB;color:#0C447C;padding:4px 10px;border-radius:10px;font-weight:500">'+p.ubicacion+'</span>'
      : '<span style="color:#9ca3af">—</span>';
    const portCell=showPrices
      ? '<td style="padding:14px 10px;text-align:right;font-weight:500;color:#3B6D11">'+fmtN(p.porte)+' \u20AC</td>'
      : '';
    const prepLabel=isPrep?'Preparado':'Sin preparar';
    const prepBg=isPrep?'#EAF3DE':'#FCEBEB';
    const prepColor=isPrep?'#27500A':'#791F1F';
    // QR for chofer PDF — inline data URI so it prints reliably
    var qrCell='';
    if(!showPrices){
      if(p.maps_url){
        var qrDataUri=makeQRDataUri(p.maps_url,110);
        qrCell='<td style="padding:8px 10px;text-align:center"><img src="'+qrDataUri+'" width="100" height="100" style="display:block;margin:0 auto"></td>';
      } else {
        qrCell='<td style="padding:8px 10px;text-align:center;color:#d1d5db;font-size:10px">—</td>';
      }
    }
    rows+='<tr style="background:'+rowBg+';border-bottom:2px solid #e5e7eb">'
      +'<td style="padding:14px 10px;font-weight:500;font-family:monospace;color:'+col.b+';font-size:14px">'+(p.orden_carga||i+1)+'</td>'
      +'<td style="padding:14px 10px;color:#185FA5;font-weight:500">'+p.num+'</td>'
      +'<td style="padding:14px 10px;font-weight:500">'+p.cliente+'</td>'
      +'<td style="padding:14px 10px;color:#6b7280">'+p.destino+'</td>'
      +'<td style="padding:14px 10px">'+ubicCell+'</td>'
      +portCell
      +((!showPrices)?qrCell:'')
      +'<td style="padding:14px 10px;text-align:right;font-weight:500">'+fmtN(p.kg)+'</td>'
      +'<td style="padding:14px 10px;text-align:center"><span style="background:'+prepBg+';color:'+prepColor+';padding:4px 10px;border-radius:10px;font-size:11px;font-weight:500">'+prepLabel+'</span></td>'
      +'</tr>';
  });

  // Build obs
  const obsPs=ps.filter(function(p){return p.obs;});
  const obsHtml=obsPs.length
    ? '<div style="margin-top:14px;font-size:11px;color:#6b7280"><strong>Observaciones:</strong><br>'
      +obsPs.map(function(p){return '<span style="color:#185FA5">'+p.num+'</span>: '+p.obs;}).join(' &middot; ')
      +'</div>'
    : '';

  // Matriculas
  const matHtml=(c.mat_camion||c.mat_remolque)
    ? '<div style="font-size:11px;color:#6b7280;margin-top:2px;font-family:monospace">'
      +(c.mat_camion?'&#x1F69B; '+c.mat_camion:'')
      +(c.mat_camion&&c.mat_remolque?' &middot; ':'')
      +(c.mat_remolque?'&#x1F69C; '+c.mat_remolque:'')
      +'</div>'
    : '';

  // Coste/margen block
  const costeHtml=(showPrices&&coste!=null)
    ? '<div style="background:#EAF3DE;border-radius:8px;padding:8px 12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">'
      +'<span style="font-size:12px;color:#3B6D11">Coste transportista: <strong>'+fmtN(coste)+' \u20AC</strong></span>'
      +'<span style="font-size:12px;color:'+(margen>=0?'#3B6D11':'#A32D2D')+'">Margen: <strong>'+(margen>=0?'+':'')+fmtN(margen)+' \u20AC</strong></span>'
      +'</div>'
    : '';

  // Portes KPI
  const portesKpiHtml=showPrices
    ? '<div style="background:#f8f9fc;border-radius:8px;padding:10px 12px">'
      +'<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Portes cliente</div>'
      +'<div style="font-size:20px;font-weight:500;color:#3B6D11;margin-top:3px">'+fmtN(portes)+' \u20AC</div>'
      +'</div>'
    : '';

  // Porte column header
  const porteThHtml=showPrices
    ? '<th style="padding:8px 10px;text-align:right;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+'">Porte \u20AC</th>'
    : '';

  const html=''
    +'<div style="font-family:\'DM Sans\',sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#1a1a2e">'
    +'<div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid '+col.b+';padding-bottom:14px;margin-bottom:16px">'
    +'<div>'
    +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:'+col.b+';font-weight:500;margin-bottom:4px">Orden de Carga</div>'
    +'<div style="font-size:22px;font-weight:600;color:'+col.t+'">'+c.name+'</div>'
    +(c.codigo_orden?'<div style="font-size:13px;font-family:monospace;color:'+col.b+';margin-top:2px">C\u00f3digo: '+c.codigo_orden+'</div>':'')
    +'</div>'
    +'<div style="text-align:right">'
    +'<div style="font-size:11px;color:#6b7280">Fecha: '+fecha+'</div>'
    +'<div style="font-size:11px;color:#6b7280;margin-top:2px">Transportista: '+(t?t.nombre:'Sin asignar')+'</div>'
    +(t&&t.telefono?'<div style="font-size:11px;color:#6b7280;margin-top:2px">Tel: '+t.telefono+'</div>':'')
    +matHtml
    +'<div style="margin-top:6px"><span style="background:'+col.bg+';color:'+col.t+';padding:3px 10px;border-radius:12px;font-size:11px;font-weight:500">'+(STATUS_CFG[c.status]?STATUS_CFG[c.status].label:c.status)+'</span></div>'
    +'</div>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:'+(showPrices?'repeat(3,1fr)':'repeat(2,1fr)')+';gap:10px;margin-bottom:16px">'
    +'<div style="background:#f8f9fc;border-radius:8px;padding:10px 12px">'
    +'<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Pedidos</div>'
    +'<div style="font-size:20px;font-weight:500;margin-top:3px">'+ps.length+'</div>'
    +'</div>'
    +'<div style="background:#f8f9fc;border-radius:8px;padding:10px 12px">'
    +'<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Kg totales</div>'
    +'<div style="font-size:20px;font-weight:500;margin-top:3px">'+fmtN(cargaKg(cid))+'</div>'
    +'</div>'
    +portesKpiHtml
    +'</div>'
    +costeHtml
    +'<div style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:8px">Orden de entrega y ubicaciones</div>'
    +'<table style="width:100%;border-collapse:collapse;font-size:12px">'
    +'<thead><tr style="background:'+col.bg+'">'
    +'<th style="padding:8px 10px;text-align:left;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+';width:40px">#</th>'
    +'<th style="padding:8px 10px;text-align:left;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+'">Pedido</th>'
    +'<th style="padding:8px 10px;text-align:left;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+'">Cliente</th>'
    +'<th style="padding:8px 10px;text-align:left;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+'">Destino</th>'
    +'<th style="padding:8px 10px;text-align:left;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+'">Ubicaci\u00f3n</th>'
    +porteThHtml
    +(!showPrices?'<th style="padding:8px 10px;text-align:center;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+'">Maps</th>':'')
    +'<th style="padding:8px 10px;text-align:right;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+'">Kg</th>'
    +'<th style="padding:8px 10px;text-align:center;color:'+col.t+';font-weight:500;border-bottom:1px solid '+col.b+'">Estado</th>'
    +'</tr></thead>'
    +'<tbody>'+rows+'</tbody>'
    +'</table>'
    +obsHtml
    +'<div style="margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between">'
    +'<span>Generado: '+new Date().toLocaleString('es-ES')+'</span>'
    +'<span>'+c.name+(c.codigo_orden?' \u00b7 '+c.codigo_orden:'')+(showPrices?'':' \u00b7 Sin precios')+'</span>'
    +'</div>'
    +'</div>';

  // Inject directly into page overlay — no popups, no iframes, no blobs needed
  document.getElementById('print-content').innerHTML=html;
  document.getElementById('print-preview-title').textContent=c.name+(c.codigo_orden?' · '+c.codigo_orden:'')+(showPrices?'':' (sin precios)');
  document.getElementById('print-preview').classList.add('open');
  document.body.style.overflow='hidden';
}

function closePrintPreview(){
  document.getElementById('print-preview').classList.remove('open');
  document.body.style.overflow='';
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function updateCargaField(cid,field,value){
  const c=cargas.find(x=>String(x.id)===String(cid));
  if(!c)return;
  c[field]=value===''?null:value;
  try{
    const updated=await api('PUT','/cargas/'+cid,c);
    Object.assign(c,updated);
    if(['truck_id','coste','status','coste_modo'].includes(field)){renderCargas();updateStats();}
  }catch(e){log('Error al guardar: '+e.message,'warn');}
}

async function guardarCosteHist(cid,val){
  const c=cargas.find(x=>String(x.id)===String(cid)); if(!c) return;
  c.coste = (val===''||val==null) ? null : Number(val);
  try{
    const upd=await api('PUT','/cargas/'+cid,c);
    Object.assign(c,upd);
    log('Coste guardado','ok');
  }catch(e){ log('Error al guardar coste: '+e.message,'warn'); }
  renderHist();
  if(typeof updateStats==='function') updateStats();
}

async function toggleCosteModo(cid){
  const c=cargas.find(x=>String(x.id)===String(cid));
  if(!c)return;
  c.coste_modo=c.coste_modo==='fijo'?'pendiente':'fijo';
  if(c.coste_modo==='pendiente')c.coste=null;
  try{const updated=await api('PUT','/cargas/'+cid,c);Object.assign(c,updated);renderCargas();updateStats();}
  catch(e){log('Error','warn');}
}

async function addCarga(){
  cargaN++;
  try{
    const c=await api('POST','/cargas',{name:'Carga '+cargaN,color_idx:cargas.length%CCOLS.length,status:'pendiente',coste_modo:'pendiente'});
    cargas.unshift(c);renderCargas();updateStats();log('Nueva carga creada','ok');
  }catch(e){log('Error al crear carga','warn');}
}

async function removeFromCarga(pid){
  try{
    await api('PATCH','/pedidos/'+pid+'/carga',{carga_id:null});
    const p=pedidos.find(x=>String(x.id)===String(pid));
    if(p){p.carga_id=null;p.orden_carga=null;}
    renderAll();log('Pedido devuelto a BC');
  }catch(e){log('Error','warn');}
}

// ── PARTIR PEDIDO en N viajes (entrega parcial: no cabe todo en el camión) ─────
// Matriz línea × viaje: eliges qué línea (y cuánta) va en cada viaje. Viaje 1 = se
// queda en el pedido (auto = lo que no muevas); los demás son pedidos nuevos.
let _partirLineas=[], _partirPed=null, _partirN=2, _partirMove={}, _partirKg=[], _partirKgManual=[], _partirPorte=[];
const _ptEsc=s=>(''+(s||'')).replace(/</g,'&lt;');
async function abrirFormPartir(pid){
  const p=pedidos.find(x=>String(x.id)===String(pid)); if(!p){ log('Pedido no encontrado','warn'); return; }
  _partirPed=p;
  try{ _partirLineas=await api('GET','/pedidos/'+pid+'/lineas'); }catch(e){ _partirLineas=[]; }
  _partirN=2;
  _partirMove={}; _partirLineas.forEach(l=>{ _partirMove[l.id]=[0]; });   // mov a viajes 2..N (long N-1)
  _partirKg=[Number(p.kg)||0,0]; _partirKgManual=[false,false]; _partirPorte=[Number(p.porte)||0,0];
  const ov=document.createElement('div'); ov.id='partir-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10060;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:640px;border-radius:16px 16px 0 0;padding:18px;max-height:92vh;overflow-y:auto">
    <b style="font-size:15px"><i class="ti ti-cut"></i> Partir pedido en viajes</b>
    <div style="font-size:12px;color:var(--text2);margin:2px 0 4px">${_ptEsc(p.num||'')} · ${_ptEsc(p.cliente||'')} · ${fmtN(p.kg)} kg</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:10px">Elige qué va en cada viaje. <b>Viaje 1</b> se queda en este pedido (lo que no muevas). Cada viaje extra crea un pedido nuevo en la bandeja.</div>
    <div id="partir-body"></div>
    <div id="pt-aviso" style="font-size:11px;color:var(--text3);margin-top:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn-sec" onclick="document.getElementById('partir-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarPartir('${p.id}')" style="font-size:13px;padding:10px 18px;background:var(--amber)"><i class="ti ti-cut"></i> Partir</button></div>
  </div>`;
  document.body.appendChild(ov);
  _partirRender();
}
function _partirAddViaje(){ if(_partirN>=6) return; _partirN++; _partirLineas.forEach(l=>_partirMove[l.id].push(0)); _partirKg.push(0); _partirKgManual.push(false); _partirPorte.push(0); _partirRender(); }
function _partirDelViaje(i){ if(_partirN<=2||i<1) return; _partirN--; _partirLineas.forEach(l=>_partirMove[l.id].splice(i-1,1)); _partirKg.splice(i,1); _partirKgManual.splice(i,1); _partirPorte.splice(i,1); _partirRender(); }
function _partirMv(lid,vi,val){ const max=Number((_partirLineas.find(l=>String(l.id)===String(lid))||{}).cantidad)||0; _partirMove[lid][vi]=Math.max(0,Math.min(Number(val)||0,max)); _partirRecalc(); }
function _partirKgIn(i,val){ _partirKg[i]=Number(val)||0; _partirKgManual[i]=true; }
function _partirPorteIn(i,val){ _partirPorte[i]=Number(val)||0; }
function _partirV1(l){ const mov=(_partirMove[l.id]||[]).reduce((s,x)=>s+(Number(x)||0),0); return (Number(l.cantidad)||0)-mov; }
function _partirRender(){
  const body=document.getElementById('partir-body'); if(!body) return;
  const inp='font-size:13px;padding:5px 6px;border:1px solid var(--border2);border-radius:7px;background:var(--surface);color:var(--text);box-sizing:border-box;width:62px;text-align:center';
  const viajes=[...Array(_partirN).keys()];   // 0..N-1
  const cab=`<tr><th style="text-align:left;font-size:10px;color:var(--text3);font-weight:700;padding:4px 6px">LÍNEA</th>${viajes.map(i=>`<th style="font-size:10px;color:${i===0?'var(--blue-d)':'var(--amber)'};font-weight:800;padding:4px 6px;white-space:nowrap">Viaje ${i+1}${i===0?' <span style="font-weight:600;color:var(--text3)">(se queda)</span>':(_partirN>2?` <a onclick="_partirDelViaje(${i})" style="cursor:pointer;color:var(--red)" title="Quitar viaje">×</a>`:'')}</th>`).join('')}</tr>`;
  let rows;
  if(_partirLineas.length){
    rows=_partirLineas.map(l=>{
      const cels=viajes.map(i=>{
        if(i===0) return `<td style="padding:3px 6px;text-align:center"><span id="pt-v1-${l.id}" style="font-size:14px;font-weight:800">${fmtN(_partirV1(l))}</span></td>`;
        return `<td style="padding:3px 6px;text-align:center"><input type="number" min="0" max="${Number(l.cantidad)||0}" value="${_partirMove[l.id][i-1]||0}" oninput="_partirMv('${l.id}',${i-1},this.value)" style="${inp}"></td>`;
      }).join('');
      return `<tr style="border-top:1px solid var(--border)"><td style="padding:5px 6px"><div style="font-size:13px;font-weight:600">${_ptEsc(l.descripcion||l.referencia||'(línea)')}</div><div style="font-size:10px;color:var(--text3)">${fmtN(l.cantidad)} ${l.embalaje?_ptEsc(l.embalaje):'ud'}</div></td>${cels}</tr>`;
    }).join('');
  } else {
    rows=`<tr style="border-top:1px solid var(--border)"><td colspan="${_partirN+1}" style="padding:8px 6px;font-size:12px;color:var(--text2)">Sin líneas detalladas: reparte solo por peso y porte.</td></tr>`;
  }
  const filaUd=`<tr style="border-top:2px solid var(--border2)"><td style="padding:5px 6px;font-size:10px;color:var(--text3);font-weight:700">UNIDADES</td>${viajes.map(i=>`<td style="padding:5px 6px;text-align:center"><span id="pt-u-${i}" style="font-size:12px;font-weight:700;color:var(--text2)">0</span></td>`).join('')}</tr>`;
  const filaKg=`<tr><td style="padding:3px 6px;font-size:11px;color:var(--text2)">Kg</td>${viajes.map(i=>`<td style="padding:3px 6px;text-align:center"><input id="pt-kg-${i}" type="number" value="${_partirKg[i]||0}" oninput="_partirKgIn(${i},this.value)" style="${inp};width:74px"></td>`).join('')}</tr>`;
  const filaPorte=`<tr><td style="padding:3px 6px;font-size:11px;color:var(--text2)">Porte €</td>${viajes.map(i=>`<td style="padding:3px 6px;text-align:center"><input id="pt-porte-${i}" type="number" value="${_partirPorte[i]||0}" oninput="_partirPorteIn(${i},this.value)" style="${inp};width:74px"></td>`).join('')}</tr>`;
  body.innerHTML=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:${180+_partirN*84}px"><thead>${cab}</thead><tbody>${rows}${filaUd}${filaKg}${filaPorte}</tbody></table></div>
    <button class="btn-sec" onclick="_partirAddViaje()" style="font-size:12px;padding:6px 11px;margin-top:10px${_partirN>=6?';opacity:.4;pointer-events:none':''}"><i class="ti ti-plus"></i> Añadir viaje</button>`;
  _partirRecalc();
}
function _partirRecalc(){
  const p=_partirPed; if(!p) return;
  const totUd=_partirLineas.reduce((s,l)=>s+(Number(l.cantidad)||0),0);
  const udViaje=[...Array(_partirN)].map(()=>0);
  let negativa=false;
  _partirLineas.forEach(l=>{
    const v1=_partirV1(l); udViaje[0]+=Math.max(0,v1);
    const sp=document.getElementById('pt-v1-'+l.id); if(sp){ sp.textContent=fmtN(v1); sp.style.color=v1<0?'var(--red)':'inherit'; }
    if(v1<0) negativa=true;
    for(let i=1;i<_partirN;i++) udViaje[i]+=Number(_partirMove[l.id][i-1])||0;
  });
  for(let i=0;i<_partirN;i++){ const u=document.getElementById('pt-u-'+i); if(u) u.textContent=fmtN(udViaje[i]); }
  // kg auto, proporcional a las unidades de cada viaje (salvo los tocados a mano)
  if(totUd>0){
    for(let i=0;i<_partirN;i++){ if(_partirKgManual[i]) continue; const kg=Math.round((Number(p.kg)||0)*udViaje[i]/totUd); _partirKg[i]=kg; const e=document.getElementById('pt-kg-'+i); if(e && document.activeElement!==e) e.value=kg; }
  }
  const av=document.getElementById('pt-aviso'); if(av){
    if(!_partirLineas.length){ av.textContent='Sin líneas: se parte por peso/porte entre los viajes.'; av.style.color='var(--text3)'; }
    else if(negativa){ av.textContent='⚠ Estás moviendo más unidades de las que tiene una línea.'; av.style.color='var(--red)'; }
    else if(udViaje[0]<=0){ av.textContent='⚠ El Viaje 1 no puede quedar vacío (algo tiene que ir en este pedido).'; av.style.color='var(--red)'; }
    else if(udViaje.slice(1).every(u=>u<=0)){ av.textContent='⚠ Mueve algo a otro viaje para partir.'; av.style.color='var(--amber)'; }
    else { av.textContent='Reparto: '+udViaje.map((u,i)=>`V${i+1}=${fmtN(u)}ud`).join(' · '); av.style.color='var(--text3)'; }
  }
}
async function confirmarPartir(pid){
  const p=_partirPed; if(!p) return;
  const hayLineas=_partirLineas.length>0;
  if(hayLineas){
    if(_partirLineas.some(l=>_partirV1(l)<0)){ log('Hay una línea con más unidades movidas de las que tiene','warn'); return; }
    if(_partirLineas.reduce((s,l)=>s+Math.max(0,_partirV1(l)),0)<=0){ log('El Viaje 1 no puede quedar vacío','warn'); return; }
  }
  // construir partes
  const partes=[];
  for(let i=0;i<_partirN;i++){
    const lineas=[];
    _partirLineas.forEach(l=>{ const q = i===0 ? _partirV1(l) : (Number(_partirMove[l.id][i-1])||0); if(q>0) lineas.push({id:Number(l.id),cantidad:q}); });
    partes.push({ kg:Number(_partirKg[i])||0, porte:Number(_partirPorte[i])||0, lineas });
  }
  // descartar viajes extra vacíos (sin líneas y, si no hay líneas, sin kg)
  const extra=partes.slice(1).filter(pa => hayLineas ? pa.lineas.length>0 : (pa.kg>0));
  if(!extra.length){ log('Mueve algo a otro viaje para partir','warn'); return; }
  const envio=[partes[0], ...extra];
  try{
    await api('POST','/pedidos/'+pid+'/partir',{partes:envio});
    document.getElementById('partir-ov')?.remove();
    log('Pedido partido en '+envio.length+' viajes: los nuevos están en la bandeja','ok');
    await loadAll();
  }catch(e){
    if(_esFalloRed(e)) log('Partir necesita conexión (no se encola sin red)','warn');
    else log('No se pudo partir: '+e.message,'warn');
  }
}

function confirmDelete(type,id){
  if(!confirm('¿Eliminar '+( type==='pedido'?'este pedido':'esta carga')+'?'))return;
  doDelete(type,id);
}

async function doDelete(type,id){
  try{
    if(type==='pedido'){
      await api('DELETE','/pedidos/'+id);
      pedidos=pedidos.filter(x=>String(x.id)!==String(id));
      log('Pedido eliminado');
    }else if(type==='carga'){
      await api('DELETE','/cargas/'+id);
      cargas=cargas.filter(x=>String(x.id)!==String(id));
      pedidos.forEach(p=>{if(String(p.carga_id)===String(id))p.carga_id=null;});
      log('Carga eliminada');
    }else if(type==='trans'){
      await api('DELETE','/transportistas/'+id);
      transportistas=transportistas.filter(x=>String(x.id)!==String(id));
      cargas.forEach(c=>{if(String(c.truck_id)===String(id))c.truck_id=null;});
      renderTrans();renderCargas();log('Transportista eliminado');return;
    }
    renderAll();
  }catch(e){log('Error al eliminar','warn');}
}

function onDragStart(e,id){dragId=id;setTimeout(()=>{const el=document.getElementById('card-'+id);if(el)el.classList.add('dragging');},0);}
function onDragEnd(){document.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));}
function clearDO(){document.querySelectorAll('.cc.drag-over').forEach(el=>el.classList.remove('drag-over'));}
function onDragOver(e,cid){e.preventDefault();clearDO();const el=document.getElementById('col-'+cid);if(el)el.classList.add('drag-over');}
function onDragLeave(){clearDO();}
async function onDrop(e,cid){
  e.preventDefault();clearDO();
  if(!dragId)return;
  const p=pedidos.find(x=>String(x.id)===String(dragId));
  if(!p||String(p.carga_id)===String(cid))return;
  const c=cargas.find(x=>String(x.id)===String(cid));
  if(!c||c.status==='entregada'){log('Carga ya entregada','warn');return;}
  try{
    const upd=await api('PATCH','/pedidos/'+p.id+'/carga',{carga_id:cid});
    p.carga_id=cid;
    if(upd&&upd.estado_prep) p.estado_prep=upd.estado_prep;
    // al soltar, desplegar la carga destino para ver que el pedido entró
    cargasColapsadas.delete(String(cid));_guardarColapsadas();
    dragId=null;renderAll();log('Pedido asignado a '+c.name,'ok');
  }catch(e){log('Error al asignar','warn');}
}

// ── PLEGAR CARGAS (para que quepan más al arrastrar pedidos) ──────────────────
function _guardarColapsadas(){ try{ localStorage.setItem('cargasColapsadas', JSON.stringify([...cargasColapsadas])); }catch(e){} }
function toggleCargaCollapse(cid){
  cid=String(cid);
  if(cargasColapsadas.has(cid)) cargasColapsadas.delete(cid); else cargasColapsadas.add(cid);
  _guardarColapsadas();
  const el=document.getElementById('col-'+cid);
  if(el){
    const plegada=cargasColapsadas.has(cid);
    el.classList.toggle('cc-collapsed',plegada);
    const ic=el.querySelector('.cc-collapse-btn i');
    if(ic) ic.className='ti ti-chevron-'+(plegada?'right':'down');
  }
  _actualizarBotonPlegar();
}
function togglePlegarTodas(){
  const activas=cargas.filter(c=>c.status!=='entregada');
  const todasPlegadas=activas.length>0 && activas.every(c=>cargasColapsadas.has(String(c.id)));
  if(todasPlegadas) cargasColapsadas.clear();
  else activas.forEach(c=>cargasColapsadas.add(String(c.id)));
  _guardarColapsadas();
  renderCargas();
}
function _actualizarBotonPlegar(){
  const b=document.getElementById('btn-plegar-cargas'); if(!b) return;
  const activas=cargas.filter(c=>c.status!=='entregada');
  const todasPlegadas=activas.length>0 && activas.every(c=>cargasColapsadas.has(String(c.id)));
  b.innerHTML=todasPlegadas?'<i class="ti ti-chevrons-down"></i> Desplegar todas':'<i class="ti ti-chevrons-up"></i> Plegar todas';
}
// Auto-scroll al arrastrar cerca de los bordes (alcanzar cargas fuera de pantalla)
document.addEventListener('dragover',function(e){
  if(!dragId) return;
  const m=80, sp=22, y=e.clientY, h=window.innerHeight||document.documentElement.clientHeight;
  if(y<m) window.scrollBy(0,-sp);
  else if(y>h-m) window.scrollBy(0,sp);
});

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(type,id){
  modalType=type;editId=id;
  const p=id&&type==='pedido'?pedidos.find(x=>String(x.id)===String(id)):null;
  const t=id&&type==='trans'?transportistas.find(x=>String(x.id)===String(id)):null;
  document.getElementById('modal-title').innerHTML=id?`<i class="ti ti-pencil"></i> Editar ${type==='pedido'?'pedido':'transportista'}`:`<i class="ti ti-plus"></i> Nuevo ${type==='pedido'?'pedido':'transportista'}`+(type==='pedido'&&!id?` <button onclick="triggerPDFImport()" style="margin-left:10px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.4);border-radius:var(--radius-sm);padding:3px 10px;font-size:11px;cursor:pointer;color:#fff"><i class="ti ti-file-import"></i> Importar PDF BC</button>`:'');
  if(type==='pedido'){
    document.getElementById('modal-body').innerHTML=`
      ${!id?'<input type="file" id="pdf-import-file" accept=".pdf" style="display:none" onchange="procesarPDFPedido(this)">':''}
      <div class="field"><label>Nº Pedido BC</label><input type="text" id="f-num" value="${p?p.num:'PED-'+String(Date.now()).slice(-4)}"></div>
      <div class="frow">
        <div class="field"><label>Cliente</label><input type="text" id="f-cliente" value="${p?p.cliente:''}" placeholder="Nombre del cliente"></div>
        <div class="field"><label>Comercial <span style="font-size:10px;color:var(--text2);font-weight:400">(quién pasa el pedido)</span></label>
          <select id="f-comercial">
            <option value="">— Sin asignar —</option>
            ${nombresComerciales().map(n=>`<option value="${n}" ${p&&p.comercial===n?'selected':''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="frow">
        <div class="field"><label>Destino</label><input type="text" id="f-destino" value="${p?p.destino:''}" placeholder="Ciudad, Provincia"></div>
        <div class="field"><label>Link Google Maps <span style="font-size:10px;color:var(--text2);font-weight:400">(opcional — para QR)</span></label><input type="url" id="f-maps-url" value="${p?p.maps_url||'':''}" placeholder="https://maps.app.goo.gl/..."></div>
        <div class="field"><label>Dirección de descarga <span style="font-size:10px;color:var(--text2);font-weight:400">(para la orden del transportista)</span></label><input type="text" id="f-dir-desc" value="${p?p.direccion_descarga||'':''}" placeholder="Calle, nº, CP, Ciudad..."></div>
        <div class="field"><label>Fecha entrega</label><input type="date" id="f-fecha" value="${p&&p.fecha?String(p.fecha).substring(0,10):''}"></div>
      </div>
      <div class="frow">
        <div class="field"><label>Ubicación en almacén</label><input type="text" id="f-ubicacion" value="${p?p.ubicacion||'':''}" placeholder="Ej: Pasillo A - Estante 3"></div>
        <div class="field"><label>Estado preparación</label>
          <select id="f-estadoprep">
            <option value="sin_preparar" ${(!p||p.estado_prep==='sin_preparar')?'selected':''}>Sin preparar</option>
            <option value="preparado" ${p&&p.estado_prep==='preparado'?'selected':''}>Preparado</option>
            <option value="carga" ${p&&p.estado_prep==='carga'?'selected':''}>En carga</option>
          </select>
        </div>
      </div>
      <div class="frow">
        <div class="field"><label>Kg</label><input type="number" id="f-kg" value="${p?p.kg:''}" placeholder="0" min="0"></div>
        <div class="field"><label>€ Porte cliente</label><input type="number" id="f-porte" value="${p?p.porte:''}" placeholder="0" min="0"></div>
      </div>
      <div class="frow">
        <div class="field"><label>Prioridad</label>
          <select id="f-prio">
            <option value="normal" ${(!p||p.prio==='normal')?'selected':''}>Normal</option>
            <option value="urgente" ${p&&p.prio==='urgente'?'selected':''}>Urgente</option>
            <option value="baja" ${p&&p.prio==='baja'?'selected':''}>Baja prioridad</option>
          </select>
        </div>
        <div class="field"><label>Nº paradas</label><input type="number" id="f-paradas" value="${p?p.paradas||1:1}" min="1"></div>
      </div>
      <div class="field"><label>Categoría</label>
        <select id="f-cat">
          <option value="">Sin categoría</option>
          ${categorias.map(cat=>`<option value="${cat.id}" ${p&&String(p.categoria_id)===String(cat.id)?'selected':''}>${cat.nombre}</option>`).join('')}
        </select></div>
      <div class="field"><label>Observaciones</label><textarea id="f-obs">${p?p.obs||'':''}</textarea></div>`;
    document.getElementById('modal-foot').innerHTML=`${id?`<button class="btn-del" onclick="closeModal();confirmDelete('pedido','${id}')"><i class="ti ti-trash"></i></button>`:''}<button class="btn-sec" onclick="closeModal()">Cancelar</button><button class="btn-primary" onclick="savePedido()"><i class="ti ti-device-floppy"></i> Guardar</button>`;
  }else{
    const tarifas=(t&&t.tarifas)?t.tarifas:[];
    document.getElementById('modal-body').innerHTML=`
      <div class="frow">
        <div class="field"><label>Nombre empresa</label><input type="text" id="f-tnombre" value="${t?t.nombre:''}" placeholder="Razón social"></div>
        <div class="field"><label>Persona contacto</label><input type="text" id="f-tcontacto" value="${t?t.contacto||'':''}" placeholder="Nombre"></div>
      </div>
      <div class="frow">
        <div class="field"><label>Teléfono</label><input type="text" id="f-ttelefono" value="${t?t.telefono||'':''}" placeholder="666 000 000"></div>
        <div class="field"><label>Email</label><input type="email" id="f-temail" value="${t?t.email||'':''}" placeholder="correo@empresa.com"></div>
      </div>
      <div class="frow">
        <div class="field"><label>NIF / CIF</label><input type="text" id="f-tnif" value="${t?t.nif||t.cif||'':''}" placeholder="B12345678"></div>
        <div class="field"><label>Color</label><select id="f-tcolor">${TRANS_COLORS.map(c=>`<option value="${c}" ${t&&t.color===c?'selected':''}>${c}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Dirección fiscal</label><input type="text" id="f-tdir" value="${t?t.direccion||'':''}" placeholder="Calle, número..."></div>
      <div class="frow">
        <div class="field"><label>CP</label><input type="text" id="f-tcp" value="${t?t.cp||'':''}" placeholder="00000"></div>
        <div class="field"><label>Ciudad</label><input type="text" id="f-tciudad" value="${t?t.ciudad||'':''}"></div>
        <div class="field"><label>País</label><input type="text" id="f-tpais" value="${t?t.pais||'España':'España'}"></div>
      </div>
      <div class="field">
        <label>Tarifas orientativas <button type="button" onclick="addTarifaRow()" style="background:var(--blue);color:#fff;border:none;border-radius:3px;padding:1px 7px;font-size:10px;cursor:pointer;margin-left:6px"><i class="ti ti-plus"></i> Añadir</button></label>
        <div id="tarifas-box">${tarifas.map((tf,i)=>`<div style="display:flex;gap:5px;margin-bottom:4px"><input type="text" placeholder="Ruta" value="${tf.ruta||''}" id="tfr-${i}" style="flex:2;font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:var(--radius-sm);background:var(--surface2)"><input type="number" placeholder="€" value="${tf.precio||''}" id="tfp-${i}" style="width:70px;font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:var(--radius-sm);background:var(--surface2)"><button type="button" onclick="this.parentElement.remove()" style="background:none;border:1px solid var(--border2);border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px;color:var(--text2)"><i class="ti ti-x"></i></button></div>`).join('')||'<div style="font-size:11px;color:var(--text2)" id="no-tarifas">Sin tarifas aún</div>'}</div>
      </div>
      <div class="field"><label>Notas</label><textarea id="f-tnotas">${t?t.notas||'':''}</textarea></div>`;
    document.getElementById('modal-foot').innerHTML=`${id?`<button class="btn-del" onclick="closeModal();confirmDelete('trans','${id}')"><i class="ti ti-trash"></i></button>`:''}<button class="btn-sec" onclick="closeModal()">Cancelar</button><button class="btn-primary" onclick="saveTrans()"><i class="ti ti-device-floppy"></i> Guardar</button>`;
  }
  document.getElementById('overlay').classList.add('open');
}

function addTarifaRow(){
  const box=document.getElementById('tarifas-box');
  const nt=document.getElementById('no-tarifas');if(nt)nt.remove();
  const i=box.querySelectorAll('[id^="tfr-"]').length;
  const div=document.createElement('div');
  div.style.cssText='display:flex;gap:5px;margin-bottom:4px';
  div.innerHTML=`<input type="text" placeholder="Ruta" id="tfr-${i}" style="flex:2;font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:var(--radius-sm);background:var(--surface2)"><input type="number" placeholder="€" id="tfp-${i}" style="width:70px;font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:var(--radius-sm);background:var(--surface2)"><button type="button" onclick="this.parentElement.remove()" style="background:none;border:1px solid var(--border2);border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px;color:var(--text2)"><i class="ti ti-x"></i></button>`;
  box.appendChild(div);
}

function closeModal(){document.getElementById('overlay').classList.remove('open');editId=null;modalType=null;pdfImportLineas=null;}

function triggerPDFImport(){
  const inp=document.getElementById('pdf-import-file');
  if(inp){inp.value='';inp.click();}
}

async function procesarPDFPedido(input){
  const file=input.files[0];
  if(!file) return;
  // Show loading in title
  const titleEl=document.getElementById('modal-title');
  const origTitle=titleEl.innerHTML;
  titleEl.innerHTML='<i class="ti ti-loader"></i> Leyendo PDF...';

  const base64=await new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=()=>rej(new Error('Error leyendo archivo'));
    r.readAsDataURL(file);
  });

  try{
    const resp=await fetch('/api/importar-pdf',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({base64,media_type:'application/pdf'})
    });
    const raw=await resp.text();
    if(!resp.ok) throw new Error('HTTP '+resp.status+': '+raw.substring(0,200));
    let datos;
    try{datos=JSON.parse(raw);}
    catch(e){throw new Error('Respuesta inválida: '+raw.substring(0,100));}

    // Fill form fields — modal stays open for review
    if(datos.num){const el=document.getElementById('f-num');if(el)el.value=datos.num;}
    if(datos.cliente_nombre){const el=document.getElementById('f-cliente');if(el)el.value=datos.cliente_nombre;}
    if(datos.destino_texto){const el=document.getElementById('f-destino');if(el)el.value=datos.destino_texto;}
    if(datos.direccion_descarga){const el=document.getElementById('f-dir-desc');if(el)el.value=datos.direccion_descarga;}
    if(datos.kg){const el=document.getElementById('f-kg');if(el)el.value=datos.kg;}
    if(datos.porte){const el=document.getElementById('f-porte');if(el)el.value=datos.porte;}
    if(datos.fecha_pedido){const el=document.getElementById('f-fecha');if(el)el.value=datos.fecha_pedido;}
    if(datos.obs){const el=document.getElementById('f-obs');if(el)el.value=datos.obs;}

    // Guardar las líneas leídas para crearlas al pulsar "Guardar"
    pdfImportLineas = datos.lineas || null;

    // Restore title and show success banner
    titleEl.innerHTML=origTitle;
    // Show green banner inside modal body
    const banner=document.createElement('div');
    banner.style.cssText='background:#e6f5ea;border:1px solid #2d7a3a;border-radius:6px;padding:8px 12px;font-size:12px;color:#2d7a3a;margin-bottom:10px;display:flex;align-items:center;gap:6px';
    banner.innerHTML='<i class="ti ti-check"></i> PDF importado: <strong>'+(datos.num||'')+'</strong> — Revisa y guarda';
    const body=document.getElementById('modal-body');
    if(body){body.insertBefore(banner,body.firstChild);}
    log('PDF importado correctamente','ok');
  }catch(e){
    titleEl.innerHTML=origTitle;
    log('Error leyendo PDF: '+e.message,'warn');
  }
}

async function savePedido(){
  const cliente=document.getElementById('f-cliente').value.trim();
  const destino=document.getElementById('f-destino').value.trim();
  const kg=parseFloat(document.getElementById('f-kg').value)||0;
  if(!cliente||!destino||!kg){log('Rellena cliente, destino y kg','warn');return;}
  const data={
    num:document.getElementById('f-num').value.trim(),
    cliente,destino,
    direccion_descarga:document.getElementById('f-dir-desc')?.value.trim()||null,
    ubicacion:document.getElementById('f-ubicacion').value.trim()||null,
    estado_prep:document.getElementById('f-estadoprep').value,
    fecha:document.getElementById('f-fecha').value||null,
    kg,porte:parseFloat(document.getElementById('f-porte').value)||0,
    prio:document.getElementById('f-prio').value,
    paradas:parseInt(document.getElementById('f-paradas').value)||1,
    obs:document.getElementById('f-obs').value.trim(),
    categoria_id:document.getElementById('f-cat')?.value||null,
    maps_url:document.getElementById('f-maps-url')?.value.trim()||null,
    comercial:document.getElementById('f-comercial')?.value||null
  };
  try{
    if(editId){
      const updated=await api('PUT','/pedidos/'+editId,{...pedidos.find(x=>String(x.id)===String(editId)),...data});
      Object.assign(pedidos.find(x=>String(x.id)===String(editId)),updated);
      log('Pedido '+data.num+' actualizado','ok');
    }else{
      const newP=await api('POST','/pedidos',data);
      // Si se importó un PDF en este modal, crear también sus líneas
      let nLin=0;
      if(pdfImportLineas){ nLin=await guardarLineasPedido(newP.id, pdfImportLineas); }
      pedidos.unshift(newP);
      log('Pedido '+data.num+' creado'+(nLin?' con '+nLin+' artículos':''),'ok');
    }
    pdfImportLineas=null;
    closeModal();renderAll();
  }catch(e){log('Error: '+e.message,'warn');}
}

async function saveTrans(){
  const nombre=document.getElementById('f-tnombre').value.trim();
  if(!nombre){log('Introduce el nombre','warn');return;}
  const tarifas=[];
  document.querySelectorAll('[id^="tfr-"]').forEach((inp,i)=>{
    const pp=document.getElementById('tfp-'+i);
    if(inp.value.trim())tarifas.push({ruta:inp.value.trim(),precio:pp?pp.value:''});
  });
  const data={nombre,contacto:document.getElementById('f-tcontacto').value.trim(),telefono:document.getElementById('f-ttelefono').value.trim(),email:document.getElementById('f-temail').value.trim(),nif:document.getElementById('f-tnif').value.trim(),cif:document.getElementById('f-tnif').value.trim(),direccion:document.getElementById('f-tdir')?.value.trim()||null,cp:document.getElementById('f-tcp')?.value.trim()||null,ciudad:document.getElementById('f-tciudad')?.value.trim()||null,pais:document.getElementById('f-tpais')?.value.trim()||'España',color:document.getElementById('f-tcolor').value,tarifas,notas:document.getElementById('f-tnotas').value.trim()};
  try{
    if(editId){
      const updated=await api('PUT','/transportistas/'+editId,data);
      Object.assign(transportistas.find(x=>String(x.id)===String(editId)),updated);
      log(nombre+' actualizado','ok');
    }else{
      const newT=await api('POST','/transportistas',data);
      transportistas.push(newT);log(nombre+' añadido','ok');
    }
    closeModal();renderTrans();renderCargas();
  }catch(e){log('Error: '+e.message,'warn');}
}

// ── TRANSPORTISTAS VIEW ───────────────────────────────────────────────────────
function renderTrans(){
  const el=document.getElementById('trans-list');
  if(!transportistas.length){
    el.innerHTML=`<div class="empty-state"><i class="ti ti-truck"></i>Sin transportistas. Añade el primero.</div>`;return;
  }
  el.innerHTML=transportistas.map(t=>{
    const cs=cargas.filter(c=>String(c.truck_id)===String(t.id));
    const totalPortes=cs.reduce((s,c)=>s+cargaPortes(c.id),0);
    const tarifas=Array.isArray(t.tarifas)?t.tarifas:[];
    return `<div class="trans-card">
      <div class="trans-hdr">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="trans-avatar" style="background:${t.color}20;color:${t.color}">${initials(t.nombre)}</div>
          <div><div style="font-size:14px;font-weight:500">${t.nombre}</div><div style="font-size:11px;color:var(--text2)">${t.contacto||''}${t.nif?' · '+t.nif:''}</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="badge b-blue">${cs.length} cargas</span>
          <span style="font-size:13px;font-weight:500;color:var(--green)">${fmtN(totalPortes)} €</span>
          <button class="ico" onclick="openModal('trans','${t.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
        </div>
      </div>
      <div class="trans-body">
        ${t.telefono?`<div><div class="tf-label"><i class="ti ti-phone"></i> Teléfono</div><div class="tf-val">${t.telefono}</div></div>`:''}
        ${t.email?`<div><div class="tf-label"><i class="ti ti-mail"></i> Email</div><div class="tf-val" style="font-size:11px">${t.email}</div></div>`:''}
      </div>
      ${tarifas.length?`<div class="trans-tarifas"><div style="font-size:10px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Tarifas orientativas</div>${tarifas.map(tf=>`<div class="tarifa-row"><span style="color:var(--text2)">${tf.ruta}</span><span style="font-weight:500;color:var(--green)">${tf.precio?tf.precio+' €':'—'}</span></div>`).join('')}</div>`:''}
      ${t.notas?`<div style="font-size:11px;color:var(--text2);padding:8px 16px;border-top:1px solid var(--border);font-style:italic">${t.notas}</div>`:''}
    </div>`;
  }).join('');
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────
function renderCal(){
  document.getElementById('cal-title').textContent=MESES[calM]+' '+calY;
  const first=new Date(calY,calM,1);
  const startDow=(first.getDay()+6)%7;
  const dim=new Date(calY,calM+1,0).getDate();
  const today=new Date();
  let html=DOWS.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<startDow;i++)html+=`<div class="cal-day other"></div>`;
  for(let d=1;d<=dim;d++){
    const ds=calY+'-'+String(calM+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const isToday=today.getFullYear()===calY&&today.getMonth()===calM&&today.getDate()===d;
    const dc=cargas.filter(c=>c.fecha&&String(c.fecha).substring(0,10)===ds&&(!catFilter||String(c.categoria_id)===catFilter));
    html+=`<div class="cal-day${isToday?' today':''}" data-iso="${ds}"><div class="cal-dn">${d}</div>${dc.map(c=>{const col=CCOLS[Math.min(c.color_idx||0,CCOLS.length-1)];return`<div class="cal-ev" onpointerdown="calChipDown(event,'carga','${c.id}')" style="background:${col.bg};color:${col.t};touch-action:none;cursor:grab">${c.name}</div>`;}).join('')}</div>`;
  }
  document.getElementById('cal-grid').innerHTML=html;
  const mc=cargas.filter(c=>c.fecha&&String(c.fecha).substring(0,7)===(calY+'-'+String(calM+1).padStart(2,'0'))&&(!catFilter||String(c.categoria_id)===catFilter));
  document.getElementById('cal-count').textContent=mc.length;
  document.getElementById('cal-list').innerHTML=mc.length===0?`<div style="padding:14px;font-size:11px;color:var(--text2);text-align:center">Sin cargas este mes</div>`:mc.map(c=>{
    const ps=cargaPs(c.id),sc=STATUS_CFG[c.status]||STATUS_CFG.pendiente;
    const t=getTrans(c.truck_id),col=CCOLS[Math.min(c.color_idx||0,CCOLS.length-1)];
    const portes=cargaPortes(c.id),coste=c.coste!=null?+c.coste:null;
    const margen=coste!=null?portes-coste:null;
    return`<div class="list-row">
      <div style="width:10px;height:10px;border-radius:50%;background:${col.b};flex-shrink:0"></div>
      <div class="list-main"><div class="list-name">${c.name}${c.codigo_orden?` <span style="font-size:10px;color:var(--text2);font-family:monospace">${c.codigo_orden}</span>`:''}</div><div class="list-meta">${fmtDate(c.fecha)} · ${t?t.nombre:'Sin transportista'} · ${ps.length} ped.</div></div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:500;color:var(--green)">${fmtN(portes)} €</div>
        ${margen!=null?`<div style="font-size:10px;color:${margen>=0?'var(--green)':'var(--red)'}">${margen>=0?'+':''}${fmtN(margen)} € mg</div>`:'<div style="font-size:10px;color:var(--text2)">Coste pend.</div>'}
        <span class="badge ${sc.badge}">${sc.label}</span>
      </div>
    </div>`;
  }).join('');
}
function calMove(d){if(d<0){if(calM===0){calM=11;calY--;}else calM--;}else{if(calM===11){calM=0;calY++;}else calM++;}renderCal();}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
// ── RESUMEN / DASHBOARD ───────────────────────────────────────────────────────
let _dashCharts={};
function _destroyDashCharts(){ for(const k in _dashCharts){ try{_dashCharts[k].destroy();}catch(e){} } _dashCharts={}; }
function _mesYM(off){ const d=new Date(); d.setDate(1); if(off) d.setMonth(d.getMonth()+off); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function _enPeriodoDash(c, periodo){
  if(periodo==='all') return true;
  const m=c.fecha?String(c.fecha).substring(0,7):'';
  if(periodo==='thismonth') return m===_mesYM(0);
  if(periodo==='lastmonth') return m===_mesYM(-1);
  return m===periodo; // YYYY-MM concreto
}
function _poblarPeriodoDash(){
  const sel=document.getElementById('dash-periodo'); if(!sel) return;
  const cur=sel.value;
  const meses=[...new Set(cargas.filter(c=>c.status==='entregada').map(c=>c.fecha?String(c.fecha).substring(0,7):'').filter(Boolean))].sort().reverse();
  sel.innerHTML='<option value="all">Todo</option><option value="thismonth">Este mes</option><option value="lastmonth">Mes anterior</option>'
    + meses.map(m=>`<option value="${m}">${_nombreMes(m)}</option>`).join('');
  if([...sel.options].some(o=>o.value===cur)) sel.value=cur;
}
// Datos agregados del periodo (reutilizado por gráficos e informes)
function _dashDatos(periodo){
  const ent=cargas.filter(c=>c.status==='entregada'&&_enPeriodoDash(c,periodo));
  const totPortes=ent.reduce((s,c)=>s+cargaPortes(c.id),0);
  const totCoste=ent.filter(c=>c.coste!=null).reduce((s,c)=>s+(+c.coste),0);
  const totKg=ent.reduce((s,c)=>s+cargaKg(c.id),0);
  const sinPrecio=ent.filter(c=>c.coste==null).length;
  const porMes={};
  ent.forEach(c=>{ const m=c.fecha?String(c.fecha).substring(0,7):'(sin fecha)'; const d=porMes[m]||(porMes[m]={v:0,kg:0,p:0,co:0}); d.v++; d.kg+=cargaKg(c.id); d.p+=cargaPortes(c.id); if(c.coste!=null)d.co+=+c.coste; });
  const porTrans=transportistas.map(t=>{ const cs=ent.filter(c=>String(c.truck_id)===String(t.id)); const p=cs.reduce((s,c)=>s+cargaPortes(c.id),0); const co=cs.filter(c=>c.coste!=null).reduce((s,c)=>s+(+c.coste),0); return{nombre:t.nombre,color:t.color,nC:cs.length,kg:cs.reduce((s,c)=>s+cargaKg(c.id),0),portes:p,costes:co,margen:p-co}; }).filter(t=>t.nC>0).sort((a,b)=>b.portes-a.portes);
  return { ent, totPortes, totCoste, totMargen:totPortes-totCoste, totKg, sinPrecio, porMes, porTrans };
}

function renderDash(){
  _poblarPeriodoDash();
  const periodo=document.getElementById('dash-periodo')?.value||'all';
  const D=_dashDatos(periodo);
  const cargasP=cargas.filter(c=>_enPeriodoDash(c,periodo));
  const margenPct=D.totPortes>0?Math.round(D.totMargen/D.totPortes*100):0;
  const nRuta=cargasP.filter(c=>c.status==='ruta').length;
  const nAbiertas=cargasP.filter(c=>c.status!=='entregada').length;
  const prepTotal=pedidos.filter(p=>_esPrep(p)).length;
  const pedAsig=pedidos.filter(p=>p.carga_id).length;
  // KPIs (dinero + operativa)
  document.getElementById('dash-kpis').innerHTML=`
    <div class="dash-card"><div class="dash-lbl">Portes (cobramos)</div><div class="dash-val" style="color:var(--green)">${fmtN(D.totPortes)} €</div><div class="dash-sub">${D.ent.length} cargas entregadas</div></div>
    <div class="dash-card"><div class="dash-lbl">Coste (nos cobran)</div><div class="dash-val" style="color:var(--amber)">${fmtN(D.totCoste)} €</div><div class="dash-sub">${D.sinPrecio?('⚠ '+D.sinPrecio+' sin precio'):'todas con precio'}</div></div>
    <div class="dash-card"><div class="dash-lbl">Margen</div><div class="dash-val" style="color:${D.totMargen>=0?'var(--green)':'var(--red)'}">${D.totMargen>=0?'+':''}${fmtN(D.totMargen)} €</div><div class="dash-sub">${margenPct}% sobre portes</div></div>
    <div class="dash-card"><div class="dash-lbl">Kg transportados</div><div class="dash-val">${fmtN(D.totKg)}</div><div class="dash-sub">en el periodo</div></div>
    <div class="dash-card"><div class="dash-lbl">Cargas abiertas</div><div class="dash-val">${nAbiertas}</div><div class="dash-sub">${nRuta} en ruta</div></div>
    <div class="dash-card"><div class="dash-lbl">Pedidos</div><div class="dash-val">${pedidos.length}</div><div class="dash-sub">${prepTotal} preparados · ${pedAsig} asignados</div></div>`;
  // Detalle por transportista
  const maxP=Math.max(...D.porTrans.map(t=>t.portes),1);
  document.getElementById('dash-trucks').innerHTML=D.porTrans.length?D.porTrans.map(t=>`
    <div class="list-row">
      <div class="trans-avatar" style="width:30px;height:30px;font-size:11px;background:${t.color}20;color:${t.color};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">${initials(t.nombre)}</div>
      <div class="list-main"><div class="list-name">${t.nombre}</div><div class="list-meta">${t.nC} cargas · ${fmtN(t.portes)} €</div>
        <div class="prog-bar"><div class="prog-fill" style="width:${Math.round(t.portes/maxP*100)}%;background:${t.color}"></div></div>
      </div>
      <div style="text-align:right;flex-shrink:0">${t.costes>0?`<div style="font-size:12px;font-weight:600;color:${t.margen>=0?'var(--green)':'var(--red)'}">${t.margen>=0?'+':''}${fmtN(t.margen)} €</div><div style="font-size:10px;color:var(--text2)">margen</div>`:'<div style="font-size:10px;color:var(--text2)">sin coste</div>'}</div>
    </div>`).join(''):`<div style="padding:14px;font-size:11px;color:var(--text2);text-align:center">Sin cargas entregadas en el periodo</div>`;
  // Gráficos (Chart.js bajo demanda)
  _cargarScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js')
    .then(()=>{ if(typeof Chart!=='undefined') _renderDashCharts(D, cargasP); })
    .catch(()=>{});
}

function _renderDashCharts(D, cargasP){
  _destroyDashCharts();
  const cs=getComputedStyle(document.documentElement);
  const txt=(cs.getPropertyValue('--text2')||'#5b6b85').trim();
  const surf=(cs.getPropertyValue('--surface')||'#fff').trim();
  const grid='rgba(127,127,127,.15)';
  const green='#3B6D11', amber='#BA7517', red='#A32D2D', blue='#185FA5';
  Chart.defaults.color=txt; Chart.defaults.font.family="'DM Sans',sans-serif";
  const eur=v=>fmtN(v)+' €';
  // 1) Evolución mensual (todas las entregadas, últimos 8 meses)
  const porMesAll={};
  cargas.filter(c=>c.status==='entregada').forEach(c=>{ const m=c.fecha?String(c.fecha).substring(0,7):''; if(!m)return; const d=porMesAll[m]||(porMesAll[m]={p:0,co:0}); d.p+=cargaPortes(c.id); if(c.coste!=null)d.co+=+c.coste; });
  const meses=Object.keys(porMesAll).sort().slice(-8);
  const ev=document.getElementById('dash-chart-evol');
  if(ev) _dashCharts.evol=new Chart(ev,{ data:{ labels:meses.map(m=>_nombreMes(m)), datasets:[
      {type:'bar',label:'Portes',data:meses.map(m=>porMesAll[m].p),backgroundColor:green+'cc',borderRadius:4},
      {type:'bar',label:'Coste',data:meses.map(m=>porMesAll[m].co),backgroundColor:amber+'cc',borderRadius:4},
      {type:'line',label:'Margen',data:meses.map(m=>porMesAll[m].p-porMesAll[m].co),borderColor:blue,backgroundColor:blue,tension:.3,fill:false,pointRadius:3}
    ]}, options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{boxWidth:12}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+eur(c.raw)}}},scales:{x:{grid:{display:false}},y:{grid:{color:grid},ticks:{callback:eur}}}} });
  // 2) Estados de cargas (donut, periodo)
  const estados=['pendiente','planificada','ruta','entregada'];
  const labelE={pendiente:'Pendiente',planificada:'Planificada',ruta:'En ruta',entregada:'Entregada'};
  const colE={pendiente:'#9ca3af',planificada:blue,ruta:amber,entregada:green};
  const counts=estados.map(e=>cargasP.filter(c=>c.status===e).length);
  const es=document.getElementById('dash-chart-estados');
  if(es) _dashCharts.estados=new Chart(es,{ type:'doughnut', data:{labels:estados.map(e=>labelE[e]),datasets:[{data:counts,backgroundColor:estados.map(e=>colE[e]),borderWidth:2,borderColor:surf}]}, options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{boxWidth:12}}}} });
  // 3) Por transportista (barras: portes y margen)
  const tr=document.getElementById('dash-chart-trans');
  if(tr) _dashCharts.trans=new Chart(tr,{ type:'bar', data:{labels:D.porTrans.map(t=>t.nombre),datasets:[
      {label:'Portes',data:D.porTrans.map(t=>t.portes),backgroundColor:green+'cc',borderRadius:4},
      {label:'Margen',data:D.porTrans.map(t=>t.margen),backgroundColor:D.porTrans.map(t=>t.margen>=0?blue+'cc':red+'cc'),borderRadius:4}
    ]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:12}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+eur(c.raw)}}},scales:{x:{grid:{display:false}},y:{grid:{color:grid},ticks:{callback:eur}}}} });
}

// ── Informes del resumen ──────────────────────────────────────────────────────
function _etiquetaPeriodo(periodo){
  if(periodo==='all') return 'Todo el histórico';
  if(periodo==='thismonth') return _nombreMes(_mesYM(0));
  if(periodo==='lastmonth') return _nombreMes(_mesYM(-1));
  return _nombreMes(periodo)||periodo;
}
async function informeDashExcel(){
  const periodo=document.getElementById('dash-periodo')?.value||'all';
  const D=_dashDatos(periodo);
  if(!D.ent.length){ log('No hay cargas entregadas en el periodo','warn'); return; }
  log('Generando informe Excel...');
  try{
    await _cargarScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    if(typeof ExcelJS==='undefined') throw new Error('ExcelJS');
    const AZUL='FF185FA5', CLARO='FFEAF3FB', GRIS='FFD0D7DE', fmtEur='#,##0.00" €"', fmtKg='#,##0';
    const borde=()=>({top:{style:'thin',color:{argb:GRIS}},left:{style:'thin',color:{argb:GRIS}},bottom:{style:'thin',color:{argb:GRIS}},right:{style:'thin',color:{argb:GRIS}}});
    const cab=cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:AZUL}};cell.alignment={vertical:'middle',horizontal:'center'};cell.border=borde();};
    const wb=new ExcelJS.Workbook(); wb.creator='Cargas Arisac';
    // Resumen
    const ws=wb.addWorksheet('Resumen'); ws.columns=[{width:26},{width:18}];
    ws.mergeCells(1,1,1,2); const tt=ws.getCell(1,1); tt.value='Informe — '+_etiquetaPeriodo(periodo); tt.font={bold:true,size:14,color:{argb:AZUL}};
    [['Cargas entregadas',D.ent.length],['Kg transportados',D.totKg],['Portes (cobramos)',D.totPortes],['Coste (nos cobran)',D.totCoste],['Margen',D.totMargen],['Sin precio (pendientes)',D.sinPrecio]].forEach((r,i)=>{
      const row=ws.addRow(r); row.getCell(1).font={bold:true};
      if(i>=1&&i<=4) row.getCell(2).numFmt=fmtEur; if(i===1) row.getCell(2).numFmt=fmtKg;
    });
    // Por mes
    const wm=wb.addWorksheet('Por mes'); wm.columns=[{width:18},{width:10},{width:12},{width:12},{width:12},{width:12}];
    const hm=wm.getRow(1); ['Mes','Cargas','Kg','Portes','Coste','Margen'].forEach((h,i)=>hm.getCell(i+1).value=h); hm.eachCell(cab);
    Object.keys(D.porMes).sort().forEach(m=>{ const d=D.porMes[m]; const r=wm.addRow([_nombreMes(m)||m,d.v,d.kg,d.p,d.co,d.p-d.co]); r.getCell(3).numFmt=fmtKg; [4,5,6].forEach(i=>r.getCell(i).numFmt=fmtEur); r.eachCell(c=>c.border=borde()); });
    // Por transportista
    const wt=wb.addWorksheet('Por transportista'); wt.columns=[{width:24},{width:10},{width:12},{width:12},{width:12},{width:12}];
    const ht=wt.getRow(1); ['Transportista','Cargas','Kg','Portes','Coste','Margen'].forEach((h,i)=>ht.getCell(i+1).value=h); ht.eachCell(cab);
    D.porTrans.forEach(t=>{ const r=wt.addRow([t.nombre,t.nC,t.kg,t.portes,t.costes,t.margen]); r.getCell(3).numFmt=fmtKg; [4,5,6].forEach(i=>r.getCell(i).numFmt=fmtEur); r.eachCell(c=>c.border=borde()); });
    const buf=await wb.xlsx.writeBuffer();
    _descargarBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'informe_resumen_'+(periodo==='all'?'todo':periodo)+'.xlsx');
    log('Informe Excel generado','ok');
  }catch(e){ log('No se pudo generar el Excel: '+e.message,'warn'); }
}
function informeDashPDF(){
  const periodo=document.getElementById('dash-periodo')?.value||'all';
  const D=_dashDatos(periodo);
  if(!D.ent.length){ log('No hay cargas entregadas en el periodo','warn'); return; }
  const eur=v=>fmtN(v)+' €';
  const kpi=(l,v,c)=>`<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;flex:1;min-width:120px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">${l}</div><div style="font-size:20px;font-weight:700;margin-top:3px;color:${c||'#15233b'}">${v}</div></div>`;
  const filaMes=Object.keys(D.porMes).sort().map(m=>{const d=D.porMes[m];return `<tr><td>${_nombreMes(m)||m}</td><td style="text-align:center">${d.v}</td><td style="text-align:right">${fmtN(d.kg)}</td><td style="text-align:right">${eur(d.p)}</td><td style="text-align:right">${eur(d.co)}</td><td style="text-align:right;font-weight:600;color:${d.p-d.co>=0?'#0F6E56':'#A32D2D'}">${eur(d.p-d.co)}</td></tr>`;}).join('');
  const filaTr=D.porTrans.map(t=>`<tr><td>${t.nombre}</td><td style="text-align:center">${t.nC}</td><td style="text-align:right">${fmtN(t.kg)}</td><td style="text-align:right">${eur(t.portes)}</td><td style="text-align:right">${eur(t.costes)}</td><td style="text-align:right;font-weight:600;color:${t.margen>=0?'#0F6E56':'#A32D2D'}">${eur(t.margen)}</td></tr>`).join('');
  const th='style="background:#185FA5;color:#fff;padding:7px 9px;text-align:left;font-size:11px"';
  const tdcss='td{padding:6px 9px;border-bottom:1px solid #eee;font-size:12px}';
  const html=`<div style="font-family:'DM Sans',sans-serif;color:#15233b">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0C447C;padding-bottom:12px;margin-bottom:18px">
      <div><div style="font-size:22px;font-weight:700;color:#0C447C">Informe de cargas</div><div style="font-size:13px;color:#6b7280">${_etiquetaPeriodo(periodo)}</div></div>
      <div style="font-size:11px;color:#9ca3af;text-align:right">ENVASADOS ARISAC<br>${new Date().toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'})}</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${kpi('Cargas entregadas',D.ent.length)}
      ${kpi('Kg transportados',fmtN(D.totKg))}
      ${kpi('Portes (cobramos)',eur(D.totPortes),'#0F6E56')}
      ${kpi('Coste (nos cobran)',eur(D.totCoste),'#854F0B')}
      ${kpi('Margen',eur(D.totMargen),D.totMargen>=0?'#0F6E56':'#A32D2D')}
    </div>
    <style>${tdcss}</style>
    <div style="font-size:14px;font-weight:600;margin:14px 0 6px">Por mes</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb"><thead><tr><th ${th}>Mes</th><th ${th}>Cargas</th><th ${th}>Kg</th><th ${th}>Portes</th><th ${th}>Coste</th><th ${th}>Margen</th></tr></thead><tbody>${filaMes}</tbody></table>
    <div style="font-size:14px;font-weight:600;margin:18px 0 6px">Por transportista</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb"><thead><tr><th ${th}>Transportista</th><th ${th}>Cargas</th><th ${th}>Kg</th><th ${th}>Portes</th><th ${th}>Coste</th><th ${th}>Margen</th></tr></thead><tbody>${filaTr}</tbody></table>
  </div>`;
  document.getElementById('print-content').innerHTML=html;
  document.getElementById('print-preview-title').textContent='Informe — '+_etiquetaPeriodo(periodo);
  document.getElementById('print-preview').classList.add('open');
}

function updateStats(){
  const asig=pedidos.filter(p=>p.carga_id);
  const portesAsig=asig.reduce((s,p)=>s+(+p.porte||0),0);
  const openC=cargas.filter(c=>c.status!=='entregada');
  const usedIds=[...new Set(asig.map(p=>String(p.carga_id)))];
  const costesConoc=usedIds.reduce((s,cid)=>{const c=cargas.find(x=>String(x.id)===cid);return c&&c.coste!=null?s+(+c.coste):s;},0);
  const m=portesAsig-costesConoc;
  const prepTotal=pedidos.filter(p=>!p.carga_id&&_esPrep(p)).length;
  document.getElementById('st-pend').textContent=pedidos.filter(p=>!p.carga_id).length;
  document.getElementById('st-prep').textContent=prepTotal;
  document.getElementById('st-cargas').textContent=openC.length;
  document.getElementById('st-asig').textContent=asig.length;
  // Update historial badge
  const entCount=cargas.filter(c=>c.status==='entregada').length;
  const hb=document.getElementById('hist-badge');if(hb)hb.textContent=entCount;
}


// ── HISTORIAL ─────────────────────────────────────────────────────────────────
function renderHist(){
  const entregadas=cargas.filter(c=>c.status==='entregada');
  // Update badge
  document.getElementById('hist-badge').textContent=entregadas.length;
  // Populate month filter
  const meses=[...new Set(entregadas.map(c=>c.fecha?String(c.fecha).substring(0,7):'').filter(Boolean))].sort().reverse();
  const selMes=document.getElementById('hist-filter-mes');
  const curMes=selMes.value;
  selMes.innerHTML='<option value="">Todos los meses</option>'+meses.map(m=>{
    const[y,mo]=m.split('-'); return `<option value="${m}" ${m===curMes?'selected':''}>${MESES[+mo-1]} ${y}</option>`;
  }).join('');
  // Populate trans filter
  const selTrans=document.getElementById('hist-filter-trans');
  const curTrans=selTrans.value;
  const usedTrans=[...new Set(entregadas.map(c=>String(c.truck_id)).filter(Boolean))];
  selTrans.innerHTML='<option value="">Todos los transportistas</option>'+usedTrans.map(tid=>{
    const t=getTrans(tid); return t?`<option value="${tid}" ${tid===curTrans?'selected':''}>${t.nombre}</option>`:'';
  }).join('');
  // Apply filters
  let list=entregadas;
  if(curMes) list=list.filter(c=>c.fecha&&String(c.fecha).substring(0,7)===curMes);
  if(curTrans) list=list.filter(c=>String(c.truck_id)===curTrans);
  // Filtro por estado del coste (lo que nos cobran): sin precio / con precio
  const curCoste=document.getElementById('hist-filter-coste')?.value||'';
  if(curCoste==='sin') list=list.filter(c=>c.coste==null);
  else if(curCoste==='con') list=list.filter(c=>c.coste!=null);
  list=list.sort((a,b)=>new Date(b.fecha||0)-new Date(a.fecha||0));
  // KPIs
  const totalPortes=list.reduce((s,c)=>s+cargaPortes(c.id),0);
  const totalCostes=list.filter(c=>c.coste!=null).reduce((s,c)=>s+(+c.coste),0);
  const totalMargen=totalPortes-totalCostes;
  const totalKg=list.reduce((s,c)=>s+cargaKg(c.id),0);
  document.getElementById('hist-kpis').innerHTML=`
    <div class="dash-card"><div class="dash-lbl">Cargas entregadas</div><div class="dash-val">${list.length}</div><div class="dash-sub">viajes completados</div></div>
    <div class="dash-card"><div class="dash-lbl">Kg transportados</div><div class="dash-val">${fmtN(totalKg)}</div><div class="dash-sub">en el periodo</div></div>
    <div class="dash-card"><div class="dash-lbl">Portes cobrados</div><div class="dash-val" style="color:var(--green)">${fmtN(totalPortes)} €</div><div class="dash-sub">facturado al cliente</div></div>
    <div class="dash-card"><div class="dash-lbl">Margen total</div><div class="dash-val" style="color:${totalMargen>=0?'var(--green)':'var(--red)'}">${totalMargen>=0?'+':''}${fmtN(totalMargen)} €</div><div class="dash-sub">portes − coste trans.</div></div>`;
  // List
  const el=document.getElementById('hist-list');
  if(!list.length){
    el.innerHTML=`<div class="empty-state"><i class="ti ti-history"></i>Sin cargas entregadas${curMes||curTrans?' con estos filtros':' aún'}</div>`;
    return;
  }
  const sinPrecio=entregadas.filter(c=>c.coste==null).length;
  el.innerHTML=`<div class="list-card">
    <div class="lc-hdr"><span>${list.length} carga${list.length>1?'s':''}</span>${sinPrecio?`<span onclick="document.getElementById('hist-filter-coste').value='sin';renderHist()" style="font-size:11px;color:var(--amber);cursor:pointer;text-decoration:underline" title="Ver solo las que faltan de precio">⚠ ${sinPrecio} sin precio</span>`:`<span style="font-size:11px;color:var(--text2)">ordenadas por fecha desc.</span>`}</div>
    ${list.map(c=>{
      const ps=cargaPs(c.id).sort((a,b)=>(a.orden_carga||999)-(b.orden_carga||999));
      const portes=cargaPortes(c.id),kg=cargaKg(c.id);
      const coste=c.coste!=null?+c.coste:null;
      const margen=coste!=null?portes-coste:null;
      const t=getTrans(c.truck_id);
      const col=CCOLS[Math.min(c.color_idx||0,CCOLS.length-1)];
      const nPrep=ps.filter(p=>_esPrep(p)).length;
      return `<div style="border-bottom:1px solid var(--border)">
        <div style="padding:12px 16px;display:flex;align-items:flex-start;gap:12px">
          <div style="width:10px;height:10px;border-radius:50%;background:${col.b};margin-top:4px;flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <span style="font-size:13px;font-weight:500">${c.name}</span>
              ${c.codigo_orden?`<span style="font-size:10px;color:var(--text2);font-family:monospace;background:var(--surface2);padding:1px 6px;border-radius:4px">${c.codigo_orden}</span>`:''}
              <span class="badge b-green"><i class="ti ti-check" style="font-size:10px"></i> Entregada</span>
            </div>
            <div style="font-size:11px;color:var(--text2);display:flex;gap:12px;flex-wrap:wrap">
              <span><i class="ti ti-calendar" style="font-size:11px"></i> ${fmtDate(c.fecha)}</span>
              <span><i class="ti ti-truck" style="font-size:11px"></i> ${t?t.nombre:'Sin transportista'}</span>
              <span><i class="ti ti-stack" style="font-size:11px"></i> ${ps.length} pedidos</span>
              <span><i class="ti ti-weight" style="font-size:11px"></i> ${fmtN(kg)} kg</span>
              <span><i class="ti ti-check" style="font-size:11px;color:var(--green)"></i> ${nPrep}/${ps.length} preparados</span>
            </div>
            ${ps.length?`<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
              ${ps.map(p=>`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${p.estado_prep==='preparado'?'var(--green-l)':'var(--surface2)'};color:${p.estado_prep==='preparado'?'var(--green)':'var(--text2)'}">
                ${p.orden_carga?p.orden_carga+'. ':''}${p.cliente}${p.ubicacion?' · <strong>'+p.ubicacion+'</strong>':''}
              </span>`).join('')}
            </div>`:''}
          </div>
          <div style="text-align:right;flex-shrink:0;min-width:150px">
            <div style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em">Precio del viaje (cobramos)</div>
            <div style="font-size:17px;font-weight:700;color:var(--green);margin-bottom:7px">${fmtN(portes)} €</div>
            <div style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Lo que nos cobran</div>
            <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
              <input type="number" inputmode="decimal" value="${coste!=null?coste:''}" placeholder="0" style="width:92px;font-size:14px;font-weight:600;border:1px solid var(--border2);border-radius:6px;padding:4px 8px;font-family:'DM Mono',monospace;color:var(--text);background:var(--surface);text-align:right" onchange="guardarCosteHist('${c.id}',this.value)" title="Lo que nos cobra el transportista">
              <span style="font-size:12px;color:var(--text2)">€</span>
            </div>
            ${coste!=null?`<div style="font-size:12px;font-weight:600;margin-top:4px;color:${margen>=0?'var(--green)':'var(--red)'}">Margen ${margen>=0?'+':''}${fmtN(margen)} €</div>`:'<div style="font-size:10px;color:var(--text3);margin-top:4px">pon el coste para ver el margen</div>'}
            <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">
              <button onclick="openPdfModal('${c.id}')" style="background:var(--blue-d);color:#fff;border:none;border-radius:var(--radius-sm);padding:4px 9px;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:3px;font-family:'DM Sans',sans-serif"><i class="ti ti-printer"></i> PDF</button>
              <button onclick="revertirEntrega('${c.id}')" style="background:none;color:#b45309;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:4px 9px;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:3px;font-family:'DM Sans',sans-serif" title="Marcar como no entregada y volver a En ruta"><i class="ti ti-arrow-back-up"></i> No entregada</button>
              <button onclick="eliminarCargaHist('${c.id}')" style="background:none;color:var(--red);border:1px solid var(--red);border-radius:var(--radius-sm);padding:4px 9px;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:3px;font-family:'DM Sans',sans-serif" title="Eliminar esta carga del historial"><i class="ti ti-trash"></i> Borrar</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── EXPORTAR HISTORIAL ────────────────────────────────────────────────────────
function _nombreMes(m){ if(!m)return ''; const[y,mo]=m.split('-'); return (MESES[+mo-1]||mo)+' '+y; }
function _descargarBlob(blob,fname){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=fname; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},100);
}
function _cargarScript(src){
  return new Promise((res,rej)=>{
    if([...document.scripts].some(s=>s.src===src)) return res();
    const s=document.createElement('script'); s.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error('carga')); document.head.appendChild(s);
  });
}
// lista de viajes según el filtro activo del historial
function _historialFiltrado(){
  const selMes=document.getElementById('hist-filter-mes')?.value||'';
  const selTrans=document.getElementById('hist-filter-trans')?.value||'';
  let list=cargas.filter(c=>c.status==='entregada');
  if(selMes) list=list.filter(c=>c.fecha&&String(c.fecha).substring(0,7)===selMes);
  if(selTrans) list=list.filter(c=>String(c.truck_id)===selTrans);
  list=list.sort((a,b)=>new Date(a.fecha||0)-new Date(b.fecha||0));
  return {list, selMes, selTrans};
}

async function exportarHistorialExcel(){
  const {list, selMes}=_historialFiltrado();
  if(!list.length){ log('No hay viajes para exportar con estos filtros','warn'); return; }
  log('Generando Excel...');
  try{
    await _cargarScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    if(typeof ExcelJS==='undefined') throw new Error('ExcelJS');
    await _generarExcelHistorial(list, selMes);
  }catch(e){
    log('No se pudo cargar Excel (¿sin conexión?), descargo CSV','warn');
    _exportarHistorialCSV(list);
  }
}

async function _generarExcelHistorial(list, selMes){
  const AZUL='FF185FA5', CLARO='FFEAF3FB', GRIS='FFD0D7DE';
  const fmtEur='#,##0.00" €"', fmtKg='#,##0';
  const borde=()=>({top:{style:'thin',color:{argb:GRIS}},left:{style:'thin',color:{argb:GRIS}},bottom:{style:'thin',color:{argb:GRIS}},right:{style:'thin',color:{argb:GRIS}}});
  const cabecera=cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:AZUL}};cell.alignment={vertical:'middle',horizontal:'center'};cell.border=borde();};
  const wb=new ExcelJS.Workbook(); wb.creator='Cargas Arisac';

  // ── Hoja "Viajes" ──
  const ws=wb.addWorksheet('Viajes',{views:[{state:'frozen',ySplit:3}]});
  const cols=[['Fecha',12],['Mes',14],['Carga',24],['Código',12],['Transportista',20],['Pedidos',9],['Clientes',44],['Kg',11],['Portes',12],['Coste',12],['Margen',12]];
  ws.columns=cols.map(c=>({width:c[1]}));
  ws.mergeCells(1,1,1,cols.length);
  const tit=ws.getCell(1,1);
  tit.value='Historial de viajes'+(selMes?'   ·   '+_nombreMes(selMes):'');
  tit.font={bold:true,size:14,color:{argb:AZUL}};
  ws.getRow(1).height=22;
  const hr=ws.getRow(3); cols.forEach((c,i)=>hr.getCell(i+1).value=c[0]); hr.eachCell(cabecera); hr.height=18;
  list.forEach(c=>{
    const ps=cargaPs(c.id), t=getTrans(c.truck_id);
    const kg=cargaKg(c.id), portes=cargaPortes(c.id);
    const coste=c.coste!=null?+c.coste:null, margen=coste!=null?portes-coste:null;
    const r=ws.addRow([
      c.fecha?new Date(c.fecha):'', _nombreMes(String(c.fecha||'').substring(0,7)),
      c.name||'', c.codigo_orden||'', t?t.nombre:'', ps.length,
      ps.map(p=>p.cliente).join(', '), kg, portes, coste, margen
    ]);
    r.getCell(1).numFmt='dd/mm/yyyy';
    r.getCell(8).numFmt=fmtKg; [9,10,11].forEach(i=>r.getCell(i).numFmt=fmtEur);
    r.eachCell(cell=>{cell.border=borde();cell.alignment={vertical:'middle'};});
    r.getCell(7).alignment={vertical:'middle',wrapText:true};
  });
  const totKg=list.reduce((s,c)=>s+cargaKg(c.id),0);
  const totP=list.reduce((s,c)=>s+cargaPortes(c.id),0);
  const totC=list.filter(c=>c.coste!=null).reduce((s,c)=>s+(+c.coste),0);
  const tr=ws.addRow(['','','','','TOTAL',list.length,'',totKg,totP,totC,totP-totC]);
  tr.getCell(8).numFmt=fmtKg; [9,10,11].forEach(i=>tr.getCell(i).numFmt=fmtEur);
  tr.eachCell(cell=>{cell.font={bold:true};cell.border=borde();cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:CLARO}};});

  // ── Hoja "Resumen por mes" ──
  const porMes={};
  list.forEach(c=>{
    const m=c.fecha?String(c.fecha).substring(0,7):'(sin fecha)';
    (porMes[m]=porMes[m]||{v:0,kg:0,p:0,co:0}); porMes[m].v++; porMes[m].kg+=cargaKg(c.id); porMes[m].p+=cargaPortes(c.id);
    if(c.coste!=null) porMes[m].co+=+c.coste;
  });
  const ws2=wb.addWorksheet('Resumen por mes');
  ws2.columns=[{width:18},{width:10},{width:12},{width:12},{width:12},{width:12}];
  const h2=ws2.getRow(1); ['Mes','Viajes','Kg','Portes','Coste','Margen'].forEach((h,i)=>h2.getCell(i+1).value=h); h2.eachCell(cabecera); h2.height=18;
  Object.keys(porMes).sort().forEach(m=>{
    const d=porMes[m];
    const r=ws2.addRow([_nombreMes(m)||m,d.v,d.kg,d.p,d.co,d.p-d.co]);
    r.getCell(3).numFmt=fmtKg; [4,5,6].forEach(i=>r.getCell(i).numFmt=fmtEur);
    r.eachCell(cell=>{cell.border=borde();cell.alignment={vertical:'middle'};});
  });

  const buf=await wb.xlsx.writeBuffer();
  const fname='historial_viajes'+(selMes?'_'+selMes:'')+'.xlsx';
  _descargarBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), fname);
  log('Excel generado: '+fname,'ok');
}

function _exportarHistorialCSV(list){
  const rows=[['Fecha','Mes','Carga','Codigo','Transportista','Pedidos','Clientes','Kg','Portes','Coste','Margen']];
  list.forEach(c=>{
    const ps=cargaPs(c.id), t=getTrans(c.truck_id), kg=cargaKg(c.id), portes=cargaPortes(c.id);
    const coste=c.coste!=null?+c.coste:'', margen=coste!==''?portes-coste:'';
    rows.push([fmtDate(c.fecha),_nombreMes(String(c.fecha||'').substring(0,7)),c.name||'',c.codigo_orden||'',t?t.nombre:'',ps.length,ps.map(p=>p.cliente).join('; '),kg,portes,coste,margen]);
  });
  const csv=rows.map(r=>r.map(v=>{const s=String(v??'');return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(';')).join('\n');
  _descargarBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),'historial_viajes.csv');
  log('CSV generado','ok');
}

// ── COPIA DE SEGURIDAD ────────────────────────────────────────────────────────
async function descargarBackup(){
  log('Generando copia de seguridad...');
  try{
    const data=await api('GET','/backup');
    const fecha=new Date().toISOString().substring(0,16).replace(/[:T]/g,'-');
    _descargarBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'backup_cargas_'+fecha+'.json');
    const n=(data.pedidos||[]).length, c=(data.cargas||[]).length;
    try{ localStorage.setItem('ultimaCopia', String(Date.now())); }catch(e){}
    document.getElementById('copia-recordatorio')?.remove();
    log('Copia descargada ('+n+' pedidos, '+c+' cargas)','ok');
  }catch(e){ log('Error generando copia: '+e.message,'warn'); }
}
function triggerRestore(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json'; inp.style.display='none';
  inp.onchange=()=>{ restaurarBackup(inp); setTimeout(()=>inp.remove(),0); };
  document.body.appendChild(inp); inp.click();
}
async function restaurarBackup(input){
  const file=input.files[0]; if(!file) return;
  let data;
  try{ data=JSON.parse(await file.text()); }catch(e){ log('El archivo no es un JSON válido','warn'); return; }
  if(!data.pedidos && !data.cargas){ log('Ese archivo no parece una copia de Cargas','warn'); return; }
  const nPed=(data.pedidos||[]).length, nCar=(data.cargas||[]).length;
  const meta=data._meta&&data._meta.fecha?(' del '+new Date(data._meta.fecha).toLocaleString('es-ES')):'';
  if(!confirm('⚠ RESTAURAR COPIA'+meta+'\n\nEsto BORRARÁ todos los datos actuales y los reemplazará por los de la copia ('+nPed+' pedidos, '+nCar+' cargas).\n\nNo se puede deshacer. ¿Continuar?')) return;
  if(!confirm('Última confirmación: se perderán los datos actuales que no estén en la copia.')) return;
  log('Restaurando copia...');
  try{
    await api('POST','/restore',data);
    await loadAll();
    log('Copia restaurada correctamente','ok');
  }catch(e){ log('Error restaurando: '+e.message,'warn'); }
}

// Copias automáticas guardadas en el servidor
async function verCopiasAuto(){
  let lista;
  try{ lista=await api('GET','/backups'); }catch(e){ log('No se pudieron cargar las copias','warn'); return; }
  const filas = lista.length ? lista.map(b=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
      <div style="font-size:12px"><b>${new Date(b.fecha).toLocaleString('es-ES')}</b> <span style="color:var(--text2)">· ${b.tipo}</span></div>
      <div style="display:flex;gap:6px">
        <button onclick="descargarCopiaAuto('${b.id}')" style="font-size:11px;padding:4px 9px;border:1px solid var(--border2);background:var(--surface);border-radius:6px;cursor:pointer">Descargar</button>
        <button onclick="restaurarCopiaAuto('${b.id}')" style="font-size:11px;padding:4px 9px;border:1px solid #C8860B;background:#fff;color:#7A4E00;border-radius:6px;cursor:pointer">Restaurar</button>
      </div>
    </div>`).join('') : '<div style="text-align:center;color:var(--text2);font-size:12px;padding:16px">Aún no hay copias automáticas. Se crean al arrancar el servidor y cada 24 h.</div>';
  const ov=document.createElement('div');
  ov.id='copias-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.onclick=e=>{ if(e.target===ov) ov.remove(); };
  ov.innerHTML=`<div style="background:var(--surface);border-radius:12px;width:480px;max-width:100%;max-height:80vh;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)"><div style="font-size:15px;font-weight:600">Copias automáticas</div><button onclick="document.getElementById('copias-ov').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3)">×</button></div>
    <div style="padding:16px 18px;overflow-y:auto">${filas}</div>
  </div>`;
  document.body.appendChild(ov);
}
async function descargarCopiaAuto(id){
  try{
    const b=await api('GET','/backups/'+id);
    const f=new Date(b.fecha).toISOString().substring(0,16).replace(/[:T]/g,'-');
    _descargarBlob(new Blob([JSON.stringify(b.datos,null,2)],{type:'application/json'}),'backup_cargas_'+f+'.json');
    log('Copia descargada','ok');
  }catch(e){ log('Error descargando copia','warn'); }
}
async function restaurarCopiaAuto(id){
  if(!confirm('⚠ Restaurar esta copia reemplazará TODOS los datos actuales. ¿Continuar?')) return;
  if(!confirm('Última confirmación: se perderán los datos actuales que no estén en la copia.')) return;
  log('Restaurando copia...');
  try{
    const b=await api('GET','/backups/'+id);
    await api('POST','/restore',b.datos);
    await loadAll();
    document.getElementById('copias-ov')?.remove();
    log('Copia restaurada correctamente','ok');
  }catch(e){ log('Error restaurando: '+e.message,'warn'); }
}

// Revertir una entrega: la carga vuelve a "Planificada" y sus pedidos a "Preparado"
async function revertirEntrega(cid){
  const c=cargas.find(x=>String(x.id)===String(cid));
  if(!c) return;
  if(!confirm('¿Marcar la carga "'+c.name+'" como NO entregada?\nVolverá a "Planificada" y sus pedidos a "Preparado".')) return;
  try{
    await api('PUT','/cargas/'+cid,{...c, status:'planificada'});
    // Devolver explícitamente los pedidos de la carga a 'preparado'
    // (funciona aunque el server no tenga la lógica inversa)
    const peds=pedidos.filter(p=>String(p.carga_id)===String(cid));
    for(const p of peds){
      await api('PATCH','/pedidos/'+p.id+'/prep',{estado_prep:'preparado'});
    }
    await loadAll();
    log('Entrega revertida: "'+c.name+'" vuelve a Planificada','ok');
  }catch(e){ log('Error al revertir: '+e.message,'warn'); }
}

// Eliminar definitivamente una carga del historial (refresca el historial)
async function eliminarCargaHist(cid){
  const c=cargas.find(x=>String(x.id)===String(cid));
  if(!c) return;
  if(!confirm('¿Eliminar la carga "'+c.name+'" del historial?\nSe borra definitivamente. Los pedidos entregados se conservan en el histórico de pedidos.')) return;
  try{
    await api('DELETE','/cargas/'+cid);
    cargas=cargas.filter(x=>String(x.id)!==String(cid));
    pedidos.forEach(p=>{ if(String(p.carga_id)===String(cid)) p.carga_id=null; });
    log('Carga eliminada del historial','ok');
    renderHist(); updateStats();
  }catch(e){ log('Error al eliminar: '+e.message,'warn'); }
}

function log(msg,type=''){
  const el=document.getElementById('sb-msg');
  const icon=type==='ok'?'ti-circle-check':type==='warn'?'ti-alert-triangle':'ti-info-circle';
  el.innerHTML=`<i class="ti ${icon}"></i> ${msg}`;
  el.className='sb-msg'+(type?' '+type:'');
}

// ── CATEGORÍAS ──────────────────────────────────────────────────────────────
const CAT_COLORS=['#334155','#1d6fa4','#2d7a3a','#8a5200','#b91c1c','#5b21b6','#0891b2','#be185d','#065f46','#92400e'];

function renderCats(){
  const el=document.getElementById('cats-list');
  if(!el)return;
  if(!categorias.length){
    el.innerHTML=`<div style="text-align:center;padding:40px;color:var(--text2)"><i class="ti ti-tag" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px"></i>Sin categorías. Crea la primera.</div>`;
    return;
  }
  el.innerHTML=`<div class="list-card">`+categorias.map(c=>{
    const nC=cargas.filter(x=>String(x.categoria_id)===String(c.id)).length;
    const nP=pedidos.filter(x=>String(x.categoria_id)===String(c.id)).length;
    return `<div class="list-row">
      <div style="width:14px;height:14px;border-radius:50%;background:${c.color};flex-shrink:0"></div>
      <div class="list-main">
        <div class="list-name">${c.nombre}</div>
        <div class="list-meta">${nC} carga${nC!==1?'s':''} · ${nP} pedido${nP!==1?'s':''}</div>
      </div>
      <button class="ico" onclick="openCatModal('${c.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
      <button class="ico del" onclick="deleteCat('${c.id}')" title="Eliminar"><i class="ti ti-trash"></i></button>
    </div>`;
  }).join('')+`</div>`;
}

function openCatModal(id){
  const c=id?categorias.find(x=>String(x.id)===String(id)):null;
  document.getElementById('modal-title').innerHTML=`<i class="ti ti-tag"></i> ${id?'Editar':'Nueva'} categoría`;
  document.getElementById('modal-body').innerHTML=
    `<div class="field"><label>Nombre</label><input type="text" id="cat-nombre" value="${c?c.nombre:''}" placeholder="Ej: Urgente, Zona Norte..."></div>`+
    `<div class="field"><label>Color</label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">`+
    CAT_COLORS.map(col=>`<div data-col="${col}" onclick="pickCol(this)" style="width:26px;height:26px;border-radius:50%;background:${col};cursor:pointer;box-sizing:border-box;border:3px solid ${c&&c.color===col?'#fff':'transparent'};box-shadow:${c&&c.color===col?'0 0 0 2px '+col:'none'}"></div>`).join('')+
    `</div><input type="hidden" id="cat-color" value="${c?c.color:CAT_COLORS[0]}"></div>`;
  document.getElementById('modal-foot').innerHTML=
    (id?`<button class="btn-del" style="margin-right:auto" onclick="deleteCat('${id}');closeModal()"><i class="ti ti-trash"></i></button>`:'')+ 
    `<button class="btn-sec" onclick="closeModal()">Cancelar</button>`+
    `<button class="btn-primary" onclick="saveCat('${id||''}')"><i class="ti ti-device-floppy"></i> Guardar</button>`;
  document.getElementById('overlay').classList.add('open');
}

function pickCol(el){
  document.querySelectorAll('[data-col]').forEach(d=>{d.style.border='3px solid transparent';d.style.boxShadow='none';});
  el.style.border='3px solid #fff'; el.style.boxShadow='0 0 0 2px '+el.dataset.col;
  document.getElementById('cat-color').value=el.dataset.col;
}

async function saveCat(id){
  const nombre=document.getElementById('cat-nombre').value.trim();
  const color=document.getElementById('cat-color').value||CAT_COLORS[0];
  if(!nombre){log('Introduce un nombre','warn');return;}
  try{
    if(id){
      const u=await api('PUT','/categorias/'+id,{nombre,color});
      Object.assign(categorias.find(x=>String(x.id)===String(id)),u);
    }else{
      categorias.push(await api('POST','/categorias',{nombre,color}));
    }
    closeModal(); renderCats(); renderCargas(); renderBCList();
    log('Categoría guardada','ok');
  }catch(e){log('Error: '+e.message,'warn');}
}

async function deleteCat(id){
  if(!confirm('¿Eliminar esta categoría?'))return;
  try{
    await api('DELETE','/categorias/'+id);
    categorias=categorias.filter(x=>String(x.id)!==String(id));
    cargas.forEach(c=>{if(String(c.categoria_id)===String(id))c.categoria_id=null;});
    pedidos.forEach(p=>{if(String(p.categoria_id)===String(id))p.categoria_id=null;});
    renderCats(); renderCargas(); renderBCList();
    log('Categoría eliminada');
  }catch(e){log('Error','warn');}
}

// ── PREPARACIÓN DE PEDIDOS ────────────────────────────────────────────────────
let prepLineasCache={};
const nombresPreparadores=()=>preparadoresList.map(p=>p.nombre);
const nombresComerciales=()=>comercialesList.map(c=>c.nombre);

// ── COMERCIALES (gestión) ─────────────────────────────────────────────────────
function abrirGestionComerciales(){
  const ov=document.createElement('div');
  ov.id='gestion-com-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML=`
    <div style="background:var(--surface);border-radius:12px;width:400px;max-width:100%">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border)">
        <div style="font-size:16px;font-weight:600">Comerciales</div>
        <button onclick="document.getElementById('gestion-com-ov').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3)">×</button>
      </div>
      <div style="padding:18px 20px">
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input type="text" id="nuevo-comercial" placeholder="Nombre del comercial" onkeydown="if(event.key==='Enter')addComercial()" style="flex:1;font-size:13px;padding:8px 11px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--text)">
          <button class="btn-primary" onclick="addComercial()"><i class="ti ti-plus"></i></button>
        </div>
        <div id="lista-comerciales"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  renderListaComerciales();
}
function renderListaComerciales(){
  const el=document.getElementById('lista-comerciales');
  if(!el) return;
  if(!comercialesList.length){ el.innerHTML='<div style="text-align:center;color:var(--text2);font-size:12px;padding:16px">No hay comerciales. Añade el primero.</div>'; return; }
  el.innerHTML=comercialesList.map(c=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
      <span style="font-size:13px;font-weight:500"><i class="ti ti-briefcase" style="color:var(--text3);margin-right:6px"></i>${c.nombre}</span>
      <button onclick="delComercial('${c.id}')" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px" title="Eliminar"><i class="ti ti-trash"></i></button>
    </div>`).join('');
}
async function addComercial(){
  const inp=document.getElementById('nuevo-comercial');
  const nombre=(inp?.value||'').trim();
  if(!nombre) return;
  try{ await api('POST','/comerciales',{nombre}); comercialesList=await api('GET','/comerciales'); inp.value=''; renderListaComerciales(); }
  catch(e){ log('Error añadiendo comercial','warn'); }
}
async function delComercial(id){
  try{ await api('DELETE','/comerciales/'+id); comercialesList=await api('GET','/comerciales'); renderListaComerciales(); }
  catch(e){ log('Error eliminando comercial','warn'); }
}
async function asignarComercial(pid,nombre){
  try{
    await api('PATCH','/pedidos/'+pid+'/comercial',{comercial:nombre||null});
    const p=pedidos.find(x=>String(x.id)===String(pid));
    if(p) p.comercial=nombre||null;
    renderPrepList(); renderPreparadosList();
  }catch(e){ log('Error asignando comercial','warn'); }
}

function fillPreparadorFilters(){
  const todos=nombresPreparadores();
  ['prep-filter-preparador','preparados-filter-preparador'].forEach(id=>{
    const sel=document.getElementById(id);
    if(!sel) return;
    const val=sel.value;
    sel.innerHTML='<option value="">Todos los preparadores</option>'+todos.map(n=>`<option value="${n}">${n}</option>`).join('');
    sel.value=val;
  });
}

function limpiarFiltrosPrep(tab){
  document.getElementById(tab+'-search').value='';
  document.getElementById(tab+'-filter-preparador').value='';
  document.getElementById(tab+'-filter-fecha').value='';
  if(tab==='prep') renderPrepList(); else renderPreparadosList();
}

function _esPrep(p){ return p.estado_prep==='preparado'||p.estado_prep==='carga'; }
function filtrarPedidos(estadoFiltro, prefijo){
  const q=(document.getElementById(prefijo+'-search')?.value||'').toLowerCase();
  const fPrep=document.getElementById(prefijo+'-filter-preparador')?.value||'';
  const fFecha=document.getElementById(prefijo+'-filter-fecha')?.value||'';
  return pedidos.filter(p=>{
    if(estadoFiltro==='sin_preparar' && ['preparado','carga','entregado'].includes(p.estado_prep)) return false;
    if(estadoFiltro==='preparado' && p.estado_prep!=='preparado') return false;
    if(q && !((p.cliente||'').toLowerCase().includes(q)||(p.num||'').toLowerCase().includes(q)||(p.destino||'').toLowerCase().includes(q))) return false;
    if(fPrep && p.preparador!==fPrep) return false;
    if(fFecha && (String(p.fecha||'').substring(0,10)!==fFecha)) return false;
    return true;
  });
}

function pedidoRowHTML(p, modo){
  const estado=p.estado_prep;
  const hayFalta=(prepLineasCache[p.id]||[]).some(l=>l.falta>0);
  const badgeEstado = estado==='preparado'
    ? '<span class="badge b-green" style="font-size:10px"><i class="ti ti-check"></i> Preparado</span>'
    : estado==='en_preparacion'
    ? '<span class="badge" style="font-size:10px;background:#E3F0FF;color:#1257A3"><i class="ti ti-progress-check" style="font-size:10px"></i> En preparación</span>'
    : '<span class="badge b-amber" style="font-size:10px">Pendiente</span>';
  return `<div style="border-bottom:1px solid var(--border);${hayFalta?'border-left:4px solid #9A2A1B;background:#FFF1EE':(p.tiene_cambios?'border-left:4px solid #E8920A;background:#FFF9F0':'')}">
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer" onclick="abrirPedidoDetalle('${p.id}')">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600;font-family:monospace;color:var(--blue-d)">${p.num||'—'}</span>
          <span style="font-weight:500">${p.cliente}</span>
          ${badgeEstado}
          ${hayFalta?'<span class="badge" style="font-size:10px;background:#FBE3E0;color:#9A2A1B;font-weight:700"><i class="ti ti-alert-triangle" style="font-size:10px"></i> Faltas</span>':''}
          ${p.tiene_cambios?'<span class="badge" style="font-size:10px;background:#FAEEDA;color:#9A6700"><i class="ti ti-bell" style="font-size:10px"></i> Actualizado</span>':''}
          ${p.comercial?`<span class="badge" style="font-size:10px;background:#EFEAFB;color:#5B3FA8"><i class="ti ti-briefcase" style="font-size:10px"></i> ${p.comercial}</span>`:''}
          ${p.preparador?`<span class="badge" style="font-size:10px;background:#E6F1FB;color:#0C447C"><i class="ti ti-user" style="font-size:10px"></i> ${p.preparador}</span>`:''}
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">
          ${p.destino||'—'}${p.ubicacion?' · <strong style="color:var(--blue-d)">Campa: '+p.ubicacion+'</strong>':''}${p.fecha?' · Entrega: '+fmtDate(p.fecha):''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:2px" onclick="event.stopPropagation()">
        ${modo==='preparados'?`<button onclick="event.stopPropagation();pasarACarga('${p.id}')" style="background:#EAF3DE;border:1px solid #3B6D11;color:#27500A;cursor:pointer;padding:6px 10px;font-size:11px;font-weight:700;border-radius:8px;white-space:nowrap;display:flex;align-items:center;gap:4px"><i class="ti ti-truck-loading"></i> A carga</button>`:''}
        <button title="Ubicación en campa" onclick="event.stopPropagation();editarUbicacion('${p.id}')" style="background:none;border:none;cursor:pointer;color:var(--blue);padding:6px;font-size:17px;line-height:1"><i class="ti ti-map-pin"></i></button>
        <button title="Eliminar pedido" onclick="event.stopPropagation();eliminarPedidoPrep('${p.id}')" style="background:none;border:none;cursor:pointer;color:#c0392b;padding:6px;font-size:17px;line-height:1"><i class="ti ti-trash"></i></button>
        <i class="ti ti-chevron-right" style="color:var(--text3)"></i>
      </div>
    </div>
  </div>`;
}

let cargaLineasCache={};
async function pasarACarga(pid){
  try{
    await api('PATCH','/pedidos/'+pid+'/prep',{estado_prep:'carga'});
    const p=pedidos.find(x=>String(x.id)===String(pid)); if(p)p.estado_prep='carga';
    delete cargaLineasCache[pid];
    log('Pasado a carga','ok');
    renderPreparadosList();
  }catch(e){ log('Error','warn'); }
}
async function cargarCargaList(){
  const el=document.getElementById('carga-list'); if(el) el.innerHTML='<div style="text-align:center;padding:30px;color:var(--text2)"><i class="ti ti-loader"></i> Cargando…</div>';
  const ped=(pedidos||[]).filter(p=>p.estado_prep==='carga');
  for(const p of ped){ if(!cargaLineasCache[p.id]){ try{ cargaLineasCache[p.id]=await api('GET','/pedidos/'+p.id+'/lineas'); }catch(e){ cargaLineasCache[p.id]=[]; } } }
  renderCargaList();
}
function renderCargaList(){
  const el=document.getElementById('carga-list'); if(!el) return;
  const ped=(pedidos||[]).filter(p=>p.estado_prep==='carga').sort((a,b)=>String(a.num||'').localeCompare(String(b.num||''),undefined,{numeric:true}));
  if(!ped.length){ el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)"><i class="ti ti-truck-loading" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px"></i>No hay pedidos en carga. Pásalos desde "Preparados".</div>'; return; }
  el.innerHTML=ped.map(p=>cargaCard(p)).join('');
}
function cargaCard(p){
  const arts=(cargaLineasCache[p.id]||[]);
  const total=arts.length, hechas=arts.filter(l=>l.cargada).length;
  const completo = total>0 && hechas===total;
  const filas=arts.map(l=>{
    const ck=!!l.cargada;
    return `<div onclick="toggleLineaCargada('${p.id}','${l.id}',${ck?'false':'true'})" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid var(--border);cursor:pointer;${ck?'background:var(--prep-ok)':''}">
      <div style="width:30px;height:30px;border-radius:8px;border:2px solid ${ck?'#27500A':'var(--border2)'};background:${ck?'#3B6D11':'transparent'};color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">${ck?'<i class="ti ti-check" style="font-size:18px"></i>':''}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;${ck?'text-decoration:line-through;color:var(--text2)':''}">${(l.descripcion||l.referencia||'—').replace(/</g,'&lt;')}</div>
        ${l.referencia&&l.descripcion?`<div style="font-size:11px;font-family:monospace;color:var(--text3)">${(''+l.referencia).replace(/</g,'&lt;')}</div>`:''}
        ${l.observaciones?`<div style="font-size:12px;color:#8a5a00;margin-top:3px;white-space:normal"><i class="ti ti-message-2" style="font-size:12px"></i> ${(''+l.observaciones).replace(/</g,'&lt;')}</div>`:''}
      </div>
      <div style="font-size:18px;font-weight:800;white-space:nowrap;${ck?'color:var(--text3)':''}">${fmtN(l.cantidad)}${l.embalaje?` <span style="font-size:11px;font-weight:500;color:var(--text2)">${(''+l.embalaje).replace(/</g,'&lt;')}</span>`:''}</div>
    </div>`;
  }).join('');
  return `<div class="list-card" style="margin-bottom:12px;${completo?'border:1px solid #3B6D11':''}">
    <div style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-weight:700;font-family:monospace;color:var(--blue-d)">${p.num||'—'}</span><span style="font-size:16px;font-weight:700">${p.cliente}</span></div>
        ${p.ubicacion?`<div style="display:inline-flex;align-items:center;gap:6px;margin-top:5px;background:#E8F1FB;color:var(--blue-d);font-size:21px;font-weight:800;padding:5px 14px;border-radius:10px;line-height:1.1"><i class="ti ti-map-pin" style="font-size:19px"></i>${(''+p.ubicacion).replace(/</g,'&lt;')}</div>`:''}
        <div style="font-size:12px;color:var(--text2);margin-top:3px">${(p.destino||'').replace(/</g,'&lt;')}</div>
      </div>
      ${completo?'<span class="badge b-green" style="font-size:11px"><i class="ti ti-check"></i> Cargado</span>':`<span style="font-size:14px;font-weight:800;color:var(--text2);white-space:nowrap">${hechas}/${total}</span>`}
    </div>
    ${p.obs?`<div style="margin:0 16px 8px;padding:8px 12px;background:#FFF7E6;border-left:3px solid #E0A100;border-radius:6px;font-size:13px;color:#5a4500;white-space:normal"><i class="ti ti-note"></i> ${(''+p.obs).replace(/</g,'&lt;')}</div>`:''}
    ${filas||'<div style="padding:12px 16px;color:var(--text2);font-size:12px;border-top:1px solid var(--border)">Sin líneas.</div>'}
    <div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
      <button onclick="volverAPreparado('${p.id}')" class="btn-sec" style="font-size:12px;padding:8px 12px"><i class="ti ti-arrow-back-up"></i> Volver a preparados</button>
      <button onclick="marcarCargado('${p.id}')" class="btn-primary" style="font-size:12px;padding:8px 14px;background:${completo?'#0F6E56':'#5a6b7b'}"><i class="ti ti-checks"></i> Ya cargado</button>
    </div>
  </div>`;
}
async function toggleLineaCargada(pid,lid,val){
  const b=(val===true||val==='true');
  try{
    await api('PATCH','/lineas/'+lid+'/cargada',{cargada:b});
    const ls=cargaLineasCache[pid]||[]; const l=ls.find(x=>String(x.id)===String(lid)); if(l)l.cargada=b;
    renderCargaList();
  }catch(e){ log('Error','warn'); }
}
async function volverAPreparado(pid){
  try{
    const up=await api('PATCH','/pedidos/'+pid+'/prep',{estado_prep:'preparado'});
    const p=pedidos.find(x=>String(x.id)===String(pid)); if(p)p.estado_prep=(up&&up.estado_prep)||'preparado';
    if(p&&p.estado_prep==='carga'){ log('Sigue en una carga: para volver a preparados, quítalo de la carga','warn'); }
    else log('Devuelto a preparados','ok');
    renderCargaList();
  }catch(e){ log('Error','warn'); }
}
async function marcarCargado(pid){
  if(!confirm('¿Marcar este pedido como cargado? Saldrá de la lista de carga.')) return;
  try{
    await api('PATCH','/pedidos/'+pid+'/prep',{estado_prep:'entregado'});
    const p=pedidos.find(x=>String(x.id)===String(pid)); if(p)p.estado_prep='entregado';
    log('Pedido cargado','ok'); renderCargaList();
  }catch(e){ log('Error','warn'); }
}
async function marcarCargadoReparto(pid){
  if(!confirm('¿Marcar este pedido como cargado? Saldrá de "En carga" y pasará al histórico.')) return;
  try{
    await api('PATCH','/pedidos/'+pid+'/prep',{estado_prep:'entregado'});
    const p=pedidos.find(x=>String(x.id)===String(pid)); if(p)p.estado_prep='entregado';
    log('Pedido cargado','ok');
    if(typeof renderCargas==='function') renderCargas();
    if(typeof renderCargaList==='function') renderCargaList();
  }catch(e){ log('Error','warn'); }
}
async function cargarHistPed(){ try{ pedidos=await api('GET','/pedidos'); }catch(e){} renderHistPed(); }
function renderHistPed(){
  const el=document.getElementById('histped-list'); if(!el) return;
  const ent=(pedidos||[]).filter(p=>p.estado_prep==='entregado');
  if(!ent.length){ el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)"><i class="ti ti-history" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px"></i>Aún no hay pedidos entregados.</div>'; return; }
  const dias={};
  ent.forEach(p=>{ const d=p.entregado_at?_fechaISO(p.entregado_at):(p.fecha?_fechaISO(p.fecha):'—'); (dias[d]=dias[d]||[]).push(p); });
  const orden=Object.keys(dias).sort((a,b)=>b.localeCompare(a));
  el.innerHTML=orden.map(d=>{
    const ps=dias[d].sort((a,b)=>String(a.num||'').localeCompare(String(b.num||''),undefined,{numeric:true}));
    const totalKg=ps.reduce((s,p)=>s+(Number(p.kg)||0),0);
    const cards=ps.map(p=>{
      const carga=(cargas||[]).find(c=>String(c.id)===String(p.carga_id));
      const tr=carga?(transportistas||[]).find(t=>String(t.id)===String(carga.truck_id)):null;
      const matriculas=carga?[carga.mat_camion,carga.mat_remolque].filter(Boolean).join(' / '):'';
      const info=[tr?tr.nombre:'', matriculas].filter(Boolean).join(' · ');
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px">
         <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
           <span style="font-size:14px;font-weight:700"><span style="font-family:monospace;color:var(--blue-d)">${p.num||'—'}</span> · ${(p.cliente||'').replace(/</g,'&lt;')}</span>
           ${p.kg?`<span style="font-size:12px;color:var(--text2);white-space:nowrap">${fmtN(p.kg)} kg</span>`:''}</div>
         <div style="font-size:11px;color:var(--text2);margin-top:3px">${(p.destino||'').replace(/</g,'&lt;')}${info?(' · '+info.replace(/</g,'&lt;')):''}</div></div>`;
    }).join('');
    return `<div style="margin-bottom:16px"><div style="font-size:14px;font-weight:800;margin-bottom:8px">${d==='—'?'Sin fecha':fmtDate(d)} <span style="font-size:12px;color:var(--text2);font-weight:500">· ${ps.length} pedido(s)${totalKg?(' · '+fmtN(totalKg)+' kg'):''}</span></div>${cards}</div>`;
  }).join('');
}
function renderPrepList(){
  const el=document.getElementById('prep-list');
  if(!el) return;
  let lista=filtrarPedidos('sin_preparar','prep');
  const sort=document.getElementById('prep-sort')?.value||'num';
  if(sort==='fecha') lista.sort((a,b)=>(String(a.fecha||'9999')).localeCompare(String(b.fecha||'9999')));
  else lista.sort((a,b)=>String(a.num||'').localeCompare(String(b.num||''),undefined,{numeric:true}));
  if(!lista.length){
    el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)"><i class="ti ti-clipboard-off" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px"></i>No hay pedidos pendientes. Importa un PDF para empezar.</div>';
    return;
  }
  el.innerHTML='<div class="list-card">'+lista.map(p=>pedidoRowHTML(p,'prep')).join('')+'</div>';
}

function renderPreparadosList(){
  const el=document.getElementById('preparados-list');
  if(!el) return;
  let lista=filtrarPedidos('preparado','preparados');
  const sortP=document.getElementById('preparados-sort')?.value||'num';
  if(sortP==='fecha') lista.sort((a,b)=>(String(a.fecha||'9999')).localeCompare(String(b.fecha||'9999')));
  else lista.sort((a,b)=>String(a.num||'').localeCompare(String(b.num||''),undefined,{numeric:true}));
  if(!lista.length){
    el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)"><i class="ti ti-package-off" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px"></i>No hay pedidos preparados todavía.</div>';
    return;
  }
  el.innerHTML='<div class="list-card">'+lista.map(p=>pedidoRowHTML(p,'preparados')).join('')+'</div>';
}

// Editar ubicación en campa desde la lista de preparación
async function editarUbicacion(pid){
  const p=pedidos.find(x=>String(x.id)===String(pid));
  if(!p) return;
  const val=prompt('Ubicación en campa para '+(p.num||p.cliente)+':', p.ubicacion||'');
  if(val===null) return; // cancelado
  const nueva=val.trim()||null;
  try{
    await api('PUT','/pedidos/'+pid,{...p, ubicacion: nueva});
    await loadAll();
    const cell=document.getElementById('ubic-campa-'+pid); // si el detalle está abierto
    if(cell) cell.textContent = nueva || '—';
    log('Ubicación actualizada','ok');
  }catch(e){ log('Error guardando ubicación: '+e.message,'warn'); }
}

// Eliminar pedido desde la lista de preparación
async function eliminarPedidoPrep(pid){
  const p=pedidos.find(x=>String(x.id)===String(pid));
  if(!p) return;
  if(!confirm('¿Eliminar el pedido '+(p.num||'')+' — '+p.cliente+'?\nEsta acción no se puede deshacer.')) return;
  try{
    await api('DELETE','/pedidos/'+pid);
    await loadAll();
    log('Pedido eliminado','ok');
  }catch(e){ log('Error eliminando pedido: '+e.message,'warn'); }
}

// Vista detalle de un pedido (pantalla completa modal)
async function abrirPedidoDetalle(pid){
  const p=pedidos.find(x=>String(x.id)===String(pid));
  if(!p) return;
  let lineas=[];
  try{ lineas=await api('GET','/pedidos/'+pid+'/lineas'); }catch(e){}
  prepLineasCache[pid]=lineas;

  const todosPrep=nombresPreparadores();
  const med=(p.medidas||'').split(/x/i).map(s=>s.trim());
  const medL=med[0]||'', medA=med[1]||'', medH=med[2]||'';
  const cambiosBanner = (p.tiene_cambios && p.cambios) ? `<div id="cambios-banner-${p.id}" style="background:#FAEEDA;border:1px solid #F0C77E;border-radius:8px;padding:10px 14px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="font-size:12px;font-weight:700;color:#7A4E00;display:flex;align-items:center;gap:6px"><i class="ti ti-bell-ringing"></i> Actualizado desde PDF — revisa los cambios</div>
      <button onclick="marcarCambiosVistos('${p.id}')" style="font-size:11px;padding:4px 10px;border:1px solid #C8860B;background:#fff;color:#7A4E00;border-radius:6px;cursor:pointer;white-space:nowrap">Marcar como visto</button>
    </div>
    <pre style="margin:8px 0 0;font-family:inherit;font-size:12px;color:#5b4300;white-space:pre-wrap;word-break:break-word">${(p.cambios||'').replace(/</g,'&lt;')}</pre>
  </div>` : '';

  const ov=document.createElement('div');
  ov.id='pedido-detalle-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:30px 16px';
  ov.addEventListener('click', e=>{ if(e.target===ov) cerrarPedidoDetalle(); });
  ov.innerHTML=`
    <div style="background:var(--surface);border-radius:12px;width:680px;max-width:100%;margin:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:18px 22px;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:18px;font-weight:700;font-family:monospace;color:var(--blue-d)">${p.num||'Sin número'}</div>
          <div style="font-size:14px;font-weight:600;margin-top:2px">${p.cliente}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:3px">${p.destino||'—'}</div>
        </div>
        <button onclick="cerrarPedidoDetalle()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3);line-height:1">×</button>
      </div>
      <div style="padding:18px 22px">
        ${cambiosBanner}
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
          <button onclick="triggerReimportPDF('${pid}')" style="font-size:12px;padding:6px 12px;border:1px solid var(--blue);background:var(--blue-l);color:var(--blue-d);border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:5px"><i class="ti ti-file-import"></i> Actualizar desde PDF</button>
          <input type="file" id="reimport-pdf-${pid}" accept=".pdf" style="display:none" onchange="reimportarPDF('${pid}',this)">
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px">
          <div><div style="font-size:10px;color:var(--text2);text-transform:uppercase">Ubicación campa</div><button onclick="editarUbicacion('${p.id}')" style="font-size:14px;font-weight:600;color:var(--blue-d);background:none;border:none;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:5px"><span id="ubic-campa-${p.id}">${p.ubicacion||'—'}</span> <i class="ti ti-pencil" style="font-size:12px;color:var(--blue)"></i></button></div>
          <div><div style="font-size:10px;color:var(--text2);text-transform:uppercase">Fecha entrega</div><div style="font-size:14px;font-weight:600">${p.fecha?fmtDate(p.fecha):'—'}</div></div>
          <div style="flex:1;min-width:160px">
            <div style="font-size:10px;color:var(--text2);text-transform:uppercase">Preparador</div>
            <select onchange="asignarPreparador('${pid}',this.value)" style="font-size:13px;padding:5px 9px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--text);margin-top:2px;width:100%">
              <option value="">Sin asignar</option>
              ${todosPrep.map(n=>`<option value="${n}" ${p.preparador===n?'selected':''}>${n}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;min-width:160px">
            <div style="font-size:10px;color:var(--text2);text-transform:uppercase"><i class="ti ti-briefcase" style="font-size:11px"></i> Comercial (pasó el pedido)</div>
            <select onchange="asignarComercial('${pid}',this.value)" style="font-size:13px;padding:5px 9px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--text);margin-top:2px;width:100%">
              <option value="">Sin asignar</option>
              ${nombresComerciales().map(n=>`<option value="${n}" ${p.comercial===n?'selected':''}>${n}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="detalle-lineas-${pid}"></div>

        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
          <label style="display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;cursor:pointer">
            <input type="checkbox" id="agencia-${p.id}" ${p.es_agencia?'checked':''} onchange="toggleAgencia('${p.id}',this.checked)" style="width:18px;height:18px;cursor:pointer">
            <i class="ti ti-truck-delivery" style="color:var(--blue)"></i> Envío por agencia
          </label>
          <div id="medidas-box-${p.id}" style="margin-top:12px;${p.es_agencia?'':'display:none'}">
            <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px">Medidas</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <div><div style="font-size:10px;color:var(--text2);margin-bottom:2px">Largo (cm)</div><input type="number" min="0" id="med-largo-${p.id}" value="${medL}" placeholder="Largo" onchange="guardarMedidas('${p.id}')" style="width:90px;font-size:13px;padding:6px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--text)"></div>
              <div><div style="font-size:10px;color:var(--text2);margin-bottom:2px">Ancho (cm)</div><input type="number" min="0" id="med-ancho-${p.id}" value="${medA}" placeholder="Ancho" onchange="guardarMedidas('${p.id}')" style="width:90px;font-size:13px;padding:6px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--text)"></div>
              <div><div style="font-size:10px;color:var(--text2);margin-bottom:2px">Alto (cm)</div><input type="number" min="0" id="med-alto-${p.id}" value="${medH}" placeholder="Alto" onchange="guardarMedidas('${p.id}')" style="width:90px;font-size:13px;padding:6px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--text)"></div>
            </div>
          </div>
          <div style="margin-top:18px">
            <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px">Observación para el carretillero</div>
            <textarea id="obsprep-${p.id}" onchange="guardarObsPrep('${p.id}',this.value)" placeholder="Notas de preparación / carga…" style="width:100%;min-height:64px;font-size:13px;padding:8px 10px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--text);resize:vertical">${(p.obs_prep||'').replace(/</g,'&lt;')}</textarea>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  renderDetalleLineas(pid);
}

function cerrarPedidoDetalle(){
  document.getElementById('pedido-detalle-ov')?.remove();
  renderPrepList();
  renderPreparadosList();
}

function renderDetalleLineas(pid){
  const cont=document.getElementById('detalle-lineas-'+pid);
  const lineas=prepLineasCache[pid]||[];
  if(!cont) return;
  if(!lineas.length){
    cont.innerHTML='<div style="padding:14px;color:var(--text2);font-size:12px;font-style:italic;text-align:center">Este pedido no tiene líneas.</div>';
    return;
  }
  const nPrep=lineas.filter(l=>l.preparada).length;
  const pct=Math.round(nPrep/lineas.length*100);
  const totKg=lineas.reduce((s,l)=>s+(Number(l.kgs)||0),0);
  const esBigBag=l=>/^BB/i.test(l.referencia||'')||/\bbb\b/i.test(l.descripcion||'');
  const embOf=l=>{const m=String(l.embalaje||'').match(/(\d+)\s*([A-Za-zÁ-ú]+)?/);return m?{n:parseInt(m[1]),u:(m[2]||'PALET').toUpperCase()}:{n:0,u:''};};
  const etiquetaEmb=l=>{const {u}=embOf(l);if(u.startsWith('PAQ'))return 'paq.';if(u.startsWith('CAJA'))return 'caja';return esBigBag(l)?'big bag':'europ.';};
  let euro=0,bb=0,paq=0,caja=0;
  lineas.forEach(l=>{const {n,u}=embOf(l);if(!n)return;if(u.startsWith('PAQ'))paq+=n;else if(u.startsWith('CAJA'))caja+=n;else if(esBigBag(l))bb+=n;else euro+=n;});
  const cards=[['Palets europeos',euro||'—'],['Big bags',bb||'—']];
  if(paq)cards.push(['Paquetes',paq]);
  if(caja)cards.push(['Cajas',caja]);
  cards.push(['Total kg',totKg?fmtN(totKg):'—']);
  cont.innerHTML=`
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      ${cards.map(([lbl,val])=>`<div style="flex:1;min-width:84px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;text-align:center"><div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em">${lbl}</div><div style="font-size:19px;font-weight:700;color:var(--blue-d)">${val}</div></div>`).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${pct===100?'#0F6E56':'#185FA5'};transition:width .2s"></div>
      </div>
      <span style="font-size:12px;font-weight:600;color:${pct===100?'#0F6E56':'var(--text2)'}">${nPrep}/${lineas.length}</span>
    </div>
    <button onclick="abrirModoPrep('${pid}')" style="width:100%;margin-bottom:12px;background:${pct===100?'#0F6E56':'#0F6E56'};color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;font-family:'DM Sans',sans-serif"><i class="ti ti-checklist" style="font-size:18px"></i> ${pct===100?'Revisar preparación':'Modo preparación'}</button>
    ${lineas.some(l=>l.falta>0)?`<div style="background:#FBE3E0;border:1px solid #E8A599;color:#9A2A1B;border-radius:10px;padding:10px 13px;margin-bottom:12px;font-size:13px;font-weight:700"><i class="ti ti-alert-triangle"></i> Este pedido tiene faltas: ${lineas.filter(l=>l.falta>0).length} artículo(s)</div>`:''}
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:var(--surface2);border-bottom:1px solid var(--border)">
        <th style="width:40px;padding:8px"></th>
        <th style="text-align:left;padding:8px;font-size:10px;color:var(--text2)">REFERENCIA</th>
        <th style="text-align:left;padding:8px;font-size:10px;color:var(--text2)">DESCRIPCIÓN</th>
        <th style="text-align:right;padding:8px;font-size:10px;color:var(--text2)">CANT.</th>
        <th style="text-align:left;padding:8px;font-size:10px;color:var(--text2);width:160px">OBSERVACIONES</th>
      </tr></thead>
      <tbody>
        ${lineas.map(l=>`<tr onclick="toggleLineaPrep('${pid}','${l.id}',${l.preparada?'false':'true'})" style="border-bottom:1px solid var(--border);cursor:pointer;${l.preparada?'opacity:.5':''}${l.falta>0?'background:#FFF1EE;':''}">
          <td style="text-align:center;padding:8px;${l.falta>0?'border-left:3px solid #9A2A1B':''}"><input type="checkbox" ${l.preparada?'checked':''} onclick="event.stopPropagation()" onchange="toggleLineaPrep('${pid}','${l.id}',this.checked)" style="width:22px;height:22px;cursor:pointer"></td>
          <td style="padding:8px;font-family:monospace;font-weight:600;color:var(--blue-d);${l.preparada?'text-decoration:line-through':''}">${l.referencia||'—'}</td>
          <td style="padding:8px;${l.preparada?'text-decoration:line-through':''}">${l.descripcion||'—'}${l.falta>0?` <span style="background:#FBE3E0;color:#9A2A1B;border-radius:8px;padding:1px 7px;font-size:10px;font-weight:700;white-space:nowrap">⚠ Faltan ${fmtN(l.falta)}</span>`:''} <button onclick="event.stopPropagation();marcarFalta('${pid}','${l.id}')" style="background:${l.falta>0?'#9A2A1B':'none'};border:1px solid ${l.falta>0?'#9A2A1B':'var(--border2)'};color:${l.falta>0?'#fff':'var(--text2)'};border-radius:6px;padding:1px 7px;font-size:10px;font-weight:${l.falta>0?'700':'400'};cursor:pointer;white-space:nowrap">${l.falta>0?'✓ Falta':'Falta'}</button>${l.falta>0?` <button onclick="event.stopPropagation();enviarFaltaASacos('${l.id}')" style="background:#FBE7D2;border:1px solid #7A4E00;color:#7A4E00;border-radius:6px;padding:1px 7px;font-size:10px;cursor:pointer;white-space:nowrap">A prod. sacos</button>`:''}</td>
          <td style="padding:8px;text-align:right;font-weight:600;white-space:nowrap">${fmtN(l.cantidad)}<div style="margin-top:3px;display:flex;align-items:center;justify-content:flex-end;gap:3px"><input type="number" min="0" value="${(String(l.embalaje||'').match(/\d+/)||[''])[0]}" onchange="guardarPalets('${pid}','${l.id}',this.value)" onclick="event.stopPropagation()" style="width:44px;font-size:11px;padding:2px 4px;text-align:right;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"><span style="font-size:9px;color:var(--text2);white-space:nowrap">${etiquetaEmb(l)}</span></div>${l.kgs?`<div style="font-size:10px;color:var(--text3);font-weight:400">${fmtN(l.kgs)} kg</div>`:''}</td>
          <td style="padding:4px 8px">
            <input type="text" value="${(l.observaciones||'').replace(/"/g,'&quot;')}" placeholder="—" onclick="event.stopPropagation()" onchange="guardarObsLinea('${pid}','${l.id}',this.value)" style="width:100%;font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)">
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

async function guardarObsLinea(pid,lid,valor){
  try{
    await api('PATCH','/lineas/'+lid+'/obs',{observaciones:valor});
    const lineas=prepLineasCache[pid]||[];
    const l=lineas.find(x=>String(x.id)===String(lid));
    if(l) l.observaciones=valor;
  }catch(e){ log('Error guardando observación','warn'); }
}

async function asignarPreparador(pid,nombre){
  try{
    await api('PATCH','/pedidos/'+pid+'/preparador',{preparador:nombre});
    const p=pedidos.find(x=>String(x.id)===String(pid));
    if(p) p.preparador=nombre;
    fillPreparadorFilters();
  }catch(e){ log('Error asignando preparador','warn'); }
}

// Cambiar el nº de palets de una línea
async function guardarPalets(pid,lid,val){
  const n=parseInt(val);
  const lineas=prepLineasCache[pid]||[];
  const l=lineas.find(x=>String(x.id)===String(lid));
  const unidad=(String(l?.embalaje||'').match(/[A-Za-zÁ-ú\.]+/)||['PALET'])[0]; // conserva PALET / PAQ. / CAJA
  const embalaje=(n&&n>0)?(n+' '+unidad):null;
  try{
    await api('PATCH','/lineas/'+lid+'/embalaje',{embalaje});
    if(l) l.embalaje=embalaje;
    renderDetalleLineas(pid); // recalcula los totales
  }catch(e){ log('Error guardando palets','warn'); }
}

// Lee las 3 medidas del formulario y las une como "L x A x Al"
function _medidasActuales(pid){
  const g=k=>document.getElementById(k+'-'+pid);
  const l=(g('med-largo')?.value||'').trim(), a=(g('med-ancho')?.value||'').trim(), h=(g('med-alto')?.value||'').trim();
  return (l||a||h)?[l,a,h].join(' x '):null;
}

async function _guardarAgencia(pid){
  const esAg=document.getElementById('agencia-'+pid)?.checked||false;
  const medidas=_medidasActuales(pid);
  await api('PATCH','/pedidos/'+pid+'/agencia',{es_agencia:esAg, medidas});
  const p=pedidos.find(x=>String(x.id)===String(pid));
  if(p){ p.es_agencia=esAg; p.medidas=medidas; }
}

async function toggleAgencia(pid,checked){
  const box=document.getElementById('medidas-box-'+pid);
  if(box) box.style.display=checked?'':'none';
  try{ await _guardarAgencia(pid); }
  catch(e){ log('Error guardando agencia','warn'); }
}

async function guardarMedidas(pid){
  try{ await _guardarAgencia(pid); }
  catch(e){ log('Error guardando medidas','warn'); }
}

// Observación global del pedido (notas del carretillero)
async function guardarObsPrep(pid,val){
  try{
    await api('PATCH','/pedidos/'+pid+'/obs_prep',{obs_prep:val.trim()||null});
    const p=pedidos.find(x=>String(x.id)===String(pid));
    if(p) p.obs_prep=val.trim()||null;
  }catch(e){ log('Error guardando observación','warn'); }
}

async function toggleLineaPrep(pid,lid,checked){
  try{
    await api('PATCH','/lineas/'+lid+'/prep',{preparada:checked});
    const lineas=prepLineasCache[pid]||[];
    const l=lineas.find(x=>String(x.id)===String(lid));
    if(l) l.preparada=checked;
    renderDetalleLineas(pid);
    const total=lineas.length;
    const nPrep=lineas.filter(x=>x.preparada).length;
    const target = (total>0 && nPrep===total) ? 'preparado' : (nPrep>0 ? 'en_preparacion' : 'sin_preparar');
    const p=pedidos.find(x=>String(x.id)===String(pid));
    if(p && p.estado_prep!=='entregado' && p.estado_prep!==target){
      const up=await api('PATCH','/pedidos/'+pid+'/prep',{estado_prep:target});
      p.estado_prep=(up&&up.estado_prep)||target;
      if(p.estado_prep==='preparado') log('Pedido '+(p.num||'')+' preparado','ok');
      else if(p.estado_prep==='carga') log('Pedido '+(p.num||'')+' preparado → pasa a carga','ok');
    }
  }catch(e){ log('Error: '+e.message,'warn'); }
}

// ── MODO PREPARACIÓN A PANTALLA COMPLETA ──────────────────────────────────────
let modoPrep=null;
async function abrirModoPrep(pid){
  let lineas=prepLineasCache[pid];
  if(!lineas){ try{ lineas=await api('GET','/pedidos/'+pid+'/lineas'); prepLineasCache[pid]=lineas; }catch(e){ lineas=[]; } }
  if(!lineas||!lineas.length){ log('Este pedido no tiene líneas','warn'); return; }
  const i=lineas.findIndex(l=>!l.preparada);
  modoPrep={pid, lineas, idx:i<0?0:i};
  let ov=document.getElementById('modo-prep-ov');
  if(!ov){ ov=document.createElement('div'); ov.id='modo-prep-ov'; ov.style.cssText="position:fixed;inset:0;z-index:10060;background:var(--surface);display:flex;flex-direction:column;font-family:'DM Sans',sans-serif"; document.body.appendChild(ov); }
  renderModoPrep();
}
function _embInfo(l){
  const esBB=/^BB/i.test(l.referencia||'')||/\bbb\b/i.test(l.descripcion||'');
  const m=String(l.embalaje||'').match(/(\d+)\s*([A-Za-zÁ-ú]+)?/);
  if(!m) return {n:0,u:'',txt:'',esBB};
  const n=parseInt(m[1]), u=(m[2]||'PALET').toUpperCase();
  let txt;
  if(u.startsWith('PAQ')) txt=n+' paquete'+(n>1?'s':'');
  else if(u.startsWith('CAJA')) txt=n+(n>1?' cajas':' caja');
  else txt=n+(esBB?(' big bag'+(n>1?'s':'')):(' palet'+(n>1?'s':'')));
  return {n,u,txt,esBB};
}
function renderModoPrep(){
  const m=modoPrep, ov=document.getElementById('modo-prep-ov'); if(!m||!ov) return;
  const p=pedidos.find(x=>String(x.id)===String(m.pid))||{};
  const total=m.lineas.length, nPrep=m.lineas.filter(l=>l.preparada).length;
  const pct=total?Math.round(nPrep/total*100):0;
  const cab=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
      <button onclick="cerrarModoPrep()" style="background:none;border:none;font-size:15px;color:var(--text2);cursor:pointer;display:flex;align-items:center;gap:3px"><i class="ti ti-chevron-left" style="font-size:22px"></i> Salir</button>
      <div style="text-align:center"><div style="font-size:14px;font-weight:700">${p.num||''}</div><div style="font-size:11px;color:var(--text2)">${p.cliente||''}${p.ubicacion?' · '+p.ubicacion:''}</div></div>
      <div style="font-size:14px;font-weight:700;color:${pct===100?'#0F6E56':'var(--blue-d)'}">${nPrep}/${total}</div>
    </div><div style="height:6px;background:var(--border);flex-shrink:0"><div style="height:100%;width:${pct}%;background:${pct===100?'#0F6E56':'#185FA5'};transition:width .25s"></div></div>`;

  const tarjetas=m.lineas.map(l=>{
    const e=_embInfo(l);
    const tag=e.txt?`<span style="background:${e.esBB?'#EFEAFB':'#E6F1FB'};color:${e.esBB?'#5B3FA8':'#0C447C'};border-radius:14px;padding:3px 12px;font-size:13px;font-weight:700;white-space:nowrap">${e.txt}</span>`:'';
    const palVal=(String(l.embalaje||'').match(/\d+/)||[''])[0];
    const unidad=e.u.startsWith('PAQ')?'paq.':(e.u.startsWith('CAJA')?'caja':(e.esBB?'big bag':'europ.'));
    return `<div style="border:1px solid ${l.preparada?'#BFE3D4':'var(--border)'};background:${l.preparada?'#F1FAF6':'var(--surface)'};border-radius:12px;padding:12px;margin-bottom:10px">
      <div style="display:flex;gap:12px;align-items:flex-start;cursor:pointer" onclick="prepToggle('${l.id}')">
        <div style="width:30px;height:30px;border-radius:50%;border:2px solid ${l.preparada?'#0F6E56':'var(--border2)'};background:${l.preparada?'#0F6E56':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">${l.preparada?'<i class="ti ti-check" style="color:#fff;font-size:18px"></i>':''}</div>
        <div style="flex:1;min-width:0">
          <div style="font-family:monospace;font-size:12px;color:var(--blue-d);font-weight:700">${l.referencia||''}</div>
          <div style="font-size:16px;font-weight:700;line-height:1.25;${l.preparada?'text-decoration:line-through;color:var(--text2)':''}">${(l.descripcion||'').replace(/</g,'&lt;')}</div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px">
            <span style="font-size:20px;font-weight:800">${fmtN(l.cantidad)}<span style="font-size:12px;font-weight:600;color:var(--text2)"> uds</span></span>
            ${tag}
            ${l.kgs?`<span style="font-size:12px;color:var(--text3)">${fmtN(l.kgs)} kg</span>`:''}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
        <div style="display:flex;align-items:center;gap:5px">
          <input type="number" min="0" value="${palVal}" onclick="event.stopPropagation()" onchange="prepPalets('${l.id}',this.value)" style="width:48px;font-size:14px;padding:5px;text-align:center;border:1px solid var(--border2);border-radius:6px;background:var(--surface);color:var(--text)">
          <span style="font-size:11px;color:var(--text2);white-space:nowrap">${unidad}</span>
        </div>
        <input type="text" value="${(l.observaciones||'').replace(/"/g,'&quot;')}" placeholder="✎ Nota / cambio…" onclick="event.stopPropagation()" onchange="prepObs('${l.id}',this.value)" style="flex:1;min-width:120px;font-size:13px;padding:7px 9px;border:1px solid ${l.observaciones?'#F0C77E':'var(--border2)'};background:${l.observaciones?'#FFFBF2':'var(--surface)'};border-radius:6px;color:var(--text)">
        <button onclick="event.stopPropagation();marcarFalta('${m.pid}','${l.id}')" style="background:${l.falta>0?'#FBE3E0':'var(--surface)'};border:1px solid ${l.falta>0?'#E8A599':'var(--border2)'};color:#9A2A1B;border-radius:6px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap"><i class="ti ti-alert-triangle"></i> ${l.falta>0?('Faltan '+fmtN(l.falta)):'Falta'}</button>
        ${l.falta>0?`<button onclick="event.stopPropagation();enviarFaltaASacos('${l.id}')" style="background:#FBE7D2;border:1px solid #7A4E00;color:#7A4E00;border-radius:6px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap"><i class="ti ti-package"></i> A prod. sacos</button>`:''}
      </div>
    </div>`;
  }).join('');

  const footer = nPrep>=total
    ? `<div style="flex-shrink:0;padding:13px 16px;border-top:1px solid var(--border);background:#F1FAF6;display:flex;align-items:center;justify-content:space-between;gap:10px">
         <div style="font-size:14px;font-weight:700;color:#0F6E56"><i class="ti ti-circle-check"></i> Todo preparado (${total})</div>
         <button onclick="cerrarModoPrep()" style="background:#0F6E56;color:#fff;border:none;border-radius:10px;padding:11px 22px;font-size:15px;font-weight:700;cursor:pointer">Hecho</button>
       </div>`
    : `<div style="flex-shrink:0;padding:11px 16px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px">
         <span style="font-size:13px;color:var(--text2)">Faltan ${total-nPrep} de ${total}</span>
         <button onclick="cerrarModoPrep()" style="background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:9px 20px;font-size:14px;cursor:pointer">Cerrar</button>
       </div>`;

  ov.innerHTML=cab+`<div style="flex:1;overflow-y:auto;padding:14px 14px 4px">${tarjetas}</div>`+footer;
}
async function prepToggle(lid){
  const m=modoPrep; if(!m) return;
  const l=m.lineas.find(x=>String(x.id)===String(lid)); if(!l) return;
  await toggleLineaPrep(m.pid, lid, !l.preparada);
  renderModoPrep();
}
async function prepObs(lid,val){
  const m=modoPrep; if(!m) return;
  await guardarObsLinea(m.pid, lid, val);   // guarda la nota y actualiza la caché
}
async function prepPalets(lid,val){
  const m=modoPrep; if(!m) return;
  await guardarPalets(m.pid, lid, val);     // no re-render: conserva el foco del input
}
function cerrarModoPrep(){
  const ov=document.getElementById('modo-prep-ov'); if(ov) ov.remove();
  const pid=modoPrep?modoPrep.pid:null; modoPrep=null;
  if(pid) renderDetalleLineas(pid);
  renderPrepList(); renderPreparadosList();
}

// ── FALTAS / COMPRAS ──────────────────────────────────────────────────────────
async function marcarFalta(pid,lid){
  const lineas=prepLineasCache[pid]||[];
  const l=lineas.find(x=>String(x.id)===String(lid));
  const actual=(l&&l.falta)?l.falta:'';
  const val=prompt('¿Cuántas unidades faltan de este artículo?\n(0 o vacío = no falta nada)', actual);
  if(val===null) return;
  const n=Math.max(0, parseInt(val)||0);
  try{
    await api('PATCH','/lineas/'+lid+'/falta',{falta:n});
    if(l) l.falta=n;
    renderDetalleLineas(pid);
    if(modoPrep && String(modoPrep.pid)===String(pid)) renderModoPrep();
    actualizarFaltasBadge();
    log(n>0?('Marcado: faltan '+n+' uds'):'Falta quitada','ok');
  }catch(e){ log('Error marcando falta','warn'); }
}
async function actualizarFaltasBadge(){
  try{ const f=await api('GET','/faltas'); actualizarBadgeCompras(f.length); }catch(e){}
}
async function resolverFalta(lid){
  try{
    await api('PATCH','/lineas/'+lid+'/falta',{falta:0});
    for(const pid in prepLineasCache){ const l=prepLineasCache[pid].find(x=>String(x.id)===String(lid)); if(l) l.falta=0; }
    renderCompras();
  }catch(e){ log('Error','warn'); }
}
function actualizarBadgeCompras(n){
  const b=document.getElementById('compras-badge'); if(!b) return;
  b.textContent=n; b.style.display=n>0?'inline-block':'none';
}
// ── COMPRAS: planner (subpestañas, formulario, calendario) ───────────────────
let comprasData=[], comprasFaltas=[], comprasSub='porpedir', ccalMode='mes', ccalRef=new Date();
const _inp='width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:3px;box-sizing:border-box';
let _compraLineasForm=[];
function _h(v){ return (v==null?'':String(v)).replace(/"/g,'&quot;'); }
function _hoyISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function _fechaISO(f){ return (''+(f||'')).substring(0,10); }
function _esHoyC(f){ return _fechaISO(f)===_hoyISO(); }
function _esPasadoC(f){ return f && _fechaISO(f)<_hoyISO(); }
function _isoOf(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function _inicioSemana(d){ const x=new Date(d); const g=(x.getDay()+6)%7; x.setDate(x.getDate()-g); x.setHours(0,0,0,0); return x; }

async function renderCompras(){
  const el=document.getElementById('compras-content'); if(!el) return;
  el.innerHTML='<div style="padding:14px;color:var(--text2);font-size:12px">Cargando…</div>';
  try{ comprasData=await api('GET','/compras'); comprasFaltas=await api('GET','/faltas'); }
  catch(e){ el.innerHTML='<div class="empty-state"><i class="ti ti-alert-circle"></i>No se pudo cargar</div>'; return; }
  if(!silosData.length){ try{ silosData=await api('GET','/silos'); }catch(e){} }
  const usadas=new Set();
  comprasData.forEach(c=>(c.lineas||[]).forEach(l=>{ if(l.falta_linea_id) usadas.add(String(l.falta_linea_id)); }));
  comprasFaltas=comprasFaltas.filter(f=>!usadas.has(String(f.linea_id)));
  const nporpedir=comprasFaltas.length + comprasData.filter(c=>c.estado==='por_pedir').length;
  const b=document.getElementById('csub-badge'); if(b){ b.textContent=nporpedir; b.style.display=nporpedir>0?'inline-block':'none'; }
  actualizarBadgeCompras(nporpedir);
  renderComprasSub();
}
function setComprasSub(s){
  comprasSub=s;
  document.querySelectorAll('#compras-subtabs .csub').forEach(e=>e.classList.toggle('active', e.dataset.sub===s));
  const f=document.getElementById('compras-filtros'); if(f) f.style.display=(s==='calendario')?'none':'flex';
  renderComprasSub();
}
function renderComprasSub(){
  const el=document.getElementById('compras-content'); if(!el) return;
  if(comprasSub==='porpedir') return renderComprasPorPedir(el);
  if(comprasSub==='pedidos') return renderComprasPedidos(el);
  if(comprasSub==='calendario') return renderComprasCalendario(el);
  if(comprasSub==='historial') return renderComprasHistorial(el);
}
function _comprasFiltradas(lista){
  const q=(document.getElementById('compras-buscar')?.value||'').toLowerCase();
  const prov=(document.getElementById('compras-prov')?.value||'').toLowerCase();
  return lista.filter(c=>{
    if(prov && !(c.proveedor||'').toLowerCase().includes(prov)) return false;
    if(q){ const txt=((c.proveedor||'')+' '+(c.pedidos_rel||'')+' '+(c.notas||'')+' '+(c.lineas||[]).map(l=>(l.descripcion||'')+' '+(l.referencia||'')).join(' ')).toLowerCase(); if(!txt.includes(q)) return false; }
    return true;
  });
}
function _telBtn(c){
  if(!c.transportista_tel) return '';
  return `<a href="tel:${(''+c.transportista_tel).replace(/[^0-9+]/g,'')}" onclick="event.stopPropagation()" style="background:#E6F1FB;color:#0C447C;border-radius:6px;padding:6px 11px;font-size:12px;text-decoration:none;white-space:nowrap"><i class="ti ti-phone"></i> ${(c.transportista||'Llamar').replace(/</g,'&lt;')}</a>`;
}
function _compraCard(c, acciones){
  const lineas=(c.lineas||[]).map(l=>`<div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:3px 0"><span>${(l.descripcion||l.referencia||'—').replace(/</g,'&lt;')}</span><span style="color:var(--text2);white-space:nowrap">${fmtN(l.cantidad)} ${(l.unidad||'').replace(/</g,'&lt;')}</span></div>`).join('');
  const eta=c.fecha_prevista?fmtDate(c.fecha_prevista):'sin fecha';
  const hoy=_esHoyC(c.fecha_prevista), tarde=c.estado==='pedido'&&_esPasadoC(c.fecha_prevista);
  return `<div class="list-card" style="margin-bottom:12px;${hoy?'border-color:#0F6E56;':tarde?'border-color:#E8A599;':''}">
    <div class="lc-hdr"><span><b>${(c.proveedor||'Sin proveedor').replace(/</g,'&lt;')}</b>${c.tolva?` · <span style="color:var(--text2)">tolva ${(''+c.tolva).replace(/</g,'&lt;')}</span>`:''} ${(b=>`<span style="font-size:10px;font-weight:700;border-radius:6px;padding:2px 7px;background:${b[0]};color:${b[1]}">${b[2]}</span>`)(_formatoBadge(c))}</span>
      <span style="font-size:11px;${hoy?'color:#0F6E56;font-weight:700':tarde?'color:#9A2A1B;font-weight:700':'color:var(--text2)'}">${hoy?'LLEGA HOY':tarde?'RETRASADO · '+eta:eta}</span></div>
    <div style="padding:8px 16px">${lineas||'<span style="font-size:12px;color:var(--text3)">Sin materiales</span>'}</div>
    ${c.pedidos_rel?`<div style="padding:0 16px 6px;font-size:11px;color:var(--text2)"><i class="ti ti-link"></i> Para pedido(s): ${(''+c.pedidos_rel).replace(/</g,'&lt;')}</div>`:''}
    ${c.notas?`<div style="padding:0 16px 6px;font-size:12px;color:var(--text2)">${c.notas.replace(/</g,'&lt;')}</div>`:''}
    <div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 16px;border-top:1px solid var(--border)">${_telBtn(c)}${acciones}</div></div>`;
}
function renderComprasPorPedir(el){
  let html='';
  const fq=(document.getElementById('compras-buscar')?.value||'').toLowerCase();
  const faltas=comprasFaltas.filter(f=>!fq || ((f.descripcion||'')+' '+(f.referencia||'')+' '+(f.pedido_num||'')).toLowerCase().includes(fq));
  if(faltas.length){
    html+=`<div style="font-size:12px;font-weight:600;color:#9A2A1B;margin:4px 0 8px"><i class="ti ti-alert-triangle"></i> Faltas marcadas en preparación</div>`;
    html+=faltas.map(f=>`<div class="list-card" style="margin-bottom:8px"><div style="display:flex;align-items:center;gap:10px;padding:10px 16px">
      <div style="flex:1;min-width:0"><div style="font-family:monospace;font-size:11px;color:var(--blue-d)">${(f.referencia||'').replace(/</g,'&lt;')}</div>
        <div style="font-size:13px">${(f.descripcion||'').replace(/</g,'&lt;')}</div>
        <div style="font-size:11px;color:var(--text2)">Pedido ${(f.pedido_num||'').replace?(''+f.pedido_num).replace(/</g,'&lt;'):f.pedido_num} · ${(f.cliente||'').replace(/</g,'&lt;')}</div></div>
      <div style="text-align:center;background:#FBE3E0;color:#9A2A1B;border-radius:8px;padding:4px 10px"><div style="font-size:16px;font-weight:800;line-height:1">${fmtN(f.falta)}</div><div style="font-size:9px">faltan</div></div>
      <div style="display:flex;flex-direction:column;gap:5px">
        <button class="btn-primary" onclick="comprarFalta('${f.linea_id}')" style="font-size:11px;padding:7px 11px;white-space:nowrap"><i class="ti ti-shopping-cart-plus"></i> Comprar</button>
        <button onclick="enviarFaltaASacos('${f.linea_id}')" style="font-size:11px;padding:7px 11px;white-space:nowrap;border:1px solid #7A4E00;background:#FBE7D2;color:#7A4E00;border-radius:8px;cursor:pointer"><i class="ti ti-package"></i> A prod. sacos</button>
        <button onclick="quitarFaltaCompras('${f.linea_id}')" style="font-size:11px;padding:7px 11px;white-space:nowrap;border:1px solid var(--border2);background:var(--surface);color:#9A2A1B;border-radius:8px;cursor:pointer"><i class="ti ti-trash"></i> Quitar falta</button>
      </div>
    </div></div>`).join('');
  }
  const cps=_comprasFiltradas(comprasData.filter(c=>c.estado==='por_pedir'));
  if(cps.length){
    html+=`<div style="font-size:12px;font-weight:600;color:var(--text2);margin:14px 0 8px">Pedidos de compra sin enviar / sin fecha</div>`;
    html+=cps.map(c=>_compraCard(c,`<button class="btn-sec" onclick="abrirFormCompra(${c.id})" style="font-size:11px;padding:6px 10px"><i class="ti ti-edit"></i> Editar</button>
       <button class="btn-primary" onclick="cambiarEstadoCompra(${c.id},'pedido')" style="font-size:11px;padding:6px 10px"><i class="ti ti-send"></i> Marcar pedido</button>
       <button class="btn-sec" onclick="borrarCompra(${c.id})" style="font-size:11px;padding:6px 10px;color:#9A2A1B"><i class="ti ti-trash"></i></button>`)).join('');
  }
  el.innerHTML = html || '<div class="empty-state"><i class="ti ti-circle-check"></i>Nada por pedir</div>';
}
function renderComprasPedidos(el){
  const cps=_comprasFiltradas(comprasData.filter(c=>c.estado==='pedido')).sort((a,b)=>(''+(a.fecha_prevista||'9999')).localeCompare(''+(b.fecha_prevista||'9999')));
  if(!cps.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-truck"></i>No hay pedidos de compra en camino</div>'; return; }
  el.innerHTML=cps.map(c=>_compraCard(c,`<button class="btn-sec" onclick="abrirFormCompra(${c.id})" style="font-size:11px;padding:6px 10px"><i class="ti ti-edit"></i> Editar</button>
     <button class="btn-primary" onclick="cambiarEstadoCompra(${c.id},'recibido')" style="font-size:11px;padding:6px 10px;background:#0F6E56"><i class="ti ti-package-import"></i> Recibido</button>
     <button class="btn-sec" onclick="cambiarEstadoCompra(${c.id},'por_pedir')" style="font-size:11px;padding:6px 10px" title="Volver a por pedir">↺</button>`)).join('');
}
function renderComprasHistorial(el){
  const cps=_comprasFiltradas(comprasData.filter(c=>c.estado==='recibido')).sort((a,b)=>(''+(b.fecha_recibido||'')).localeCompare(''+(a.fecha_recibido||'')));
  const head=`<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn-sec" onclick="exportarComprasExcel()" style="font-size:11px;padding:6px 11px"><i class="ti ti-file-spreadsheet"></i> Exportar Excel</button></div>`;
  if(!cps.length){ el.innerHTML=head+'<div class="empty-state"><i class="ti ti-history"></i>Sin compras recibidas</div>'; return; }
  el.innerHTML=head+cps.map(c=>{
    const lineas=(c.lineas||[]).map(l=>`<div style="display:flex;justify-content:space-between;font-size:13px;padding:2px 0"><span>${(l.descripcion||l.referencia||'').replace(/</g,'&lt;')}</span><span style="color:var(--text2)">${fmtN(l.cantidad)} ${(l.unidad||'').replace(/</g,'&lt;')}</span></div>`).join('');
    return `<div class="list-card" style="margin-bottom:10px;opacity:.92"><div class="lc-hdr"><span><b>${(c.proveedor||'—').replace(/</g,'&lt;')}</b></span><span style="font-size:11px;color:#0F6E56"><i class="ti ti-check"></i> Recibido ${c.fecha_recibido?fmtDate(c.fecha_recibido):''}</span></div>
      <div style="padding:8px 16px">${lineas}</div>
      <div style="padding:6px 16px;border-top:1px solid var(--border)"><button class="btn-sec" onclick="cambiarEstadoCompra(${c.id},'pedido')" style="font-size:11px;padding:5px 10px">↺ Reabrir</button> <button class="btn-sec" onclick="borrarCompra(${c.id})" style="font-size:11px;padding:5px 10px;color:#9A2A1B"><i class="ti ti-trash"></i></button></div></div>`;
  }).join('');
}
// ── Calendario de compras ──
function renderComprasCalendario(el){
  const cps=comprasData.filter(c=>c.fecha_prevista && c.estado!=='recibido');
  const porDia={}; cps.forEach(c=>{ const k=_fechaISO(c.fecha_prevista); (porDia[k]=porDia[k]||[]).push(c); });
  const tab=(m,t)=>`<button onclick="setCalMode('${m}')" style="font-size:11px;padding:6px 12px;border:1px solid var(--border);border-radius:7px;cursor:pointer;${ccalMode===m?'background:var(--blue);color:#fff;border-color:var(--blue)':'background:var(--surface);color:var(--text)'}">${t}</button>`;
  const nav=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap">
     <div style="display:flex;gap:4px">${tab('mes','Mes')}${tab('semana','Semana')}${tab('dia','Día')}</div>
     <div style="display:flex;align-items:center;gap:6px">
       <button class="btn-sec" onclick="calNav(-1)" style="font-size:14px;padding:4px 11px">‹</button>
       <span style="font-size:13px;font-weight:600;min-width:130px;text-align:center">${_calTitulo()}</span>
       <button class="btn-sec" onclick="calNav(1)" style="font-size:14px;padding:4px 11px">›</button>
       <button class="btn-sec" onclick="calHoy()" style="font-size:11px;padding:5px 10px">Hoy</button></div></div>`;
  let body = ccalMode==='mes'?_calMes(porDia):ccalMode==='semana'?_calSemana(porDia):_calDia(porDia);
  el.innerHTML=nav+body;
}
function _calRefresh(){ if(_activeView==='prodcal'){ const el=document.getElementById('prodcal-content'); if(el) renderComprasCalendario(el); } else renderComprasSub(); }
function setCalMode(m){ ccalMode=m; _calRefresh(); }
function calNav(d){ if(ccalMode==='mes') ccalRef.setMonth(ccalRef.getMonth()+d); else if(ccalMode==='semana') ccalRef.setDate(ccalRef.getDate()+7*d); else ccalRef.setDate(ccalRef.getDate()+d); ccalRef=new Date(ccalRef); _calRefresh(); }
function calHoy(){ ccalRef=new Date(); _calRefresh(); }
// ── Arrastre de eventos del calendario entre días (táctil + ratón) ──
let _cdrag=null;
function _cellUnder(x,y){ const el=document.elementFromPoint(x,y); return el?el.closest('[data-iso]'):null; }
function calChipDown(ev,tipo,id){
  if(ev.button!=null && ev.button!==0) return;
  const startX=ev.clientX, startY=ev.clientY, target=ev.currentTarget;
  _cdrag={tipo,id:String(id),startX,startY,moved:false,clone:null,cell:null,target};
  const move=(e)=>{
    if(!_cdrag) return;
    const x=e.clientX, y=e.clientY;
    if(!_cdrag.moved && (Math.abs(x-startX)>6||Math.abs(y-startY)>6)){
      _cdrag.moved=true;
      const cl=target.cloneNode(true);
      cl.style.cssText+=';position:fixed;z-index:99999;pointer-events:none;opacity:.9;width:'+target.offsetWidth+'px;box-shadow:0 6px 18px rgba(0,0,0,.25)';
      document.body.appendChild(cl); _cdrag.clone=cl; target.style.opacity='.35';
    }
    if(_cdrag.moved){
      e.preventDefault();
      if(_cdrag.clone){ _cdrag.clone.style.left=(x-22)+'px'; _cdrag.clone.style.top=(y-14)+'px'; }
      const cell=_cellUnder(x,y);
      if(_cdrag.cell&&_cdrag.cell!==cell) _cdrag.cell.classList.remove('cal-drop-hi');
      if(cell) cell.classList.add('cal-drop-hi');
      _cdrag.cell=cell;
    }
  };
  const up=(e)=>{
    document.removeEventListener('pointermove',move,true);
    document.removeEventListener('pointerup',up,true);
    const d=_cdrag; _cdrag=null;
    if(d.clone) d.clone.remove();
    if(d.target) d.target.style.opacity='';
    if(d.cell) d.cell.classList.remove('cal-drop-hi');
    if(!d.moved){ if(d.tipo==='compra') abrirFormCompra(Number(d.id)); return; }
    const x=(e.clientX!=null?e.clientX:d.startX), y=(e.clientY!=null?e.clientY:d.startY);
    const cell=_cellUnder(x,y); if(!cell) return;
    const iso=cell.getAttribute('data-iso'); if(!iso) return;
    if(d.tipo==='carga') _moverCargaDia(d.id,iso); else _moverCompraDia(d.id,iso);
  };
  document.addEventListener('pointermove',move,true);
  document.addEventListener('pointerup',up,true);
}
async function _moverCargaDia(id,iso){
  const c=cargas.find(x=>String(x.id)===String(id)); if(!c) return;
  if(String(c.fecha||'').substring(0,10)===iso) return;
  try{ await api('PUT','/cargas/'+id,{...c,fecha:iso}); c.fecha=iso; renderCal(); log('Carga movida a '+fmtDate(iso),'ok'); }
  catch(e){ log('Error moviendo carga','warn'); renderCal(); }
}
async function _moverCompraDia(id,iso){
  const c=comprasData.find(x=>String(x.id)===String(id)); if(!c) return;
  if(_fechaISO(c.fecha_prevista)===iso) return;
  try{ await api('PUT','/compras/'+id,{...c,fecha_prevista:iso}); c.fecha_prevista=iso; _calRefresh(); log('Compra movida a '+fmtDate(iso),'ok'); }
  catch(e){ log('Error moviendo compra','warn'); _calRefresh(); }
}
function _calTitulo(){
  if(ccalMode==='mes') return MESES[ccalRef.getMonth()]+' '+ccalRef.getFullYear();
  if(ccalMode==='dia') return ccalRef.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  const ini=_inicioSemana(ccalRef); const fin=new Date(ini); fin.setDate(ini.getDate()+6);
  return ini.getDate()+' '+MESES[ini.getMonth()].slice(0,3)+' – '+fin.getDate()+' '+MESES[fin.getMonth()].slice(0,3);
}
function _chipDia(items){ return items.map(c=>{ const t=(c.lineas||[]).map(l=>l.descripcion||l.referencia).filter(Boolean).join(', ')||'compra';
  return `<div onpointerdown="calChipDown(event,'compra','${c.id}')" style="background:${c.estado==='pedido'?'#E6F1FB':'#FFF3E6'};color:${c.estado==='pedido'?'#0C447C':'#7A4E00'};border-radius:5px;padding:2px 5px;font-size:10px;margin-bottom:2px;cursor:grab;touch-action:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${((c.proveedor||'—')+': '+t).replace(/</g,'&lt;')}</div>`; }).join(''); }
function _calMes(porDia){
  const y=ccalRef.getFullYear(), m=ccalRef.getMonth(); const ini=_inicioSemana(new Date(y,m,1)); const hoy=_hoyISO();
  let dias='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';
  ['L','M','X','J','V','S','D'].forEach(d=>dias+=`<div style="text-align:center;font-size:10px;color:var(--text2);font-weight:600">${d}</div>`);
  const cur=new Date(ini);
  for(let i=0;i<42;i++){ const iso=_isoOf(cur); const items=porDia[iso]||[]; const otroMes=cur.getMonth()!==m; const esHoy=iso===hoy;
    dias+=`<div data-iso="${iso}" style="min-height:62px;border:1px solid ${esHoy?'#0F6E56':'var(--border)'};border-radius:6px;padding:3px;background:${esHoy?'#F1FAF6':otroMes?'var(--surface2)':'var(--surface)'};opacity:${otroMes?'.45':'1'}"><div style="font-size:10px;color:${esHoy?'#0F6E56':'var(--text2)'};font-weight:${esHoy?'700':'400'};margin-bottom:2px">${cur.getDate()}</div>${_chipDia(items)}</div>`;
    cur.setDate(cur.getDate()+1); }
  return dias+'</div>';
}
function _calItemRow(c){ const t=(c.lineas||[]).map(l=>(l.descripcion||l.referencia||'')+' ('+fmtN(l.cantidad)+' '+(l.unidad||'')+')').join(', ');
  return `<div onpointerdown="calChipDown(event,'compra','${c.id}')" style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);cursor:grab;touch-action:none"><span style="font-size:13px"><b>${(c.proveedor||'—').replace(/</g,'&lt;')}</b> — ${t.replace(/</g,'&lt;')}</span><span style="font-size:11px;color:var(--text2);white-space:nowrap">${c.estado==='pedido'?'en camino':'por pedir'}</span></div>`; }
function _calSemana(porDia){ const ini=_inicioSemana(ccalRef); const hoy=_hoyISO(); let html='';
  for(let i=0;i<7;i++){ const d=new Date(ini); d.setDate(ini.getDate()+i); const iso=_isoOf(d); const items=porDia[iso]||[]; const esHoy=iso===hoy;
    html+=`<div class="list-card" data-iso="${iso}" style="margin-bottom:6px;${esHoy?'border-color:#0F6E56':''}"><div style="padding:8px 14px;font-size:12px;font-weight:600;${esHoy?'color:#0F6E56':''}">${d.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'short'})}${esHoy?' · HOY':''}</div><div style="padding:0 14px 10px">${items.length?items.map(_calItemRow).join(''):'<span style="font-size:12px;color:var(--text3)">—</span>'}</div></div>`; }
  return html;
}
function _calDia(porDia){ const iso=_isoOf(ccalRef); const items=porDia[iso]||[];
  return `<div class="list-card"><div style="padding:0 14px">${items.length?items.map(_calItemRow).join(''):'<div class="empty-state" style="padding:24px"><i class="ti ti-calendar-off"></i>Nada llega este día</div>'}</div></div>`; }
// ── Formulario de pedido de compra ──
// deja el material base quitando envase/formato/tamaño ("Big Bag Blanca 0-2 500" → "Blanca 0-2")
function _materialBase(desc){
  let s=' '+(desc||'')+' ';
  s=s.replace(/\b(big\s*bags?|bigbags?|b\.?b\.?|sacos?|palets?|pal[eé]s?|envases?|granel)\b/gi,' ');
  s=s.replace(/\b\d+(?:[.,]\d+)?\s*kg\b/gi,' ');
  s=s.replace(/(?<![\d-])(?:500|675|735|900|1000|15|20|25)(?![\d-])/g,' ');
  s=s.replace(/\s{2,}/g,' ').trim();
  return s || (desc||'').trim();
}
function comprarFalta(lid){
  const f=comprasFaltas.find(x=>String(x.linea_id)===String(lid)); if(!f) return;
  abrirFormCompra(null,{ tipo_produccion:(/\bsacos?\b/i.test(f.descripcion||'')?'saco':'bb'), pedidos_rel:f.pedido_num||'',
    notas:'Para: '+(f.descripcion||'')+(f.cliente?(' · '+f.cliente):''),
    lineas:[{referencia:f.referencia||'', descripcion:_materialBase(f.descripcion), cantidad:f.falta||0, unidad:'', falta_linea_id:f.linea_id}] });
}
async function quitarFaltaCompras(lid){
  if(!confirm('¿Quitar esta falta? Dejará de aparecer como pendiente de comprar.')) return;
  try{ await resolverFalta(lid); log('Falta quitada','ok'); }catch(e){ log('Error','warn'); }
}
let prepResumenData=[], _prepArtGrupos=[], _prepArtAbierto=-1;
async function cargarPrepResumen(){
  const el=document.getElementById('porart-content'); if(el) el.innerHTML='<div class="empty-state"><i class="ti ti-loader"></i>Cargando…</div>';
  try{ prepResumenData=await api('GET','/preparacion-pendiente'); }catch(e){ prepResumenData=[]; }
  _prepArtAbierto=-1; renderPrepResumen();
}
function _artKey(l){ return ((l.referencia||'').trim()||(l.descripcion||'').trim().toLowerCase()); }
function renderPrepResumen(){
  const el=document.getElementById('porart-content'); if(!el) return;
  const grupos={};
  (prepResumenData||[]).forEach(l=>{
    const k=_artKey(l); if(!k) return;
    if(!grupos[k]) grupos[k]={ key:k, referencia:l.referencia||'', descripcion:l.descripcion||'', embalaje:l.embalaje||'', total:0, pedidos:[] };
    grupos[k].total += Number(l.cantidad)||0;
    grupos[k].pedidos.push(l);
    if(!grupos[k].descripcion && l.descripcion) grupos[k].descripcion=l.descripcion;
  });
  const arr=Object.values(grupos).sort((a,b)=>(''+(a.descripcion||a.referencia)).localeCompare(''+(b.descripcion||b.referencia)));
  _prepArtGrupos=arr;
  if(!arr.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-checks"></i>Todo preparado · no hay artículos pendientes</div>'; return; }
  const totalUds=arr.reduce((s,g)=>s+g.total,0);
  let html=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:13px"><b>${arr.length}</b> artículos pendientes · <b>${fmtN(totalUds)}</b> unidades en total</div>`;
  html+=arr.map((g,i)=>{
    const abierto=_prepArtAbierto===i;
    const det=abierto?`<div style="border-top:1px solid var(--border);padding:6px 14px">${g.pedidos.map(p=>`<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span><b style="font-family:monospace;color:var(--blue-d)">${(p.pedido_num||'—')}</b> · ${(p.cliente||'').replace(/</g,'&lt;')}</span><span style="font-weight:700;white-space:nowrap">${fmtN(p.cantidad)}${p.embalaje?(' '+(''+p.embalaje).replace(/</g,'&lt;')):''}</span></div>`).join('')}</div>`:'';
    return `<div class="list-card" style="margin-bottom:8px">
       <div onclick="togglePrepArt(${i})" style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer">
         <div style="flex:1;min-width:0">
           ${g.referencia?`<div style="font-family:monospace;font-size:11px;color:var(--blue-d)">${g.referencia.replace(/</g,'&lt;')}</div>`:''}
           <div style="font-size:14px;font-weight:600">${(g.descripcion||g.referencia||'—').replace(/</g,'&lt;')}</div>
           <div style="font-size:11px;color:var(--text2)">${g.pedidos.length} pedido(s) · toca para ver</div></div>
         <div style="text-align:center;background:#FFF3E6;color:#7A4E00;border-radius:8px;padding:4px 12px"><div style="font-size:18px;font-weight:800;line-height:1">${fmtN(g.total)}</div><div style="font-size:9px">uds</div></div>
         <i class="ti ti-chevron-${abierto?'up':'down'}" style="color:var(--text3)"></i></div>
       ${det}
       <div style="padding:8px 14px;border-top:1px solid var(--border)"><button onclick="enviarArtACompras(${i})" class="btn-sec" style="font-size:12px;padding:8px 12px;color:#0C447C;border-color:#0C447C"><i class="ti ti-shopping-cart-plus"></i> Enviar a compras</button></div>
     </div>`;
  }).join('');
  el.innerHTML=html;
}
function togglePrepArt(i){ _prepArtAbierto=(_prepArtAbierto===i)?-1:i; renderPrepResumen(); }
function enviarArtACompras(i){
  const g=_prepArtGrupos[i]; if(!g) return;
  const peds=[...new Set(g.pedidos.map(p=>p.pedido_num).filter(Boolean))].join(', ');
  abrirFormCompra(null,{ tipo_produccion:(/\bsacos?\b/i.test(g.descripcion||g.referencia||'')?'saco':'bb'), pedidos_rel:peds,
    notas:'Para: '+(g.descripcion||g.referencia||''),
    lineas:[{ referencia:g.referencia||'', descripcion:_materialBase(g.descripcion||g.referencia||''), cantidad:g.total, unidad:'' }] });
}
let _faltaSacosInfo=null;
function _faltaInfo(lid){
  const f=comprasFaltas.find(x=>String(x.linea_id)===String(lid));
  if(f) return {lid, referencia:f.referencia||'', descripcion:f.descripcion||'', falta:f.falta||0, pedido_num:f.pedido_num||'', cliente:f.cliente||''};
  for(const pid in (prepLineasCache||{})){
    const l=(prepLineasCache[pid]||[]).find(x=>String(x.id)===String(lid));
    if(l){ const ped=(typeof pedidos!=='undefined'?pedidos:[]).find(x=>String(x.id)===String(pid))||{}; return {lid, referencia:l.referencia||'', descripcion:l.descripcion||'', falta:l.falta||0, pedido_num:ped.num||'', cliente:ped.cliente||''}; }
  }
  return {lid, referencia:'', descripcion:'', falta:0, pedido_num:'', cliente:''};
}
function enviarFaltaASacos(lid){
  const info=_faltaInfo(lid); _faltaSacosInfo=info;
  const ov=document.createElement('div'); ov.id='fs-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10070;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const opts=matPrimas.filter(m=>m.activo!==false).map(m=>`<option value="${(m.nombre||'').replace(/"/g,'&quot;')}">`).join('');
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:460px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Enviar a Producción Sacos</b>
    ${info.cliente?`<div style="background:#0C447C;color:#fff;border-radius:8px;padding:6px 11px;margin:8px 0 4px;font-size:14px;font-weight:800"><i class="ti ti-user" style="font-size:13px"></i> ${(''+info.cliente).replace(/</g,'&lt;')}</div>`:''}
    <div style="font-size:12px;color:var(--text2);margin:2px 0 12px">${(info.descripcion||'').replace(/</g,'&lt;')}${info.pedido_num?(' · pedido '+(''+info.pedido_num).replace(/</g,'&lt;')):''}</div>
    <label style="font-size:12px;color:var(--text2);display:block">Material<input id="fs-mat" list="fs-mat-list" placeholder="Materia prima…" value="${(info.descripcion||'').replace(/"/g,'&quot;')}" style="${inp}"><datalist id="fs-mat-list">${opts}</datalist></label>
    <div style="display:flex;gap:10px;margin-top:10px">
      <label style="font-size:12px;color:var(--text2);flex:1">Nº de sacos<input id="fs-uni" type="number" min="0" value="${info.falta||''}" style="${inp}"></label>
      <label style="font-size:12px;color:var(--text2);flex:1">Kg por saco<input id="fs-kgu" type="number" min="0" value="${_lastKgU.saco!=null?_lastKgU.saco:''}" style="${inp}"></label></div>
    <div style="font-size:11px;color:var(--text2);margin-top:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px"><i class="ti ti-info-circle"></i> Se crea la tarea en Producción Sacos y también un aviso en Compras (Por pedir).</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('fs-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarFaltaASacos()" style="font-size:13px;padding:10px 18px;background:#7A4E00"><i class="ti ti-package"></i> Crear tarea</button></div>
  </div>`;
  document.body.appendChild(ov);
}
async function confirmarFaltaASacos(){
  const info=_faltaSacosInfo; if(!info) return;
  const lid=info.lid;
  const nombre=(document.getElementById('fs-mat').value||'').trim();
  const uni=Number(document.getElementById('fs-uni').value)||0;
  const kgu=Number(document.getElementById('fs-kgu').value)||0;
  if(kgu) _lastKgU.saco=kgu;
  let mp=matPrimas.find(m=>(m.nombre||'').toLowerCase()===nombre.toLowerCase());
  if(!mp && nombre){ try{ mp=await api('POST','/materias-primas',{nombre}); await cargarMatPrimas(false); }catch(e){} }
  try{
    await api('POST','/producciones',{ tipo:'saco', mp_id:mp?mp.id:null, unidades:uni, kg_unidad:kgu, cliente:info.cliente||null, notas:(info.descripcion||'')+(info.pedido_num?(' · pedido '+info.pedido_num):'') });
    // avisar también a Compras: queda en "Por pedir" enlazado a la falta (la falta sigue marcada en el pedido)
    await api('POST','/compras',{ estado:'por_pedir', pedidos_rel:info.pedido_num||null, tipo_produccion:'saco', notas:'También en Producción Sacos'+(info.cliente?(' · '+info.cliente):''),
      lineas:[{ referencia:info.referencia||'', descripcion:info.descripcion||'', cantidad:info.falta||uni, unidad:'', falta_linea_id:lid }] });
    document.getElementById('fs-ov')?.remove();
    try{ renderCompras(); }catch(e){}
    if(document.getElementById('modo-prep-ov')) renderModoPrep();
    actualizarFaltasBadge();
    log('Enviado a Producción Sacos y avisado a Compras · '+uni+' saco(s)','ok');
  }catch(e){ log('Error: '+e.message,'warn'); }
}
let _compraFormId=null, _compraAutoTimer=null, _compraSaving=false;
function abrirFormCompra(id, prefill){
  let c = id ? comprasData.find(x=>String(x.id)===String(id)) : null;
  c = c || prefill || {};
  _compraFormId = id || null;
  _compraEdit = c;
  _compraLineasForm = (c.lineas&&c.lineas.length)?c.lineas.map(l=>({...l})):[{referencia:'',descripcion:'',cantidad:'',unidad:'',falta_linea_id:null}];
  const ov=document.createElement('div'); ov.id='compra-form-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10050;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click', e=>{ if(e.target===ov) cerrarFormCompra(); });
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:620px;max-height:92vh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">${id?'Editar pedido de compra':'Nuevo pedido de compra'}</b><button onclick="cerrarFormCompra()" style="background:none;border:none;font-size:24px;color:var(--text2);cursor:pointer">×</button></div>
    <div style="flex:1;overflow-y:auto;padding:16px"><input type="hidden" id="cf-id" value="${id||''}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label style="font-size:12px;color:var(--text2)">Proveedor<input id="cf-prov" value="${_h(c.proveedor)}" onchange="autoCompra()" style="${_inp}"></label>
        <label style="font-size:12px;color:var(--text2)">Fecha prevista de llegada<input id="cf-fecha" type="date" value="${_fechaISO(c.fecha_prevista)}" onchange="autoCompra()" style="${_inp}"></label>
        <label style="font-size:12px;color:var(--text2)">Hora prevista (opcional)<input id="cf-hora" type="time" value="${c.hora||''}" onchange="autoCompra()" style="${_inp}"></label>
        <label style="font-size:12px;color:var(--text2)">Estado<select id="cf-estado" onchange="autoCompra()" style="${_inp}">
          <option value="por_pedir"${(c.estado||'por_pedir')==='por_pedir'?' selected':''}>Por pedir</option>
          <option value="pedido"${c.estado==='pedido'?' selected':''}>Pedido / planificado</option>
          ${c.estado==='recibido'?'<option value="recibido" selected>Recibido</option>':''}
        </select></label>
        <div style="grid-column:1 / -1">
          <div style="font-size:12px;color:var(--text2);margin-bottom:4px">Formato de la compra</div>
          <div style="display:flex;gap:6px">
            <button type="button" id="cf-fmt-granel" onclick="setCompraFormato('granel')" class="btn-sec" style="flex:1;font-size:12px;padding:9px">Granel</button>
            <button type="button" id="cf-fmt-bb" onclick="setCompraFormato('bb')" class="btn-sec" style="flex:1;font-size:12px;padding:9px">Big Bag</button>
            <button type="button" id="cf-fmt-saco" onclick="setCompraFormato('saco')" class="btn-sec" style="flex:1;font-size:12px;padding:9px">Saco</button>
          </div>
          <div id="cf-fmt-sub" style="margin-top:8px"></div>
        </div>
        <label style="font-size:12px;color:var(--text2)">Transportista (compra)<input id="cf-trans" value="${_h(c.transportista)}" onchange="autoCompra()" style="${_inp}"></label>
        <label style="font-size:12px;color:var(--text2)">Teléfono transportista<input id="cf-tel" value="${_h(c.transportista_tel)}" onchange="autoCompra()" style="${_inp}"></label>
        <label style="font-size:12px;color:var(--text2);grid-column:1 / -1">Para pedido(s) de venta <span style="color:var(--text3)">— marca los que necesitan el material (vacío = compra para stock)</span>
          <div id="cf-pedrel-box" style="margin-top:4px;max-height:140px;overflow-y:auto;border:1px solid var(--border2);border-radius:8px;padding:6px;background:var(--surface)"></div>
        </label>
      </div>
      <label style="font-size:12px;color:var(--text2);display:block;margin-top:10px">Notas<textarea id="cf-notas" rows="2" onchange="autoCompra()" style="${_inp}">${_h(c.notas)}</textarea></label>
      <div style="margin-top:14px;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center">Materiales <button class="btn-sec" onclick="addLineaCompra()" style="font-size:11px;padding:5px 10px"><i class="ti ti-plus"></i> Añadir</button></div>
      <div id="cf-lineas" style="margin-top:8px"></div>
    </div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;justify-content:flex-end">
      <span style="font-size:11px;color:var(--text2);margin-right:auto"><i class="ti ti-device-floppy"></i> Se guarda solo</span>
      <button class="btn-primary" onclick="cerrarFormCompra()" style="font-size:13px;padding:10px 22px">Hecho</button></div>
  </div>`;
  document.body.appendChild(ov);
  renderLineasCompraForm();
  renderPedrelBox(c.pedidos_rel);
  _compraTipo = ['bb','saco','compartir','acopio'].includes(c.tipo_produccion)?c.tipo_produccion:'bb';
  setCompraFormato(c.formato||'granel');   // formato (granel/bb/saco), y si granel pinta el fin
}
let _compraFormato='granel', _compraTipo='bb', _compraEdit={};
function setCompraFormato(f){
  _compraFormato=f;
  ['granel','bb','saco'].forEach(x=>{ const b=document.getElementById('cf-fmt-'+x); if(b) b.className=(x===f)?'btn-primary':'btn-sec'; });
  const c=_compraEdit||{};
  const sub=document.getElementById('cf-fmt-sub'); if(!sub) return;
  if(f==='granel'){
    sub.innerHTML=`<div style="font-size:12px;color:var(--text2);margin-bottom:4px">¿Para qué fin?</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" id="cf-tp-bb" onclick="setCompraTipo('bb')" class="btn-sec" style="flex:1;min-width:70px;font-size:12px;padding:9px">Big Bag</button>
        <button type="button" id="cf-tp-saco" onclick="setCompraTipo('saco')" class="btn-sec" style="flex:1;min-width:70px;font-size:12px;padding:9px">Sacos</button>
        <button type="button" id="cf-tp-compartir" onclick="setCompraTipo('compartir')" class="btn-sec" style="flex:1;min-width:70px;font-size:12px;padding:9px">Compartir</button>
        <button type="button" id="cf-tp-acopio" onclick="setCompraTipo('acopio')" class="btn-sec" style="flex:1;min-width:70px;font-size:12px;padding:9px">Acopio</button>
      </div>
      <div id="cf-tolva-wrap" style="margin-top:8px"></div>`;
    setCompraTipo(['bb','saco','compartir','acopio'].includes(_compraTipo)?_compraTipo:'bb');
  } else {
    const kgVal=(f==='bb'?c.kg_bb:c.kg_saco);
    sub.innerHTML=`<label style="font-size:12px;color:var(--text2)">Kg por ${f==='bb'?'big bag':'saco'} (opcional)<input id="cf-kgenv" type="number" min="0" value="${kgVal!=null?kgVal:''}" oninput="autoCompra()" style="${_inp}"></label>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Compra ya envasada (no entra a tolva).</div>
      <input type="hidden" id="cf-tolva" value="">`;
    autoCompra();
  }
}
function setCompraTipo(t){
  _compraTipo=t;
  ['bb','saco','compartir','acopio'].forEach(x=>{ const b=document.getElementById('cf-tp-'+x); if(b) b.className=(x===t)?'btn-primary':'btn-sec'; });
  const c=_compraEdit||{};
  let html='';
  if(t==='acopio'){
    html='<div style="font-size:12px;color:var(--text2);background:var(--surface);border:1px dashed var(--border2);border-radius:8px;padding:10px">Va a <b>acopio</b> (no entra a ninguna tolva).</div><input type="hidden" id="cf-tolva" value="">';
  } else {
    const allowed = t==='bb'?[1,2,3,4] : t==='saco'?[1,2] : [1];   // compartir -> tolva 1
    const silos=(silosData||[]).filter(s=>allowed.includes(Number(s.numero))).sort((a,b)=>Number(a.numero)-Number(b.numero));
    const curTolva=(document.getElementById('cf-tolva')?.value)||c.tolva||'';
    const opt='<option value="">(elige tolva)</option>'+silos.map(s=>`<option value="${(s.nombre||'').replace(/"/g,'&quot;')}" ${curTolva===s.nombre?'selected':''}>Tolva ${s.numero}${s.nombre&&s.nombre!==('Tolva '+s.numero)?(' · '+(''+s.nombre).replace(/</g,'&lt;')):''}</option>`).join('');
    html=`<label style="font-size:12px;color:var(--text2)">Tolva (${t==='bb'?'1·2·3·4':t==='saco'?'1·2':'1'})<select id="cf-tolva" onchange="autoCompra()" style="${_inp}">${opt}</select></label>`;
  }
  const wrap=document.getElementById('cf-tolva-wrap'); if(wrap) wrap.innerHTML=html;
  autoCompra();
}
function _formatoBadge(c){
  const f=c.formato||'granel';
  if(f==='bb') return ['#FBE7D2','#7A4E00','Big Bag env.'+(c.kg_bb?(' '+fmtN(c.kg_bb)+'kg'):'')];
  if(f==='saco') return ['#E9F0F8','#0C447C','Saco env.'+(c.kg_saco?(' '+fmtN(c.kg_saco)+'kg'):'')];
  const t=c.tipo_produccion;
  const fin = t==='bb'?'Big Bag':t==='saco'?'Sacos':(t==='compartir'||t==='ambos')?'Compartir':t==='acopio'?'Acopio':'Granel';
  return ['#E7F0E4','#2E5811','Granel · '+fin];
}
function _pedidosPendientes(){
  const entregadas=new Set((cargas||[]).filter(c=>c.status==='entregada').map(c=>String(c.id)));
  return (pedidos||[]).filter(p=>!(p.carga_id && entregadas.has(String(p.carga_id))))
    .slice().sort((a,b)=>(''+(a.num||'')).localeCompare(''+(b.num||''),'es',{numeric:true}));
}
function renderPedrelBox(selStr){
  const box=document.getElementById('cf-pedrel-box'); if(!box) return;
  const sel=new Set((selStr||'').split(',').map(s=>s.trim()).filter(Boolean));
  const peds=_pedidosPendientes();
  if(!peds.length){ box.innerHTML='<div style="font-size:12px;color:var(--text3);padding:4px">No hay pedidos pendientes</div>'; return; }
  box.innerHTML=peds.map(p=>{ const val=p.num||('#'+p.id); const ck=sel.has(String(val));
    return `<label style="display:flex;align-items:center;gap:8px;padding:5px 4px;font-size:13px;color:var(--text);cursor:pointer"><input type="checkbox" class="cf-pedrel-cb" value="${_h(val)}" ${ck?'checked':''} onchange="autoCompra()" style="width:16px;height:16px;flex-shrink:0"> <b style="font-family:monospace;color:var(--blue-d)">${(''+val).replace(/</g,'&lt;')}</b> <span style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(p.cliente||'').replace(/</g,'&lt;')}</span></label>`;
  }).join('');
}
function renderLineasCompraForm(){
  const el=document.getElementById('cf-lineas'); if(!el) return;
  const sl='font-size:13px;padding:8px 10px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);box-sizing:border-box';
  el.innerHTML=_compraLineasForm.map((l,i)=>`<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px">
     <input value="${_h(l.descripcion)}" oninput="_compraLineasForm[${i}].descripcion=this.value" onchange="autoCompra()" placeholder="Material / descripción" style="width:100%;${sl}">
     <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
       <input value="${_h(l.cantidad)}" oninput="_compraLineasForm[${i}].cantidad=this.value" onchange="autoCompra()" type="number" min="0" placeholder="Cant." style="width:72px;${sl}">
       <input value="${_h(l.unidad)}" oninput="_compraLineasForm[${i}].unidad=this.value" onchange="autoCompra()" placeholder="unidad (big bags, palets, kg…)" style="flex:1;min-width:0;${sl}">
       <button onclick="_compraLineasForm.splice(${i},1);renderLineasCompraForm();autoCompra()" style="background:none;border:none;color:#9A2A1B;font-size:20px;cursor:pointer;padding:0 4px" title="Quitar línea">×</button>
     </div></div>`).join('');
}
function addLineaCompra(){ _compraLineasForm.push({referencia:'',descripcion:'',cantidad:'',unidad:'',falta_linea_id:null}); renderLineasCompraForm(); }
function _gatherCompraBody(){
  const fecha=document.getElementById('cf-fecha')?.value||'';
  const pedrel=[...document.querySelectorAll('.cf-pedrel-cb:checked')].map(cb=>cb.value).join(', ');
  const prev=_compraFormId?comprasData.find(x=>String(x.id)===String(_compraFormId)):null;
  const estadoSel=document.getElementById('cf-estado')?.value;
  const estado=estadoSel || ((prev&&prev.estado==='recibido')?'recibido':(fecha?'pedido':'por_pedir'));
  return { proveedor:(document.getElementById('cf-prov')?.value||'').trim()||null, fecha_prevista:fecha||null,
    hora:(document.getElementById('cf-hora')?.value||'')||null,
    tolva:(document.getElementById('cf-tolva')?.value||'').trim()||null, pedidos_rel:pedrel||null,
    formato:_compraFormato||'granel',
    tipo_produccion:_compraFormato==='granel'?(_compraTipo||null):null,
    kg_bb:_compraFormato==='bb'?(Number(document.getElementById('cf-kgenv')?.value)||null):null,
    kg_saco:_compraFormato==='saco'?(Number(document.getElementById('cf-kgenv')?.value)||null):null,
    transportista:(document.getElementById('cf-trans')?.value||'').trim()||null, transportista_tel:(document.getElementById('cf-tel')?.value||'').trim()||null,
    notas:(document.getElementById('cf-notas')?.value||'').trim()||null, estado,
    lineas:_compraLineasForm.filter(l=>(''+(l.descripcion||l.referencia||'')).trim()||Number(l.cantidad)>0) };
}
function _compraVacia(b){ return !b.proveedor && !b.fecha_prevista && !b.tolva && !b.pedidos_rel && !b.transportista && !b.transportista_tel && !b.notas && (!b.lineas||!b.lineas.length); }
async function _guardarCompraAhora(){
  if(_compraSaving) return;
  if(!document.getElementById('compra-form-ov')) return;
  const body=_gatherCompraBody();
  if(!_compraFormId && _compraVacia(body)) return;     // no crear borradores vacíos
  _compraSaving=true;
  try{
    if(_compraFormId){ await api('PUT','/compras/'+_compraFormId,body); }
    else { const r=await api('POST','/compras',body); _compraFormId=(r&&r.id)||null; const cf=document.getElementById('cf-id'); if(cf&&_compraFormId) cf.value=_compraFormId; }
    comprasData=await api('GET','/compras');
  }catch(e){ /* reintentará al siguiente cambio o al cerrar */ }
  _compraSaving=false;
}
function autoCompra(){ clearTimeout(_compraAutoTimer); _compraAutoTimer=setTimeout(_guardarCompraAhora,600); }
async function cerrarFormCompra(){
  clearTimeout(_compraAutoTimer);
  await _guardarCompraAhora();
  if(_compraFormId){ const c=comprasData.find(x=>String(x.id)===String(_compraFormId)); if(c&&_compraVacia(c)){ try{ await api('DELETE','/compras/'+_compraFormId); }catch(e){} } }
  document.getElementById('compra-form-ov')?.remove();
  _compraFormId=null;
  renderCompras();
}
async function cambiarEstadoCompra(id,estado){
  if(estado==='recibido' && !confirm('¿Marcar como recibido?\nSe avisará en los pedidos de venta que tenían faltas.')) return;
  try{ await api('PATCH','/compras/'+id+'/estado',{estado}); log('Actualizado','ok'); renderCompras(); }catch(e){ log('Error','warn'); }
}
async function borrarCompra(id){ if(!confirm('¿Borrar este pedido de compra?')) return; try{ await api('DELETE','/compras/'+id); renderCompras(); }catch(e){ log('Error','warn'); } }
async function exportarComprasExcel(){
  const cps=comprasData.filter(c=>c.estado==='recibido');
  const rows=[['Proveedor','Recibido','Material','Cantidad','Unidad','Para pedido','Tolva','Transportista']];
  cps.forEach(c=>(c.lineas||[]).forEach(l=>rows.push([c.proveedor||'',c.fecha_recibido?fmtDate(c.fecha_recibido):'',l.descripcion||l.referencia||'',fmtN(l.cantidad),l.unidad||'',c.pedidos_rel||'',c.tolva||'',c.transportista||''])));
  try{
    await _cargarScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Compras'); rows.forEach(r=>ws.addRow(r)); ws.getRow(1).font={bold:true};
    const buf=await wb.xlsx.writeBuffer(); _descargarBlob(new Blob([buf]),'compras_'+_hoyISO()+'.xlsx');
  }catch(e){ _descargarBlob(new Blob([rows.map(r=>r.join(';')).join('\n')],{type:'text/csv'}),'compras_'+_hoyISO()+'.csv'); }
}

function triggerPrepPDF(){
  const inp=document.getElementById('prep-pdf-file');
  if(inp){inp.value='';inp.click();}
}

function abrirGestionPreparadores(){
  const ov=document.createElement('div');
  ov.id='gestion-prep-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML=`
    <div style="background:var(--surface);border-radius:12px;width:400px;max-width:100%">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border)">
        <div style="font-size:16px;font-weight:600">Preparadores</div>
        <button onclick="document.getElementById('gestion-prep-ov').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3)">×</button>
      </div>
      <div style="padding:18px 20px">
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input type="text" id="nuevo-preparador" placeholder="Nombre del preparador" onkeydown="if(event.key==='Enter')addPreparador()" style="flex:1;font-size:13px;padding:8px 11px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--text)">
          <button class="btn-primary" onclick="addPreparador()"><i class="ti ti-plus"></i></button>
        </div>
        <div id="lista-preparadores"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  renderListaPreparadores();
}

function renderListaPreparadores(){
  const el=document.getElementById('lista-preparadores');
  if(!el) return;
  if(!preparadoresList.length){
    el.innerHTML='<div style="text-align:center;color:var(--text2);font-size:12px;padding:16px">No hay preparadores. Añade el primero.</div>';
    return;
  }
  el.innerHTML=preparadoresList.map(p=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
      <span style="font-size:13px;font-weight:500"><i class="ti ti-user" style="color:var(--text3);margin-right:6px"></i>${p.nombre}</span>
      <button onclick="delPreparador('${p.id}')" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px" title="Eliminar"><i class="ti ti-trash"></i></button>
    </div>`).join('');
}

async function addPreparador(){
  const inp=document.getElementById('nuevo-preparador');
  const nombre=(inp?.value||'').trim();
  if(!nombre) return;
  try{
    await api('POST','/preparadores',{nombre});
    preparadoresList=await api('GET','/preparadores');
    inp.value='';
    renderListaPreparadores();
    fillPreparadorFilters();
  }catch(e){ log('Error añadiendo preparador','warn'); }
}

async function delPreparador(id){
  try{
    await api('DELETE','/preparadores/'+id);
    preparadoresList=await api('GET','/preparadores');
    renderListaPreparadores();
    fillPreparadorFilters();
  }catch(e){ log('Error eliminando preparador','warn'); }
}

// ── Helpers de importación PDF (unifican preparación y planificación) ──────────

// Cabecera del pedido a partir de la respuesta del parser (/importar-pdf).
// 'base' = pedido existente (al reimportar conserva lo que no venga en el PDF).
function cabeceraDesdePDF(datos, base){
  base = base || {};
  return {
    ...base,
    num: datos.num || base.num || null,
    cliente: datos.cliente_nombre || base.cliente || 'Cliente',
    destino: datos.destino_texto || base.destino || '—',
    direccion_descarga: datos.direccion_descarga || base.direccion_descarga || null,
    fecha: datos.fecha_pedido || base.fecha || null,
    kg: datos.kg || base.kg || 0,
    porte: datos.porte || base.porte || 0,
    obs: datos.obs || base.obs || null
  };
}

// Guarda las líneas del pedido (solo artículos). Si se pasan 'previas',
// conserva el estado 'preparada' y las observaciones manuales por referencia.
async function guardarLineasPedido(pid, datosLineas, previas){
  const filtradas=(datosLineas||[]).filter(l=>l.es_articulo!==false);
  let payload=filtradas;
  if(previas && previas.length){
    const porRef={};
    previas.forEach(l=>{ porRef[l.referencia]={preparada:l.preparada,observaciones:l.observaciones}; });
    payload=filtradas.map(l=>({
      ...l,
      preparada: !!(porRef[l.referencia]?.preparada),
      observaciones: porRef[l.referencia]?.observaciones || l.observaciones || null
    }));
  }
  await api('POST','/pedidos/'+pid+'/lineas',{lineas:payload});
  return filtradas.length;
}

async function importarPrepPDF(input){
  const file=input.files[0];
  if(!file) return;
  log('Leyendo PDF...');
  const base64=await new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=()=>rej(new Error('Error leyendo archivo'));
    r.readAsDataURL(file);
  });
  try{
    const datos=await api('POST','/importar-pdf',{base64});
    if(!datos.num){ log('No se pudo leer el número de pedido','warn'); return; }
    const nuevo=await api('POST','/pedidos', cabeceraDesdePDF(datos));
    const n=await guardarLineasPedido(nuevo.id, datos.lineas);
    await loadAll();
    fillPreparadorFilters();
    renderPrepList();
    log('Pedido '+datos.num+' importado con '+n+' artículos','ok');
  }catch(e){ log('Error importando PDF: '+e.message,'warn'); }
}

// Compara el pedido actual con lo que trae el PDF y devuelve la lista de cambios
function diffPedido(viejo, oldLines, datos){
  const cambios=[];
  const fmt=v=>(v===null||v===undefined||v==='')?'(vacío)':v;
  const campos=[
    ['cliente','Cliente',datos.cliente_nombre],
    ['destino','Destino',datos.destino_texto],
    ['direccion_descarga','Dirección descarga',datos.direccion_descarga],
    ['fecha','Fecha',datos.fecha_pedido],
    ['kg','Kg',datos.kg],
    ['porte','Porte €',datos.porte]
  ];
  for(const [k,label,nv] of campos){
    if(nv==null||nv==='') continue;                 // si el PDF no trae el dato, no cuenta
    if(String(viejo[k]??'')!==String(nv)) cambios.push(label+': '+fmt(viejo[k])+' → '+fmt(nv));
  }
  const oldByRef={}, newByRef={};
  (oldLines||[]).forEach(l=>oldByRef[l.referencia]=l);
  (datos.lineas||[]).filter(l=>l.es_articulo!==false).forEach(l=>newByRef[l.referencia]=l);
  for(const ref in newByRef){
    const nl=newByRef[ref], ol=oldByRef[ref];
    if(!ol){ cambios.push('+ Línea nueva: '+ref+' ('+nl.cantidad+(nl.embalaje?' · '+nl.embalaje:'')+')'); continue; }
    if(Number(ol.cantidad)!==Number(nl.cantidad)) cambios.push(ref+' · cantidad: '+ol.cantidad+' → '+nl.cantidad);
    const op=(String(ol.embalaje||'').match(/\d+/)||[''])[0]||'0';
    const np=(String(nl.embalaje||'').match(/\d+/)||[''])[0]||'0';
    if(op!==np) cambios.push(ref+' · palets: '+op+' → '+np);
  }
  for(const ref in oldByRef){ if(!newByRef[ref]) cambios.push('− Línea eliminada: '+ref+(oldByRef[ref].descripcion?' ('+oldByRef[ref].descripcion+')':'')); }
  return cambios;
}

// Notificación modal con la lista de cambios
function mostrarCambios(titulo, cambios){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.onclick=e=>{ if(e.target===ov) ov.remove(); };
  ov.innerHTML=`<div style="background:var(--surface);border-radius:12px;width:460px;max-width:100%;overflow:hidden">
    <div style="background:#FAEEDA;border-bottom:1px solid #F0C77E;padding:14px 18px;display:flex;align-items:center;gap:10px">
      <i class="ti ti-bell-ringing" style="color:#9A6700;font-size:20px"></i>
      <div><div style="font-size:14px;font-weight:700;color:#7A4E00">Pedido actualizado desde PDF</div>
      <div style="font-size:12px;color:#9A6700">${titulo} — ${cambios.length} cambio(s)</div></div>
    </div>
    <div style="padding:14px 18px;max-height:50vh;overflow-y:auto">
      ${cambios.map(c=>`<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">${c.replace(/</g,'&lt;')}</div>`).join('')}
    </div>
    <div style="padding:12px 18px;text-align:right;border-top:1px solid var(--border)">
      <button class="btn-primary" data-ok>Entendido</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-ok]').onclick=()=>ov.remove();
}

// Marcar los cambios como vistos (quita el naranja, conserva el historial)
async function marcarCambiosVistos(pid){
  const p=pedidos.find(x=>String(x.id)===String(pid));
  try{
    await api('PATCH','/pedidos/'+pid+'/cambios',{cambios:p?p.cambios:null, tiene_cambios:false});
    if(p) p.tiene_cambios=false;
    const banner=document.getElementById('cambios-banner-'+pid); if(banner) banner.remove();
    renderPrepList(); renderPreparadosList();
  }catch(e){ log('Error','warn'); }
}

function triggerReimportPDF(pid){
  // Crear el input al vuelo y colgarlo del body: evita fallos de id / overlay en móvil
  const inp=document.createElement('input');
  inp.type='file';
  inp.accept='.pdf,application/pdf';
  inp.style.display='none';
  inp.onchange=()=>{ reimportarPDF(pid, inp); setTimeout(()=>inp.remove(),0); };
  document.body.appendChild(inp);
  inp.click();
}

async function reimportarPDF(pid,input){
  const file=input.files[0];
  if(!file) return;
  log('Leyendo PDF...');
  const base64=await new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=()=>rej(new Error('Error leyendo archivo'));
    r.readAsDataURL(file);
  });
  try{
    const datos=await api('POST','/importar-pdf',{base64});
    const p=pedidos.find(x=>String(x.id)===String(pid));
    if(!p) return;
    const oldLines=(prepLineasCache[pid]||[]).slice();   // memoria de cómo estaba
    const cambios=diffPedido(p, oldLines, datos);
    // Cabecera + líneas
    await api('PUT','/pedidos/'+pid, cabeceraDesdePDF(datos, p));
    await guardarLineasPedido(pid, datos.lineas, oldLines);
    // Registrar cambios (memoria) y marcar el pedido en naranja
    if(cambios.length){
      const stamp=new Date().toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const bloque='【 '+stamp+' 】\n'+cambios.map(c=>'• '+c).join('\n');
      const nuevoTexto=bloque+(p.cambios?('\n\n'+p.cambios):'');
      await api('PATCH','/pedidos/'+pid+'/cambios',{cambios:nuevoTexto, tiene_cambios:true});
    }
    await loadAll();
    // Reabrir el detalle para reflejar líneas, totales y el aviso de cambios
    document.getElementById('pedido-detalle-ov')?.remove();
    await abrirPedidoDetalle(pid);
    if(cambios.length){ mostrarCambios((p.num||p.cliente||'Pedido'), cambios); log('Pedido actualizado: '+cambios.length+' cambio(s)','ok'); }
    else log('Pedido actualizado: sin cambios','ok');
  }catch(e){ log('Error actualizando PDF: '+e.message,'warn'); }
}

// ── BANDEJA BC ────────────────────────────────────────────────────────────────
let bcBandeja=[];
let bcIgnorados=[];
let bcClientesExcluidos=[];

function ignorarBCPedido(num){
  if(!bcIgnorados.includes(num)) bcIgnorados.push(num);
  api('POST','/bc/config/ignorados',{value:bcIgnorados});
  // También marcar como rechazado en la bandeja para que no vuelva
  api('POST','/bc/pedido/'+encodeURIComponent(num)+'/estado',{estado:'rechazado'});
  bcBandeja=bcBandeja.filter(p=>p.num!==num);
  renderBCBandeja();
}

function restaurarIgnorados(){
  bcIgnorados=[];
  api('POST','/bc/config/ignorados',{value:[]});
  renderBCBandeja();
}

async function loadBCConfig(){
  try{
    const [ign, exc] = await Promise.all([
      api('GET','/bc/config/ignorados'),
      api('GET','/bc/config/excluidos')
    ]);
    bcIgnorados = ign||[];
    bcClientesExcluidos = exc||[];
  }catch(e){ console.warn('BC config error:', e.message); }
}

async function sincronizarBC(){
  const btn=event?.target?.closest('button');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="ti ti-loader"></i> Cargando...';}
  try{
    await loadBCPedidos();
    log('Pedidos actualizados','ok');
  }catch(e){
    log('Error: '+e.message,'warn');
  }
  if(btn){btn.disabled=false;btn.innerHTML='<i class="ti ti-refresh"></i> Actualizar';}
}

async function loadBCPedidos(){
  const el=document.getElementById('bc-bandeja-list');
  if(!el)return;
  el.innerHTML='<div style="text-align:center;padding:30px;color:var(--text2)"><i class="ti ti-loader"></i> Cargando pedidos de BC...</div>';
  try{
    const data=await api('GET','/bc/pedidos');
    bcBandeja=data;
    renderBCBandeja();
  }catch(e){
    el.innerHTML='<div style="background:var(--red-l);border-radius:6px;padding:14px;color:var(--red)"><strong>Error conectando con BC:</strong> '+e.message+'</div>';
  }
}

function renderBCBandeja(){
  const el=document.getElementById('bc-bandeja-list');
  if(!el)return;
  if(!bcBandeja.length){
    el.innerHTML='<div style="text-align:center;padding:30px;color:var(--text2)">No hay pedidos abiertos en BC</div>';
    return;
  }
  const imported=new Set(pedidos.map(p=>p.num));
  const visibles=bcBandeja.filter(p=>!bcIgnorados.includes(p.num)&&!bcClientesExcluidos.some(c=>p.cliente&&p.cliente.toLowerCase().includes(c.toLowerCase())));
  const nIgn=bcBandeja.length-visibles.length;

  let html='';
  if(nIgn>0){
    html+=`<div style="padding:8px 16px;font-size:11px;color:var(--text2);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
      <span>${nIgn} pedido${nIgn!==1?'s':''} ignorado${nIgn!==1?'s':''}</span>
      <button onclick="restaurarIgnorados()" style="background:none;border:none;cursor:pointer;color:var(--blue-d);font-size:11px;text-decoration:underline">Mostrar todos</button>
    </div>`;
  }

  if(!visibles.length){
    html+='<div style="text-align:center;padding:30px;color:var(--text2)">Todos los pedidos están importados o ignorados</div>';
    el.innerHTML='<div class="list-card">'+html+'</div>';
    return;
  }

  html+=visibles.map(p=>{
    const yaImportado=imported.has(p.num);
    return `<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);${yaImportado?'opacity:.55':''}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
          <span style="font-weight:600;font-family:monospace;color:var(--blue-d)">${p.num}</span>
          ${yaImportado?'<span style="background:var(--green-l);color:var(--green);font-size:10px;padding:1px 7px;border-radius:8px;font-weight:600">Ya importado</span>':''}
        </div>
        <div style="font-size:13px;font-weight:500;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.cliente}</div>
        <div style="font-size:11px;color:var(--text2)">${p.destino||''}${p.fecha?' · '+fmtDate(p.fecha):''}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        ${!yaImportado
          ?`<button class="btn-primary" style="font-size:11px;padding:5px 10px" onclick="importarDesdeBCBandeja('${p.num}')"><i class="ti ti-plus"></i> Añadir</button>`
          :'<button class="btn-sec" style="font-size:11px;padding:5px 10px" disabled>Importado</button>'
        }
        ${!yaImportado?`<button class="btn-sec" style="font-size:11px;padding:5px 8px;color:var(--text2)" onclick="ignorarBCPedido('${p.num}')" title="Ignorar este pedido"><i class="ti ti-eye-off"></i></button>`:''}
      </div>
    </div>`;
  }).join('');

  el.innerHTML='<div class="list-card">'+html+'</div>';
}

async function importarDesdeBCBandeja(num){
  const btn=event.target.closest('button');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="ti ti-loader"></i>';}
  try{
    const p=await api('GET','/bc/pedido/'+encodeURIComponent(num));
    // Open modal pre-filled
    openModal('pedido',null);
    await new Promise(r=>setTimeout(r,100)); // wait for modal to render
    if(p.num) document.getElementById('f-num').value=p.num;
    if(p.cliente) document.getElementById('f-cliente').value=p.cliente;
    if(p.destino) document.getElementById('f-destino').value=p.destino;
    if(p.direccion_descarga) document.getElementById('f-dir-desc').value=p.direccion_descarga;
    if(p.kg) document.getElementById('f-kg').value=Math.round(p.kg);
    if(p.porte) document.getElementById('f-porte').value=p.porte;
    if(p.fecha) document.getElementById('f-fecha').value=p.fecha;
    // Volcar las líneas igual que el import de PDF: se crean al pulsar Guardar.
    // guardarLineasPedido se queda solo con los artículos (excluye la línea de portes).
    pdfImportLineas = (Array.isArray(p.lineas) ? p.lineas : []).map(l=>({
      referencia: l.referencia || l.ref_bc || null,
      descripcion: l.descripcion || null,
      cantidad: l.cantidad || 0,
      kgs: (l.kgs != null ? l.kgs : (l.peso != null ? l.peso : null)),
      embalaje: l.embalaje || null,
      es_articulo: l.es_articulo !== false && !/^PORT/i.test(l.referencia || l.ref_bc || '')
    }));
    if(!pdfImportLineas.length) pdfImportLineas = null;
    // Show banner
    const banner=document.createElement('div');
    banner.style.cssText='background:#e6f5ea;border:1px solid #2d7a3a;border-radius:6px;padding:8px 12px;font-size:12px;color:#2d7a3a;margin-bottom:10px';
    banner.innerHTML='<i class="ti ti-check"></i> Importado desde BC: <strong>'+num+'</strong> — Revisa y guarda';
    const body=document.getElementById('modal-body');
    if(body) body.insertBefore(banner,body.firstChild);
    log('Pedido '+num+' cargado desde BC','ok');
  }catch(e){
    if(btn){btn.disabled=false;btn.innerHTML='<i class="ti ti-plus"></i> Añadir';}
    log('Error: '+e.message,'warn');
  }
}

function añadirClienteExcluido(){
  const inp=document.getElementById('bc-excluir-input');
  const val=inp?.value.trim();
  if(!val) return;
  if(!bcClientesExcluidos.includes(val)) bcClientesExcluidos.push(val);
  api('POST','/bc/config/excluidos',{value:bcClientesExcluidos});
  inp.value='';
  renderClientesExcluidos();
  renderBCBandeja();
}

function quitarClienteExcluido(nombre){
  bcClientesExcluidos=bcClientesExcluidos.filter(c=>c!==nombre);
  api('POST','/bc/config/excluidos',{value:bcClientesExcluidos});
  renderClientesExcluidos();
  renderBCBandeja();
}

function renderClientesExcluidos(){
  const el=document.getElementById('bc-excluidos-list');
  if(!el) return;
  if(!bcClientesExcluidos.length){
    el.innerHTML='<div style="font-size:11px;color:var(--text2);font-style:italic">Ningún cliente excluido</div>';
    return;
  }
  el.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:6px">'+
    bcClientesExcluidos.map(c=>
      `<div style="display:flex;align-items:center;gap:5px;background:var(--red-l);color:var(--red);border:1px solid var(--red);padding:3px 8px;border-radius:20px;font-size:11px;font-weight:500">
        <span>${(''+c).replace(/</g,'&lt;')}</span>
        <button onclick="quitarClienteExcluido('${(''+c).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" style="background:none;border:none;cursor:pointer;color:var(--red);padding:0;line-height:1;font-size:13px">×</button>
      </div>`
    ).join('')+'</div>';
}

// Comprueba que el servidor desplegado está al día (evita fallos silenciosos
// cuando se sube index.html pero no server.js, o no se reinicia).
const NEEDS_API = 46;
async function comprobarServidor(){
  let v=0;
  try{ const h=await api('GET','/health'); v=(h&&h.version)||0; }catch(e){ v=0; }
  const ya=document.getElementById('server-warn');
  if(v < NEEDS_API){
    if(!ya){
      const d=document.createElement('div');
      d.id='server-warn';
      d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:10050;background:#FBE9E7;color:#9A2A1B;border-bottom:1px solid #E8A599;padding:8px 14px;font-size:12px;text-align:center;font-family:DM Sans,sans-serif';
      d.innerHTML='⚠ El servidor desplegado está desactualizado: vuelve a subir <b>server.js</b> y reinícialo. Algunas funciones pueden no guardarse bien. <button onclick="document.getElementById(\'server-warn\').remove()" style="margin-left:8px;background:none;border:1px solid #9A2A1B;color:#9A2A1B;border-radius:4px;padding:1px 7px;cursor:pointer">Ocultar</button>';
      document.body.appendChild(d);
    }
  } else if(ya){ ya.remove(); }
}

// Recordatorio suave para descargar una copia si hace muchos días que no se hace
function comprobarRecordatorioCopia(){
  let last=0; try{ last=parseInt(localStorage.getItem('ultimaCopia')||'0'); }catch(e){}
  const dias = last ? Math.floor((Date.now()-last)/86400000) : 999;
  if(dias < 7) return;                                  // avisa a partir de 7 días
  if(document.getElementById('copia-recordatorio')) return;
  const txt = last ? ('Hace '+dias+' días que no guardas una copia de seguridad.') : ('Conviene guardar una copia de seguridad en SharePoint.');
  const d=document.createElement('div');
  d.id='copia-recordatorio';
  d.style.cssText='position:fixed;bottom:16px;right:16px;z-index:10040;background:#FFF7E6;border:1px solid #F0C77E;border-radius:10px;padding:12px 14px;max-width:300px;box-shadow:0 4px 16px rgba(0,0,0,.12);font-family:DM Sans,sans-serif';
  d.innerHTML='<div style="font-size:12px;color:#7A4E00;margin-bottom:8px">💾 '+txt+' Descárgala y guárdala en tu carpeta de SharePoint.</div><div style="display:flex;gap:6px;justify-content:flex-end"><button onclick="document.getElementById(\'copia-recordatorio\').remove()" style="font-size:11px;padding:5px 10px;border:1px solid #C8860B;background:#fff;color:#7A4E00;border-radius:6px;cursor:pointer">Ahora no</button><button onclick="descargarBackup()" style="font-size:11px;padding:5px 10px;border:none;background:#0F6E56;color:#fff;border-radius:6px;cursor:pointer">Descargar copia</button></div>';
  document.body.appendChild(d);
}

// ── PRODUCCIÓN · Materias primas y Silos (Fase 1) ─────────────────────────────
let silosData=[], matPrimas=[];
async function cargarMatPrimas(render){
  try{ matPrimas=await api('GET','/materias-primas'); }catch(e){ matPrimas=[]; }
  if(render) renderMatPrimas();
}
function renderMatPrimas(){
  const el=document.getElementById('matprima-list'); if(!el) return;
  if(!matPrimas.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-database"></i>Aún no hay materias primas. Añade la primera arriba.</div>'; return; }
  el.innerHTML=matPrimas.map(m=>`<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px">
     <i class="ti ti-package" style="color:var(--text2)"></i>
     <span style="flex:1;font-size:14px">${(m.nombre||'').replace(/</g,'&lt;')}</span>
     <button onclick="delMatPrima(${m.id})" style="background:none;border:none;color:#9A2A1B;cursor:pointer;font-size:16px" title="Borrar"><i class="ti ti-trash"></i></button>
   </div>`).join('');
}
async function addMatPrima(){
  const inp=document.getElementById('mp-nuevo'); const v=(inp.value||'').trim(); if(!v) return;
  try{ await api('POST','/materias-primas',{nombre:v}); inp.value=''; await cargarMatPrimas(true); }catch(e){ log('Error','warn'); }
}
async function delMatPrima(id){
  if(!confirm('¿Borrar esta materia prima?')) return;
  try{ await api('DELETE','/materias-primas/'+id); await cargarMatPrimas(true); }catch(e){ log('Error','warn'); }
}
async function cargarSilos(){
  if(!matPrimas.length) await cargarMatPrimas(false);
  try{ silosData=await api('GET','/silos'); }catch(e){ silosData=[]; }
  try{ viajesData=await api('GET','/viajes'); }catch(e){}
  try{ comprasData=await api('GET','/compras'); }catch(e){}
  renderSilos();
}
function siloSVGProd(pct,col,uid,nivel){
  const id='sp'+uid;
  const p=Math.max(0,Math.min(100,pct));
  const fillTop = 142 - (p/100)*(142-12);
  const outline='M28,12 L92,12 Q102,12 102,22 L102,90 L66,142 L54,142 L18,90 L18,22 Q18,12 28,12 Z';
  return `<svg viewBox="0 0 120 158" width="104" height="138" style="display:block;margin:0 auto">
    <defs><clipPath id="${id}"><path d="${outline}"/></clipPath></defs>
    <g clip-path="url(#${id})">
      <rect x="0" y="0" width="120" height="158" fill="#EAEDF1"/>
      <rect class="silofill" x="0" y="142" width="120" height="0" fill="${col}" data-y="${fillTop.toFixed(1)}" data-h="${(158-fillTop).toFixed(1)}" style="transition:y .6s cubic-bezier(.4,0,.2,1),height .6s cubic-bezier(.4,0,.2,1)"/>
    </g>
    <path d="${outline}" fill="none" stroke="#A7AFBA" stroke-width="2.5"/>
    <line x1="18" y1="90" x2="102" y2="90" stroke="#A7AFBA" stroke-width="1.4" stroke-dasharray="3 3"/>
    <rect x="51" y="142" width="18" height="8" rx="1.5" fill="#A7AFBA"/>
    <text x="60" y="${nivel?52:58}" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="25" font-weight="800" fill="${p>=63?'#fff':col}">${p}%</text>
    ${nivel?`<text x="60" y="69" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="11" font-weight="800" letter-spacing="1" fill="${p>=63?'#fff':col}">${nivel}</text>`:''}
  </svg>`;
}
function renderSilos(){
  const grid=document.getElementById('silos-grid'); if(!grid) return;
  const totA=silosData.reduce((s,x)=>s+Number(x.kg_actual||0),0);
  const totC=silosData.reduce((s,x)=>s+Number(x.capacidad_kg||0),0);
  const pctTot=totC?Math.round(totA/totC*100):0;
  const tt=document.getElementById('silos-total'); if(tt) tt.textContent=fmtN(totA)+' / '+fmtN(totC)+' kg ('+pctTot+'% ocupado)';
  const vac=silosData.filter(s=>s.vaciando).map(s=>s.nombre);
  const vv=document.getElementById('silos-vaciando'); if(vv) vv.textContent=vac.length?('Vaciando ahora: '+vac.join(', ')):'Ningún silo en vaciado';
  // banner de materiales disponibles en silos
  const mats=[...new Set(silosData.filter(s=>Number(s.kg_actual)>0 && s.producto).map(s=>''+s.producto))].sort();
  const banner=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:11px 14px;margin-bottom:14px">
      <div style="font-size:12px;color:var(--text2);margin-bottom:7px"><i class="ti ti-packages"></i> Materiales disponibles en silos</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">${mats.length?mats.map(m=>`<span style="font-size:12px;font-weight:700;background:#EAF3EE;color:#0F6E56;border-radius:8px;padding:4px 11px"><i class="ti ti-check" style="font-size:11px"></i> ${m.replace(/</g,'&lt;')}</span>`).join(''):'<span style="font-size:12px;color:var(--text3)">Ningún silo con material</span>'}</div></div>`;
  grid.innerHTML=banner+'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:14px">'+silosData.map(s=>{
    const cap=Number(s.capacidad_kg)||1, kg=Number(s.kg_actual)||0;
    const pct=Math.max(0,Math.min(100,Math.round(kg/cap*100)));
    const hayMat=kg>0;
    const nivel=hayMat?(pct<35?'BAJA':pct<=70?'NORMAL':'ALTA'):'';
    const col=hayMat?(pct<35?'#2D6CB5':pct<=70?'#1E8C6E':'#B5710E'):'#C2C8D0';
    const vaciando=s.vaciando;
    return `<div class="silo-card" data-silo-id="${s.id}" data-silo-num="${s.numero}" style="background:var(--surface);border:1px solid ${vaciando?'#E8A599':'var(--border)'};border-radius:14px;padding:12px;text-align:center;${vaciando?'box-shadow:0 0 0 3px #FBE3E0 inset':''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:12px;font-weight:700;background:#FFF3E6;color:#7A4E00;border-radius:7px;padding:2px 9px">${s.nombre}</span>
        ${vaciando?'<span style="font-size:9px;font-weight:700;color:#fff;background:#A32D2D;border-radius:6px;padding:2px 6px">VACIANDO</span>':(nivel?`<span style="font-size:9px;font-weight:800;color:#fff;background:${col};border-radius:6px;padding:2px 7px">${nivel}</span>`:'')}
      </div>
      ${siloSVGProd(pct,col,s.id,nivel)}
      <div style="font-size:13px;font-weight:700;margin-top:6px;min-height:17px">${s.producto?(''+s.producto).replace(/</g,'&lt;'):'<span style="color:var(--text3);font-weight:500">vacío</span>'}</div>
      <div style="font-size:12px;color:var(--text2)">${fmtN(kg)} / ${fmtN(cap)} kg</div>
      <div style="display:flex;gap:5px;margin-top:10px">
        <button onclick="abrirLlenarSilo(${s.id})" style="flex:1;border:none;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:700;cursor:pointer;background:#E9F0F8;color:var(--blue-d)"><i class="ti ti-arrow-down"></i> Llenar</button>
        <button onclick="abrirProducirSilo(${s.id})" style="flex:1;border:none;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:700;cursor:pointer;background:#FBE7D2;color:#7A4E00">Producir</button>
      </div>
      <button onclick="abrirTraspaso(${s.id})" style="width:100%;margin-top:5px;border:1px solid var(--border);border-radius:8px;padding:7px;font-size:11px;cursor:pointer;background:var(--surface);color:var(--text2)">⇄ Traspasar a otra tolva</button>
      <button onclick="toggleVaciando(${s.id},${!vaciando})" style="width:100%;margin-top:5px;border:1px solid ${vaciando?'#E8A599':'var(--border)'};border-radius:8px;padding:7px;font-size:11px;cursor:pointer;background:${vaciando?'#FBE3E0':'var(--surface)'};color:${vaciando?'#9A2A1B':'var(--text2)'}">${vaciando?'Quitar "vaciando"':'Marcar "estoy vaciando"'}</button>
      ${progSiloHTML(s)}
    </div>`;
  }).join('')+'</div>'+comprasProximasHTML();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    document.querySelectorAll('#silos-grid .silofill').forEach(r=>{ r.setAttribute('y', r.dataset.y); r.setAttribute('height', r.dataset.h); });
  }));
  initSilosDnD();
}
function comprasProximasHTML(){
  const hoy=_hoyISO(), d0=new Date(hoy+'T00:00:00');
  const ayer=_fechaISO(new Date(d0.getTime()-86400000)), manana=_fechaISO(new Date(d0.getTime()+86400000));
  const ventana=new Set([ayer,hoy,manana]);
  const diaLbl=f=> f===hoy?'Hoy':f===ayer?'Ayer':f===manana?'Mañana':fmtDate(f);
  const cps=(comprasData||[]).filter(c=>c.estado!=='recibido' && c.fecha_prevista && ventana.has(_fechaISO(c.fecha_prevista)) && (c.formato||'granel')==='granel' && c.tipo_produccion!=='acopio')
    .sort((a,b)=>(''+(a.fecha_prevista||'')+(a.hora||'')).localeCompare(''+(b.fecha_prevista||'')+(b.hora||'')));
  if(!cps.length) return '';
  const allowedOf=t=> t==='bb'?[1,2,3,4] : t==='saco'?[1,2] : (t==='compartir'||t==='ambos')?[1] : [0,1,2,3,4,5];
  const chip=c=>{
    const t=(c.lineas||[]).map(l=>(l.descripcion||l.referencia||'')).filter(Boolean).join(', ');
    const allowed=allowedOf(c.tipo_produccion);
    const fb=_formatoBadge(c);
    const tolvasTxt=allowed.length>=6?'cualquier tolva':allowed.length?('Tolva '+allowed.join(' · ')):'cualquier tolva';
    const f=c.fecha_prevista?_fechaISO(c.fecha_prevista):'';
    const dia=f?(diaLbl(f)+(c.hora?(' '+c.hora):'')):'';
    return `<div class="cs-chip" data-compra-id="${c.id}" data-tolvas="${allowed.join(',')}" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:grab">
       <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
         <b style="font-size:13px">${(c.proveedor||'Compra').replace(/</g,'&lt;')}</b>
         <span style="font-size:10px;font-weight:800;background:${fb[0]};color:${fb[1]};border-radius:6px;padding:2px 8px;white-space:nowrap">${fb[2]}</span></div>
       ${t?`<div style="font-size:12px;color:var(--text2);margin-top:2px">${t.replace(/</g,'&lt;')}</div>`:''}
       <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:8px">
         <span style="font-size:11px;color:#0F6E56;font-weight:700"><i class="ti ti-arrow-ramp-right-3"></i> ${tolvasTxt}</span>
         ${dia?`<span style="font-size:11px;color:var(--text2);font-weight:700"><i class="ti ti-clock"></i> ${dia}</span>`:''}</div>
       <div style="font-size:10px;color:var(--text3);margin-top:5px"><i class="ti ti-hand-finger"></i> mantén pulsado y arrástrala a su tolva</div>
     </div>`;
  };
  return `<div style="margin-top:20px">
     <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
       <span style="font-size:13px;font-weight:600"><i class="ti ti-truck-loading"></i> Compras por descargar <span style="font-size:11px;color:var(--text3);font-weight:400">· ayer, hoy y mañana</span></span>
       <span onclick="switchView('prodcal')" style="font-size:11px;color:var(--blue);cursor:pointer">Ver calendario ›</span></div>
     ${cps.map(chip).join('')}</div>`;
}
let _cs=null;
function initSilosDnD(){
  const grid=document.getElementById('silos-grid'); if(!grid) return;
  grid.querySelectorAll('.cs-chip').forEach(ch=>ch.addEventListener('pointerdown',csDown));
}
function csDown(e){
  if(e.button && e.button!==0) return;
  if(e.target.closest('a,button')) return;
  const chip=e.currentTarget;
  const sx=e.clientX, sy=e.clientY, cid=chip.dataset.compraId;
  const allowed=(chip.dataset.tolvas||'').split(',').filter(x=>x!=='').map(Number);
  let started=false, moved=false;
  const tm=ev=>{ if(started) ev.preventDefault(); };
  const begin=()=>{
    started=true;
    const r=chip.getBoundingClientRect();
    const g=chip.cloneNode(true);
    g.style.cssText='position:fixed;margin:0;width:'+r.width+'px;left:'+r.left+'px;top:'+r.top+'px;z-index:10095;pointer-events:none;opacity:.97;transform:scale(1.03) rotate(1deg);box-shadow:0 12px 28px rgba(0,0,0,.3);border-radius:10px';
    document.body.appendChild(g);
    chip.style.opacity='.3'; document.body.style.userSelect='none';
    _cs={cid, allowed, chip, ghost:g, offx:sx-r.left, offy:sy-r.top, silo:null};
    document.querySelectorAll('.silo-card').forEach(c=>{ const n=Number(c.dataset.siloNum); if(allowed.length&&!allowed.includes(n)) c.style.opacity='.35'; });
    try{ if(navigator.vibrate) navigator.vibrate(18); }catch(_){}
  };
  const timer=setTimeout(()=>{ if(!moved) begin(); },180);
  const move=ev=>{
    if(!started){ if(Math.hypot(ev.clientX-sx,ev.clientY-sy)>9){ moved=true; clearTimeout(timer); cleanup(); } return; }
    ev.preventDefault();
    _cs.ghost.style.left=(ev.clientX-_cs.offx)+'px'; _cs.ghost.style.top=(ev.clientY-_cs.offy)+'px';
    const el=document.elementFromPoint(ev.clientX,ev.clientY);
    const card=el&&el.closest?el.closest('.silo-card'):null;
    const ok=(card && (!_cs.allowed.length || _cs.allowed.includes(Number(card.dataset.siloNum))))?card:null;
    if(ok!==_cs.silo){ document.querySelectorAll('.silo-card').forEach(c=>{ c.style.outline=(c===ok)?'3px solid #0F6E56':''; c.style.outlineOffset='-3px'; }); _cs.silo=ok; }
  };
  const up=ev=>{ clearTimeout(timer); cleanup(); if(started) csDrop(); else if(!moved && Math.hypot(ev.clientX-sx,ev.clientY-sy)<9) abrirFormCompra(Number(cid)); };
  function cleanup(){ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); document.removeEventListener('pointercancel',up); document.removeEventListener('touchmove',tm); document.body.style.userSelect=''; }
  document.addEventListener('pointermove',move,{passive:false});
  document.addEventListener('pointerup',up);
  document.addEventListener('pointercancel',up);
  document.addEventListener('touchmove',tm,{passive:false});
}
function csDrop(){
  const k=_cs; _cs=null; if(!k) return;
  k.ghost.remove();
  document.querySelectorAll('.silo-card').forEach(c=>{ c.style.outline=''; c.style.opacity=''; });
  if(!k.silo){ k.chip.style.opacity=''; return; }
  try{ if(navigator.vibrate) navigator.vibrate(18); }catch(_){}
  csAskKg(k.cid, k.silo.dataset.siloId);
}
function csAskKg(compraId,siloId){
  const c=(comprasData||[]).find(x=>String(x.id)===String(compraId));
  const s=(silosData||[]).find(x=>String(x.id)===String(siloId));
  if(!c||!s) return;
  const lin=(c.lineas||[])[0]||{};
  const matTxt=(lin.descripcion||lin.referencia||c.proveedor||'material');
  const guess=(c.lineas||[]).reduce((a,l)=>a+(Number(l.cantidad)||0),0)||'';
  const ov=document.createElement('div'); ov.id='cs-kg-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10072;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const inp='width:100%;font-size:26px;font-weight:800;text-align:center;padding:14px;border:2px solid var(--border2);border-radius:12px;background:var(--surface);color:var(--text);box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:440px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:17px">Descargar en Tolva ${s.numero}</b>
    <div style="font-size:12px;color:var(--text2);margin:2px 0 14px">${(''+matTxt).replace(/</g,'&lt;')} · ${(c.proveedor||'').replace(/</g,'&lt;')}</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:6px">¿Cuántos kg descarga?</div>
    <input id="cs-kg" type="number" inputmode="numeric" min="0" value="${guess}" placeholder="0" style="${inp}">
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
      <button class="btn-sec" onclick="document.getElementById('cs-kg-ov').remove()" style="font-size:13px;padding:11px 16px">Cancelar</button>
      <button class="btn-primary" onclick="csConfirm('${compraId}','${siloId}')" style="font-size:14px;padding:11px 18px;background:#0F6E56"><i class="ti ti-check"></i> Descargar</button></div>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(()=>document.getElementById('cs-kg')?.focus(),60);
}
async function csConfirm(compraId,siloId){
  const kg=Number(document.getElementById('cs-kg')?.value)||0;
  if(!kg){ log('Pon los kg que descarga','warn'); return; }
  const c=(comprasData||[]).find(x=>String(x.id)===String(compraId));
  const s=(silosData||[]).find(x=>String(x.id)===String(siloId));
  const lin=(c&&c.lineas||[])[0]||{};
  const nombre=(lin.descripcion||lin.referencia||'').trim();
  let mp=nombre?matPrimas.find(m=>(m.nombre||'').toLowerCase()===nombre.toLowerCase()):null;
  if(!mp && nombre){ try{ mp=await api('POST','/materias-primas',{nombre}); await cargarMatPrimas(false); }catch(e){} }
  try{
    const r=await api('POST','/viajes',{mp_id:mp?mp.id:null,kg,silo_id:siloId,origen:'compra'});
    const vid=r.ids&&r.ids[0];
    if(vid) await api('PATCH','/viajes/'+vid+'/completar',{destino_tipo:'silo',destino_silo_id:siloId,kg_final:kg});
    await api('PATCH','/compras/'+compraId+'/estado',{estado:'recibido',tolva:s?s.nombre:null});
    document.getElementById('cs-kg-ov')?.remove();
    await cargarSilos();
    log('Descargado en '+(s?s.nombre:'tolva')+' · '+fmtN(kg)+' kg','ok');
  }catch(e){ log('Error al descargar','warn'); }
}
function comprasSiloHTML(s){
  const hoy=_hoyISO();
  const dm=new Date(); dm.setDate(dm.getDate()+1); const man=_isoOf(dm);
  const cps=(comprasData||[]).filter(c=>c.tolva===s.nombre && c.fecha_prevista && c.estado!=='recibido' && (_fechaISO(c.fecha_prevista)===hoy||_fechaISO(c.fecha_prevista)===man))
    .sort((a,b)=>(''+a.fecha_prevista).localeCompare(''+b.fecha_prevista));
  if(!cps.length) return '';
  return cps.map(c=>{
    const t=(c.lineas||[]).map(l=>(l.descripcion||l.referencia||'')).filter(Boolean).join(', ');
    const dia=_fechaISO(c.fecha_prevista)===hoy?'Hoy':'Mañana';
    return `<div onclick="abrirFormCompra(${c.id})" style="display:flex;align-items:center;gap:5px;font-size:10px;padding:3px 0;border-bottom:1px solid var(--border);cursor:pointer">
       <span style="font-size:8px;font-weight:700;background:#E6F1FB;color:#0C447C;border-radius:5px;padding:1px 5px">${dia}</span>
       <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="ti ti-shopping-cart" style="font-size:10px"></i> ${(c.proveedor||'compra').replace(/</g,'&lt;')}${t?(' · '+t.replace(/</g,'&lt;')):''}</span></div>`;
  }).join('');
}
function progSiloHTML(s){
  const items=(viajesData||[]).filter(v=>v.estado!=='hecho' && String(v.silo_id)===String(s.id));
  const rows=items.map(v=>`<div style="display:flex;align-items:center;gap:5px;font-size:10px;padding:3px 0;border-bottom:1px solid var(--border)">
       <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.hora?('<b>'+v.hora+'</b> '):''}${(v.material||'—').replace(/</g,'&lt;')} · ${fmtN(v.kg)}kg${v.origen==='produccion'?' <span style="color:var(--text3)">(prod.)</span>':''}</span>
       <button onclick="subirProgramado('${v.id}',${s.id})" title="Subir a esta tolva" style="background:#E9F0F8;color:#0C447C;border:none;border-radius:5px;padding:2px 6px;font-size:9px;font-weight:700;cursor:pointer">SUBIR</button>
       <button onclick="cambiarTolvaProg('${v.id}')" title="Cambiar de tolva" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:12px;padding:0">⇄</button>
       <button onclick="borrarViaje('${v.id}')" title="Quitar" style="background:none;border:none;color:#9A2A1B;cursor:pointer;font-size:12px;padding:0;line-height:1">×</button>
     </div>`).join('');
  return `<div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px;text-align:left">
     <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px"><span style="font-size:10px;color:var(--text2);font-weight:600"><i class="ti ti-clock"></i> Programación</span><button onclick="programarSilo(${s.id})" style="background:none;border:none;color:var(--blue);font-size:11px;cursor:pointer">+ Programar</button></div>
     ${comprasSiloHTML(s)}${rows||(comprasSiloHTML(s)?'':'<div style="font-size:10px;color:var(--text3)">Sin entradas programadas</div>')}</div>`;
}
function programarSilo(siloId){
  const ov=document.createElement('div'); ov.id='progsilo-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10062;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const opts=matPrimas.filter(m=>m.activo!==false).map(m=>`<option value="${(m.nombre||'').replace(/"/g,'&quot;')}">`).join('');
  const s=silosData.find(x=>String(x.id)===String(siloId));
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:460px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Programar llegada a ${s?s.nombre:''}</b>
    <div style="font-size:11px;color:var(--text2);margin:2px 0 12px">Se crea como viaje pendiente del camión a esta tolva</div>
    <input type="hidden" id="pg-silo" value="${siloId}">
    <label style="font-size:12px;color:var(--text2);display:block">Material<input id="pg-mat" list="pg-mat-list" placeholder="Buscar…" style="${inp}"><datalist id="pg-mat-list">${opts}</datalist></label>
    <div style="display:flex;gap:10px;margin-top:10px">
      <label style="font-size:12px;color:var(--text2);flex:1">Kg por viaje<input id="pg-kg" type="number" min="0" style="${inp}"></label>
      <label style="font-size:12px;color:var(--text2);flex:1">Hora<input id="pg-hora" type="time" style="${inp}"></label></div>
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:10px">Nº de viajes<input id="pg-n" type="number" min="1" value="1" style="${inp}"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('progsilo-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="guardarProgramado()" style="font-size:13px;padding:10px 18px">Programar</button></div>
  </div>`;
  document.body.appendChild(ov);
}
async function guardarProgramado(){
  const siloId=document.getElementById('pg-silo').value;
  const nombre=(document.getElementById('pg-mat').value||'').trim();
  let mp=matPrimas.find(m=>(m.nombre||'').toLowerCase()===nombre.toLowerCase());
  if(!mp && nombre){ try{ mp=await api('POST','/materias-primas',{nombre}); await cargarMatPrimas(false); }catch(e){} }
  const body={ mp_id:mp?mp.id:null, kg:Number(document.getElementById('pg-kg').value)||0, silo_id:siloId, hora:document.getElementById('pg-hora').value||null, n_viajes:Number(document.getElementById('pg-n').value)||1, origen:'manual' };
  try{ await api('POST','/viajes',body); document.getElementById('progsilo-ov')?.remove(); await cargarSilos(); }catch(e){ log('Error al programar','warn'); }
}
async function subirProgramado(viajeId, siloId){
  const v=viajesData.find(x=>String(x.id)===String(viajeId));
  const s=silosData.find(x=>String(x.id)===String(siloId));
  if(!v||!s) return;
  if(s.mp_id && Number(s.kg_actual)>0 && v.mp_id && String(s.mp_id)!==String(v.mp_id)){
    if(!confirm('Ojo: '+s.nombre+' ya tiene '+(s.producto||'otro material')+'. ¿Subir igualmente?')) return;
  }
  try{ await api('PATCH','/viajes/'+viajeId+'/completar',{destino_tipo:'silo',destino_silo_id:siloId,kg_final:v.kg}); await cargarSilos(); }
  catch(e){ log('Error al subir material','warn'); }
}
async function cambiarTolvaProg(viajeId){
  const v=viajesData.find(x=>String(x.id)===String(viajeId)); if(!v) return;
  const opciones=silosData.map((s,i)=>`${i+1}) ${s.nombre}${s.producto?(' · '+s.producto):''}`).join('\n');
  const r=prompt('¿A qué tolva la cambio? Escribe el número:\n'+opciones);
  const idx=parseInt(r)-1;
  if(isNaN(idx)||!silosData[idx]) return;
  try{ await api('PUT','/viajes/'+viajeId,{mp_id:v.mp_id,kg:v.kg,silo_id:silosData[idx].id,notas:v.notas}); await cargarSilos(); }
  catch(e){ log('Error','warn'); }
}
function abrirLlenarSilo(id){
  const s=silosData.find(x=>String(x.id)===String(id)); if(!s) return;
  const ov=document.createElement('div'); ov.id='silo-llenar-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10060;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const opts=matPrimas.filter(m=>m.activo!==false).map(m=>`<option value="${(m.nombre||'').replace(/"/g,'&quot;')}">`).join('');
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:460px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Llenar ${s.nombre}</b>
    <div style="font-size:12px;color:var(--text2);margin:2px 0 14px">Actual: ${fmtN(s.kg_actual)} / ${fmtN(s.capacidad_kg)} kg</div>
    <label style="font-size:12px;color:var(--text2)">Material${s.producto?(' (ahora: '+s.producto+')'):''}
      <input id="sl-mp" list="sl-mp-list" placeholder="Buscar materia prima…" value="${s.producto?(''+s.producto).replace(/"/g,'&quot;'):''}" style="${inp}">
      <datalist id="sl-mp-list">${opts}</datalist></label>
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:10px">Kg que llegan
      <input id="sl-kg" type="number" min="0" placeholder="0" style="${inp}"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('silo-llenar-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarLlenar(${id})" style="font-size:13px;padding:10px 18px">Llenar</button></div>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(()=>document.getElementById('sl-kg')?.focus(),60);
}
async function confirmarLlenar(id){
  const nombre=(document.getElementById('sl-mp').value||'').trim();
  const kg=Number(document.getElementById('sl-kg').value)||0;
  let mp=matPrimas.find(m=>(m.nombre||'').toLowerCase()===nombre.toLowerCase());
  if(!mp && nombre){ try{ mp=await api('POST','/materias-primas',{nombre}); await cargarMatPrimas(false); }catch(e){} }
  try{ await api('POST','/silos/'+id+'/llenar',{mp_id:mp?mp.id:null, kg}); document.getElementById('silo-llenar-ov')?.remove(); await cargarSilos(); }
  catch(e){ log('Error al llenar','warn'); }
}
function vaciarSiloSinAnotar(id){
  if(!confirm('¿Vaciar sin anotar producción? Deja el silo a 0 y sin material (para limpiar restos).')) return;
  api('POST','/silos/'+id+'/vaciar').then(()=>{ document.getElementById('prodsilo-ov')?.remove(); cargarSilos(); log('Silo vaciado','ok'); }).catch(()=>log('Error','warn'));
}
let _ps=null;
function abrirProducirSilo(id){
  const s=silosData.find(x=>String(x.id)===String(id)); if(!s) return;
  _ps={ siloId:id, tipo:null, kgu:'', uni:'', step:1, vaciar:false };
  const ov=document.createElement('div'); ov.id='prodsilo-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10061;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  ov.innerHTML='<div id="ps-panel" style="background:var(--bg);width:100%;max-width:520px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px"></div>';
  document.body.appendChild(ov);
  psRender();
}
function psClose(){ document.getElementById('prodsilo-ov')?.remove(); }
function _tolvaTipos(n){ n=Number(n); if(n===0||n===5) return ['saco']; if(n===2) return ['bb']; return ['saco','bb']; }
function _fabSilo(n){ n=Number(n); if(n===0||n===1) return 'PKT'; if(n===3||n===4||n===5) return 'ESSEGI'; return null; }
function _psBtn(sel,label,sub,onclick){
  return `<button onclick="${onclick}" style="padding:18px 10px;border-radius:14px;border:2px solid ${sel?'#0F6E56':'var(--border2)'};background:${sel?'#EAF3EE':'var(--surface)'};color:${sel?'#0F6E56':'var(--text)'};font-weight:800;font-size:17px;cursor:pointer;min-height:66px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">${label}${sub?`<span style="font-size:11px;font-weight:500;color:var(--text2)">${sub}</span>`:''}</button>`;
}
function psRender(){
  const p=document.getElementById('ps-panel'); if(!p||!_ps) return;
  const s=silosData.find(x=>String(x.id)===String(_ps.siloId)); if(!s){ psClose(); return; }
  const prod=(s.producto?(''+s.producto):s.nombre).replace(/</g,'&lt;');
  const vacio=!s.mp_id||Number(s.kg_actual)<=0;
  const inpBig='width:100%;font-size:26px;font-weight:800;text-align:center;padding:14px;border:2px solid var(--border2);border-radius:12px;background:var(--surface);color:var(--text);box-sizing:border-box';
  const inpSmall='width:100%;font-size:15px;padding:11px;border:1px solid var(--border2);border-radius:10px;background:var(--surface);color:var(--text);box-sizing:border-box';
  const lab='font-size:13px;color:var(--text2);margin-bottom:8px';
  const closeBtn='<button onclick="psClose()" style="background:none;border:none;font-size:26px;color:var(--text2);cursor:pointer;line-height:1">×</button>';
  if(_ps.step===1){
    p.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><b style="font-size:18px">¿Qué ha salido de ${prod}?</b>${closeBtn}</div>
      <div style="font-size:12px;color:var(--text2);margin:2px 0 14px">${s.nombre} · quedan ${fmtN(s.kg_actual)} / ${fmtN(s.capacidad_kg)} kg</div>
      ${vacio?'<div style="font-size:13px;color:#7A4E00;background:#FFF3E6;border-radius:8px;padding:10px;margin-bottom:12px">El silo está vacío. Puedes vaciarlo igualmente para limpiar restos.</div>':''}
      <div style="${lab}">¿Qué se ha producido?</div>
      <div style="display:grid;grid-template-columns:${_tolvaTipos(s.numero).length===1?'1fr':'1fr 1fr'};gap:12px">
        ${_tolvaTipos(s.numero).map(t=>_psBtn(false,t==='bb'?'Big Bag':'Sacos','',"psTipo('"+t+"')")).join('')}
      </div>
      <button onclick="vaciarSiloSinAnotar(${_ps.siloId})" class="btn-sec" style="margin-top:18px;font-size:12px;padding:10px 14px;color:#9A2A1B">Vaciar sin anotar</button>`;
    return;
  }
  const tipo=_ps.tipo;
  let mid='';
  if(tipo==='bb'){
    const sizes=[500,675,735,900,1000];
    mid=`<div style="${lab}">Tamaño del Big Bag</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${sizes.map(k=>_psBtn(Number(_ps.kgu)===k,k+' kg','','psSize('+k+')')).join('')}
      </div>
      <input type="number" inputmode="numeric" min="0" placeholder="Otro tamaño (kg)" value="${(sizes.includes(Number(_ps.kgu))||!_ps.kgu)?'':_ps.kgu}" oninput="psSetKgu(this.value)" style="${inpSmall};margin-top:10px">`;
  } else {
    const ss=[15,20,25];
    const fab=_fabSilo(s.numero);
    mid=`<div style="${lab}">Tamaño del saco</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        ${ss.map(k=>_psBtn(Number(_ps.kgu)===k,k+' kg','','psSize('+k+')')).join('')}
      </div>
      <input type="number" inputmode="numeric" min="0" placeholder="Otro tamaño (kg)" value="${(ss.includes(Number(_ps.kgu))||!_ps.kgu)?'':_ps.kgu}" oninput="psSetKgu(this.value)" style="${inpSmall};margin-top:10px">
      ${fab?`<div style="font-size:13px;color:#0C447C;background:#E9F0F8;border-radius:8px;padding:8px 12px;margin-top:12px"><i class="ti ti-building-factory-2"></i> Lo fabrica: <b>${fab}</b></div>`:''}`;
  }
  const totalKg=(Number(_ps.kgu)||0)*(Number(_ps.uni)||0);
  p.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:18px">${prod} · ${tipo==='bb'?'Big Bag':'Sacos'}</b>${closeBtn}</div>
    <button onclick="_ps.step=1;psRender()" class="btn-sec" style="font-size:12px;padding:6px 12px;margin:8px 0 14px"><i class="ti ti-arrow-left"></i> Cambiar</button>
    <div style="${lab}">¿Qué hago al registrar?</div>
    <div style="display:flex;gap:8px;margin:6px 0 16px">
      <button onclick="psVaciar(false)" style="flex:1;padding:13px 8px;border-radius:12px;border:2px solid ${!_ps.vaciar?'#0F6E56':'var(--border2)'};background:${!_ps.vaciar?'#EAF7F1':'var(--surface)'};color:${!_ps.vaciar?'#0B5A45':'var(--text2)'};font-weight:700;font-size:13px;cursor:pointer"><i class="ti ti-clipboard-check" style="font-size:20px;display:block;margin-bottom:3px"></i>Solo anotar</button>
      <button onclick="psVaciar(true)" style="flex:1;padding:13px 8px;border-radius:12px;border:2px solid ${_ps.vaciar?'#A9461C':'var(--border2)'};background:${_ps.vaciar?'#FBE7DD':'var(--surface)'};color:${_ps.vaciar?'#8A3A16':'var(--text2)'};font-weight:700;font-size:13px;cursor:pointer"><i class="ti ti-droplet-off" style="font-size:20px;display:block;margin-bottom:3px"></i>Anotar y vaciar silo</button>
    </div>
    ${mid}
    <div style="${lab};margin-top:18px">Unidades (${tipo==='bb'?'big bags':'sacos'})</div>
    <input type="number" inputmode="numeric" min="0" value="${_ps.uni}" placeholder="0" oninput="psSetUni(this.value)" style="${inpBig}">
    <div id="ps-total" style="font-size:13px;font-weight:700;color:#0F6E56;margin-top:12px;min-height:18px">${totalKg>0?('Saldrán '+fmtN(totalKg)+' kg del silo'):''}</div>
    ${_ps.vaciar?`<div style="background:#FBE7DD;border:1px solid #D9A07F;color:#8A3A16;border-radius:10px;padding:9px 12px;margin-top:12px;font-size:12.5px;font-weight:600"><i class="ti ti-alert-triangle"></i> Al registrar se vaciará el silo (saldo a 0).</div>`:''}
    <button onclick="confirmarProducir()" style="width:100%;margin-top:16px;font-size:16px;padding:15px;border:none;border-radius:12px;color:#fff;font-weight:800;cursor:pointer;background:${_ps.vaciar?'#A9461C':'#0F6E56'}"><i class="ti ti-${_ps.vaciar?'droplet-off':'clipboard-check'}"></i> ${_ps.vaciar?'Registrar y VACIAR silo':'Registrar producción'}</button>`;
}
function psTipo(t){ _ps.tipo=t; if(t==='saco' && !_ps.kgu && _lastKgU.saco!=null) _ps.kgu=_lastKgU.saco; _ps.step=2; psRender(); }
function psSize(k){ _ps.kgu=k; psRender(); }
function psSetKgu(v){ _ps.kgu=v; psUpdateTotal(); }
function psSetUni(v){ _ps.uni=v; psUpdateTotal(); }
function psUpdateTotal(){ const el=document.getElementById('ps-total'); if(!el) return; const t=(Number(_ps.kgu)||0)*(Number(_ps.uni)||0); el.textContent=t>0?('Saldrán '+fmtN(t)+' kg del silo'):''; }
function psVaciar(v){ _ps.vaciar=v; psRender(); }
async function confirmarProducir(){
  if(!_ps) return;
  const vaciar=!!_ps.vaciar;
  const id=_ps.siloId, tipo=_ps.tipo, kgu=Number(_ps.kgu)||0, uni=Number(_ps.uni)||0;
  const hay = tipo && kgu>0 && uni>0;
  if(!hay && !vaciar){
    if(!tipo){ _ps.step=1; psRender(); return; }
    if(!kgu){ log(tipo==='bb'?'Elige el tamaño del big bag':'Pon los kg por saco','warn'); return; }
    log('Pon las unidades','warn'); return;
  }
  if(!hay && vaciar && !confirm('No has anotado producción. ¿Vaciar el silo igualmente?')) return;
  try{
    if(hay){ await api('POST','/silos/'+id+'/producir',{tipo,unidades:uni,kg_unidad:kgu}); _lastKgU[tipo]=kgu; }
    if(vaciar) await api('POST','/silos/'+id+'/vaciar');
    psClose(); await cargarSilos();
    const ud=uni+' '+(tipo==='bb'?'big bags':'sacos');
    log(vaciar?('Registrado'+(hay?(' · '+ud):'')+' y silo vaciado'):('Producción anotada · '+ud),'ok');
  }catch(e){ log('Error al registrar','warn'); }
}
async function toggleVaciando(id,val){
  try{ await api('PATCH','/silos/'+id+'/vaciando',{vaciando:val}); await cargarSilos(); }catch(e){ log('Error','warn'); }
}
function abrirTraspaso(id){
  const s=silosData.find(x=>String(x.id)===String(id)); if(!s) return;
  if(!s.mp_id||Number(s.kg_actual)<=0){ log('Este silo está vacío','warn'); return; }
  const ov=document.createElement('div'); ov.id='traspaso-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10062;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const destinos=silosData.filter(x=>String(x.id)!==String(id))
    .map(x=>`<option value="${x.id}">${x.nombre}${x.producto?(' · '+x.producto):' · vacío'} (${fmtN(x.kg_actual)}/${fmtN(x.capacidad_kg)})</option>`).join('');
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:460px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Traspasar desde ${s.nombre}</b>
    <div style="font-size:12px;color:var(--text2);margin:2px 0 14px">${s.producto?(''+s.producto).replace(/</g,'&lt;'):''} · ${fmtN(s.kg_actual)} kg disponibles</div>
    <label style="font-size:12px;color:var(--text2);display:block">A qué tolva<select id="tr-dest" style="${inp}">${destinos}</select></label>
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:10px">Kg a pasar<input id="tr-kg" type="number" min="0" value="${Math.round(Number(s.kg_actual))}" style="${inp}"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('traspaso-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarTraspaso(${id})" style="font-size:13px;padding:10px 18px">Traspasar</button></div>
  </div>`;
  document.body.appendChild(ov);
}
async function confirmarTraspaso(id){
  const dest=document.getElementById('tr-dest').value;
  const kg=Number(document.getElementById('tr-kg').value)||0;
  if(!dest||!kg){ log('Indica destino y kg','warn'); return; }
  try{ await api('POST','/silos/'+id+'/traspasar',{destino_silo_id:dest,kg}); document.getElementById('traspaso-ov')?.remove(); await cargarSilos(); }
  catch(e){ log('Error en el traspaso','warn'); }
}

// ── PRODUCCIÓN BB / Sacos / Final (Fase 2) ────────────────────────────────────
let prodData=[], prodFiltro={bb:'todos',saco:'todos'};
function siloDeMaterial(mp_id){ return silosData.find(s=>String(s.mp_id)===String(mp_id) && Number(s.kg_actual)>0); }
function silosDisponibles(){ return silosData.filter(s=>!s.mp_id || Number(s.kg_actual)<=0); }
async function cargarProd(tipo){
  if(!matPrimas.length) await cargarMatPrimas(false);
  try{ silosData=await api('GET','/silos'); }catch(e){}
  try{ prodData=await api('GET','/producciones'); }catch(e){ prodData=[]; }
  // refresca la vista de producción que esté activa (cola unificada o BB/Sacos)
  if(_activeView==='prodcola') renderProduccionCola(); else renderProd(tipo);
}
// ── PRODUCCIÓN · Cola única agrupada por material (Fase A) ─────────────────────
async function cargarProduccionCola(){
  if(!matPrimas.length) await cargarMatPrimas(false);
  if(!clientesAuto.length){ try{ clientesAuto=await api('GET','/clientes-auto'); }catch(e){} }
  try{ silosData=await api('GET','/silos'); }catch(e){}
  try{ prodData=await api('GET','/producciones'); }catch(e){ prodData=[]; }
  try{ viajesData=await api('GET','/viajes'); }catch(e){}
  renderProduccionCola();
}
// kg de material en camino hacia el silo (viajes pendientes de ese material)
function _enCaminoKg(mpid){ if(!mpid) return 0; return (viajesData||[]).filter(v=>String(v.mp_id)===String(mpid) && v.estado==='pendiente').reduce((s,v)=>s+Number(v.kg||0),0); }
let _prodColaFiltro='todos';
function setProdColaFiltro(v){ _prodColaFiltro=v; renderProduccionCola(); }
// Detecta el material a partir de una descripción libre. No exige el nombre
// completo: trocea en palabras, descarta ruido (bb, saco, kg, granulometría…)
// y casa por las palabras DISTINTIVAS del material (p.ej. "A Blanca 0-4mm" →
// "Arena blanca" por "blanca"; "Gr Forna" → "Gravilla forna" por "forna").
const _matStop=new Set(['bb','big','bag','saco','sacos','palet','pallet','paleta','cliente','kg','kgs','mm','cm','ud','uds','de','del','la','el','y','con','para','x','granel']);
function _matToks(s){ return (''+(s||'')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9]+/).filter(Boolean); }
// granulometrías de un texto: 0-4, 12-20, 0/2 → "0-4","12-20","0-2"
function _matGranos(s){ const n=(''+(s||'')).toLowerCase(); const o=[]; let m; const re=/(\d+)\s*[-/]\s*(\d+)/g; while((m=re.exec(n))) o.push(m[1]+'-'+m[2]); return o; }
function matchMaterialDesc(desc){
  const d=_matToks(desc); if(!d.length) return null;
  const dG=_matGranos(desc);
  const isNum=t=>/[0-9]/.test(t);
  const has=t=>d.some(w=>w===t || (!isNum(w)&&w.length>=3&&(w.startsWith(t)||t.startsWith(w))));
  let best=null,bestScore=-1;
  for(const m of matPrimas){ if(m.activo===false) continue;
    const st=_matToks(m.nombre).filter(t=>t.length>=2 && !isNum(t) && !_matStop.has(t));
    if(!st.length) continue;
    let matched=0,strong=0,sum=0;
    for(const t of st){ if(has(t)){ matched++; sum+=t.length; if(t.length>=4) strong++; } }
    // vale si casan TODAS las palabras del material, o al menos una distintiva (≥4 letras)
    if(!((matched===st.length)||(strong>=1&&matched>=1))) continue;
    // granulometría: si el material la lleva y la descripción también, deben
    // coincidir (0-4 ≠ 0-2 = otro producto). Si chocan, descartar este material.
    const mG=_matGranos(m.nombre); let gScore=0;
    if(mG.length && dG.length){ if(!mG.some(g=>dG.includes(g))) continue; gScore=500; }
    const score=matched*1000+gScore+sum;
    if(score>bestScore){ best=m; bestScore=score; }
  }
  return best;
}
function renderProduccionCola(){
  const el=document.getElementById('produccion-content'); if(!el) return;
  const esc=s=>(''+(s||'')).replace(/</g,'&lt;');
  let base=prodData.slice();
  if(_prodColaFiltro!=='todos') base=base.filter(p=>p.tipo===_prodColaFiltro);
  const activas=base.filter(p=>p.estado!=='hecho');
  const hechasHoy=base.filter(p=>p.estado==='hecho' && p.hecho_at && _fechaISO(p.hecho_at)===_hoyISO());
  // KPIs
  const uPend=activas.reduce((s,p)=>s+Number(p.unidades||0),0);
  const enProc=activas.filter(p=>p.estado==='en_proceso').length;
  const uHoy=hechasHoy.reduce((s,p)=>s+Number(p.unidades||0),0);
  // Agrupar por material
  const grupos={};
  activas.forEach(p=>{
    let mat=p.material;
    if(!mat){ const m=matchMaterialDesc(p.notas||p.cliente); if(m){ mat=m.nombre; p._matDerivado=true; p._mpDerivado=m.id; } }
    const k=mat||'(sin material asignado)';
    (grupos[k]=grupos[k]||[]).push(p);
  });
  // Ordenar tareas dentro de cada grupo: en proceso primero, luego por prioridad (orden desc)
  Object.values(grupos).forEach(g=>g.sort((a,b)=>({en_proceso:0,pendiente:1}[a.estado]-{en_proceso:0,pendiente:1}[b.estado]) || (Number(b.orden||0)-Number(a.orden||0))));
  // Ordenar materiales: los que están en silo (listos) primero, luego por unidades pendientes desc
  const keys=Object.keys(grupos).sort((a,b)=>{
    const sa=grupos[a][0].mp_id?siloDeMaterial(grupos[a][0].mp_id):null;
    const sb=grupos[b][0].mp_id?siloDeMaterial(grupos[b][0].mp_id):null;
    if((!!sb)!==(!!sa)) return (sb?1:0)-(sa?1:0);
    return grupos[b].reduce((s,p)=>s+Number(p.unidades||0),0)-grupos[a].reduce((s,p)=>s+Number(p.unidades||0),0);
  });
  const fb=(v,l)=>`<button onclick="setProdColaFiltro('${v}')" style="font-size:11px;padding:6px 12px;border-radius:20px;border:1px solid var(--border2);cursor:pointer;${_prodColaFiltro===v?'background:var(--blue);color:#fff;border-color:var(--blue)':'background:var(--surface);color:var(--text2)'}">${l}</button>`;
  let html=`<div class="cargas-hdr">
      <span class="cargas-title"><i class="ti ti-cube"></i> Cola de producción</span>
      <span style="display:flex;gap:6px"><button class="btn-sec" onclick="informeProduccionExcel()" style="font-size:12px;padding:7px 12px"><i class="ti ti-file-spreadsheet"></i> Informe</button><button class="btn-primary" onclick="abrirFormProd('bb')" style="font-size:12px;padding:7px 12px"><i class="ti ti-plus"></i> Nueva tarea</button></span></div>
    <div style="display:flex;gap:6px;margin-bottom:12px">${fb('todos','Todo')}${fb('bb','Big Bags')}${fb('saco','Sacos')}</div>
    <div class="dash-kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
      <div class="dash-card"><div class="dash-lbl">Pendiente</div><div class="dash-val">${fmtN(uPend)}</div><div class="dash-sub">unidades por producir</div></div>
      <div class="dash-card"><div class="dash-lbl">En proceso</div><div class="dash-val" style="color:var(--blue)">${enProc}</div><div class="dash-sub">tareas en marcha</div></div>
      <div class="dash-card"><div class="dash-lbl">Hecho hoy</div><div class="dash-val" style="color:var(--green)">${fmtN(uHoy)}</div><div class="dash-sub">unidades</div></div>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:10px"><i class="ti ti-info-circle"></i> Agrupado por material para hacer los menos cambios posibles. El mismo material, distintos clientes/envases, va junto.</div>`;
  if(!keys.length){ html+='<div class="empty-state"><i class="ti ti-cube"></i>Sin tareas pendientes</div>'; }
  const grupoSilo=k=>{ const mp=grupos[k][0].mp_id||grupos[k][0]._mpDerivado; return mp?siloDeMaterial(mp):null; };
  const renderGrupo=(mat)=>{
    const g=grupos[mat];
    const mpid=g[0].mp_id||g[0]._mpDerivado;
    const silo=mpid?siloDeMaterial(mpid):null;
    const ready=!!silo;
    const derivado=g.some(p=>p._matDerivado);
    const totU=g.reduce((s,p)=>s+Number(p.unidades||0),0);
    const enCamino=_enCaminoKg(mpid);
    const siloHtml=silo
      ? `<span class="badge b-green"><i class="ti ti-package" style="font-size:10px"></i> ${silo.nombre} · ${fmtN(silo.kg_actual)} kg${enCamino>0?` · +${fmtN(enCamino)} en camino`:''}</span>`
      : (enCamino>0
        ? `<span class="badge b-amber"><i class="ti ti-truck-delivery" style="font-size:10px"></i> ${fmtN(enCamino)} kg en camino</span>`
        : `<span class="badge b-amber"><i class="ti ti-alert-triangle" style="font-size:10px"></i> sin material en silo · pedir al camión</span>`);
    const accent=ready?'var(--green)':'var(--blue)';
    const hdrBg=ready?'var(--green-l)':'var(--blue-l)';
    const titleCol=ready?'var(--green)':'var(--blue-d)';
    const ico=ready?'<i class="ti ti-bolt-filled" style="font-size:16px;color:var(--green)"></i>':'<i class="ti ti-cube" style="font-size:16px;color:var(--blue-d)"></i>';
    return `<div class="list-card" style="margin-bottom:14px;border-left:5px solid ${accent}${ready?';box-shadow:0 0 0 1.5px var(--green)':''}">
      <div class="lc-hdr" style="background:${hdrBg}">
        <span style="display:flex;align-items:center;gap:8px">${ico}<b style="font-size:15px;color:${titleCol}">${esc(mat)}</b><span style="font-size:11px;color:var(--text2)">· ${g.length} tarea${g.length>1?'s':''} · ${fmtN(totU)} ud</span>${ready?'<span style="font-size:9px;font-weight:800;background:var(--green);color:#fff;border-radius:8px;padding:2px 8px;letter-spacing:.3px">PRODUCE YA</span>':''}${derivado?'<span style="font-size:9px;font-weight:700;background:var(--blue-l);color:var(--blue-d);border-radius:8px;padding:2px 7px" title="Material detectado a partir de la descripción">auto-detectado</span>':''}</span>
        ${siloHtml}
      </div>
      ${g.map(p=>prodColaCard(p)).join('')}
    </div>`;
  };
  const listos=keys.filter(grupoSilo), espera=keys.filter(k=>!grupoSilo(k));
  if(listos.length){
    const udL=listos.reduce((s,k)=>s+grupos[k].reduce((a,p)=>a+Number(p.unidades||0),0),0);
    html+=`<div style="display:flex;align-items:center;gap:8px;margin:4px 0 10px;font-size:12px;font-weight:800;color:var(--green)"><i class="ti ti-bolt-filled"></i> LISTO PARA PRODUCIR YA · material en silo <span style="background:var(--green);color:#fff;border-radius:10px;padding:1px 8px;font-size:11px">${listos.length} mat · ${fmtN(udL)} ud</span></div>`;
    listos.forEach(m=>html+=renderGrupo(m));
  }
  if(espera.length){
    html+=`<div style="display:flex;align-items:center;gap:8px;margin:${listos.length?'18px':'4px'} 0 10px;font-size:12px;font-weight:700;color:var(--amber)"><i class="ti ti-clock"></i> Falta material — pedir al camión</div>`;
    espera.forEach(m=>html+=renderGrupo(m));
  }
  // Hechas hoy (plegable simple)
  if(hechasHoy.length){
    html+=`<div class="list-card" style="margin-bottom:14px"><div class="lc-hdr"><span><i class="ti ti-check" style="color:var(--green)"></i> Hechas hoy (${hechasHoy.length})</span></div>
      ${hechasHoy.map(p=>`<div class="list-row"><div class="list-main"><div class="list-name">${esc(p.material||'')}${p.cliente?` · ${esc(p.cliente)}`:''}</div><div class="list-meta">${fmtN(p.unidades)} ${p.tipo==='bb'?'BB':'sacos'}</div></div><button onclick="cambiarEstadoProd('${p.id}','en_proceso')" class="btn-sec" style="font-size:10px;padding:4px 8px">↺ Reabrir</button></div>`).join('')}
    </div>`;
  }
  el.innerHTML=html;
}
function prodColaCard(p){
  const esc=s=>(''+(s||'')).replace(/</g,'&lt;');
  const mpEff=p.mp_id||p._mpDerivado;      // material asignado o detectado de la descripción
  const sinSilo=mpEff && !siloDeMaterial(mpEff);
  const sinMat=!p.mp_id;                    // sin material asignado de verdad (botón "Material")
  const sinMatEff=!mpEff;                   // ni siquiera detectado
  // estado mostrado (deriva "esperando material")
  let est=['var(--amber-l)','var(--amber)','En cola'];
  if(p.estado==='en_proceso') est=['var(--blue-l)','var(--blue-d)','En proceso'];
  else if(sinMatEff||sinSilo) est=['var(--red-l)','var(--red)','Esperando material'];
  const envase=p.cliente
    ? `<span style="font-size:12px;font-weight:700;color:var(--blue-d)"><i class="ti ti-user" style="font-size:11px"></i> ${esc(p.cliente)}</span>`
    : `<span style="font-size:10px;font-weight:700;color:var(--teal);background:var(--teal-l);padding:2px 8px;border-radius:8px"><i class="ti ti-package" style="font-size:10px"></i> PARA STOCK</span>`;
  const tam=`${fmtN(p.unidades)} ${p.tipo==='bb'?'BB':'sacos'}${Number(p.kg_unidad)?` × ${fmtN(p.kg_unidad)} kg`:''}`;
  const acc=`
    ${p.estado==='pendiente'?`<button onclick="cambiarEstadoProd('${p.id}','en_proceso')" class="btn-sec" style="font-size:11px;padding:5px 10px">Empezar</button>`:''}
    <button onclick="marcarHechoProd('${p.id}')" class="btn-primary" style="font-size:11px;padding:5px 10px;background:var(--green)"><i class="ti ti-check"></i> Hecho</button>
    ${sinMat?`<button onclick="asignarMaterialProd('${p.id}')" class="btn-sec" style="font-size:11px;padding:5px 9px;color:var(--blue-d)"><i class="ti ti-tag"></i> Material</button>`:''}
    ${(sinMatEff||sinSilo)?`<button onclick="solicitarMaterialProd('${p.id}')" class="btn-sec" style="font-size:11px;padding:5px 9px"><i class="ti ti-truck-delivery"></i> Pedir</button>`:''}
    <button onclick="abrirFormProd('${p.tipo}','${p.id}')" class="btn-sec" style="font-size:11px;padding:5px 8px"><i class="ti ti-edit"></i></button>`;
  return `<div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <div style="display:flex;flex-direction:column;gap:0;flex-shrink:0">
      <button onclick="moverPrioridadProd('${p.id}',-1)" title="Subir prioridad" style="background:none;border:none;cursor:pointer;color:var(--text3);padding:0 4px;font-size:13px;line-height:1"><i class="ti ti-chevron-up"></i></button>
      <button onclick="moverPrioridadProd('${p.id}',1)" title="Bajar prioridad" style="background:none;border:none;cursor:pointer;color:var(--text3);padding:0 4px;font-size:13px;line-height:1"><i class="ti ti-chevron-down"></i></button>
    </div>
    <div style="flex:1;min-width:160px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px">${envase}<span style="font-size:9px;font-weight:700;background:${est[0]};color:${est[1]};border-radius:8px;padding:2px 8px">${est[2]}</span>${p.fabricante?`<span style="font-size:9px;color:var(--text3)">${esc(p.fabricante)}</span>`:''}</div>
      <div style="font-size:14px;font-weight:700">${tam}</div>
      ${p.notas?`<div style="font-size:11px;color:var(--text2);margin-top:1px"><i class="ti ti-message" style="font-size:10px"></i> ${esc(p.notas)}</div>`:''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${acc}</div>
  </div>`;
}
// Sube/baja la prioridad de una tarea DENTRO de su grupo de material (1 posición).
// OJO: la clave de grupo debe calcularse IGUAL que en renderProduccionCola (incluyendo
// el material auto-detectado de la descripción), o las flechas mueven en el grupo equivocado.
function _matKeyProd(p){
  if(p.material) return p.material;
  const m=matchMaterialDesc(p.notas||p.cliente);
  return (m&&m.nombre)||'(sin material asignado)';
}
function moverPrioridadProd(id, dir){
  const p=prodData.find(x=>String(x.id)===String(id)); if(!p) return;
  const mat=_matKeyProd(p);
  const grupo=prodData.filter(x=>x.estado!=='hecho' && _matKeyProd(x)===mat)
    .sort((a,b)=>({en_proceso:0,pendiente:1}[a.estado]-{en_proceso:0,pendiente:1}[b.estado]) || (Number(b.orden||0)-Number(a.orden||0)));
  const idx=grupo.findIndex(x=>String(x.id)===String(id));
  const j=dir<0?idx-1:idx+1;
  if(j<0||j>=grupo.length) return;
  const ids=grupo.map(x=>String(x.id));
  const t=ids[idx]; ids[idx]=ids[j]; ids[j]=t;
  api('POST','/producciones/reordenar',{ids}).then(()=>cargarProduccionCola()).catch(()=>log('Error al reordenar','warn'));
}
// ── PRODUCCIÓN · Informe Excel (Fase E) ───────────────────────────────────────
async function informeProduccionExcel(){
  log('Generando informe de producción...');
  try{
    await _cargarScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    if(typeof ExcelJS==='undefined') throw new Error('ExcelJS');
    const AZUL='FF185FA5', GRIS='FFD0D7DE', fmtKg='#,##0';
    const borde=()=>({top:{style:'thin',color:{argb:GRIS}},left:{style:'thin',color:{argb:GRIS}},bottom:{style:'thin',color:{argb:GRIS}},right:{style:'thin',color:{argb:GRIS}}});
    const cab=cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:AZUL}};cell.alignment={vertical:'middle',horizontal:'center'};cell.border=borde();};
    const matDe=p=>{ let mat=p.material; if(!mat){ const m=matchMaterialDesc(p.notas||p.cliente); if(m) mat=m.nombre; } return mat||'(sin material)'; };
    // resumen por material
    const M={};
    prodData.forEach(p=>{ const k=matDe(p); const g=M[k]=M[k]||{cola:0,proc:0,hechoHoy:0,stock:0};
      const u=Number(p.unidades||0);
      if(p.estado==='pendiente') g.cola+=u; else if(p.estado==='en_proceso') g.proc+=u;
      else if(p.estado==='hecho'){ if(p.hecho_at&&_fechaISO(p.hecho_at)===_hoyISO()) g.hechoHoy+=u; if(p.servido!==true&&!p.cliente) g.stock+=u; } });
    const wb=new ExcelJS.Workbook(); wb.creator='Cargas Arisac';
    const ws=wb.addWorksheet('Por material'); ws.columns=[{width:26},{width:12},{width:12},{width:12},{width:14}];
    const h=ws.getRow(1); ['Material','En cola','En proceso','Hecho hoy','Stock terminado'].forEach((t,i)=>h.getCell(i+1).value=t); h.eachCell(cab);
    Object.keys(M).sort().forEach(k=>{ const g=M[k]; const r=ws.addRow([k,g.cola,g.proc,g.hechoHoy,g.stock]); [2,3,4,5].forEach(i=>r.getCell(i).numFmt=fmtKg); r.eachCell(c=>c.border=borde()); });
    // detalle de tareas
    const wd=wb.addWorksheet('Tareas'); wd.columns=[{width:26},{width:10},{width:10},{width:10},{width:14},{width:24},{width:12}];
    const hd=wd.getRow(1); ['Material','Tipo','Unidades','Kg/ud','Estado','Cliente / Stock','Hecho'].forEach((t,i)=>hd.getCell(i+1).value=t); hd.eachCell(cab);
    prodData.slice().sort((a,b)=>matDe(a).localeCompare(matDe(b))).forEach(p=>{
      const r=wd.addRow([matDe(p),p.tipo==='bb'?'BB':'Saco',Number(p.unidades||0),Number(p.kg_unidad||0),p.estado,p.cliente||'PARA STOCK',p.hecho_at?_fechaISO(p.hecho_at):'']);
      r.eachCell(c=>c.border=borde());
    });
    const buf=await wb.xlsx.writeBuffer();
    _descargarBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'informe_produccion.xlsx');
    log('Informe de producción generado','ok');
  }catch(e){ log('No se pudo generar el informe: '+e.message,'warn'); }
}
function setProdFiltro(tipo,v){ prodFiltro[tipo]=v; renderProd(tipo); }
let prodVista={bb:'tablero',saco:'tablero'};
function setProdVista(tipo,v){ prodVista[tipo]=v; renderProd(tipo); }
function renderProd(tipo){
  const el=document.getElementById(tipo==='bb'?'prodbb-content':'prodsacos-content'); if(!el) return;
  const titulo=tipo==='bb'?'Producción Big Bag':'Producción Sacos';
  const vista=prodVista[tipo]||'tablero';
  const all=prodData.filter(p=>p.tipo===tipo);
  const envasePl=tipo==='bb'?'big bags':'sacos';
  // resumen del día
  const noHechas=all.filter(p=>p.estado!=='hecho');
  const uPend=noHechas.reduce((s,p)=>s+Number(p.unidades||0),0);
  const kPend=noHechas.reduce((s,p)=>s+Number(p.kg_total||0),0);
  const uHech=all.filter(p=>p.estado==='hecho' && p.hecho_at && _fechaISO(p.hecho_at)===_hoyISO()).reduce((s,p)=>s+Number(p.unidades||0),0);
  const vbtn=(v,lbl,ic)=>`<button onclick="setProdVista('${tipo}','${v}')" style="font-size:11px;padding:6px 11px;border-radius:8px;border:1px solid var(--border);cursor:pointer;${vista===v?'background:var(--blue);color:#fff;border-color:var(--blue)':'background:var(--surface);color:var(--text2)'}"><i class="ti ti-${ic}"></i> ${lbl}</button>`;
  let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:16px;font-weight:500">${titulo}</div>
      <button class="btn-primary" onclick="abrirFormProd('${tipo}')" style="font-size:12px;padding:8px 13px"><i class="ti ti-plus"></i> Nueva tarea</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <div style="flex:1;min-width:120px;background:#FFF3E6;border-radius:10px;padding:9px 12px"><div style="font-size:11px;color:#7A4E00">Pendiente de hacer</div><div style="font-size:16px;font-weight:800;color:#7A4E00">${fmtN(uPend)} ${envasePl} · ${fmtN(kPend)} kg</div></div>
      <div style="flex:1;min-width:100px;background:#EAF3EE;border-radius:10px;padding:9px 12px"><div style="font-size:11px;color:#0F6E56">Hecho hoy</div><div style="font-size:16px;font-weight:800;color:#0F6E56">${fmtN(uHech)} ${envasePl}</div></div></div>
    <div style="display:flex;gap:6px;margin-bottom:14px">${vbtn('tablero','Tablero','layout-kanban')}${vbtn('lista','Lista','list')}</div>`;
  if(vista==='lista'){
    const ord={pendiente:0,en_proceso:1,hecho:2};
    const lista=all.slice().sort((a,b)=>(ord[a.estado]-ord[b.estado]) || (Number(b.orden||0)-Number(a.orden||0)));
    html += lista.length ? lista.map(prodCard).join('') : '<div class="empty-state"><i class="ti ti-clipboard"></i>Sin tareas aquí</div>';
    el.innerHTML=html;
    return;
  }
  // ── TABLERO KANBAN ──
  const cols=[['pendiente','Pendiente','#FBE3E0','#9A2A1B'],['en_proceso','En proceso','#E9F0F8','#0C447C'],['hecho','Hecho','#EAF3EE','#0F6E56']];
  html+=`<div style="font-size:11px;color:var(--text3);margin-bottom:8px"><i class="ti ti-hand-finger"></i> Arrastra una tarjeta a otra columna para cambiar el estado, o súbela/bájala para priorizar.</div>
    <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;-webkit-overflow-scrolling:touch">`;
  cols.forEach(([est,lbl,bg,txt])=>{
    const cards=all.filter(p=>p.estado===est);
    html+=`<div class="kb-col" data-tipo="${tipo}" data-estado="${est}" style="flex:1 0 240px;min-width:240px;background:var(--bg2,var(--surface));border:1px solid var(--border);border-radius:12px;padding:8px;transition:outline .12s">
      <div style="font-size:12px;font-weight:800;color:${txt};background:${bg};border-radius:8px;padding:6px 10px;margin-bottom:8px;display:flex;justify-content:space-between"><span>${lbl}</span><span>${cards.length}</span></div>
      <div class="kb-col-body" style="min-height:70px;display:flex;flex-direction:column;gap:8px">
        ${cards.length?cards.map(kbCard).join(''):'<div class="kb-empty" style="font-size:11px;color:var(--text3);text-align:center;padding:18px 0;border:1px dashed var(--border);border-radius:8px">Suelta aquí</div>'}
      </div></div>`;
  });
  html+=`</div>`;
  el.innerHTML=html;
  initProdBoard(tipo);
}
function kbCard(p){
  const esc=s=>(''+(s||'')).replace(/</g,'&lt;');
  const sinMat=!p.mp_id;
  return `<div class="kb-card" data-id="${p.id}" data-tipo="${p.tipo}" style="background:var(--surface);border:1px solid var(--border2);border-radius:10px;padding:10px 12px;box-shadow:0 1px 2px rgba(0,0,0,.04);cursor:grab">
       ${p.cliente?`<div style="font-size:11px;font-weight:800;color:#0C447C;margin-bottom:2px"><i class="ti ti-user" style="font-size:10px"></i> ${esc(p.cliente)}</div>`:''}
       <div style="font-size:14px;font-weight:800;line-height:1.15">${esc(p.material||p.notas||'(sin material)')}${sinMat?' <span style="font-size:10px;color:#9A2A1B">·sin mat.</span>':''}</div>
       <div style="font-size:12px;color:var(--text2);margin-top:1px">${fmtN(p.unidades)} ${p.tipo==='bb'?'BB':'sacos'}${Number(p.kg_total)?(' · '+fmtN(p.kg_total)+' kg'):''}</div>
       ${sinMat?`<button onclick="event.stopPropagation();asignarMaterialProd('${p.id}')" style="margin-top:6px;font-size:10px;padding:4px 8px;border:1px solid #0C447C;background:#E9F0F8;color:#0C447C;border-radius:7px;cursor:pointer">Asignar material</button>`:''}
   </div>`;
}
let _kb=null;
function initProdBoard(tipo){
  const root=document.getElementById(tipo==='bb'?'prodbb-content':'prodsacos-content'); if(!root) return;
  root.querySelectorAll('.kb-card').forEach(card=>{ card.addEventListener('pointerdown', kbDown); });
}
function kbDown(e){
  if(e.button && e.button!==0) return;
  if(e.target.closest('button')) return;            // no arrancar desde botones internos
  const card=e.currentTarget;
  const startX=e.clientX, startY=e.clientY;
  const pid=card.dataset.id, tipo=card.dataset.tipo;
  let started=false, moved=false;
  const tmPrevent=ev=>{ if(started) ev.preventDefault(); };   // frena el scroll mientras se arrastra
  const begin=()=>{
    started=true;
    const rect=card.getBoundingClientRect();
    const ghost=card.cloneNode(true);
    ghost.style.cssText='position:fixed;margin:0;width:'+rect.width+'px;left:'+rect.left+'px;top:'+rect.top+'px;z-index:10095;pointer-events:none;opacity:.96;transform:rotate(2deg) scale(1.02);box-shadow:0 12px 28px rgba(0,0,0,.28);border-radius:10px';
    document.body.appendChild(ghost);
    card.style.opacity='.3'; document.body.style.userSelect='none';
    _kb={ id:pid, tipo, card, ghost, offx:startX-rect.left, offy:startY-rect.top, col:null };
    try{ if(navigator.vibrate) navigator.vibrate(18); }catch(_){}
  };
  const timer=setTimeout(()=>{ if(!moved) begin(); }, 180);
  const move=ev=>{
    if(!started){
      if(Math.hypot(ev.clientX-startX, ev.clientY-startY)>9){ moved=true; clearTimeout(timer); cleanup(); }  // es scroll
      return;
    }
    ev.preventDefault();
    _kb.ghost.style.left=(ev.clientX-_kb.offx)+'px';
    _kb.ghost.style.top=(ev.clientY-_kb.offy)+'px';
    const el=document.elementFromPoint(ev.clientX,ev.clientY);
    const col=el&&el.closest?el.closest('.kb-col'):null;
    if(col!==_kb.col){ document.querySelectorAll('.kb-col').forEach(c=>{ c.style.outline=(c===col)?'2px dashed var(--blue)':''; c.style.outlineOffset='-2px'; }); _kb.col=col; }
  };
  const up=async ev=>{
    clearTimeout(timer); cleanup();
    if(!started){
      if(!moved && Math.hypot(ev.clientX-startX, ev.clientY-startY)<9){ abrirFormProd(tipo,pid); }   // toque = editar
      return;
    }
    await kbFinish(ev);
  };
  function cleanup(){
    document.removeEventListener('pointermove',move);
    document.removeEventListener('pointerup',up);
    document.removeEventListener('pointercancel',up);
    document.removeEventListener('touchmove',tmPrevent);
    document.body.style.userSelect='';
  }
  document.addEventListener('pointermove',move,{passive:false});
  document.addEventListener('pointerup',up);
  document.addEventListener('pointercancel',up);
  document.addEventListener('touchmove',tmPrevent,{passive:false});
}
async function kbFinish(e){
  const k=_kb; _kb=null;
  if(!k) return;
  k.ghost.remove();
  document.querySelectorAll('.kb-col').forEach(c=>{ c.style.outline=''; });
  const col=k.col;
  if(!col){ k.card.style.opacity=''; return; }
  try{ if(navigator.vibrate) navigator.vibrate(18); }catch(_){}
  const destino=col.dataset.estado, origen=k.card.closest('.kb-col')?.dataset.estado;
  if(destino!==origen){
    if(destino==='hecho'){ k.card.style.opacity=''; marcarHechoProd(k.id); return; }
    await cambiarEstadoProd(k.id, destino);
    return;
  }
  const cards=[...col.querySelectorAll('.kb-card')].filter(c=>c.dataset.id!==k.id);
  let idx=cards.length;
  for(let i=0;i<cards.length;i++){ const r=cards[i].getBoundingClientRect(); if(e.clientY < r.top + r.height/2){ idx=i; break; } }
  const ids=cards.map(c=>c.dataset.id); ids.splice(idx,0,k.id);
  try{ await api('POST','/producciones/reordenar',{ids}); }catch(_){}
  await cargarProd(k.tipo);
}
function prodCard(p){
  const envase=p.tipo==='bb'?'big bag':'saco';
  const silo=siloDeMaterial(p.mp_id);
  const eb={pendiente:['#FBE3E0','#9A2A1B','Pendiente'],en_proceso:['#E9F0F8','#0C447C','En proceso'],hecho:['#EAF3EE','#0F6E56','Hecho']}[p.estado]||['#eee','#555',p.estado];
  let siloInfo;
  if(silo) siloInfo=`<span style="font-size:11px;background:#EAF3EE;color:#0F6E56;border-radius:7px;padding:2px 8px"><i class="ti ti-package"></i> En ${silo.nombre} (${fmtN(silo.kg_actual)} kg)</span>`;
  else { const d=silosDisponibles().map(s=>s.nombre).join(', '); siloInfo=`<span style="font-size:11px;background:#FFF3E6;color:#7A4E00;border-radius:7px;padding:2px 8px">No está en silo${d?' · libres: '+d:''}</span>`; }
  const acc = p.estado==='hecho'
    ? `<button onclick="cambiarEstadoProd('${p.id}','en_proceso')" class="btn-sec" style="font-size:11px;padding:6px 10px">↺ Reabrir</button>`
    : `${p.estado==='pendiente'?`<button onclick="cambiarEstadoProd('${p.id}','en_proceso')" class="btn-sec" style="font-size:11px;padding:6px 10px">Empezar</button>`:''}
       <button onclick="marcarHechoProd('${p.id}')" class="btn-primary" style="font-size:11px;padding:6px 10px;background:#0F6E56"><i class="ti ti-check"></i> Hecho</button>`;
  const sinMat=!p.mp_id;
  const titulo = p.material || (sinMat && p.notas ? p.notas : '(sin material)');
  return `<div class="list-card" style="margin-bottom:10px">
     ${p.cliente?`<div style="background:#0C447C;color:#fff;padding:7px 16px;border-radius:12px 12px 0 0;font-size:16px;font-weight:800"><i class="ti ti-user" style="font-size:14px"></i> ${(''+p.cliente).replace(/</g,'&lt;')}</div>`:''}
     <div class="lc-hdr" style="align-items:flex-start"><span style="display:flex;align-items:center;gap:7px;min-width:0"><i class="ti ti-cube" style="font-size:18px;color:#7A4E00"></i><b style="font-size:17px;font-weight:800;line-height:1.15">${(titulo||'').replace(/</g,'&lt;')}</b>${sinMat?' <span style="font-size:10px;color:#9A2A1B;font-weight:700;white-space:nowrap">· sin material</span>':''}</span><span style="font-size:10px;font-weight:700;background:${eb[0]};color:${eb[1]};border-radius:8px;padding:3px 9px;white-space:nowrap">${eb[2]}</span></div>
     <div style="padding:8px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
       <span style="font-size:20px;font-weight:800">${fmtN(p.unidades)}<span style="font-size:12px;font-weight:600;color:var(--text2)"> ${envase}${Number(p.unidades)===1?'':'s'}${Number(p.kg_unidad)?(' × '+fmtN(p.kg_unidad)+' kg'):''}</span></span>
       ${Number(p.kg_total)?`<span style="font-size:13px;color:var(--text2)">= ${fmtN(p.kg_total)} kg</span>`:''}${siloInfo}
     </div>
     ${(p.material && p.notas)?`<div style="padding:0 16px 6px;font-size:12px;color:var(--text2)">${p.notas.replace(/</g,'&lt;')}</div>`:''}
     <div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 16px;border-top:1px solid var(--border)">${acc}
       ${sinMat?`<button onclick="asignarMaterialProd('${p.id}')" class="btn-sec" style="font-size:11px;padding:6px 10px;color:#0C447C;border-color:#0C447C"><i class="ti ti-tag"></i> Asignar material</button>`:''}
       ${p.estado!=='hecho'?`<button onclick="solicitarMaterialProd('${p.id}')" class="btn-sec" style="font-size:11px;padding:6px 10px"><i class="ti ti-truck-delivery"></i> Solicitar material</button>`:''}
       <button onclick="abrirFormProd('${p.tipo}','${p.id}')" class="btn-sec" style="font-size:11px;padding:6px 10px"><i class="ti ti-edit"></i></button>
       <button onclick="borrarProd('${p.id}','${p.tipo}')" class="btn-sec" style="font-size:11px;padding:6px 10px;color:#9A2A1B"><i class="ti ti-trash"></i></button></div></div>`;
}
let _lastKgU={bb:null,saco:null};
function abrirFormProd(tipo,id){
  const p = id? prodData.find(x=>String(x.id)===String(id)) : {};
  const ov=document.createElement('div'); ov.id='prod-form-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10060;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const opts=matPrimas.filter(m=>m.activo!==false).map(m=>`<option value="${(m.nombre||'').replace(/"/g,'&quot;')}">`).join('');
  const envase=tipo==='bb'?'big bag':'saco';
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">${id?'Editar':'Nueva'} tarea · ${tipo==='bb'?'Big Bag':'Sacos'}</b>
    <input type="hidden" id="pf-id" value="${id||''}"><input type="hidden" id="pf-tipo" value="${tipo}">
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:12px">Material (de materias primas)
      <input id="pf-mat" list="pf-mat-list" placeholder="Buscar…" value="${p.material?(''+p.material).replace(/"/g,'&quot;'):''}" style="${inp}" onchange="prodSiloHint()" oninput="prodSiloHint()"><datalist id="pf-mat-list">${opts}</datalist></label>
    <div id="pf-silohint" style="font-size:11px;margin-top:5px;min-height:15px"></div>
    <div style="display:flex;gap:10px;margin-top:10px">
      <label style="font-size:12px;color:var(--text2);flex:1">Nº de ${envase}s<input id="pf-uni" type="number" min="0" value="${p.unidades!=null?p.unidades:''}" style="${inp}" oninput="prodKgHint()"></label>
      <label style="font-size:12px;color:var(--text2);flex:1">Kg por ${envase}<input id="pf-kgu" type="number" min="0" value="${p.kg_unidad!=null?p.kg_unidad:(!id&&_lastKgU[tipo]!=null?_lastKgU[tipo]:'')}" style="${inp}" oninput="prodKgHint()"></label></div>
    <div id="pf-kghint" style="font-size:12px;color:var(--text2);margin-top:6px"></div>
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:10px">Para <span style="color:var(--text3)">(cliente automático · vacío = Stock)</span>
      <input id="pf-cliente" list="pf-cli-list" placeholder="📦 Stock (estándar)" value="${p.cliente?(''+p.cliente).replace(/"/g,'&quot;'):''}" style="${inp}">
      <datalist id="pf-cli-list">${clientesAuto.map(c=>`<option value="${(c.nombre||'').replace(/"/g,'&quot;')}">`).join('')}</datalist></label>
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:10px">Notas<input id="pf-notas" value="${p.notas?(''+p.notas).replace(/"/g,'&quot;'):''}" style="${inp}"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('prod-form-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="guardarProd()" style="font-size:13px;padding:10px 18px">Guardar</button></div>
  </div>`;
  document.body.appendChild(ov);
  prodSiloHint(); prodKgHint();
}
function prodKgHint(){ const u=Number(document.getElementById('pf-uni')?.value)||0, k=Number(document.getElementById('pf-kgu')?.value)||0; const el=document.getElementById('pf-kghint'); if(el) el.textContent='Total: '+fmtN(u*k)+' kg'; }
function prodSiloHint(){
  const nombre=(document.getElementById('pf-mat')?.value||'').trim().toLowerCase();
  const mp=matPrimas.find(m=>(m.nombre||'').toLowerCase()===nombre);
  const el=document.getElementById('pf-silohint'); if(!el) return;
  if(!mp){ el.innerHTML=''; return; }
  const silo=siloDeMaterial(mp.id);
  if(silo) el.innerHTML=`<span style="color:#0F6E56">✓ Está en ${silo.nombre} (${fmtN(silo.kg_actual)} kg)</span>`;
  else { const d=silosDisponibles().map(s=>s.nombre).join(', '); el.innerHTML=`<span style="color:#7A4E00">No está en ningún silo${d?' · silos libres: '+d:''}</span>`; }
}
async function guardarProd(){
  const id=document.getElementById('pf-id').value, tipo=document.getElementById('pf-tipo').value;
  const nombre=(document.getElementById('pf-mat').value||'').trim();
  let mp=matPrimas.find(m=>(m.nombre||'').toLowerCase()===nombre.toLowerCase());
  if(!mp && nombre){ try{ mp=await api('POST','/materias-primas',{nombre}); await cargarMatPrimas(false); }catch(e){} }
  const body={ tipo, mp_id:mp?mp.id:null, unidades:Number(document.getElementById('pf-uni').value)||0, kg_unidad:Number(document.getElementById('pf-kgu').value)||0, notas:(document.getElementById('pf-notas').value||'').trim()||null, cliente:(document.getElementById('pf-cliente')?.value||'').trim()||null };
  if(body.kg_unidad) _lastKgU[tipo]=body.kg_unidad;
  try{ if(id) await api('PUT','/producciones/'+id,body); else await api('POST','/producciones',body); document.getElementById('prod-form-ov')?.remove(); await cargarProd(tipo); }
  catch(e){ log('Error guardando','warn'); }
}
async function cambiarEstadoProd(id,estado){
  const p=prodData.find(x=>String(x.id)===String(id));
  try{ await api('PATCH','/producciones/'+id+'/estado',{estado}); await cargarProd(p?p.tipo:'bb'); }catch(e){ log('Error','warn'); }
}
function marcarHechoProd(id){
  const p=prodData.find(x=>String(x.id)===String(id)); if(!p) return;
  const silos=silosData.filter(s=>String(s.mp_id)===String(p.mp_id) && Number(s.kg_actual)>0);
  const ov=document.createElement('div'); ov.id='mh-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10063;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const opciones=silos.map((s,i)=>`<label style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer"><input type="radio" name="mh-silo" value="${s.id}" ${i===0?'checked':''}> Descontar de <b>${s.nombre}</b> <span style="color:var(--text2);font-size:12px">(${fmtN(s.kg_actual)} kg)</span></label>`).join('');
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:460px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Marcar hecho · ${(p.material||p.notas||'').replace(/</g,'&lt;')}</b>
    <div style="font-size:13px;color:var(--text2);margin:4px 0 12px">${fmtN(p.unidades)} ${p.tipo==='bb'?'big bags':'sacos'}${Number(p.kg_total)?(' · '+fmtN(p.kg_total)+' kg'):''}</div>
    ${Number(p.kg_total)?'':'<div style="font-size:12px;color:#9A2A1B;background:#FBE3E0;border-radius:8px;padding:8px;margin-bottom:10px">Esta tarea no tiene kg (kg por unidad a 0). Edítala si quieres descontar del silo.</div>'}
    ${opciones||'<div style="font-size:12px;color:#7A4E00;background:#FFF3E6;border-radius:8px;padding:9px;margin-bottom:8px">El material no está en ningún silo: se marcará hecho sin descontar.</div>'}
    ${opciones?'<label style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px dashed var(--border);border-radius:8px;cursor:pointer"><input type="radio" name="mh-silo" value="no"> No descontar de ningún silo</label>':''}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('mh-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarMarcarHecho('${id}')" style="font-size:13px;padding:10px 18px;background:#0F6E56"><i class="ti ti-check"></i> Marcar hecho</button></div>
  </div>`;
  document.body.appendChild(ov);
}
async function confirmarMarcarHecho(id){
  const p=prodData.find(x=>String(x.id)===String(id)); if(!p) return;
  const sel=document.querySelector('input[name=mh-silo]:checked');
  const v=sel?sel.value:'no';
  const descontar=v!=='no', silo_id=descontar?v:null;
  try{ await api('PATCH','/producciones/'+id+'/estado',{estado:'hecho',descontar,silo_id}); document.getElementById('mh-ov')?.remove(); await cargarProd(p.tipo); }
  catch(e){ log('Error','warn'); }
}
function asignarMaterialProd(id){
  const p=prodData.find(x=>String(x.id)===String(id)); if(!p) return;
  const ov=document.createElement('div'); ov.id='am-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10063;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const opts=matPrimas.filter(m=>m.activo!==false).map(m=>`<option value="${(m.nombre||'').replace(/"/g,'&quot;')}">`).join('');
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:440px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Asignar material</b>
    ${p.notas?`<div style="font-size:12px;color:var(--text2);margin:2px 0 10px">${(''+p.notas).replace(/</g,'&lt;')}</div>`:''}
    <input id="am-mat" list="am-mat-list" placeholder="Buscar materia prima…" value="${p.material?(''+p.material).replace(/"/g,'&quot;'):''}" style="${inp}"><datalist id="am-mat-list">${opts}</datalist>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('am-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarAsignarMaterial('${id}')" style="font-size:13px;padding:10px 18px">Guardar</button></div>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(()=>document.getElementById('am-mat')?.focus(),60);
}
async function confirmarAsignarMaterial(id){
  const p=prodData.find(x=>String(x.id)===String(id)); if(!p) return;
  const nombre=(document.getElementById('am-mat').value||'').trim();
  let mp=matPrimas.find(m=>(m.nombre||'').toLowerCase()===nombre.toLowerCase());
  if(!mp && nombre){ try{ mp=await api('POST','/materias-primas',{nombre}); await cargarMatPrimas(false); }catch(e){} }
  try{ await api('PUT','/producciones/'+id,{mp_id:mp?mp.id:null, unidades:p.unidades, kg_unidad:p.kg_unidad, notas:p.notas}); document.getElementById('am-ov')?.remove(); await cargarProd(p.tipo); }
  catch(e){ log('Error','warn'); }
}
async function borrarProd(id,tipo){ if(!confirm('¿Borrar esta tarea?')) return; try{ await api('DELETE','/producciones/'+id); await cargarProd(tipo); }catch(e){ log('Error','warn'); } }
async function cargarProdFinal(){
  if(!matPrimas.length) await cargarMatPrimas(false);
  try{ prodData=await api('GET','/producciones'); }catch(e){ prodData=[]; }
  renderProdFinal();
}
let prodFinalHoy=true;
function setProdFinalHoy(v){ prodFinalHoy=v; renderProdFinal(); }
function renderProdFinal(){
  const el=document.getElementById('prodfinal-content'); if(!el) return;
  const hoy=_hoyISO();
  let hechas=prodData.filter(p=>p.estado==='hecho');
  if(prodFinalHoy) hechas=hechas.filter(p=>p.hecho_at && _fechaISO(p.hecho_at)===hoy);
  hechas=hechas.sort((a,b)=>(''+(b.hecho_at||'')).localeCompare(''+(a.hecho_at||'')));
  const tg=(v,lbl)=>`<button onclick="setProdFinalHoy(${v})" style="font-size:12px;padding:7px 13px;border-radius:8px;border:1px solid var(--border);cursor:pointer;${prodFinalHoy===v?'background:var(--blue);color:#fff;border-color:var(--blue)':'background:var(--surface);color:var(--text2)'}">${lbl}</button>`;
  const head=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px"><div style="font-size:16px;font-weight:500">Producción final</div><button class="btn-sec" onclick="exportarProdFinal()" style="font-size:11px;padding:6px 11px"><i class="ti ti-file-spreadsheet"></i> Exportar Excel</button></div>
    <div style="display:flex;gap:6px;margin-bottom:12px">${tg(true,'Hoy')}${tg(false,'Todo')}</div>`;
  if(!hechas.length){ el.innerHTML=head+'<div class="empty-state"><i class="ti ti-checklist"></i>'+(prodFinalHoy?'Hoy todavía no hay producción terminada':'Aún no hay producción terminada')+'</div>'; return; }
  const tBB=hechas.filter(p=>p.tipo==='bb').reduce((s,p)=>s+Number(p.unidades||0),0);
  const tSC=hechas.filter(p=>p.tipo==='saco').reduce((s,p)=>s+Number(p.unidades||0),0);
  const tKg=hechas.reduce((s,p)=>s+Number(p.kg_total||0),0);
  const chip=(l,v)=>`<div style="flex:1;min-width:90px;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:8px 12px;font-size:12px;color:var(--text2)">${l}<br><b style="font-size:16px;color:var(--text)">${v}</b></div>`;
  // desglose por material
  const porMat={}; hechas.forEach(p=>{ const k=p.material||'(sin material)'; if(!porMat[k])porMat[k]={u:0,kg:0}; porMat[k].u+=Number(p.unidades||0); porMat[k].kg+=Number(p.kg_total||0); });
  const matRows=Object.keys(porMat).sort().map(k=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span>${k.replace(/</g,'&lt;')}</span><span style="color:var(--text2)"><b>${fmtN(porMat[k].u)}</b> ud · ${fmtN(porMat[k].kg)} kg</span></div>`).join('');
  // desglose por fabricante (sacos)
  const porFab={}; hechas.forEach(p=>{ if(!p.fabricante)return; if(!porFab[p.fabricante])porFab[p.fabricante]={u:0,kg:0}; porFab[p.fabricante].u+=Number(p.unidades||0); porFab[p.fabricante].kg+=Number(p.kg_total||0); });
  const fabKeys=Object.keys(porFab).sort();
  const fabRows=fabKeys.map(k=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span><b style="color:#0C447C">${k}</b></span><span style="color:var(--text2)"><b>${fmtN(porFab[k].u)}</b> ud · ${fmtN(porFab[k].kg)} kg</span></div>`).join('');
  el.innerHTML=head+
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${chip('Big bags',fmtN(tBB))}${chip('Sacos',fmtN(tSC))}${chip('Total',fmtN(tKg)+' kg')}</div>`+
    `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:12px"><div style="font-size:12px;color:var(--text2);margin-bottom:4px">Por material</div>${matRows}</div>`+
    (fabKeys.length?`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:12px"><div style="font-size:12px;color:var(--text2);margin-bottom:4px">Por fabricante (sacos)</div>${fabRows}</div>`:'')+
    hechas.map(p=>`<div class="list-card" style="margin-bottom:8px">
      ${p.cliente?`<div style="background:#0C447C;color:#fff;padding:5px 14px;border-radius:12px 12px 0 0;font-size:13px;font-weight:700"><i class="ti ti-user" style="font-size:12px"></i> ${(''+p.cliente).replace(/</g,'&lt;')}</div>`:''}
      <div style="display:flex;justify-content:space-between;padding:10px 14px;gap:8px">
      <div><div style="font-size:14px;font-weight:600">${(p.material||p.notas||'(sin material)').replace(/</g,'&lt;')}${p.fabricante?` <span style="font-size:10px;font-weight:700;background:#E9F0F8;color:#0C447C;border-radius:6px;padding:1px 7px">${p.fabricante}</span>`:''}</div><div style="font-size:11px;color:var(--text2)">${p.tipo==='bb'?'Big bag':'Saco'}${p.silo_nombre?(' · de '+p.silo_nombre):''}${p.hecho_at?(' · '+fmtDate(p.hecho_at)):''}</div></div>
      <div style="text-align:right"><div style="font-size:15px;font-weight:800">${fmtN(p.unidades)}${Number(p.kg_unidad)?` <span style="font-size:11px;color:var(--text2)">× ${fmtN(p.kg_unidad)}kg</span>`:''}</div>${Number(p.kg_total)?`<div style="font-size:11px;color:var(--text2)">${fmtN(p.kg_total)} kg</div>`:''}</div>
    </div></div>`).join('');
}
async function exportarProdFinal(){
  const hoy=_hoyISO();
  let hechas=prodData.filter(p=>p.estado==='hecho');
  if(prodFinalHoy) hechas=hechas.filter(p=>p.hecho_at && _fechaISO(p.hecho_at)===hoy);
  const rows=[['Fecha','Cliente','Material','Envase','Fabricante','Unidades','Kg/ud','Kg total','Silo']];
  hechas.forEach(p=>rows.push([p.hecho_at?fmtDate(p.hecho_at):'',p.cliente||'',p.material||p.notas||'',p.tipo==='bb'?'Big bag':'Saco',p.fabricante||'',p.unidades,p.kg_unidad,p.kg_total,p.silo_nombre||'']));
  try{ await _cargarScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Producción'); rows.forEach(r=>ws.addRow(r)); ws.getRow(1).font={bold:true};
    const buf=await wb.xlsx.writeBuffer(); _descargarBlob(new Blob([buf]),'produccion_'+(prodFinalHoy?hoy:'todo')+'.xlsx');
  }catch(e){ _descargarBlob(new Blob([rows.map(r=>r.join(';')).join('\n')],{type:'text/csv'}),'produccion_'+(prodFinalHoy?hoy:'todo')+'.csv'); }
}

// ── CAMIÓN (Fase 3) ───────────────────────────────────────────────────────────
let viajesData=[], camionFiltro='pendiente';
async function cargarViajes(){
  if(!matPrimas.length) await cargarMatPrimas(false);
  try{ silosData=await api('GET','/silos'); }catch(e){}
  try{ viajesData=await api('GET','/viajes'); }catch(e){ viajesData=[]; }
  renderCamion();
  cargarMantData().then(()=>renderCamion());   // para el aviso de la pestaña Mantenimiento
}
let camionTab='viajes';
function setCamionFiltro(v){ camionFiltro=v; renderCamion(); }
function setCamionTab(t){ camionTab=t; renderCamion(); }
function renderCamion(){
  const el=document.getElementById('camion-content'); if(!el) return;
  const tb=(v,lbl,ic)=>`<button onclick="setCamionTab('${v}')" style="flex:1;font-size:12.5px;padding:12px 6px;border:none;background:none;border-bottom:2.5px solid ${camionTab===v?'var(--blue)':'transparent'};color:${camionTab===v?'var(--blue-d)':'var(--text2)'};font-weight:${camionTab===v?'700':'500'};cursor:pointer;white-space:nowrap"><i class="ti ti-${ic}"></i> ${lbl}</button>`;
  el.innerHTML=`<div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:14px">${tb('viajes','Viajes','truck')}${tb('historial','Historial','calendar-stats')}${tb('mant','Mantenimiento'+((mantItems&&mantOverdue().length)?` <span style="background:#A32D2D;color:#fff;border-radius:10px;font-size:9px;padding:1px 6px;margin-left:1px;font-weight:700">${mantOverdue().length}</span>`:''),'tool')}</div><div id="camion-sub"></div>`;
  if(camionTab==='viajes') renderCamionViajes();
  else if(camionTab==='historial') renderCamionHistorial();
  else renderCamionMant();
}
function renderCamionViajes(){
  const el=document.getElementById('camion-sub'); if(!el) return;
  const pend=viajesData.filter(v=>v.estado!=='hecho' && v.origen!=='compra'), hechos=viajesData.filter(v=>v.estado==='hecho' && v.origen!=='compra');
  const hoy=_hoyISO();
  const hoyHechos=hechos.filter(v=>v.hecho_at && _fechaISO(v.hecho_at)===hoy);
  const strip=silosData.map(s=>{ const pct=Math.round((Number(s.kg_actual)||0)/(Number(s.capacidad_kg)||1)*100); return `<div style="flex:0 0 auto;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:6px 10px;font-size:11px;white-space:nowrap"><b>${s.nombre}</b> · ${s.producto?(''+s.producto).replace(/</g,'&lt;'):'vacío'} · ${pct}%</div>`; }).join('');
  const fbtn=(v,lbl,n)=>`<button onclick="setCamionFiltro('${v}')" style="font-size:11px;padding:6px 11px;border-radius:8px;border:1px solid var(--border);cursor:pointer;${camionFiltro===v?'background:var(--blue);color:#fff;border-color:var(--blue)':'background:var(--surface);color:var(--text2)'}">${lbl}${n!=null?(' ('+n+')'):''}</button>`;
  let html=`<div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn-primary" onclick="abrirFormViaje()" style="font-size:12px;padding:8px 13px"><i class="ti ti-plus"></i> Nuevo viaje</button></div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:4px">Estado de las tolvas (dónde echar)</div>
    <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:14px;padding-bottom:2px">${strip||'<span style="font-size:12px;color:var(--text3)">sin silos</span>'}</div>
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">${fbtn('pendiente','Pendientes',pend.length)}${fbtn('hecho','Hechos',hechos.length)}${fbtn('hoy','Parte de hoy',null)}</div>`;
  if(camionFiltro==='hoy'){
    const kgHoy=hoyHechos.reduce((s,v)=>s+Number(v.kg_final||v.kg||0),0);
    const porDest={};
    hoyHechos.forEach(v=>{ const k=v.destino_tipo==='silo'?('Silo '+(v.destino_silo_nombre||'')):('Acopio'+(v.acopio?(' '+v.acopio):'')); porDest[k]=(porDest[k]||0)+Number(v.kg_final||v.kg||0); });
    const destRows=Object.keys(porDest).map(k=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:#E8EDF2"><span>${k.replace(/</g,'&lt;')}</span><span>${fmtN(porDest[k])} kg</span></div>`).join('')||'<div style="font-size:12px;color:#9FB0C2">Sin descargas hoy todavía</div>';
    html+=`<div style="background:#1B2430;border-radius:12px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px">
          <div><div style="font-size:11px;color:#9FB0C2">Parte de hoy · ${fmtDate(hoy)}</div><div style="font-size:18px;font-weight:800;color:#fff">${hoyHechos.length} viaje(s) · ${fmtN(kgHoy)} kg</div></div>
          <button class="btn-primary" onclick="exportarParteCamion()" style="font-size:11px;padding:8px 12px"><i class="ti ti-file-spreadsheet"></i> Exportar</button></div>
        <div style="border-top:1px solid #2A3645;padding-top:8px">${destRows}</div>
        ${pend.length?`<div style="font-size:11px;color:#9FB0C2;margin-top:8px">Quedan ${pend.length} viaje(s) pendiente(s) en cola</div>`:''}</div>`;
    html += hoyHechos.length ? hoyHechos.map(viajeCard).join('') : '<div class="empty-state"><i class="ti ti-truck"></i>Aún no hay viajes completados hoy</div>';
    el.innerHTML=html; return;
  }
  const lista = camionFiltro==='pendiente'?pend:hechos;
  html += lista.length ? lista.map(viajeCard).join('') : '<div class="empty-state"><i class="ti ti-truck"></i>Sin viajes</div>';
  el.innerHTML=html;
}
function viajeCard(v){
  if(v.estado==='hecho'){
    const dest=v.destino_tipo==='silo'?('Silo: '+(v.destino_silo_nombre||'')):('Acopio'+(v.acopio?': '+v.acopio:''));
    return `<div class="list-card" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;padding:10px 14px;gap:8px">
      <div><div style="font-size:14px;font-weight:600">${(v.material||'').replace(/</g,'&lt;')}</div><div style="font-size:11px;color:var(--text2)"><i class="ti ti-check" style="color:#0F6E56"></i> ${dest}${v.hecho_at?(' · '+fmtDate(v.hecho_at)):''}</div></div>
      <div style="text-align:right;font-size:15px;font-weight:800">${fmtN(v.kg_final||v.kg)} kg</div></div></div>`;
  }
  const silo=silosData.find(s=>String(s.id)===String(v.silo_id));
  return `<div class="list-card" style="margin-bottom:10px">
     <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 16px 2px"><span style="font-size:17px;font-weight:800"><i class="ti ti-cube" style="font-size:15px;color:#7A4E00"></i> ${(v.material||'(sin material)').replace(/</g,'&lt;')}</span>${Number(v.kg)>0?`<span style="font-size:11px;color:var(--text2)">${fmtN(v.kg)} kg</span>`:''}</div>
     <div style="padding:8px 16px"><span style="font-size:13px;background:#E9F0F8;color:#0C447C;border-radius:8px;padding:4px 11px"><i class="ti ti-arrow-down"></i> Echar a: <b>${silo?silo.nombre:'(sin asignar)'}</b></span>${v.origen==='produccion'?' <span style="font-size:10px;color:var(--text3)">· lo pidió producción</span>':''}</div>
     ${v.notas?`<div style="padding:0 16px 6px;font-size:12px;color:var(--text2)">${v.notas.replace(/</g,'&lt;')}</div>`:''}
     <div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 16px;border-top:1px solid var(--border)">
       <button onclick="abrirCompletarViaje('${v.id}')" class="btn-primary" style="font-size:11px;padding:7px 12px;background:#0F6E56"><i class="ti ti-package-import"></i> Descargar</button>
       <button onclick="abrirFormViaje('${v.id}')" class="btn-sec" style="font-size:11px;padding:7px 10px"><i class="ti ti-edit"></i></button>
       <button onclick="borrarViaje('${v.id}')" class="btn-sec" style="font-size:11px;padding:7px 10px;color:#9A2A1B"><i class="ti ti-trash"></i></button></div></div>`;
}
function _tons(kg){ return (Number(kg||0)/1000).toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:2})+' t'; }
// ── Historial por días ──
let _camHistAbierto=null;
function renderCamionHistorial(){
  const el=document.getElementById('camion-sub'); if(!el) return;
  const hechos=viajesData.filter(v=>v.estado==='hecho' && v.hecho_at && v.origen!=='compra');
  const dias={};
  hechos.forEach(v=>{ const d=_fechaISO(v.hecho_at); if(!dias[d])dias[d]={dia:d,kg:0,viajes:[],mat:{}}; const kg=Number(v.kg_final||v.kg||0); dias[d].kg+=kg; dias[d].viajes.push(v); const m=(v.material||'Sin material'); dias[d].mat[m]=(dias[d].mat[m]||0)+kg; });
  const lista=Object.values(dias).sort((a,b)=>b.dia.localeCompare(a.dia));
  if(!lista.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-calendar-off"></i>Aún no hay viajes completados</div>'; return; }
  const totalKg=lista.reduce((s,d)=>s+d.kg,0);
  let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
     <div style="font-size:13px;color:var(--text2)">${lista.length} día(s) · <b style="color:var(--text)">${_tons(totalKg)}</b> en total</div>
     <button class="btn-primary" onclick="exportarHistorialCamion()" style="font-size:12px;padding:8px 12px"><i class="ti ti-file-spreadsheet"></i> Exportar</button></div>`;
  html+=lista.map(d=>{
    const abierto=_camHistAbierto===d.dia;
    const mats=Object.keys(d.mat).sort((a,b)=>d.mat[b]-d.mat[a]);
    const matRows=mats.map(m=>`<div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-top:1px solid var(--border)"><span>${m.replace(/</g,'&lt;')}</span><span style="font-weight:700">${_tons(d.mat[m])} <span style="font-size:11px;color:var(--text2);font-weight:400">(${fmtN(d.mat[m])} kg)</span></span></div>`).join('');
    const viajeRows=abierto?d.viajes.map(v=>{ const dest=v.destino_tipo==='silo'?('Tolva: '+(v.destino_silo_nombre||'')):('Acopio'+(v.acopio?': '+v.acopio:'')); return `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);padding:3px 0"><span>${(v.material||'').replace(/</g,'&lt;')} · ${dest}</span><span>${fmtN(v.kg_final||v.kg||0)} kg</span></div>`; }).join(''):'';
    return `<div class="list-card" style="margin-bottom:10px">
       <div onclick="toggleCamHist('${d.dia}')" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;cursor:pointer">
         <div><div style="font-size:15px;font-weight:700">${fmtDate(d.dia)}</div><div style="font-size:11px;color:var(--text2)">${d.viajes.length} viaje(s)</div></div>
         <div style="text-align:right;display:flex;align-items:center;gap:8px"><div style="font-size:18px;font-weight:800">${_tons(d.kg)}</div><i class="ti ti-chevron-${abierto?'up':'down'}" style="color:var(--text3)"></i></div></div>
       <div style="padding:0 14px 10px">${matRows}${abierto&&viajeRows?`<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)"><div style="font-size:11px;color:var(--text3);margin-bottom:2px">Viajes del día</div>${viajeRows}</div>`:''}</div>
     </div>`;
  }).join('');
  el.innerHTML=html;
}
function toggleCamHist(d){ _camHistAbierto=(_camHistAbierto===d)?null:d; renderCamionHistorial(); }
async function exportarHistorialCamion(){
  const hechos=viajesData.filter(v=>v.estado==='hecho' && v.hecho_at && v.origen!=='compra').slice().sort((a,b)=>_fechaISO(a.hecho_at).localeCompare(_fechaISO(b.hecho_at)));
  const rows=[['Fecha','Material','Destino','Kg','Toneladas']];
  hechos.forEach(v=>{ const dest=v.destino_tipo==='silo'?('Tolva '+(v.destino_silo_nombre||'')):('Acopio'+(v.acopio?' '+v.acopio:'')); const kg=Number(v.kg_final||v.kg||0); rows.push([fmtDate(v.hecho_at),v.material||'',dest,kg,Number((kg/1000).toFixed(3))]); });
  try{ await _cargarScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Historial camión'); rows.forEach(r=>ws.addRow(r)); ws.getRow(1).font={bold:true};
    const buf=await wb.xlsx.writeBuffer(); _descargarBlob(new Blob([buf]),'historial_camion.xlsx');
  }catch(e){ _descargarBlob(new Blob([rows.map(r=>r.join(';')).join('\n')],{type:'text/csv'}),'historial_camion.csv'); }
}
// ── Mantenimiento ──
let mantItems=null, mantRegs=[], mantReps=[], mantVehiculo='Camión';
async function cargarMantData(){
  try{ mantItems=await api('GET','/mant/items'); }catch(e){ mantItems=mantItems||[]; }
  try{ mantRegs=await api('GET','/mant/registros'); }catch(e){ mantRegs=[]; }
  try{ mantReps=await api('GET','/mant/reparaciones'); }catch(e){ mantReps=[]; }
}
async function cargarMant(){ await cargarMantData(); renderCamionMant(); }
function mantCurHoras(){
  const hs=[...mantRegs,...mantReps].filter(r=>r.vehiculo===mantVehiculo && r.horas!=null).map(r=>Number(r.horas));
  return hs.length?Math.max(...hs):null;
}
function mantLast(itemId){
  const rs=mantRegs.filter(r=>r.vehiculo===mantVehiculo && String(r.item_id)===String(itemId));
  return rs.length?rs[0]:null; // vienen ordenados por fecha desc
}
function _mantEstado(item,last,curHoras){
  if(!last) return {due:true,txt:'Nunca registrada'};
  const dias=Math.floor((Date.now()-new Date(_fechaISO(last.fecha)+'T00:00:00').getTime())/86400000);
  const diasTxt='Hace '+dias+' día'+(dias===1?'':'s');
  if(item.periodicidad==='semanal') return {due:dias>=7,txt:diasTxt};
  if(item.periodicidad==='mensual') return {due:dias>=30,txt:diasTxt};
  if(item.periodicidad==='250h'){
    if(last.horas!=null && curHoras!=null){ const dh=curHoras-Number(last.horas); return {due:dh>=250,txt:fmtN(dh)+' h desde la última'}; }
    return {due:false,txt:diasTxt};
  }
  return {due:false,txt:diasTxt};
}
function mantOverdue(){
  if(!mantItems) return [];
  const ch=mantCurHoras();
  return mantItems.filter(i=>_mantEstado(i,mantLast(i.id),ch).due);
}
function setMantVeh(v){ mantVehiculo=v; renderCamionMant(); }
function nuevoVehMant(){ const v=prompt('Nombre del vehículo o máquina:'); if(v&&v.trim()){ mantVehiculo=v.trim(); renderCamionMant(); } }
function renderCamionMant(){
  const el=document.getElementById('camion-sub'); if(!el) return;
  if(mantItems===null){ el.innerHTML='<div style="text-align:center;padding:30px;color:var(--text2)"><i class="ti ti-loader"></i> Cargando…</div>'; cargarMant(); return; }
  const vehs=[...new Set(['Camión',...mantRegs.map(r=>r.vehiculo),...mantReps.map(r=>r.vehiculo)].filter(Boolean))];
  if(!vehs.includes(mantVehiculo)) mantVehiculo=vehs[0]||'Camión';
  const vbtns=vehs.map(v=>`<button onclick="setMantVeh('${(''+v).replace(/'/g,"\\'")}')" style="font-size:12px;padding:7px 12px;border-radius:8px;border:1px solid ${v===mantVehiculo?'var(--blue)':'var(--border2)'};background:${v===mantVehiculo?'var(--blue)':'var(--surface)'};color:${v===mantVehiculo?'#fff':'var(--text)'};cursor:pointer">${(''+v).replace(/</g,'&lt;')}</button>`).join('');
  const curHoras=mantCurHoras();
  const peri=[['semanal','Semanal','#F4D35E','#6E5200'],['mensual','Mensual','#9BD17C','#2E5811'],['250h','Cada 250 horas','#7FB3E8','#0C447C']];
  const vencidas=mantOverdue();
  let html=`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px"><span style="font-size:12px;color:var(--text2)">Vehículo:</span>${vbtns}<button onclick="nuevoVehMant()" style="font-size:12px;padding:7px 10px;border-radius:8px;border:1px dashed var(--border2);background:var(--surface);color:var(--text2);cursor:pointer"><i class="ti ti-plus"></i></button></div>`;
  if(vencidas.length){
    html+=`<div style="background:#FCEBEB;border:1px solid #E6A6A6;border-radius:10px;padding:11px 14px;margin-bottom:14px">
       <div style="font-size:13px;font-weight:700;color:#9A2A1B"><i class="ti ti-alert-triangle"></i> ${vencidas.length} revisión(es) pendiente(s)</div>
       <div style="font-size:12px;color:#7A1F1F;margin-top:4px">${vencidas.map(i=>i.nombre.replace(/</g,'&lt;')).join(' · ')}</div></div>`;
  }
  html+=`<div style="font-size:15px;font-weight:700;margin-bottom:6px">Revisiones</div>`;
  peri.forEach(([key,lbl,col,txt])=>{
    const its=mantItems.filter(i=>i.periodicidad===key);
    if(!its.length) return;
    html+=`<div style="font-size:11px;font-weight:700;color:${txt};background:${col};display:inline-block;border-radius:6px;padding:3px 10px;margin:8px 0 6px">${lbl}</div>`;
    html+=its.map(i=>{ const last=mantLast(i.id); const est=_mantEstado(i,last,curHoras);
      const badge = est.due
        ? '<span style="font-size:10px;font-weight:700;background:#FCEBEB;color:#9A2A1B;border-radius:6px;padding:2px 8px;white-space:nowrap"><i class="ti ti-alert-triangle" style="font-size:10px"></i> Toca</span>'
        : '<span style="font-size:10px;font-weight:700;background:#EAF3DE;color:#27500A;border-radius:6px;padding:2px 8px;white-space:nowrap"><i class="ti ti-check" style="font-size:10px"></i> Al día</span>';
      return `<div class="list-card" style="margin-bottom:8px;border-left:4px solid ${est.due?'#A32D2D':col}">
         <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px">
           <div style="min-width:0"><div style="font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${i.nombre.replace(/</g,'&lt;')} ${badge}</div>
             <div style="font-size:11px;color:var(--text2);margin-top:2px">${last?('Última: '+fmtDate(last.fecha)+(last.km!=null?(' · '+fmtN(last.km)+' km'):'')+(last.horas!=null?(' · '+fmtN(last.horas)+' h'):'')+' · '+est.txt):est.txt}</div></div>
           <button onclick="marcarMant('${i.id}')" class="btn-primary" style="font-size:13px;padding:10px 14px;white-space:nowrap;background:#0F6E56"><i class="ti ti-check"></i> Hecho</button>
         </div></div>`;
    }).join('');
  });
  // reparaciones
  const repsVeh=mantReps.filter(r=>r.vehiculo===mantVehiculo);
  html+=`<div style="display:flex;justify-content:space-between;align-items:center;margin:20px 0 8px"><div style="font-size:15px;font-weight:700">Reparaciones</div><button onclick="nuevaReparacion()" class="btn-sec" style="font-size:12px;padding:7px 11px"><i class="ti ti-plus"></i> Añadir</button></div>`;
  html+= repsVeh.length? repsVeh.map(r=>`<div class="list-card" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:10px;padding:11px 14px">
       <div style="min-width:0"><div style="font-size:14px;font-weight:600">${(r.concepto||'—').replace(/</g,'&lt;')}</div><div style="font-size:11px;color:var(--text2)">${fmtDate(r.fecha)}${r.km!=null?(' · '+fmtN(r.km)+' km'):''}${r.horas!=null?(' · '+fmtN(r.horas)+' h'):''}</div></div>
       <button onclick="borrarReparacion('${r.id}')" style="background:none;border:none;color:#9A2A1B;cursor:pointer;font-size:16px"><i class="ti ti-trash"></i></button></div></div>`).join('') : '<div style="font-size:12px;color:var(--text2);padding:6px 2px">Sin reparaciones registradas.</div>';
  // registro / historial de revisiones
  const regsVeh=mantRegs.filter(r=>r.vehiculo===mantVehiculo);
  html+=`<div style="font-size:15px;font-weight:700;margin:20px 0 8px">Registro de revisiones</div>`;
  html+= regsVeh.length? regsVeh.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border)">
       <div style="min-width:0"><div style="font-size:13px;font-weight:600">${(r.item_nombre||'—').replace(/</g,'&lt;')}</div><div style="font-size:11px;color:var(--text2)">${fmtDate(r.fecha)}${r.km!=null?(' · '+fmtN(r.km)+' km'):''}${r.horas!=null?(' · '+fmtN(r.horas)+' h'):''}</div></div>
       <button onclick="borrarRegistroMant('${r.id}')" style="background:none;border:none;color:#9A2A1B;cursor:pointer;font-size:15px"><i class="ti ti-trash"></i></button></div>`).join('') : '<div style="font-size:12px;color:var(--text2);padding:6px 2px">Aún no hay revisiones registradas.</div>';
  el.innerHTML=html;
}
async function borrarRegistroMant(id){
  if(!confirm('¿Borrar este registro de revisión?')) return;
  try{ await api('DELETE','/mant/registros/'+id); await cargarMant(); }catch(e){ log('Error','warn'); }
}
function marcarMant(itemId){
  const it=mantItems.find(i=>String(i.id)===String(itemId)); if(!it) return;
  const lastKm=(mantRegs.filter(r=>r.vehiculo===mantVehiculo && r.km!=null)[0]||{}).km;
  const ov=document.createElement('div'); ov.id='mant-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10072;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const inp='width:100%;font-size:18px;padding:12px;border:2px solid var(--border2);border-radius:10px;background:var(--surface);color:var(--text);box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:440px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:16px">${it.nombre.replace(/</g,'&lt;')}</b>
    <div style="font-size:12px;color:var(--text2);margin:2px 0 14px">${(''+mantVehiculo).replace(/</g,'&lt;')} · marcar como hecho</div>
    <div style="display:flex;gap:10px">
      <label style="flex:1;font-size:12px;color:var(--text2)">Km<input id="mant-km" type="number" inputmode="numeric" value="${lastKm!=null?lastKm:''}" style="${inp}"></label>
      <label style="flex:1;font-size:12px;color:var(--text2)">Horas<input id="mant-horas" type="number" inputmode="numeric" style="${inp}"></label></div>
    <label style="display:block;font-size:12px;color:var(--text2);margin-top:10px">Fecha<input id="mant-fecha" type="date" value="${_hoyISO()}" style="${inp}"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('mant-ov').remove()" style="font-size:13px;padding:11px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarMant('${itemId}')" style="font-size:14px;padding:11px 18px;background:#0F6E56"><i class="ti ti-check"></i> Guardar</button></div>
  </div>`;
  document.body.appendChild(ov);
}
async function confirmarMant(itemId){
  const km=document.getElementById('mant-km')?.value, horas=document.getElementById('mant-horas')?.value, fecha=document.getElementById('mant-fecha')?.value;
  try{
    await api('POST','/mant/registros',{ item_id:itemId, vehiculo:mantVehiculo, km:km?Number(km):null, horas:horas?Number(horas):null, fecha:fecha||null });
    document.getElementById('mant-ov')?.remove();
    await cargarMant(); log('Revisión registrada','ok');
  }catch(e){ log('Error','warn'); }
}
function nuevaReparacion(){
  const ov=document.createElement('div'); ov.id='rep-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10072;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const inp='width:100%;font-size:16px;padding:12px;border:2px solid var(--border2);border-radius:10px;background:var(--surface);color:var(--text);box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:460px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:16px">Nueva reparación</b>
    <div style="font-size:12px;color:var(--text2);margin:2px 0 14px">${(''+mantVehiculo).replace(/</g,'&lt;')}</div>
    <label style="display:block;font-size:12px;color:var(--text2)">Concepto<input id="rep-concepto" placeholder="Qué se reparó" style="${inp}"></label>
    <div style="display:flex;gap:10px;margin-top:10px">
      <label style="flex:1;font-size:12px;color:var(--text2)">Fecha<input id="rep-fecha" type="date" value="${_hoyISO()}" style="${inp}"></label>
      <label style="flex:1;font-size:12px;color:var(--text2)">Km<input id="rep-km" type="number" inputmode="numeric" style="${inp}"></label>
      <label style="flex:1;font-size:12px;color:var(--text2)">Horas<input id="rep-horas" type="number" inputmode="numeric" style="${inp}"></label></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('rep-ov').remove()" style="font-size:13px;padding:11px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarReparacion()" style="font-size:14px;padding:11px 18px"><i class="ti ti-check"></i> Guardar</button></div>
  </div>`;
  document.body.appendChild(ov);
}
async function confirmarReparacion(){
  const concepto=(document.getElementById('rep-concepto')?.value||'').trim();
  if(!concepto){ log('Pon el concepto','warn'); return; }
  const fecha=document.getElementById('rep-fecha')?.value, km=document.getElementById('rep-km')?.value, horas=document.getElementById('rep-horas')?.value;
  try{
    await api('POST','/mant/reparaciones',{ vehiculo:mantVehiculo, concepto, fecha:fecha||null, km:km?Number(km):null, horas:horas?Number(horas):null });
    document.getElementById('rep-ov')?.remove();
    await cargarMant(); log('Reparación guardada','ok');
  }catch(e){ log('Error','warn'); }
}
async function borrarReparacion(id){
  if(!confirm('¿Borrar esta reparación?')) return;
  try{ await api('DELETE','/mant/reparaciones/'+id); await cargarMant(); }catch(e){ log('Error','warn'); }
}
const MATERIALES_CAMION=['Planche','Blanca 0-2','Mortero 0-2','Forna 2-4','Forna 4-6','Forna 6-12','Forna 12-20','Forna 20-25','Machaca 25-60'];
let _vf=null;
function abrirFormViaje(id){
  const v = id? viajesData.find(x=>String(x.id)===String(id)) : null;
  _vf = { id:id||null, material:(v&&v.material)||'', kg:(v&&v.kg!=null?v.kg:''),
          destino: v ? (v.silo_id?{tipo:'silo',silo_id:v.silo_id}:null) : null,
          step: (v&&v.material)?2:1, n:1 };
  const ov=document.createElement('div'); ov.id='viaje-form-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10060;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  ov.innerHTML='<div id="vf-panel" style="background:var(--bg);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px"></div>';
  document.body.appendChild(ov);
  vfRender();
}
function vfClose(){ document.getElementById('viaje-form-ov')?.remove(); }
function vfRender(){
  const p=document.getElementById('vf-panel'); if(!p||!_vf) return;
  if(_vf.step===1){
    p.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px"><b style="font-size:18px">¿Qué sube el camión?</b><button onclick="vfClose()" style="background:none;border:none;font-size:26px;color:var(--text2);cursor:pointer;line-height:1">×</button></div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px">Toca el material</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${MATERIALES_CAMION.map(m=>`<button onclick="vfPickMat(this.dataset.m)" data-m="${m.replace(/"/g,'&quot;')}" style="padding:20px 12px;border-radius:14px;border:2px solid var(--border2);background:var(--surface);color:var(--text);font-size:16px;font-weight:800;cursor:pointer;min-height:70px">${m}</button>`).join('')}
      </div>`;
    return;
  }
  const silos=(silosData||[]).slice().sort((a,b)=>Number(a.numero)-Number(b.numero));
  const inp='width:100%;font-size:26px;font-weight:800;text-align:center;padding:14px;border:2px solid var(--border2);border-radius:12px;background:var(--surface);color:var(--text);box-sizing:border-box';
  const d=_vf.destino;
  const dBtn=(sel,label,sub,onclick)=>`<button onclick="${onclick}" style="padding:14px 6px;border-radius:12px;border:2px solid ${sel?'#0F6E56':'var(--border2)'};background:${sel?'#EAF3EE':'var(--surface)'};color:${sel?'#0F6E56':'var(--text)'};font-weight:800;font-size:15px;cursor:pointer;min-height:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">${label}${sub?`<span style="font-size:10px;font-weight:500;color:${sel?'#0F6E56':'var(--text2)'}">${sub}</span>`:''}</button>`;
  p.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <div><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Material</div>
      <div style="font-size:25px;font-weight:800;line-height:1.1"><i class="ti ti-cube" style="font-size:20px;color:#7A4E00"></i> ${_vf.material}</div></div>
      <button onclick="vfClose()" style="background:none;border:none;font-size:26px;color:var(--text2);cursor:pointer;line-height:1">×</button></div>
    <button onclick="_vf.step=1;vfRender()" class="btn-sec" style="font-size:12px;padding:6px 12px;margin-bottom:16px"><i class="ti ti-arrow-left"></i> Cambiar material</button>
    <div style="font-size:13px;color:var(--text2);margin-bottom:8px">¿A qué tolva va?</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      ${silos.map(s=>dBtn(d&&d.tipo==='silo'&&String(d.silo_id)===String(s.id),'Tolva '+s.numero, s.producto?(''+s.producto).replace(/</g,'&lt;'):'vacía', "vfDest('silo','"+s.id+"')")).join('')}
      ${dBtn(d&&d.tipo==='acopio','Acopio','no va a tolva',"vfDest('acopio','')")}
    </div>
    <div style="font-size:13px;color:var(--text2);margin:18px 0 6px">Kg que sube <span style="color:var(--text3);font-weight:400">· solo si lo descargas ahora</span></div>
    <input id="vf-kg" type="number" inputmode="numeric" min="0" value="${_vf.kg}" placeholder="se ponen al descargar" style="${inp}" oninput="_vf.kg=this.value">
    ${_vf.id
      ? `<button class="btn-primary" onclick="vfConfirm('editar')" style="width:100%;margin-top:20px;font-size:17px;padding:16px;background:#0F6E56;border-radius:12px"><i class="ti ti-check"></i> Guardar cambios</button>`
      : `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:18px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:9px 14px">
           <span style="font-size:13px;color:var(--text2)">Nº de viajes a la cola</span>
           <div style="display:flex;align-items:center;gap:14px">
             <button onclick="vfN(-1)" style="width:40px;height:40px;border-radius:10px;border:1px solid var(--border2);background:var(--surface);color:var(--text);font-size:24px;font-weight:800;cursor:pointer;line-height:1">−</button>
             <span style="font-size:22px;font-weight:800;min-width:26px;text-align:center">${_vf.n||1}</span>
             <button onclick="vfN(1)" style="width:40px;height:40px;border-radius:10px;border:1px solid var(--border2);background:var(--surface);color:var(--text);font-size:24px;font-weight:800;cursor:pointer;line-height:1">+</button>
           </div></div>
         <div style="display:flex;gap:8px;margin-top:14px">
           <button class="btn-sec" onclick="vfConfirm('cola')" style="flex:1;font-size:14px;padding:15px;border-radius:12px"><i class="ti ti-clock-plus"></i> Añadir a la cola${(_vf.n||1)>1?(' ('+(_vf.n)+')'):''}</button>
           <button class="btn-primary" onclick="vfConfirm('ahora')" style="flex:1;font-size:15px;padding:15px;background:#0F6E56;border-radius:12px"><i class="ti ti-check"></i> Hacerlo ahora</button>
         </div>
         <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center">"A la cola": elige tolva y cuántos viajes; los kg los pones al descargar cada uno</div>`}`;
}
function vfPickMat(m){ _vf.material=m; _vf.step=2; vfRender(); }
function vfN(d){ _vf.n=Math.max(1,(_vf.n||1)+d); vfRender(); }
function vfDest(tipo,silo_id){ _vf.destino = tipo==='silo'?{tipo:'silo',silo_id}:{tipo:'acopio'}; vfRender(); }
async function vfConfirm(modo){
  const kg=Number(document.getElementById('vf-kg')?.value)||0; _vf.kg=kg;
  if(!_vf.material){ _vf.step=1; vfRender(); return; }
  if(!_vf.destino){ log('Elige la tolva','warn'); return; }
  if(modo==='ahora' && !kg){ log('Pon los kg que descarga','warn'); return; }
  let mp=matPrimas.find(m=>(m.nombre||'').toLowerCase()===_vf.material.toLowerCase());
  if(!mp){ try{ mp=await api('POST','/materias-primas',{nombre:_vf.material}); await cargarMatPrimas(false); }catch(e){} }
  const dest=_vf.destino;
  const siloId = (dest && dest.tipo==='silo') ? dest.silo_id : null;
  const esAcopio = !!(dest && dest.tipo==='acopio');
  const dl = dest ? (dest.tipo==='silo' ? ('a '+((silosData.find(s=>String(s.id)===String(dest.silo_id))||{}).nombre||'tolva')) : 'a acopio') : '';
  try{
    if(_vf.id){
      await api('PUT','/viajes/'+_vf.id,{ mp_id:mp?mp.id:null, kg, silo_id:siloId });
      log('Viaje actualizado','ok');
    } else {
      const n = modo==='cola' ? (_vf.n||1) : 1;
      const r=await api('POST','/viajes',{ mp_id:mp?mp.id:null, kg, silo_id:siloId, origen:'camion', notas:esAcopio?'A acopio':null, n_viajes:n });
      const vid=r.ids&&r.ids[0];
      if(modo==='ahora' && vid && dest){
        if(dest.tipo==='silo') await api('PATCH','/viajes/'+vid+'/completar',{ destino_tipo:'silo', destino_silo_id:dest.silo_id, kg_final:kg });
        else await api('PATCH','/viajes/'+vid+'/completar',{ destino_tipo:'acopio', acopio:'Acopio', kg_final:kg });
        log('Viaje hecho · '+fmtN(kg)+' kg '+dl,'ok');
      } else {
        log('Añadido a la cola · '+n+' viaje'+(n>1?'s':'')+(dl?(' '+dl):''),'ok');
        camionFiltro='pendiente';
      }
    }
    try{ if(navigator.vibrate) navigator.vibrate(18); }catch(_){}
    vfClose(); await cargarViajes(); try{ silosData=await api('GET','/silos'); }catch(_){}
  }catch(e){ console.error('viaje:',e); log('Error al guardar el viaje','warn'); }
}
let _vcDestino='silo';
function abrirCompletarViaje(id){
  const v=viajesData.find(x=>String(x.id)===String(id)); if(!v) return;
  _vcDestino='silo';
  const ov=document.createElement('div'); ov.id='viaje-comp-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10061;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const siloOpts=silosData.map(s=>{ const pct=Math.round((Number(s.kg_actual)||0)/(Number(s.capacidad_kg)||1)*100); return `<option value="${s.id}" ${String(v.silo_id)===String(s.id)?'selected':''}>${s.nombre} · ${s.producto?(''+s.producto):'vacío'} ${pct}%</option>`; }).join('');
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:460px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Descargar · ${(v.material||'').replace(/</g,'&lt;')}</b>
    <div style="display:flex;gap:6px;margin:12px 0">
      <button id="vc-tab-silo" onclick="vcDest('silo')" class="btn-primary" style="flex:1;font-size:13px;padding:9px">A silo</button>
      <button id="vc-tab-acopio" onclick="vcDest('acopio')" class="btn-sec" style="flex:1;font-size:13px;padding:9px">A acopio</button></div>
    <div id="vc-silo-box"><label style="font-size:12px;color:var(--text2)">Silo<select id="vc-silo" style="${inp}">${siloOpts}</select></label></div>
    <div id="vc-acopio-box" style="display:none"><label style="font-size:12px;color:var(--text2)">Acopio (nombre)<input id="vc-acopio" style="${inp}" placeholder="p. ej. Acopio norte"></label></div>
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:10px">Kg descargados<input id="vc-kg" type="number" min="0" value="${v.kg||''}" style="${inp}"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('viaje-comp-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarCompletar('${id}')" style="font-size:13px;padding:10px 18px;background:#0F6E56">Descargar</button></div>
  </div>`;
  document.body.appendChild(ov);
}
function vcDest(d){
  _vcDestino=d;
  document.getElementById('vc-silo-box').style.display=d==='silo'?'block':'none';
  document.getElementById('vc-acopio-box').style.display=d==='acopio'?'block':'none';
  document.getElementById('vc-tab-silo').className=d==='silo'?'btn-primary':'btn-sec';
  document.getElementById('vc-tab-acopio').className=d==='acopio'?'btn-primary':'btn-sec';
}
async function confirmarCompletar(id){
  const v=viajesData.find(x=>String(x.id)===String(id));
  const destino=_vcDestino||'silo';
  const kg=Number(document.getElementById('vc-kg').value)||0;
  const body={ destino_tipo:destino, kg_final:kg };
  if(destino==='silo'){
    const sid=document.getElementById('vc-silo').value; body.destino_silo_id=sid;
    const s=silosData.find(x=>String(x.id)===String(sid));
    if(s && s.mp_id && Number(s.kg_actual)>0 && String(s.mp_id)!==String(v.mp_id)){ if(!confirm('Ojo: '+s.nombre+' ya tiene '+(s.producto||'otro material')+'. ¿Descargar igualmente?')) return; }
    if(s && Number(s.kg_actual)+kg>Number(s.capacidad_kg)){ if(!confirm(s.nombre+' se pasaría de su capacidad; se llenará hasta el tope. ¿Continuar?')) return; }
  } else { body.acopio=(document.getElementById('vc-acopio').value||'').trim()||null; }
  try{ await api('PATCH','/viajes/'+id+'/completar',body); document.getElementById('viaje-comp-ov')?.remove(); await cargarViajes(); }
  catch(e){ log('Error al descargar','warn'); }
}
async function borrarViaje(id){ if(!confirm('¿Quitar este viaje?')) return; try{ await api('DELETE','/viajes/'+id); if(_activeView==='silos') await cargarSilos(); else await cargarViajes(); }catch(e){ log('Error','warn'); } }
async function exportarParteCamion(){
  const hoy=_hoyISO();
  const delDia=viajesData.filter(v=>v.origen!=='compra' && ((v.hecho_at && _fechaISO(v.hecho_at)===hoy) || (v.estado!=='hecho' && v.fecha && _fechaISO(v.fecha)===hoy)));
  const fuente = delDia.length ? delDia : viajesData;
  const rows=[['Estado','Material','Kg previsto','Tolva prevista','Destino','Kg final','Fecha']];
  fuente.forEach(v=>rows.push([v.estado,v.material||'',v.kg,v.silo_nombre||'',v.estado==='hecho'?(v.destino_tipo==='silo'?('Silo '+(v.destino_silo_nombre||'')):('Acopio '+(v.acopio||''))):'',v.kg_final||'',v.hecho_at?fmtDate(v.hecho_at):'']));
  try{ await _cargarScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Camión'); rows.forEach(r=>ws.addRow(r)); ws.getRow(1).font={bold:true};
    const buf=await wb.xlsx.writeBuffer(); _descargarBlob(new Blob([buf]),'parte_camion_'+hoy+'.xlsx');
  }catch(e){ _descargarBlob(new Blob([rows.map(r=>r.join(';')).join('\n')],{type:'text/csv'}),'parte_camion_'+hoy+'.csv'); }
}
// Solicitar material al camión desde una tarea de producción
function solicitarMaterialProd(id){
  const p=prodData.find(x=>String(x.id)===String(id)); if(!p) return;
  const ov=document.createElement('div'); ov.id='solic-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10062;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const siloOpts=silosData.map(s=>`<option value="${s.id}">${s.nombre}${s.producto?(' · '+s.producto):' · vacío'}</option>`).join('');
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:440px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Solicitar material al camión</b>
    <div style="font-size:12px;color:var(--text2);margin:2px 0 12px">${(p.material||'').replace(/</g,'&lt;')}</div>
    <label style="font-size:12px;color:var(--text2)">A qué tolva<select id="sm-silo" style="${inp}">${siloOpts}</select></label>
    <div style="display:flex;gap:10px;margin-top:10px">
      <label style="font-size:12px;color:var(--text2);flex:1">Nº de viajes<input id="sm-n" type="number" min="1" value="1" style="${inp}"></label>
      <label style="font-size:12px;color:var(--text2);flex:1">Kg por viaje<input id="sm-kg" type="number" min="0" placeholder="0" style="${inp}"></label></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('solic-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarSolicitar('${id}')" style="font-size:13px;padding:10px 18px">Solicitar</button></div>
  </div>`;
  document.body.appendChild(ov);
}
async function confirmarSolicitar(id){
  const p=prodData.find(x=>String(x.id)===String(id)); if(!p) return;
  const body={ mp_id:p.mp_id, kg:Number(document.getElementById('sm-kg').value)||0, silo_id:document.getElementById('sm-silo').value||null, n_viajes:Number(document.getElementById('sm-n').value)||1, origen:'produccion' };
  try{ await api('POST','/viajes',body); document.getElementById('solic-ov')?.remove(); log('Solicitado al camión: '+(body.n_viajes)+' viaje(s)','ok'); }
  catch(e){ log('Error al solicitar','warn'); }
}

// ── CALENDARIO DE PRODUCCIÓN (Fase 4) ───────────────────────────────
let pcalMode='mes', pcalRef=new Date();


// Calendario de producción (por fecha de las compras programadas)
async function cargarProdCal(){
  try{ comprasData=await api('GET','/compras'); }catch(e){ comprasData=[]; }
  renderProdCal();
}
function renderProdCal(){
  const el=document.getElementById('prodcal-content'); if(!el) return;
  renderComprasCalendario(el);
}
function pcalNav(d){ if(pcalMode==='mes') pcalRef.setMonth(pcalRef.getMonth()+d); else if(pcalMode==='semana') pcalRef.setDate(pcalRef.getDate()+7*d); else pcalRef.setDate(pcalRef.getDate()+d); pcalRef=new Date(pcalRef); renderProdCal(); }
function pcalHoy(){ pcalRef=new Date(); renderProdCal(); }
function _pcalTitulo(){
  if(pcalMode==='mes') return MESES[pcalRef.getMonth()]+' '+pcalRef.getFullYear();
  if(pcalMode==='dia') return pcalRef.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  const ini=_inicioSemana(pcalRef); const fin=new Date(ini); fin.setDate(ini.getDate()+6);
  return ini.getDate()+' '+MESES[ini.getMonth()].slice(0,3)+' – '+fin.getDate()+' '+MESES[fin.getMonth()].slice(0,3);
}
function _pcalChip(items){ return items.map(c=>`<div style="background:#E6F1FB;color:#0C447C;border-radius:5px;padding:2px 5px;font-size:10px;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.hora?c.hora+' ':''}${((c.material||'')+' '+fmtN(c.kg)+'kg').replace(/</g,'&lt;')}</div>`).join(''); }
function _pcalRow(c){ return `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px"><b>${c.hora||'—'}</b> · ${(c.material||'').replace(/</g,'&lt;')}${c.silo_nombre?(' → '+c.silo_nombre):''}</span><span style="font-size:12px;color:var(--text2)">${fmtN(c.kg)} kg</span></div>`; }
function _pcalMes(porDia){
  const y=pcalRef.getFullYear(),m=pcalRef.getMonth(); const ini=_inicioSemana(new Date(y,m,1)); const hoy=_hoyISO();
  let d='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';
  ['L','M','X','J','V','S','D'].forEach(x=>d+=`<div style="text-align:center;font-size:10px;color:var(--text2);font-weight:600">${x}</div>`);
  const cur=new Date(ini);
  for(let i=0;i<42;i++){ const iso=_isoOf(cur); const it=porDia[iso]||[]; const om=cur.getMonth()!==m; const eh=iso===hoy;
    d+=`<div style="min-height:62px;border:1px solid ${eh?'#185FA5':'var(--border)'};border-radius:6px;padding:3px;background:${eh?'#EAF2FB':om?'var(--surface2)':'var(--surface)'};opacity:${om?'.45':'1'}"><div style="font-size:10px;color:${eh?'#0C447C':'var(--text2)'};font-weight:${eh?'700':'400'};margin-bottom:2px">${cur.getDate()}</div>${_pcalChip(it)}</div>`;
    cur.setDate(cur.getDate()+1); }
  return d+'</div>';
}
function _pcalSemana(porDia){ const ini=_inicioSemana(pcalRef); const hoy=_hoyISO(); let h='';
  for(let i=0;i<7;i++){ const dd=new Date(ini); dd.setDate(ini.getDate()+i); const iso=_isoOf(dd); const it=porDia[iso]||[]; const eh=iso===hoy;
    h+=`<div class="list-card" style="margin-bottom:6px;${eh?'border-color:#185FA5':''}"><div style="padding:8px 14px;font-size:12px;font-weight:600;${eh?'color:#0C447C':''}">${dd.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'short'})}${eh?' · HOY':''}</div><div style="padding:0 14px 10px">${it.length?it.map(_pcalRow).join(''):'<span style="font-size:12px;color:var(--text3)">—</span>'}</div></div>`; }
  return h; }
function _pcalDia(porDia){ const it=porDia[_isoOf(pcalRef)]||[];
  return `<div class="list-card"><div style="padding:0 14px">${it.length?it.map(_pcalRow).join(''):'<div class="empty-state" style="padding:24px"><i class="ti ti-calendar-off"></i>Nada programado este día</div>'}</div></div>`; }

// ── PEDIDOS DE CLIENTE (Fase 5) ───────────────────────────────────────────────
let pedidosCliData=[], _pedLineas=[], _apTipo='saco', pedCliTab='revision';
async function cargarPedidosCli(){
  if(!matPrimas.length) await cargarMatPrimas(false);
  try{ pedidosCliData=await api('GET','/pedidos-cli'); }catch(e){ pedidosCliData=[]; }
  renderPedidosCli();
}
async function importarPedidoCliPDF(input){
  const file=input.files[0]; if(!file) return;
  log('Leyendo PDF…');
  const base64=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=()=>rej(new Error('Error leyendo archivo')); r.readAsDataURL(file); });
  try{
    const datos=await api('POST','/importar-pdf',{base64});
    const lineas=(datos.lineas||[]).filter(l=>l && (l.descripcion||l.referencia) && l.es_articulo!==false)
      .map(l=>({ descripcion:(l.descripcion||l.referencia||'').trim(), cantidad:Number(l.cantidad)||0, unidad:(l.embalaje||'')||null, kgs:Number(l.kgs)||0 }));
    if(!lineas.length){ log('No se han encontrado líneas en el PDF','warn'); input.value=''; return; }
    const cliente=datos.cliente_nombre||null;
    const r=await api('POST','/pedidos-cli',{ cliente, notas: datos.num?('Pedido '+datos.num):null, lineas });
    await cargarPedidosCli();
    if(r && r.auto) log('Cliente automático "'+(cliente||'')+'" → '+r.autoTareas+' tarea(s) Big Bag creada(s)','ok');
    else if(!cliente) log('Pedido importado, pero no se detectó el cliente en el PDF (escríbelo a mano para automatizar)','warn');
    else log('Importado · cliente detectado: "'+cliente+'". No coincide con ningún cliente automático de Ajustes','ok');
  }catch(e){ log('Error importando PDF: '+e.message,'warn'); }
  input.value='';
}
function renderPedidosCli(){
  const el=document.getElementById('pedidoscli-content'); if(!el) return;
  const c={revision:0,preparado:0,carga:0,cargado:0};
  pedidosCliData.forEach(p=>{ const e=p.estado||'revision'; if(c[e]!=null) c[e]++; });
  const tb=(v,lbl,n,ic)=>`<button onclick="setPedCliTab('${v}')" style="flex:1;font-size:12px;padding:11px 4px;border:none;background:none;border-bottom:2.5px solid ${pedCliTab===v?'var(--blue)':'transparent'};color:${pedCliTab===v?'var(--blue-d)':'var(--text2)'};font-weight:${pedCliTab===v?'700':'500'};cursor:pointer;white-space:nowrap"><i class="ti ti-${ic}"></i> ${lbl}${n?` <span style="font-size:10px;background:var(--surface2);border-radius:8px;padding:0 6px">${n}</span>`:''}</button>`;
  el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:16px;font-weight:500">Pedidos de cliente</div>
      <div style="display:flex;gap:6px">
        <button class="btn-sec" onclick="document.getElementById('pcli-pdf-file').click()" style="font-size:12px;padding:8px 12px"><i class="ti ti-file-import"></i> Importar PDF</button>
        <button class="btn-primary" onclick="abrirFormPedidoCli()" style="font-size:12px;padding:8px 13px"><i class="ti ti-plus"></i> Nuevo</button></div>
      <input type="file" id="pcli-pdf-file" accept=".pdf" style="display:none" onchange="importarPedidoCliPDF(this)"></div>
    <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:14px">${tb('revision','Revisión',c.revision,'eye-search')}${tb('preparado','Preparados',c.preparado,'checks')}${tb('carga','En carga',c.carga,'package-export')}${tb('historico','Histórico',c.cargado,'history')}</div>
    <div id="pedcli-sub"></div>`;
  renderPedCliSub();
}
function setPedCliTab(t){ pedCliTab=t; renderPedidosCli(); }
function renderPedCliSub(){
  const el=document.getElementById('pedcli-sub'); if(!el) return;
  if(pedCliTab==='historico') return renderPedCliHistorico(el);
  const lista=pedidosCliData.filter(p=>(p.estado||'revision')===pedCliTab);
  if(!lista.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-clipboard-list"></i>Nada aquí</div>'; return; }
  el.innerHTML=lista.map(p=> pedCliTab==='carga'?pedCliCargaCard(p):pedidoCliCard(p,pedCliTab)).join('');
}
const _esPaletLin=l=>/pal[eé]/i.test(l.descripcion||'');
function pedidoCliCard(p, modo){
  const lins=p.lineas||[];
  const noPalet=lins.filter(l=>!_esPaletLin(l));
  const prep=noPalet.filter(l=>l.preparado).length;
  const todoPrep = noPalet.length>0 && prep===noPalet.length;
  const lineHtml=lins.map(l=>{
    const pal=_esPaletLin(l);
    const eb = pal ? ['#EDE7DA','#6B5B36','PALET · no cuenta']
      : l.preparado ? ['#1E8C6E','#fff','PREPARADO']
      : ({pendiente:['#FBE3E0','#9A2A1B','Pendiente'],en_produccion:['#E9F0F8','#0C447C','En producción'],hecho:['#EAF3EE','#0F6E56','Producido']}[l.estado]||['#eee','#555',l.estado]);
    return `<div style="display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:10px;margin-bottom:6px;background:${l.preparado?'#EAF7F1':'var(--surface)'};border:1px solid ${l.preparado?'#1E8C6E':'var(--border)'};${pal?'opacity:.7':''}">
       <div style="flex:1;min-width:0">
         <div style="font-size:18px;font-weight:800;line-height:1.1">${fmtN(l.cantidad)}${l.unidad?(' <span style="font-size:12px;font-weight:600;color:var(--text2)">'+(''+l.unidad).replace(/</g,'&lt;')+'</span>'):''}</div>
         <div style="font-size:13px;color:var(--text);margin-top:2px">${(l.descripcion||'').replace(/</g,'&lt;')||'<span style="color:var(--text3)">—</span>'}</div>
       </div>
       <span style="font-size:11px;font-weight:800;background:${eb[0]};color:${eb[1]};border-radius:8px;padding:5px 10px;white-space:nowrap">${eb[2]}</span>
       ${pal?'':`<button onclick="toggleLineaPreparada('${l.id}',${l.preparado?'false':'true'})" style="border:1px solid ${l.preparado?'#E8A599':'#1E8C6E'};background:${l.preparado?'#fff':'#1E8C6E'};color:${l.preparado?'#9A2A1B':'#fff'};border-radius:8px;padding:8px 11px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">${l.preparado?'Quitar':'Preparar'}</button>
       ${(!l.preparado && l.estado==='pendiente')?`<button onclick="abrirAProduccion('${l.id}')" class="btn-sec" style="font-size:10px;padding:6px 8px;white-space:nowrap">A prod.</button>`:''}`}</div>`;
  }).join('');
  let footer='';
  if(modo==='preparado'){
    footer=`<button onclick="pedCliEstado('${p.id}','revision')" class="btn-sec" style="font-size:12px;padding:9px 12px"><i class="ti ti-arrow-back-up"></i> A revisión</button>
       <button onclick="enviarPedCliACarga('${p.id}')" class="btn-primary" style="font-size:12px;padding:9px 13px;background:#185FA5"><i class="ti ti-package-export"></i> Enviar a carga</button>`;
  } else {
    footer=`<button onclick="marcarPedidoPreparado('${p.id}',${todoPrep?'false':'true'})" class="btn-primary" style="font-size:12px;padding:9px 13px;background:${todoPrep?'#9A2A1B':'#0F6E56'}"><i class="ti ti-${todoPrep?'x':'checks'}"></i> ${todoPrep?'Quitar preparado':'Marcar todo preparado'}</button>`;
  }
  footer+=`<button onclick="document.getElementById('pcli-reimport-${p.id}').click()" class="btn-sec" style="font-size:12px;padding:9px 12px"><i class="ti ti-file-import"></i> PDF</button>
     <input type="file" id="pcli-reimport-${p.id}" accept=".pdf" style="display:none" onchange="reimportarPedidoCli('${p.id}',this)">
     <button onclick="abrirFormPedidoCli('${p.id}')" class="btn-sec" style="font-size:12px;padding:9px 12px"><i class="ti ti-edit"></i></button>
     <button onclick="borrarPedidoCli('${p.id}')" class="btn-sec" style="font-size:12px;padding:9px 12px;color:#9A2A1B"><i class="ti ti-trash"></i></button>`;
  return `<div class="list-card" style="margin-bottom:14px;border:2px solid ${todoPrep?'#1E8C6E':'var(--border)'}">
     <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;${todoPrep?'background:#EAF7F1;':''}border-bottom:1px solid var(--border)">
       <span style="font-size:17px;font-weight:800">${(p.cliente||'(sin cliente)').replace(/</g,'&lt;')}</span>
       <span style="font-size:12px;font-weight:800;${todoPrep?'color:#0F6E56':'color:var(--text2)'}">${todoPrep?'✓ PREPARADO':(prep+'/'+noPalet.length+' preparadas')}</span></div>
     <div style="padding:10px 12px">${lineHtml||'<div style="font-size:12px;color:var(--text3);padding:6px">Sin líneas</div>'}</div>
     ${p.notas?`<div style="padding:0 14px 8px;font-size:12px;color:var(--text2)">${p.notas.replace(/</g,'&lt;')}</div>`:''}
     <div style="display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--border)">${footer}</div></div>`;
}
function pedCliCargaCard(p){
  const lins=p.lineas||[];
  const carg=lins.filter(l=>l.cargada).length;
  const todoCarg = lins.length>0 && carg===lins.length;
  const lineHtml=lins.map(l=>`<div onclick="toggleLineaCargadaCli('${l.id}',${l.cargada?'false':'true'})" style="display:flex;align-items:center;gap:10px;padding:12px 13px;border-radius:10px;margin-bottom:6px;background:${l.cargada?'#EAF7F1':'var(--surface)'};border:1px solid ${l.cargada?'#1E8C6E':'var(--border)'};cursor:pointer">
     <input type="checkbox" ${l.cargada?'checked':''} onclick="event.stopPropagation()" onchange="toggleLineaCargadaCli('${l.id}',this.checked)" style="width:24px;height:24px;cursor:pointer;flex:0 0 auto">
     <div style="flex:1;min-width:0;${l.cargada?'opacity:.6;text-decoration:line-through':''}">
       <div style="font-size:17px;font-weight:800;line-height:1.1">${fmtN(l.cantidad)}${l.unidad?(' <span style="font-size:12px;font-weight:600;color:var(--text2)">'+(''+l.unidad).replace(/</g,'&lt;')+'</span>'):''}</div>
       <div style="font-size:13px;color:var(--text);margin-top:2px">${(l.descripcion||'').replace(/</g,'&lt;')||'—'}</div></div></div>`).join('');
  return `<div class="list-card" style="margin-bottom:14px;border:2px solid ${todoCarg?'#1E8C6E':'#185FA5'}">
     <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border)">
       <div><div style="font-size:17px;font-weight:800">${(p.cliente||'(sin cliente)').replace(/</g,'&lt;')}</div>${p.nombre_carga?`<div style="font-size:12px;color:#185FA5;font-weight:600"><i class="ti ti-tag"></i> ${(''+p.nombre_carga).replace(/</g,'&lt;')}</div>`:''}</div>
       <span style="font-size:13px;font-weight:800;color:${todoCarg?'#0F6E56':'var(--text2)'}">${carg}/${lins.length} cargadas</span></div>
     <div style="padding:10px 12px">${lineHtml||'<div style="font-size:12px;color:var(--text3);padding:6px">Sin líneas</div>'}</div>
     <div style="display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--border)">
       <button onclick="pedCliEstado('${p.id}','preparado')" class="btn-sec" style="font-size:12px;padding:9px 12px"><i class="ti ti-arrow-back-up"></i> A preparados</button>
       <button onclick="todoCargadoCli('${p.id}')" class="btn-primary" style="font-size:13px;padding:9px 14px;background:#0F6E56"><i class="ti ti-checks"></i> Todo cargado</button></div></div>`;
}
function renderPedCliHistorico(el){
  const hist=pedidosCliData.filter(p=>(p.estado||'')==='cargado');
  if(!hist.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-history"></i>Aún no hay cargas en el histórico</div>'; return; }
  const dias={};
  hist.forEach(p=>{ const d=p.cargado_at?_fechaISO(p.cargado_at):'—'; (dias[d]=dias[d]||[]).push(p); });
  const orden=Object.keys(dias).sort((a,b)=>b.localeCompare(a));
  el.innerHTML=orden.map(d=>{
    const ps=dias[d];
    const cards=ps.map(p=>{
      const lins=p.lineas||[];
      const tot=lins.reduce((s,l)=>s+(Number(l.cantidad)||0),0);
      const detalle=lins.map(l=>`<div style="font-size:12px;color:var(--text2);display:flex;justify-content:space-between;padding:2px 0"><span>${(l.descripcion||'—').replace(/</g,'&lt;')}</span><span>${fmtN(l.cantidad)}${l.unidad?(' '+(''+l.unidad).replace(/</g,'&lt;')):''}</span></div>`).join('');
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px">
         <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-size:14px;font-weight:700">${(p.cliente||'(sin cliente)').replace(/</g,'&lt;')}</span>${p.nombre_carga?`<span style="font-size:11px;color:#185FA5;font-weight:700"><i class="ti ti-tag"></i> ${(''+p.nombre_carga).replace(/</g,'&lt;')}</span>`:''}</div>
         <div style="font-size:11px;color:var(--text3);margin:3px 0 6px">${lins.length} línea(s) · ${fmtN(tot)} uds</div>${detalle}</div>`;
    }).join('');
    return `<div style="margin-bottom:16px"><div style="font-size:14px;font-weight:800;margin-bottom:8px">${d==='—'?'Sin fecha':fmtDate(d)} <span style="font-size:12px;color:var(--text2);font-weight:500">· ${ps.length} carga(s)</span></div>${cards}</div>`;
  }).join('');
}
async function pedCliEstado(id, estado, nombre){ try{ await api('PATCH','/pedidos-cli/'+id+'/estado',{estado, nombre_carga:nombre}); await cargarPedidosCli(); }catch(e){ log('Error','warn'); } }
function enviarPedCliACarga(id){ const n=(prompt('Nombre para esta carga (opcional):')||'').trim(); pedCliEstado(id,'carga',n||null); }
async function toggleLineaCargadaCli(id,val){ try{ await api('PATCH','/pedidos-cli/lineas/'+id+'/cargada',{cargada:val}); await cargarPedidosCli(); }catch(e){ log('Error','warn'); } }
function todoCargadoCli(id){ if(!confirm('¿Marcar como todo cargado y enviar al histórico?')) return; pedCliEstado(id,'cargado',null); }
async function toggleLineaPreparada(id,val){ try{ await api('PATCH','/pedidos-cli/lineas/'+id+'/preparado',{preparado:val}); await cargarPedidosCli(); }catch(e){ log('Error','warn'); } }
async function reimportarPedidoCli(id, input){
  const file=input.files[0]; if(!file) return;
  if(!confirm('Actualizar este pedido con el PDF? Se reemplazan sus líneas por las del nuevo documento.')){ input.value=''; return; }
  log('Leyendo PDF…');
  const base64=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=()=>rej(new Error('Error leyendo archivo')); r.readAsDataURL(file); });
  try{
    const datos=await api('POST','/importar-pdf',{base64});
    const lineas=(datos.lineas||[]).filter(l=>l && (l.descripcion||l.referencia) && l.es_articulo!==false)
      .map(l=>({ descripcion:(l.descripcion||l.referencia||'').trim(), cantidad:Number(l.cantidad)||0, unidad:(l.embalaje||'')||null }));
    if(!lineas.length){ log('No se han encontrado líneas en el PDF','warn'); input.value=''; return; }
    const ped=pedidosCliData.find(x=>String(x.id)===String(id));
    await api('PUT','/pedidos-cli/'+id,{ cliente: datos.cliente_nombre || (ped?ped.cliente:null), notas: ped?ped.notas:null, lineas });
    await cargarPedidosCli();
    log('Pedido actualizado con el PDF ('+lineas.length+' líneas)','ok');
  }catch(e){ log('Error actualizando: '+e.message,'warn'); }
  input.value='';
}
async function marcarPedidoPreparado(id,val){ if(val && !confirm('¿Marcar TODO el pedido como preparado?')) return; try{ await api('PATCH','/pedidos-cli/'+id+'/preparado',{preparado:val}); await cargarPedidosCli(); }catch(e){ log('Error','warn'); } }
function abrirFormPedidoCli(id){
  const p = id? pedidosCliData.find(x=>String(x.id)===String(id)) : null;
  _pedLineas = (p && p.lineas && p.lineas.length) ? p.lineas.map(l=>({id:l.id,descripcion:l.descripcion||'',cantidad:l.cantidad!=null?l.cantidad:'',unidad:l.unidad||''})) : [{descripcion:'',cantidad:'',unidad:''}];
  const ov=document.createElement('div'); ov.id='pcl-form-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10060;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:520px;border-radius:16px 16px 0 0;padding:18px;max-height:92vh;overflow-y:auto">
    <b style="font-size:15px">${id?'Editar pedido':'Nuevo pedido de cliente'}</b>
    <input type="hidden" id="pcl-id" value="${id||''}">
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:12px">Cliente<input id="pcl-cliente" value="${p&&p.cliente?(''+p.cliente).replace(/"/g,'&quot;'):''}" style="${inp}"></label>
    <div style="font-size:12px;color:var(--text2);margin-top:14px;margin-bottom:2px">Líneas (cantidad · ud · material)</div>
    <div id="pcl-lineas"></div>
    <button onclick="agregarPedLinea()" class="btn-sec" style="font-size:12px;padding:6px 12px;margin-top:4px"><i class="ti ti-plus"></i> Añadir línea</button>
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:12px">Notas<input id="pcl-notas" value="${p&&p.notas?(''+p.notas).replace(/"/g,'&quot;'):''}" style="${inp}"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('pcl-form-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="guardarPedidoCli()" style="font-size:13px;padding:10px 18px">Guardar</button></div>
  </div>`;
  document.body.appendChild(ov);
  renderPedLineas();
}
function renderPedLineas(){
  const cont=document.getElementById('pcl-lineas'); if(!cont) return;
  const opts=matPrimas.filter(m=>m.activo!==false).map(m=>`<option value="${(m.nombre||'').replace(/"/g,'&quot;')}">`).join('');
  const fld='font-size:13px;padding:7px;border:1px solid var(--border2);border-radius:7px;background:var(--surface);color:var(--text)';
  cont.innerHTML=`<datalist id="pcl-mat-list">${opts}</datalist>`+_pedLineas.map((l,i)=>`<div data-row style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
     <input class="pl-cant" type="number" min="0" placeholder="Cant." value="${l.cantidad!=null?l.cantidad:''}" style="${fld};width:62px">
     <input class="pl-uni" placeholder="ud" value="${l.unidad?(''+l.unidad).replace(/"/g,'&quot;'):''}" style="${fld};width:52px">
     <input class="pl-desc" list="pcl-mat-list" placeholder="Material / descripción" value="${(l.descripcion||'').replace(/"/g,'&quot;')}" style="${fld};flex:1">
     <button onclick="quitarPedLinea(${i})" style="background:none;border:none;color:#9A2A1B;font-size:17px;cursor:pointer;line-height:1">×</button></div>`).join('');
}
function _leerPedLineas(){
  const cont=document.getElementById('pcl-lineas'); if(!cont) return;
  [...cont.querySelectorAll('[data-row]')].forEach((row,i)=>{
    _pedLineas[i]=_pedLineas[i]||{};
    _pedLineas[i].descripcion=row.querySelector('.pl-desc').value;
    _pedLineas[i].cantidad=row.querySelector('.pl-cant').value;
    _pedLineas[i].unidad=row.querySelector('.pl-uni').value;
  });
}
function agregarPedLinea(){ _leerPedLineas(); _pedLineas.push({descripcion:'',cantidad:'',unidad:''}); renderPedLineas(); }
function quitarPedLinea(i){ _leerPedLineas(); _pedLineas.splice(i,1); if(!_pedLineas.length)_pedLineas.push({descripcion:'',cantidad:'',unidad:''}); renderPedLineas(); }
async function guardarPedidoCli(){
  _leerPedLineas();
  const id=document.getElementById('pcl-id').value;
  const cliente=(document.getElementById('pcl-cliente').value||'').trim()||null;
  const notas=(document.getElementById('pcl-notas').value||'').trim()||null;
  const lineas=_pedLineas.filter(l=>(''+(l.descripcion||'')).trim()||Number(l.cantidad)).map(l=>({id:l.id,descripcion:(''+(l.descripcion||'')).trim(),cantidad:Number(l.cantidad)||0,unidad:(''+(l.unidad||'')).trim()||null}));
  try{ if(id) await api('PUT','/pedidos-cli/'+id,{cliente,notas,lineas}); else await api('POST','/pedidos-cli',{cliente,notas,lineas}); document.getElementById('pcl-form-ov')?.remove(); await cargarPedidosCli(); }
  catch(e){ log('Error guardando pedido','warn'); }
}
async function borrarPedidoCli(id){ if(!confirm('¿Borrar este pedido?')) return; try{ await api('DELETE','/pedidos-cli/'+id); await cargarPedidosCli(); }catch(e){ log('Error','warn'); } }
function abrirAProduccion(lineId){
  let desc='', cant=''; pedidosCliData.forEach(p=>(p.lineas||[]).forEach(l=>{ if(String(l.id)===String(lineId)){ desc=l.descripcion||''; cant=(l.cantidad!=null?l.cantidad:''); } }));
  _apTipo='saco';
  const ov=document.createElement('div'); ov.id='ap-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10062;display:flex;align-items:flex-end;justify-content:center';
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  const opts=matPrimas.filter(m=>m.activo!==false).map(m=>`<option value="${(m.nombre||'').replace(/"/g,'&quot;')}">`).join('');
  const inp='width:100%;font-size:14px;padding:9px 11px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);margin-top:4px;box-sizing:border-box';
  ov.innerHTML=`<div style="background:var(--bg);width:100%;max-width:460px;border-radius:16px 16px 0 0;padding:18px">
    <b style="font-size:15px">Enviar a producción</b>
    <div style="display:flex;gap:6px;margin:12px 0">
      <button id="ap-tab-saco" onclick="apTipo('saco')" class="btn-primary" style="flex:1;font-size:13px;padding:9px">Sacos</button>
      <button id="ap-tab-bb" onclick="apTipo('bb')" class="btn-sec" style="flex:1;font-size:13px;padding:9px">Big Bag</button></div>
    <label style="font-size:12px;color:var(--text2);display:block">Material<input id="ap-mat" list="ap-mat-list" placeholder="Buscar…" value="${(desc||'').replace(/"/g,'&quot;')}" style="${inp}"><datalist id="ap-mat-list">${opts}</datalist></label>
    <div style="display:flex;gap:10px;margin-top:10px">
      <label style="font-size:12px;color:var(--text2);flex:1">Nº de unidades<input id="ap-uni" type="number" min="0" value="${cant}" style="${inp}"></label>
      <label style="font-size:12px;color:var(--text2);flex:1">Kg por unidad<input id="ap-kgu" type="number" min="0" value="${_lastKgU.saco!=null?_lastKgU.saco:''}" style="${inp}"></label></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn-sec" onclick="document.getElementById('ap-ov').remove()" style="font-size:13px;padding:10px 16px">Cancelar</button>
      <button class="btn-primary" onclick="confirmarAProduccion('${lineId}')" style="font-size:13px;padding:10px 18px">Enviar</button></div>
  </div>`;
  document.body.appendChild(ov);
}
function apTipo(t){ _apTipo=t; document.getElementById('ap-tab-saco').className=t==='saco'?'btn-primary':'btn-sec'; document.getElementById('ap-tab-bb').className=t==='bb'?'btn-primary':'btn-sec'; }
async function confirmarAProduccion(lineId){
  const nombre=(document.getElementById('ap-mat').value||'').trim();
  let mp=matPrimas.find(m=>(m.nombre||'').toLowerCase()===nombre.toLowerCase());
  if(!mp && nombre){ try{ mp=await api('POST','/materias-primas',{nombre}); await cargarMatPrimas(false); }catch(e){} }
  const body={ tipo:_apTipo, mp_id:mp?mp.id:null, unidades:Number(document.getElementById('ap-uni').value)||0, kg_unidad:Number(document.getElementById('ap-kgu').value)||0, origen_linea_id:lineId };
  if(body.kg_unidad) _lastKgU[_apTipo]=body.kg_unidad;
  try{ await api('POST','/producciones',body); document.getElementById('ap-ov')?.remove(); await cargarPedidosCli(); log('Línea enviada a producción','ok'); }
  catch(e){ log('Error al enviar','warn'); }
}

// ── CLIENTES AUTOMÁTICOS (Ajustes) ────────────────────────────────────────────
let clientesAuto=[];
async function cargarClientesAuto(){ try{ clientesAuto=await api('GET','/clientes-auto'); }catch(e){ clientesAuto=[]; } renderClientesAuto(); }
function renderClientesAuto(){
  const el=document.getElementById('cauto-list'); if(!el) return;
  if(!clientesAuto.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-users"></i>Sin clientes automáticos todavía</div>'; return; }
  el.innerHTML='<div style="font-size:11px;color:var(--text2);margin-bottom:8px">Las líneas de <b>big bag</b> van a producción al importar el pedido. Los <b>sacos</b> nunca van. Elige si van <b>siempre</b> o solo a partir de cierta cantidad.</div>'
    +clientesAuto.map(c=>{ const siempre=!(c.min_bb>1);
      return `<div style="padding:11px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px">
       <div style="display:flex;align-items:center;gap:10px">
         <i class="ti ti-bolt" style="color:#B5710E"></i><span style="flex:1;font-size:14px;min-width:0">${(c.nombre||'').replace(/</g,'&lt;')}</span>
         <button onclick="delClienteAuto(${c.id})" style="background:none;border:none;color:#9A2A1B;cursor:pointer;font-size:16px" title="Quitar"><i class="ti ti-trash"></i></button></div>
       <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
         <button onclick="setClienteAutoMin(${c.id},1)" style="font-size:12px;padding:7px 12px;border-radius:8px;cursor:pointer;border:1px solid ${siempre?'#0F6E56':'var(--border2)'};background:${siempre?'#0F6E56':'var(--surface)'};color:${siempre?'#fff':'var(--text2)'};font-weight:${siempre?'700':'500'}">Siempre</button>
         <span style="font-size:12px;color:var(--text2)">o a partir de</span>
         <input type="number" min="2" value="${c.min_bb>1?c.min_bb:''}" placeholder="X" onchange="setClienteAutoMin(${c.id}, this.value||1)" style="width:56px;font-size:13px;padding:6px 8px;border:1px solid ${!siempre?'#B5710E':'var(--border2)'};border-radius:8px;background:var(--surface2);color:var(--text);text-align:center">
         <span style="font-size:12px;color:var(--text2)">big bags</span></div></div>`;
    }).join('');
}
async function setClienteAutoMin(id,val){ try{ await api('PATCH','/clientes-auto/'+id,{min_bb:Math.max(1,Number(val)||1)}); await cargarClientesAuto(); }catch(e){ log('Error','warn'); } }
async function addClienteAuto(){ const inp=document.getElementById('cauto-nuevo'); const v=(inp.value||'').trim(); if(!v) return; try{ await api('POST','/clientes-auto',{nombre:v}); inp.value=''; await cargarClientesAuto(); }catch(e){ log('Error','warn'); } }
async function delClienteAuto(id){ if(!confirm('¿Quitar este cliente automático?')) return; try{ await api('DELETE','/clientes-auto/'+id); await cargarClientesAuto(); }catch(e){ log('Error','warn'); } }

// ── CALENDARIO: suscripción Outlook (ICS) ─────────────────────────────────────
let _calToken=null;
async function cargarCalSync(){
  const el=document.getElementById('calsync-content'); if(el) el.innerHTML='<div class="empty-state"><i class="ti ti-loader"></i>Cargando…</div>';
  try{ const r=await api('GET','/cal-token'); _calToken=r.token; }catch(e){ _calToken=null; }
  renderCalSync();
}
function renderCalSync(){
  const el=document.getElementById('calsync-content'); if(!el) return;
  if(!_calToken){ el.innerHTML='<div class="empty-state">No se pudo obtener el enlace. Reinicia el servidor e inténtalo de nuevo.</div>'; return; }
  const base=location.origin;
  const urlCargas=base+'/api/cal/'+_calToken+'/cargas.ics';
  const urlCompras=base+'/api/cal/'+_calToken+'/compras.ics';
  const card=(titulo,desc,url,col)=>`<div class="list-card" style="margin-bottom:14px;padding:14px 16px">
     <div style="font-size:14px;font-weight:700;color:${col}">${titulo}</div>
     <div style="font-size:12px;color:var(--text2);margin:2px 0 8px">${desc}</div>
     <div style="display:flex;gap:8px;align-items:center">
       <input readonly value="${url}" onclick="this.select()" style="flex:1;font-size:12px;font-family:monospace;padding:9px 10px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);color:var(--text);min-width:0">
       <button class="btn-primary" onclick="copiarTexto('${url}')" style="font-size:12px;padding:9px 13px;white-space:nowrap"><i class="ti ti-copy"></i> Copiar</button></div></div>`;
  el.innerHTML=
    card('Cargas','Las cargas de reparto con su fecha, transportista y clientes.',urlCargas,'#0C447C')+
    card('Compras','Las compras previstas con su material, tolva y estado.',urlCompras,'#7A4E00')+
    `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--text2);line-height:1.7">
       <b style="color:var(--text)">Cómo añadirlo en Outlook</b><br>
       1. Copia una de las direcciones de arriba.<br>
       2. Outlook web: <b>Calendario › Agregar calendario › Suscribirse desde Internet</b> y pega la dirección.<br>
       3. Outlook escritorio: <b>Inicio › Abrir calendario › Desde Internet</b>.<br>
       Se actualiza solo cada cierto tiempo. Mismo proceso vale para Google Calendar (Otros calendarios › Desde URL).</div>
     <div style="font-size:11px;color:var(--text3);margin-top:10px"><i class="ti ti-lock"></i> La dirección lleva una clave privada; no la compartas con quien no deba ver el calendario.</div>`;
}
async function copiarTexto(t){ try{ await navigator.clipboard.writeText(t); log('Copiado','ok'); }catch(e){ log('Selecciónalo y cópialo a mano','warn'); } }

setInterval(()=>{ flushOutbox(); loadAll(); },30000);
loadAll();
flushOutbox(); _renderOutboxChip();
switchView('plan');
comprobarServidor();
comprobarRecordatorioCopia();
actualizarFaltasBadge();

// PWA: registrar service worker con auto-actualización
if('serviceWorker' in navigator){
  let _swReloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(_swReloaded) return; _swReloaded=true; location.reload();
  });
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js').then(reg=>{
      reg.update();
      setInterval(()=>{ try{ reg.update(); }catch(e){} }, 60000);
    }).catch(e=>console.warn('SW error:',e));
  });
}
// Etiqueta de versión visible (para comprobar qué versión está cargada)
window.addEventListener('load',()=>{
  try{ const t=document.createElement('div'); t.textContent='v'+NEEDS_API;
    t.style.cssText='position:fixed;left:6px;bottom:6px;font-size:9px;color:var(--text3);opacity:.55;z-index:3;pointer-events:none;background:var(--surface);padding:1px 5px;border-radius:5px';
    document.body.appendChild(t);
  }catch(e){}
});
