// ====== Configurações ======

// Abre câmera traseira automaticamente
const VIDEO_CONSTRAINTS = {
  audio: false,
  video: { facingMode: { ideal: "environment" } }
};

// Mapeamento dos ranges (Northing N e Easting E) -> nome lógico
// Regra: precisa estar dentro do range de N E de E (conector lógico "e")
const LOCAL_RANGES = [
  { name: "EXTERNO-P01", N:[9341182,9341202], E:[249285,249305] },
  { name: "EXTERNO-P02", N:[9341339,9341359], E:[249285,249305] },
  { name: "EXTERNO-P03", N:[9341476,9341496], E:[249281,249301] },
  { name: "EXTERNO-P04", N:[9341475,9341495], E:[249395,249415] },
  { name: "EXTERNO-P05", N:[9341472,9341492], E:[249534,249554] },
  { name: "EXTERNO-P06", N:[9341396,9341416], E:[249531,249551] },
  { name: "EXTERNO-P07", N:[9341305,9341325], E:[249570,249590] },
  { name: "EXTERNO-P08", N:[9341184,9341204], E:[249413,249433] },
  { name: "EXTERNO-P09", N:[9341232,9341252], E:[249322,249342] },
  { name: "EXTERNO-P10", N:[9341240,9341260], E:[249338,249358] },
  { name: "EXTERNO-P11", N:[9341240,9341260], E:[249338,249358] },
];

// ====== Estado da sessão (cache em memória) ======
const session = {
  photos: [] // { blob, localName, folderName, week, stampText }
};

// ====== Elementos ======
const video   = document.getElementById('video');
const canvas  = document.getElementById('canvas');
const shutter = document.getElementById('shutterBtn');
const redoBtn = document.getElementById('redoBtn');
const counterBtn = document.getElementById('counterBtn');

// ====== Helpers ======

// Semana ISO do ano
function getISOWeek(date=new Date()){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo; // 1..53
}

// Data DDMMAA para nome do ZIP (timezone America/Bahia ~ -03:00)
function zipDateDDMMAA(){
  const now = new Date();
  const dd = String(now.getDate()).padStart(2,'0');
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const aa = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${aa}`;
}

// Normalizar nome da pasta a partir de "EXTERNO-Pxx"
function normalizeFolder(localName){
  if(localName === "FORA DE ÁREA") return "foraarea";
  const m = localName.match(/^EXTERNO-P0?(\d+)$/i);
  if(!m) return "foraarea";
  return `externo${m[1]}`; // minúsculo, sem hífen, sem 'P', sem zero à esquerda
}

// Determinar zona UTM por longitude
function utmZoneFromLon(lon){
  return Math.floor((lon + 180) / 6) + 1; // 1..60
}

// Converte WGS84 -> UTM (usando proj4); retorna {E,N,zone,isSouth}
function latLonToUTM(lat, lon){
  const zone = utmZoneFromLon(lon);
  const isSouth = lat < 0;
  const utmProj = `+proj=utm +zone=${zone} ${isSouth?'+south':''} +datum=WGS84 +units=m +no_defs`;
  const [E, N] = proj4('WGS84', utmProj, [lon, lat]); // proj4 espera [lon, lat]
  return { E, N, zone, isSouth };
}

// Determina o "Local" a partir dos ranges
function determineLocalName(N, E){
  for(const r of LOCAL_RANGES){
    const inN = N >= r.N[0] && N <= r.N[1];
    const inE = E >= r.E[0] && E <= r.E[1];
    if(inN && inE) return r.name;
  }
  return "FORA DE ÁREA";
}

// Atualiza contador
function updateCounter(){
  const n = session.photos.length;
  if(n > 0){
    counterBtn.textContent = String(n);
    counterBtn.classList.remove('hidden');
    redoBtn.classList.remove('hidden');
  }else{
    counterBtn.classList.add('hidden');
    redoBtn.classList.add('hidden');
  }
}

// Desenha (carimba) e captura o frame do vídeo em JPEG Blob (sempre 1:1, com barras)
async function captureStampedPhoto(){
  // Tenta obter geolocalização (alta precisão quando possível)
  let coords = null;
  try{
    coords = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve(pos.coords),
        _err => resolve(null),
        { enableHighAccuracy:true, timeout:5000, maximumAge:0 }
      );
    });
  }catch(_){ /* ignore */ }

  // Dimensões originais do vídeo
  const vw = video.videoWidth  || 1280;
  const vh = video.videoHeight || 720;

  // Canvas quadrado (1:1)
  const S = Math.max(vw, vh); // grande o bastante p/ nunca estourar qualidade
  canvas.width  = S;
  canvas.height = S;

  const ctx = canvas.getContext('2d');

  // Fundo preto (barras)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);

  // Escala "contain" para desenhar o frame *sem recorte* dentro do quadrado
  // Mantém proporção e centraliza (gera barras pretas quando necessário)
  const scale = Math.min(S / vw, S / vh);
  const drawW = Math.round(vw * scale);
  const drawH = Math.round(vh * scale);
  const dx = Math.round((S - drawW) / 2);
  const dy = Math.round((S - drawH) / 2);

  // Desenha o frame do vídeo centralizado
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, vw, vh, dx, dy, drawW, drawH);

  // Calcula UTM e Local (se tivermos coords)
  let stampLocal = "FORA DE ÁREA";
  let stampUTM = null;

  if(coords){
    const lat = coords.latitude;
    const lon = coords.longitude;

    const utmZoneFromLon = (L) => Math.floor((L + 180) / 6) + 1;
    const zone = utmZoneFromLon(lon);
    const isSouth = lat < 0;
    const utmProj = `+proj=utm +zone=${zone} ${isSouth?'+south':''} +datum=WGS84 +units=m +no_defs`;
    const [E, N] = proj4('WGS84', utmProj, [lon, lat]);

    stampUTM = {
      E: Math.round(E),
      N: Math.round(N),
      zone: zone + (isSouth ? 'S' : 'N')
    };

    // Reutiliza os ranges definidos no topo do arquivo
    const inRange = (v, [a,b]) => v >= a && v <= b;
    const match = LOCAL_RANGES.find(r => inRange(stampUTM.N, r.N) && inRange(stampUTM.E, r.E));
    stampLocal = match ? match.name : "FORA DE ÁREA";
  }

  // Texto do carimbo
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  const MM = String(now.getMonth()+1).padStart(2,'0');
  const yyyy = now.getFullYear();

  const lines = [];
  lines.push(`LOCAL: ${stampLocal}`);
  if(stampUTM){
    lines.push(`UTM: E ${stampUTM.E}  N ${stampUTM.N}  Z ${stampUTM.zone}`);
  }else{
    lines.push(`UTM: indisponível`);
  }
  lines.push(`${dd}/${MM}/${yyyy} ${hh}:${mm}/${ss}`.replace('/', ':')); // dd/MM/yyyy HH:mm:ss

  // Desenha caixa e texto no canto inferior esquerdo **dentro do quadrado**
  ctx.save();
  const pad = 12;
  ctx.font = `bold 28px Arial, sans-serif`;
  const lineH = 34;

  // Largura do texto baseada na maior linha
  const textW = Math.max(...lines.map(t => ctx.measureText(t).width));
  const boxW = Math.min(textW + pad*2, S - 28); // margem de 14px de cada lado
  const boxH = lines.length * lineH + pad*2;

  const x = 14;
  const y = S - boxH - 14; // encostado no rodapé do quadrado (barras inclusas)

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, boxW, boxH);

  ctx.fillStyle = '#fff';
  let ty = y + pad + 22;
  for(const t of lines){
    ctx.fillText(t, x + pad, ty);
    ty += lineH;
  }
  ctx.restore();

  // Gera Blob JPEG
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));

  // Helpers já existentes
  const getISOWeek = (date=new Date())=>{
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };

  const normalizeFolder = (localName)=>{
    if(localName === "FORA DE ÁREA") return "foraarea";
    const m = localName.match(/^EXTERNO-P0?(\d+)$/i);
    if(!m) return "foraarea";
    return `externo${m[1]}`;
  };

  const week = getISOWeek(now);
  const localName = stampLocal;
  const folderName = normalizeFolder(localName);
  const stampText = lines.join('\n');

  return { blob, week, localName, folderName, stampText };
}


// Exporta sessão como ZIP (e limpa)
async function exportSessionZip(){
  if(session.photos.length === 0) return;

  const zip = new JSZip();

  // Agrupar por pasta e nomear arquivos wXX.jpg (com _2, _3... se colidir)
  const countersPerFolderWeek = new Map(); // key: folder|week -> count

  for(const p of session.photos){
    const base = `w${String(p.week).padStart(2,'0')}.jpg`;
    const key = `${p.folderName}|${p.week}`;
    const count = (countersPerFolderWeek.get(key) || 0) + 1;
    countersPerFolderWeek.set(key, count);

    const filename = count === 1 ? base : base.replace('.jpg', `_${count}.jpg`);
    const path = `${p.folderName}/${filename}`;

    // Coloca o arquivo
    zip.file(path, p.blob);
  }

  const ddmmaa = zipDateDDMMAA();
  const zipName = `VSR-${ddmmaa}.zip`;
  const content = await zip.generateAsync({ type:'blob' });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();

  // Limpa sessão e UI
  session.photos = [];
  updateCounter();
  // volta para estado de captura (já estamos nele)
}

// ====== Eventos UI ======
shutter.addEventListener('click', async ()=>{
  const photo = await captureStampedPhoto();
  session.photos.push(photo);
  updateCounter();
});

redoBtn.addEventListener('click', ()=>{
  // Apaga somente a última foto tirada
  session.photos.pop();
  updateCounter();
});

counterBtn.addEventListener('click', ()=>{
  if(session.photos.length === 0) return;
  const ok = confirm("Baixar a sessão como ZIP e limpar o cache?");
  if(ok) exportSessionZip();
});

// ====== Inicialização da câmera ======
async function initCamera(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
    video.srcObject = stream;
  }catch(err){
    alert("Não foi possível acessar a câmera. Verifique as permissões do navegador.");
  }
}

window.addEventListener('load', initCamera);
