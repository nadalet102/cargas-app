// services/ics.js — Generación de feeds de calendario (ICS) y validación del token.
const { pool } = require('../db');

function _icsEsc(s){ return (''+(s||'')).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n'); }
function _icsFold(line){
  if(line.length<=73) return line;
  let out=''; let i=0;
  while(i<line.length){ out += (i?'\r\n ':'') + line.substring(i,i+73); i+=73; }
  return out;
}
function _icsWrap(name, events){
  const now=new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Cargas Arisac//ES//EN','CALSCALE:GREGORIAN',
           'X-WR-CALNAME:'+_icsEsc(name),'X-WR-TIMEZONE:Europe/Madrid','REFRESH-INTERVAL;VALUE=DURATION:PT1H','X-PUBLISHED-TTL:PT1H'];
  for(const e of events){
    L.push('BEGIN:VEVENT','UID:'+e.uid,'DTSTAMP:'+now,'DTSTART;VALUE=DATE:'+e.start,'DTEND;VALUE=DATE:'+e.end,'SUMMARY:'+_icsEsc(e.summary));
    if(e.desc) L.push('DESCRIPTION:'+_icsEsc(e.desc));
    L.push('TRANSP:TRANSPARENT','END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(_icsFold).join('\r\n')+'\r\n';
}
async function _calTokenOk(token){
  try { const r=await pool.query("SELECT value#>>'{}' AS token FROM bc_config WHERE key='cal_token'"); return !!(r.rows[0] && r.rows[0].token && r.rows[0].token===token); }
  catch(e){ return false; }
}

module.exports = { _icsWrap, _calTokenOk };
