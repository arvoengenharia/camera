// GeoCam UTM – script.js com área dinâmica, contador e download em ZIP

// Helpers UTM
function latBandLetter(lat) {
  const bands = "CDEFGHJKLMNPQRSTUVWX";
  const capped = Math.max(-80, Math.min(84, lat));
  let idx = Math.floor((capped + 80) / 8);
  return bands[Math.max(0, Math.min(19, idx))];
}
function utmZoneFromLon(lon) {
  return Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1));
}
function toUTM(lat, lon) {
  const zone = utmZoneFromLon(lon);
  const south = lat < 0;
  const def = `+proj=utm +zone=${zone} ${south ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
  const [E, N] = proj4('EPSG:4326', def, [lon, lat]);
  return { zone, band: latBandLetter(lat), e: Math.round(E), n: Math.round(N) };
}

// Áreas
const AREAS = [
  { nome: 'EXTERNO-P01', n0: 9341182, n1: 9341202, e0: 249285, e1: 249305 },
  { nome: 'EXTERNO-P02', n0: 9341339, n1: 9341359, e0: 249285, e1: 249305 },
  { nome: 'EXTERNO-P03', n0: 9341476, n1: 9341496, e0: 249281, e1: 249301 },
  { nome: 'EXTERNO-P04', n0: 9341475, n1: 9341495, e0: 249395, e1: 249415 },
  { nome: 'EXTERNO-P05', n0: 9341472, n1: 9341492, e0: 249534, e1: 249554 },
  { nome: 'EXTERNO-P06', n0: 9341396, n1: 9341416, e0: 249531, e1: 249551 },
  { nome: 'EXTERNO-P07', n0: 9341305, n1: 9341325, e0: 249570, e1: 249590 },
  { nome: 'EXTERNO-P08', n0: 9341184, n1: 9341204, e0: 249413, e1: 249433 },
  { nome: 'EXTERNO-P09', n0: 9341232, n1: 9341252, e0: 249322, e1: 249342 },
  { nome: 'EXTERNO-P10', n0: 9341240, n1: 9341260, e0: 249338, e1: 249358 },
  { nome: 'EXTERNO-P11', n0: 9341240, n1: 9341260, e0: 249338, e1: 249358 }
];

function getArea(n, e) {
  for (const a of AREAS) {
    if (n >= a.n0 && n <= a.n1 && e >= a.e0 && e <= a.e1) return a.nome;
  }
  return "FORA DE ÁREA";
}

function sanitizeFolder(area) {
  if (area === "FORA DE ÁREA") return "fora";
  return area.replace(/[^0-9]/gi, '').replace(/^0+/, '').toLowerCase().padStart(1, '');
}

function getWeekNumber(date) {
  const firstDay = new Date(date.getFullYear(), 0, 1);
  const pastDays = Math.floor((date - firstDay) / 86400000);
  return Math.ceil((pastDays + firstDay.getDay() + 1) / 7);
}

// Elementos
const els = {
  chipGPS: document.getElementById('chipGPS'),
  chipCam: document.getElementById('chipCam'),
  video: document.getElementById('video'),
  canvas: document.getElementById('canvas'),
  still: document.getElementById('still'),
  badge: document.getElementById('badge'),
  btnShot: document.getElementById('btnShot'),
  btnRedo: document.getElementById('redoButton'),
  counter: document.getElementById('photoCounter')
};

// Estado
const state = {
  lat: null, lon: null, zone: null, band: null, e: null, n: null,
  stream: null,
  captureURL: null,
  photos: []
};

// GPS
function startGPS() {
  if (!('geolocation' in navigator)) return;
  els.chipGPS.textContent = 'GPS';
  navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude } = pos.coords;
    Object.assign(state, { lat: latitude, lon: longitude }, toUTM(latitude, longitude));
    updateBadge();
    els.chipGPS.classList.add('ok');
  }, () => els.chipGPS.classList.remove('ok'), {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0
  });
}

// Câmera
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    state.stream = stream;
    els.video.srcObject = stream;
    await els.video.play();
    els.chipCam.classList.add('ok');
  } catch {
    els.chipCam.classList.remove('ok');
    alert('Não foi possível acessar a câmera.');
  }
}

// Atualiza badge dinâmica
function updateBadge() {
  const { zone, band, e, n } = state;
  if (zone && band && e != null && n != null) {
    const area = getArea(n, e);
    const utm = `${zone}${band}-${e}-${n}`;

    const agora = new Date();
    const data = agora.toLocaleDateString('pt-BR');
    const hora = agora.toTimeString().slice(0, 8);

    els.badge.innerHTML = `
      ${data}-${hora}<br>
      ${utm}<br>
      GALPÃO DOCA<br>
      ${area}<br>
      #ARVO ENGENHARIA
    `;
  }
}

// Captura
function capturePhoto() {
  if (!state.stream || !state.lat || !state.lon) return;
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  const s = Math.min(vw, vh);
  const sx = (vw - s) / 2;
  const sy = (vh - s) / 2;
  els.canvas.width = s;
  els.canvas.height = s;
  const ctx = els.canvas.getContext('2d');
  ctx.drawImage(els.video, sx, sy, s, s, 0, 0, s, s);
  els.canvas.toBlob(blob => {
    const base = `#${state.zone}${state.band}-${state.e}-${state.n}`;
    const area = getArea(state.n, state.e);
    const url = URL.createObjectURL(blob);
    state.photos.push({ blob, url, area, date: new Date() });
    state.captureURL = url;
    els.still.src = url;
    els.still.style.display = 'block';
    els.video.style.display = 'none';
    els.btnRedo.style.display = 'grid';
    els.counter.style.display = 'grid';
    updateCounter();
  }, 'image/jpeg', 0.92);
}

// Refazer
function redo() {
  if (state.photos.length > 0) {
    const removed = state.photos.pop();
    URL.revokeObjectURL(removed.url);
  }
  els.still.style.display = 'none';
  els.video.style.display = 'block';
  els.btnRedo.style.display = 'none';
  if (state.photos.length === 0) els.counter.style.display = 'none';
  updateCounter();
}

// Contador
function updateCounter() {
  els.counter.textContent = state.photos.length;
}

// Baixar ZIP
async function downloadZIP() {
  const zip = new JSZip();
  const folders = {};

  for (let i = 0; i < state.photos.length; i++) {
    const photo = state.photos[i];
    const folderName = sanitizeFolder(photo.area);
    const week = getWeekNumber(photo.date);
    const fnameBase = `w${week}`;
    const count = (folders[folderName]?.[week] || 0) + 1;
    folders[folderName] = folders[folderName] || {};
    folders[folderName][week] = count;
    const fname = count === 1 ? `${fnameBase}.jpg` : `${fnameBase}-${count}.jpg`;
    const blob = await photo.blob.arrayBuffer();
    zip.file(`${folderName}/${fname}`, blob);
  }

  zip.generateAsync({ type: "blob" }).then(content => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = "fotos.zip";
    a.click();
  });
}

// Eventos
els.btnShot.addEventListener('click', capturePhoto);
els.btnRedo.addEventListener('click', redo);
els.counter.addEventListener('click', () => {
  if (state.photos.length === 0) return;
  if (confirm("Deseja baixar as fotos tiradas?")) {
    downloadZIP();
  }
});

window.addEventListener('beforeunload', () => {
  if (state.stream) state.stream.getTracks().forEach(t => t.stop());
  state.photos.forEach(p => URL.revokeObjectURL(p.url));
});

window.addEventListener('load', () => {
  startCamera();
  startGPS();
});
