// ====== GeoCam UTM – script.js (somente mudanças necessárias nos chips) ======

// (REMOVIDO) Bloco que alterava o chip de HTTPS/secure.

// ---- UTM helpers ----
function latBandLetter(lat){
  const bands = "CDEFGHJKLMNPQRSTUVWX";
  const capped = Math.max(-80, Math.min(84, lat));
  let idx = Math.floor((capped + 80) / 8);
  if(idx < 0) idx = 0; if(idx > 19) idx = 19;
  return bands[idx];
}
function utmZoneFromLon(lon){
  let z = Math.floor((lon + 180) / 6) + 1;
  if(z < 1) z = 1; if(z > 60) z = 60;
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
  // você já tem esse select no HTML
  obraSelect: document.getElementById('obraSelect'),

  chipGPS: document.getElementById('chipGPS'),
  chipCam: document.getElementById('chipCam'),

  video: document.getElementById('video'),
  canvas: document.getElementById('canvas'),
  still:  document.getElementById('still'),
  badge:  document.getElementById('badge'),

  btnStart: document.getElementById('btnStart'),
  btnShot:  document.getElementById('btnShot'),
  btnRedo:  document.getElementById('btnRedo'),
  btnSave:  document.getElementById('btnSave'),

  gpsStatus: document.getElementById('gpsStatus'),
  acc:       document.getElementById('acc'),
  zoneBand:  document.getElementById('zoneBand'),
  easting:   document.getElementById('easting'),
  northing:  document.getElementById('northing'),
  fname:     document.getElementById('fname'),
};

const state = { lat:null, lon:null, acc:null, zone:null, band:null, e:null, n:null, stream:null, captureURL:null };
let watchId = null;

// ---- UI básica (inalterada, exceto nomes dos chips em pontos específicos) ----
function updateUI(){
  const {lat,lon,acc,zone,band,e,n} = state;
  if(lat!=null && lon!=null){
    // linha Lat,Lon removida do UI
    els.acc.textContent = acc!=null ? `${Math.round(acc)} m` : '—';
    els.zoneBand.textContent = (zone?zone:'—') + (band?band:'');
    els.easting.textContent = e ?? '—';
    els.northing.textContent = n ?? '—';
    if(zone && band && e!=null && n!=null){
      const base = `#${zone}${band}-${e}-${n}`;
      els.fname.textContent = `${base}.jpg`;
      els.badge.textContent = `UTM: ${base}`;
      els.gpsStatus.innerHTML = '<span style="color:var(--ok)">Fixado</span>';

      // >>> chips: GPS apenas “GPS” e verde quando ok
      els.chipGPS.textContent = 'GPS';
      els.chipGPS.classList.add('ok');
    }
  }
}

// ---- GPS ----
function startGPS(){
  if(!('geolocation' in navigator)){
    els.gpsStatus.innerHTML = '<span style="color:var(--danger)">Sem geolocalização</span>';
    // chip neutro
    els.chipGPS.textContent = 'GPS';
    els.chipGPS.classList.remove('ok');
    return;
  }
  els.gpsStatus.textContent = 'Solicitando permissão…';
  // chip neutro enquanto pede
  els.chipGPS.textContent = 'GPS';
  els.chipGPS.classList.remove('ok');

  watchId = navigator.geolocation.watchPosition(p=>{
    const {latitude, longitude, accuracy} = p.coords;
    Object.assign(state, {lat:latitude, lon:longitude, acc:accuracy}, toUTM(latitude, longitude));
    updateUI();
  }, err=>{
    els.gpsStatus.innerHTML = `<span style="color:var(--danger)">${err.message}</span>`;
    // chip neutro no erro
    els.chipGPS.textContent = 'GPS';
    els.chipGPS.classList.remove('ok');
  }, { enableHighAccuracy:true, timeout:15000, maximumAge:0 });
}

// ---- Câmera ----
async function startCamera(){
  try{
    els.btnStart.disabled = true; els.btnStart.textContent = 'Abrindo câmera…';
    const stream = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080} }, audio:false
    });
    state.stream = stream; els.video.srcObject = stream; await els.video.play();
    els.btnShot.disabled = false;

    // >>> chips: CAM apenas “CAM” e verde quando ativa
    els.chipCam.textContent = 'CAM';
    els.chipCam.classList.add('ok');

    els.btnStart.textContent = 'Câmera ativa';
  }catch(e){
    console.error(e);

    // >>> chips: CAM neutro no erro
    els.chipCam.textContent = 'CAM';
    els.chipCam.classList.remove('ok');

    alert('Não foi possível acessar a câmera. Verifique permissões.');
    els.btnStart.disabled=false; els.btnStart.textContent='Abrir câmera';
  }
}

// ---- Captura (inalterada) ----
async function capturePhoto(){
  if(!state.stream){ alert('Câmera inativa. Toque em "Abrir câmera".'); return; }
  if(state.lat==null || state.lon==null){ alert('Aguarde o GPS fixar.'); return; }
  const vw = els.video.videoWidth, vh = els.video.videoHeight; if(!vw||!vh){ alert('Câmera iniciando…'); return; }
  const s = Math.min(vw, vh), sx = (vw - s)/2, sy = (vh - s)/2;
  els.canvas.width = s; els.canvas.height = s;
  const ctx = els.canvas.getContext('2d'); ctx.drawImage(els.video, sx, sy, s, s, 0, 0, s, s);

  els.canvas.toBlob((blob)=>{
    if(!blob){ alert('Falha ao gerar imagem.'); return; }
    const base = `#${state.zone}${state.band}-${state.e}-${state.n}`;
    const fname = `${base}.jpg`;
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

// ---- Listeners (inalterados) ----
els.btnStart.addEventListener('click', ()=>{ startGPS(); startCamera(); });
els.btnShot.addEventListener('click', capturePhoto);
els.btnRedo.addEventListener('click', redo);
window.addEventListener('beforeunload', stopAll);

// ---- Service Worker (inalterado, ajuste conforme seu projeto) ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', ()=> navigator.serviceWorker.register('./sw.js'));
}

// ---- Estado inicial dos chips (CAM neutro, GPS neutro) ----
if(!('mediaDevices' in navigator)){
  els.chipCam.textContent = 'CAM';
  els.chipCam.classList.remove('ok');
} else {
  // sem “pronta”; só ficará verde quando a câmera abrir de fato
  els.chipCam.textContent = 'CAM';
  els.chipCam.classList.remove('ok');
}
// GPS começa neutro
els.chipGPS.textContent = 'GPS';
els.chipGPS.classList.remove('ok');
