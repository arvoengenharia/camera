// Sinaliza contexto seguro
(function(){
  const el = document.getElementById('chipSecure');
  const ok = location.protocol==='https:' || ['localhost','127.0.0.1'].includes(location.hostname);
  el.textContent = ok ? 'HTTPS ✓' : 'Use HTTPS';
  el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
})();

// ---- UTM helpers ----
function latBandLetter(lat){
  const bands = "CDEFGHJKLMNPQRSTUVWX";
  const capped = Math.max(-80, Math.min(84, lat));
  let idx = Math.floor((capped + 80) / 8);
  if(idx<0) idx=0; if(idx>19) idx=19;
  return bands[idx];
}
function utmZoneFromLon(lon){
  let z = Math.floor((lon + 180) / 6) + 1;
  if(z<1) z=1; if(z>60) z=60;
  return z;
}
function toUTM(lat, lon){
  const zone = utmZoneFromLon(lon);
  const south = lat < 0;
  const def = `+proj=utm +zone=${zone} ${south?'+south':''} +datum=WGS84 +units=m +no_defs`;
  const [E,N] = proj4('EPSG:4326', def, [lon, lat]);
  return { zone, band: latBandLetter(lat), e: Math.round(E), n: Math.round(N) };
}

// ---- Estado/UI ----
const els = {
  chipGPS: document.getElementById('chipGPS'),
  chipCam: document.getElementById('chipCam'),
  video: document.getElementById('video'),
  canvas: document.getElementById('canvas'),
  still: document.getElementById('still'),
  badge: document.getElementById('badge'),
  btnStart: document.getElementById('btnStart'),
  btnShot: document.getElementById('btnShot'),
  btnRedo: document.getElementById('btnRedo'),
  btnSave: document.getElementById('btnSave'),
  gpsStatus: document.getElementById('gpsStatus'),
  acc: document.getElementById('acc'),
  zoneBand: document.getElementById('zoneBand'),
  easting: document.getElementById('easting'),
  northing: document.getElementById('northing'),
  fname: document.getElementById('fname'),
};
const state = { lat:null, lon:null, acc:null, zone:null, band:null, e:null, n:null, stream:null, captureURL:null, obraId:null, obraNome:null };
let watchId = null;

// ---- Obras (carregar JSON e popular select) ----
async function carregarObras(){
  try{
    const res = await fetch('./fotos/obras.json', {cache:'no-store'});
    if(!res.ok) throw new Error('Falha ao carregar obras.json');
    const data = await res.json();
    const sel = document.getElementById('obraSelect');
    sel.innerHTML = '<option value="">Selecionar…</option>' + (data.obras||[]).map(o => `<option value="${o.id}">${o.nome}</option>`).join('');
    sel.addEventListener('change', (e)=>{
      const id = e.target.value;
      const item = (data.obras||[]).find(o => o.id===id);
      state.obraId = id || null;
      state.obraNome = item ? item.nome : null;
      updateUI();
    });
  }catch(e){
    console.warn(e);
  }
}

// Utilitário: timestamp YYYYMMDD-HHMMSS
function tsNow(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Nome do arquivo no padrão solicitado
function nomeArquivoAtual(withTimestamp=true){
  const obra = state.obraNome ? state.obraNome : 'OBRA';
  const base = `#${obra}-${state.zone||'--'}${state.band||''}-${state.e??'--'}-${state.n??'--'}`;
  return withTimestamp ? `${base}_${tsNow()}.jpg` : `${base}.jpg`;
}

function updateUI(){
  const {acc,zone,band,e,n} = state;
  els.acc.textContent = acc!=null ? `${Math.round(acc)} m` : '—';
  els.zoneBand.textContent = (zone?zone:'—') + (band?band:'');
  els.easting.textContent = e ?? '—';
  els.northing.textContent = n ?? '—';
  if(zone && band && e!=null && n!=null){
    els.fname.textContent = nomeArquivoAtual(false);
    els.badge.textContent = `UTM: #${zone}${band}-${e}-${n}`;
    els.gpsStatus.innerHTML = '<span style="color:var(--ok)">Fixado</span>';
    els.chipGPS.textContent = `GPS: ±${Math.round(acc||0)} m`; els.chipGPS.style.color='var(--ok)';
  }
}

function startGPS(){
  if(!('geolocation' in navigator)){
    els.gpsStatus.innerHTML = '<span style="color:var(--danger)">Sem geolocalização</span>';
    els.chipGPS.textContent = 'GPS: indisponível'; return;
  }
  els.gpsStatus.textContent = 'Solicitando permissão…';
  els.chipGPS.textContent = 'GPS: pedindo…';
  watchId = navigator.geolocation.watchPosition(p=>{
    const {latitude, longitude, accuracy} = p.coords;
    Object.assign(state, {lat:latitude, lon:longitude, acc:accuracy}, toUTM(latitude, longitude));
    updateUI();
  }, err=>{
    els.gpsStatus.innerHTML = `<span style="color:var(--danger)">${err.message}</span>`;
    els.chipGPS.textContent = 'GPS: negado';
  }, { enableHighAccuracy:true, timeout:15000, maximumAge:0 });
}

async function startCamera(){
  try{
    els.btnStart.disabled = true; els.btnStart.textContent = 'Abrindo câmera…';
    const stream = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080} }, audio:false
    });
    state.stream = stream; els.video.srcObject = stream; await els.video.play();
    els.btnShot.disabled = false; els.chipCam.textContent = 'Câmera: ativa'; els.chipCam.style.color='var(--ok)';
    els.btnStart.textContent = 'Câmera ativa';
  }catch(e){
    console.error(e); els.chipCam.textContent='Câmera: erro'; els.chipCam.style.color='var(--danger)';
    alert('Não foi possível acessar a câmera. Verifique permissões.');
    els.btnStart.disabled=false; els.btnStart.textContent='Abrir câmera';
  }
}

async function capturePhoto(){
  if(!state.stream){ alert('Câmera inativa. Toque em "Abrir câmera".'); return; }
  if(state.zone==null || state.band==null || state.e==null || state.n==null){ alert('Aguarde o GPS fixar.'); return; }
  const vw = els.video.videoWidth, vh = els.video.videoHeight; if(!vw||!vh){ alert('Câmera iniciando…'); return; }
  const s = Math.min(vw, vh), sx = (vw - s)/2, sy = (vh - s)/2;
  els.canvas.width = s; els.canvas.height = s;
  const ctx = els.canvas.getContext('2d'); ctx.drawImage(els.video, sx, sy, s, s, 0, 0, s, s);

  els.canvas.toBlob((blob)=>{
    if(!blob){ alert('Falha ao gerar imagem.'); return; }
    const fname = nomeArquivoAtual(true);
    if(state.captureURL) URL.revokeObjectURL(state.captureURL);
    const url = URL.createObjectURL(blob); state.captureURL = url;

    els.still.src = url; els.still.style.display='block';
    els.video.style.display='none'; els.canvas.style.display='none';
    els.btnRedo.style.display='inline-flex'; els.btnSave.style.display='inline-flex';
    els.btnSave.textContent = `Salvar: ${fname}`; els.btnSave.href = url; els.btnSave.setAttribute('download', fname);
  }, 'image/jpeg', 0.92);
}

function redo(){
  els.still.style.display='none'; els.video.style.display='block';
  els.btnRedo.style.display='none'; els.btnSave.style.display='none';
}

function stopAll(){
  if (watchId!=null) { navigator.geolocation.clearWatch(watchId); watchId=null; }
  if(state.stream){ state.stream.getTracks().forEach(t=>t.stop()); state.stream=null; }
  if(state.captureURL){ URL.revokeObjectURL(state.captureURL); state.captureURL=null; }
}

document.getElementById('btnStart').addEventListener('click', ()=>{ startGPS(); startCamera(); });
document.getElementById('btnShot').addEventListener('click', capturePhoto);
document.getElementById('btnRedo').addEventListener('click', redo);
window.addEventListener('beforeunload', stopAll);

// Service Worker + obras
if ('serviceWorker' in navigator) {
  window.addEventListener('load', ()=> { navigator.serviceWorker.register('./sw.js'); carregarObras(); });
} else {
  window.addEventListener('load', carregarObras);
}

// Estado inicial
if(!('mediaDevices' in navigator)){ els.chipCam.textContent='Câmera: não suportada'; els.chipCam.style.color='var(--danger)'; }
else { els.chipCam.textContent='Câmera: pronta'; }
