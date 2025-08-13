// ====== GeoCam UTM – script.js ======

// Sinaliza contexto seguro (HTTPS / localhost)
(function(){
  const el = document.getElementById('chipSecure');
  const ok = location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname);
  el.textContent = ok ? 'HTTPS ✓' : 'Use HTTPS';
  el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
})();

// ---- UTM helpers (proj4 obrigatório no index) ----
function latBandLetter(lat){
  const bands = "CDEFGHJKLMNPQRSTUVWX"; // -80° a 84°
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

  obraSelect: document.getElementById('obraSelect'),
};

const state = {
  lat: null, lon: null, acc: null,
  zone: null, band: null, e: null, n: null,
  stream: null, captureURL: null,
  obraId: null, obraNome: null
};

let watchId = null;

// ---- Obras (carregar JSON e popular select) ----
async function carregarObras(){
  try{
    const res = await fetch('./fotos/obras.json', { cache: 'no-store' });
    if(!res.ok) throw new Error('Falha ao carregar obras.json');
    const data = await res.json();
    const obras = data.obras || [];
    els.obraSelect.innerHTML = '<option value="">Selecionar…</option>' +
      obras.map(o => `<option value="${o.id}">${o.nome}</option>`).join('');
    els.obraSelect.addEventListener('change', (e)=>{
      const id = e.target.value;
      const item = obras.find(o => o.id === id);
      state.obraId = id || null;
      state.obraNome = item ? item.nome : null;
      updateUI();
    });
  }catch(e){
    console.warn('[obras] ', e);
  }
}

// Util: timestamp YYYYMMDD-HHMMSS
function tsNow(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Nome do arquivo no padrão: #<Obra>-<Zona><Banda>-<E>-<N>_<YYYYMMDD-HHMMSS>.jpg
function nomeArquivoAtual(withTimestamp = true){
  const obra = (state.obraNome || 'OBRA').replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'_');
  const base = `#${obra}-${state.zone ?? '--'}${state.band ?? ''}-${state.e ?? '--'}-${state.n ?? '--'}`;
  return withTimestamp ? `${base}_${tsNow()}.jpg` : `${base}.jpg`;
}

// Atualiza UI
function updateUI(){
  const { acc, zone, band, e, n } = state;
  els.acc.textContent      = acc != null ? `${Math.round(acc)} m` : '—';
  els.zoneBand.textContent = (zone ? zone : '—') + (band ? band : '');
  els.easting.textContent  = e ?? '—';
  els.northing.textContent = n ?? '—';

  if(zone && band && e != null && n != null){
    els.fname.textContent = nomeArquivoAtual(false);
    els.badge.textContent = `UTM: #${zone}${band}-${e}-${n}`;
    els.gpsStatus.innerHTML = '<span style="color:var(--ok)">Fixado</span>';
    els.chipGPS.textContent = `GPS: ±${Math.round(acc || 0)} m`;
    els.chipGPS.style.color = 'var(--ok)';
  }
}

// GPS
function startGPS(){
  if(!('geolocation' in navigator)){
    els.gpsStatus.innerHTML = '<span style="color:var(--danger)">Sem geolocalização</span>';
    els.chipGPS.textContent = 'GPS: indisponível';
    return;
  }
  els.gpsStatus.textContent = 'Solicitando permissão…';
  els.chipGPS.textContent   = 'GPS: pedindo…';

  // Debounce simples para evitar excesso de writes na UI
  let lastUpdate = 0;
  const MIN_MS = 400;

  watchId = navigator.geolocation.watchPosition(p=>{
    const now = Date.now();
    if (now - lastUpdate < MIN_MS) return;
    lastUpdate = now;

    const { latitude, longitude, accuracy } = p.coords;
    Object.assign(state, { lat: latitude, lon: longitude, acc: accuracy }, toUTM(latitude, longitude));
    updateUI();
  }, err=>{
    els.gpsStatus.innerHTML = `<span style="color:var(--danger)">${err.message}</span>`;
    els.chipGPS.textContent = 'GPS: negado';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

// Câmera
async function startCamera(){
  try{
    els.btnStart.disabled = true;
    els.btnStart.textContent = 'Abrindo câmera…';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    state.stream = stream;
    els.video.srcObject = stream;
    await els.video.play();
    els.btnShot.disabled = false;
    els.chipCam.textContent = 'Câmera: ativa';
    els.chipCam.style.color = 'var(--ok)';
    els.btnStart.textContent = 'Câmera ativa';
  }catch(e){
    console.error(e);
    els.chipCam.textContent = 'Câmera: erro';
    els.chipCam.style.color = 'var(--danger)';
    alert('Não foi possível acessar a câmera. Verifique permissões.');
    els.btnStart.disabled = false;
    els.btnStart.textContent = 'Abrir câmera';
  }
}

// Captura (recorte 1:1 central)
async function capturePhoto(){
  if(!state.stream){ alert('Câmera inativa. Toque em "Abrir câmera".'); return; }
  if(state.zone == null || state.band == null || state.e == null || state.n == null){
    alert('Aguarde o GPS fixar.'); return;
  }

  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if(!vw || !vh){ alert('Câmera iniciando…'); return; }

  // Corrige caso Safari/iOS reporte dimensões trocadas
  const W = Math.max(vw, vh);
  const H = Math.min(vw, vh);
  const isLandscape = vw >= vh;
  const srcW = isLandscape ? vw : vh;
  const srcH = isLandscape ? vh : vw;

  // Quadrado central
  const s = Math.min(srcW, srcH);
  const sx = (srcW - s) / 2;
  const sy = (srcH - s) / 2;

  els.canvas.width = s;
  els.canvas.height = s;

  const ctx = els.canvas.getContext('2d');
  // Para manter a orientação correta no drawImage:
  // desenhamos sempre a partir da origem 0,0 do vídeo, ajustando sx/sy conforme cálculo acima
  ctx.drawImage(els.video, sx, sy, s, s, 0, 0, s, s);

  els.canvas.toBlob((blob)=>{
    if(!blob){ alert('Falha ao gerar imagem.'); return; }
    const fname = nomeArquivoAtual(true);
    if(state.captureURL) URL.revokeObjectURL(state.captureURL);
    const url = URL.createObjectURL(blob);
    state.captureURL = url;

    els.still.src = url; els.still.style.display = 'block';
    els.video.style.display = 'none'; els.canvas.style.display = 'none';
    els.btnRedo.style.display = 'inline-flex'; els.btnSave.style.display = 'inline-flex';
    els.btnSave.textContent = `Salvar: ${fname}`;
    els.btnSave.href = url;
    els.btnSave.setAttribute('download', fname);
  }, 'image/jpeg', 0.92);
}

function redo(){
  els.still.style.display = 'none';
  els.video.style.display = 'block';
  els.btnRedo.style.display = 'none';
  els.btnSave.style.display = 'none';
}

function stopAll(){
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (state.stream){ state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
  if (state.captureURL){ URL.revokeObjectURL(state.captureURL); state.captureURL = null; }
}

// Listeners
els.btnStart.addEventListener('click', ()=>{ startGPS(); startCamera(); });
els.btnShot.addEventListener('click', capturePhoto);
els.btnRedo.addEventListener('click', redo);
window.addEventListener('beforeunload', stopAll);

// ---- Registro do Service Worker com detecção de update ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Carregar lista de obras junto com o SW
    carregarObras();

    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Checa atualização no load
      reg.update().catch(()=>{});

      reg.onupdatefound = () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.onstatechange = () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            const ok = confirm('Nova versão disponível. Atualizar agora?');
            if (ok && reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          }
        };
      };

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Após o skipWaiting, recarrega para aplicar a versão nova
        window.location.reload();
      });
    }).catch((err) => {
      console.warn('SW register failed:', err);
      // Mesmo que dê erro no SW, ainda carregamos as obras
      carregarObras();
    });
  });
} else {
  // Sem SW, ainda carregamos as obras
  window.addEventListener('load', carregarObras);
}

// Estado inicial da câmera (chip)
if(!('mediaDevices' in navigator)){
  els.chipCam.textContent = 'Câmera: não suportada';
  els.chipCam.style.color = 'var(--danger)';
} else {
  els.chipCam.textContent = 'Câmera: pronta';
}
