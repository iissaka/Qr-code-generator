/* Clean, minimal QR-only script */

const $ = id => document.getElementById(id);

function enableActions(enabled){
  const disabled = !enabled;
  const dl = $('downloadBtn'); if(dl) dl.disabled = disabled;
  const cp = $('copyBtn'); if(cp) cp.disabled = disabled;
}

function clearCanvas(canvas){
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
}

function generateQR(){
  const input = $('qrInput');
  if(!input) return;
  const value = input.value.trim();
  if(!value){ alert('Veuillez saisir une URL ou du texte.'); return; }

  const canvas = $('qrcode');
  if(!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  // Compute visual size based on available container width for better responsivity
  const container = canvas.parentElement || canvas;
  const containerWidth = Math.max(0, container.clientWidth || Math.min(window.innerWidth, 760));
  // Leave some padding room, clamp between reasonable min/max
  const visualSize = Math.round(Math.max(120, Math.min(containerWidth - 32, Math.min(window.innerWidth * 0.9, 520))));
  const size = Math.round(visualSize * ratio);
  canvas.width = size; canvas.height = size;
  canvas.style.width = visualSize + 'px'; canvas.style.height = visualSize + 'px';

  clearCanvas(canvas);

  // Read colors
  const dark = ($('colorDark') && $('colorDark').value) || '#0f172a';
  const light = ($('colorLight') && $('colorLight').value) || '#ffffff';
  canvas.style.background = light;

  ensureQRCodeLoaded(() => {
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: Math.max(2 * ratio, 2),
      color: { dark: dark, light: light },
      errorCorrectionLevel: 'H'
    }, function (error) {
      if (error) { console.error(error); alert('Erreur lors de la génération du QR.'); enableActions(false); return; }
      canvas.dataset.generated = 'true';
      enableActions(true);
    });
  });
}

function ensureQRCodeLoaded(cb){
  if(typeof QRCode !== 'undefined' && QRCode.toCanvas) return cb();
  // load dynamically
  const src = 'https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js';
  // Avoid loading multiple times
  if(document.querySelector('script[data-qrcode-loader]')){
    // wait until loaded
    const check = setInterval(()=>{
      if(typeof QRCode !== 'undefined' && QRCode.toCanvas){ clearInterval(check); cb(); }
    }, 100);
    setTimeout(()=>{ clearInterval(check); if(typeof QRCode === 'undefined') alert('Impossible de charger la librairie QR.'); }, 5000);
    return;
  }
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.setAttribute('data-qrcode-loader','1');
  s.onload = () => { if(typeof QRCode !== 'undefined') cb(); else alert('La librairie QR a échoué à charger.'); };
  s.onerror = () => alert('Échec du chargement de la librairie QR. Vérifiez votre connexion.');
  document.head.appendChild(s);
}

function ensureBarcodeLoaded(cb){
  if(typeof JsBarcode !== 'undefined') return cb();
  if(document.querySelector('script[data-jsbarcode-loader]')){
    const check = setInterval(()=>{ if(typeof JsBarcode !== 'undefined'){ clearInterval(check); cb(); } }, 100);
    setTimeout(()=>{ clearInterval(check); if(typeof JsBarcode === 'undefined') alert('Impossible de charger la librairie Barcode.'); }, 5000);
    return;
  }
  const src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
  const s = document.createElement('script');
  s.src = src; s.async = true; s.setAttribute('data-jsbarcode-loader','1');
  s.onload = () => { if(typeof JsBarcode !== 'undefined') cb(); else alert('La librairie Barcode a échoué à charger.'); };
  s.onerror = () => alert('Échec du chargement de la librairie Barcode.');
  document.head.appendChild(s);
}

function downloadQRCode(){
  const canvas = $('qrcode');
  if(!canvas || !canvas.dataset.generated) { alert('Veuillez générer un QR Code d\'abord.'); return; }
  const ratio = window.devicePixelRatio || 1;
  canvas.toBlob(function(blob){
    if(!blob) return alert('Impossible de créer l\'image.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'qrcode.png'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, 'image/png');
}

async function copyQRCode(){
  const canvas = $('qrcode');
  if(!canvas || !canvas.dataset.generated) { alert('Veuillez générer un QR Code d\'abord.'); return; }
  if(!navigator.clipboard || typeof ClipboardItem === 'undefined') return alert('Copie non supportée sur ce navigateur.');
  try{
    const ratio = window.devicePixelRatio || 1;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const item = new ClipboardItem({ 'image/png': blob });
    await navigator.clipboard.write([item]);
    alert('QR copié dans le presse-papier.');
  }catch(e){ console.error(e); alert('Impossible de copier le QR.'); }
}

document.addEventListener('DOMContentLoaded', ()=>{
  const gen = $('generateBtn'); if(gen) gen.addEventListener('click', generateQR);
  const dl = $('downloadBtn'); if(dl) dl.addEventListener('click', downloadQRCode);
  const cp = $('copyBtn'); if(cp) cp.addEventListener('click', copyQRCode);
  const input = $('qrInput'); if(input) input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') generateQR(); });
  enableActions(false);
});
 
