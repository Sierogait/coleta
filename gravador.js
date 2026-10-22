// VisuWhats Coleta: gravador de áudio (WAV sem filtros) e vídeo, biblioteca local e exportação.
"use strict";

// ---------------- abas
document.querySelectorAll('.abas button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.abas button').forEach(x => x.classList.toggle('on', x === b));
  ['abaConversa', 'abaGravar', 'abaBib'].forEach(id => document.getElementById(id).hidden = id !== b.dataset.a);
  if (b.dataset.a === 'abaBib') desenhaBiblioteca();
});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------------- banco local (IndexedDB)
function abrirBanco() {
  return new Promise((ok, er) => {
    const r = indexedDB.open('coleta', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('recebidos')) db.createObjectStore('recebidos');
      if (!db.objectStoreNames.contains('gravacoes')) db.createObjectStore('gravacoes', { keyPath: 'id' });
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => er(r.error);
  });
}
async function bd(modo, fn) {
  const db = await abrirBanco();
  return new Promise((ok, er) => {
    const tx = db.transaction('gravacoes', modo); const st = tx.objectStore('gravacoes');
    const req = fn(st); tx.oncomplete = () => ok(req && req.result); tx.onerror = () => er(tx.error);
  });
}

// ---------------- captura de áudio PCM (AudioWorklet), sem filtros
const PROC = `class Cap extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('cap',Cap);`;
const RES = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };
let G = null;  // gravação em andamento

function fmtTempo(s) { s = Math.floor(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function blocoInfo(campos) {
  const enc = new TextEncoder(); const subs = [];
  for (const [id, txt] of Object.entries(campos)) {
    if (!txt) continue;
    let b = enc.encode(txt + '\0'); const pad = b.length % 2;
    const h = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 4; i++) h.setUint8(i, id.charCodeAt(i)); h.setUint32(4, b.length, true);
    subs.push(new Uint8Array(h.buffer), b); if (pad) subs.push(new Uint8Array(1));
  }
  const tam = subs.reduce((a, x) => a + x.length, 0) + 4;
  const h = new DataView(new ArrayBuffer(12)); 'LIST'.split('').forEach((c, i) => h.setUint8(i, c.charCodeAt(0))); h.setUint32(4, tam, true); 'INFO'.split('').forEach((c, i) => h.setUint8(8 + i, c.charCodeAt(0)));
  return [new Uint8Array(h.buffer), ...subs];
}
function wav(partes, taxa, info) {
  const n = partes.reduce((a, p) => a + p.length, 0);
  const extra = info ? blocoInfo(info) : []; const tamExtra = extra.reduce((a, x) => a + x.length, 0);
  const h = new DataView(new ArrayBuffer(44));
  const w = (o, t) => { for (let i = 0; i < t.length; i++) h.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); h.setUint32(4, 36 + n * 2 + tamExtra, true); w(8, 'WAVE'); w(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true);
  h.setUint16(22, 1, true); h.setUint32(24, taxa, true); h.setUint32(28, taxa * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  w(36, 'data'); h.setUint32(40, n * 2, true);
  return new Blob([h.buffer, ...partes.map(p => p.buffer), ...extra], { type: 'audio/wav' });
}
function tipoVideo() {
  for (const t of ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'])
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

// ---------------- localização e conferência do relógio
function iniciarLocalizacao() {
  const L = { pontos: [], erro: null, id: null };
  if (!$('#gGeo').checked || !navigator.geolocation) { L.erro = $('#gGeo').checked ? 'GPS indisponível neste aparelho' : 'não solicitada'; return L; }
  L.id = navigator.geolocation.watchPosition(p => {
    L.pontos.push({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), precisao_m: Math.round(p.coords.accuracy),
                    altitude_m: p.coords.altitude != null ? Math.round(p.coords.altitude) : null, em_utc: new Date(p.timestamp).toISOString() });
    const u = L.pontos[L.pontos.length - 1];
    $('#gLocal').textContent = `📍 ${u.lat.toFixed(5)}, ${u.lon.toFixed(5)} (±${u.precisao_m} m)`;
  }, e => { L.erro = e.message || 'localização não autorizada'; $('#gLocal').textContent = '📍 Localização não disponível: ' + L.erro; },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  return L;
}
function resumoLocal(L) {
  if (L.id != null) navigator.geolocation.clearWatch(L.id);
  if (!L.pontos.length) return { obtida: false, motivo: L.erro || 'sem sinal de GPS durante a gravação' };
  const melhor = L.pontos.reduce((a, b) => b.precisao_m < a.precisao_m ? b : a);
  const passo = Math.max(1, Math.ceil(L.pontos.length / 200));
  return { obtida: true, fonte: 'GPS/serviço de localização do aparelho', inicio: L.pontos[0], fim: L.pontos[L.pontos.length - 1], mais_precisa: melhor,
           pontos: L.pontos.length, trilha: L.pontos.filter((_, i) => i % passo === 0) };
}
async function conferirRelogio() {
  const fontes = [['https://worldtimeapi.org/api/timezone/Etc/UTC', j => j.utc_datetime], ['https://timeapi.io/api/Time/current/zone?timeZone=UTC', j => j.dateTime + 'Z']];
  for (const [url, ler] of fontes) {
    try {
      const t0 = Date.now(); const r = await fetch(url, { cache: 'no-store' }); const j = await r.json(); const t1 = Date.now();
      const srv = Date.parse(ler(j)); if (isNaN(srv)) continue;
      return { conferido: true, servidor: new URL(url).host, diferenca_s: Math.round(((srv + (t1 - t0) / 2) - t1) / 100) / 10, ida_e_volta_ms: t1 - t0 };
    } catch (e) {}
  }
  return { conferido: false, motivo: 'sem internet ou servidor de hora indisponível' };
}
function textoCarimbo(L) {
  const d = new Date(); const off = -d.getTimezoneOffset(); const sinal = off >= 0 ? '+' : '−';
  const fuso = `UTC${sinal}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  const u = L.pontos[L.pontos.length - 1];
  return [`${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')} (${fuso})`,
          u ? `${u.lat.toFixed(5)}, ${u.lon.toFixed(5)} ±${u.precisao_m} m` : 'localização: ' + (L.erro || 'aguardando GPS…'), 'VisuWhats Coleta'];
}

async function comecar() {
  const modo = document.querySelector('input[name=gmodo]:checked').value;
  const aviso = $('#gAviso'); aviso.className = 'aviso';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(modo === 'video'
      ? { ...RES, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } } : RES);
  } catch (e) { aviso.textContent = 'O celular não liberou o ' + (modo === 'video' ? 'microfone/câmera' : 'microfone') + ': ' + e.message; aviso.className = 'aviso erro'; return; }
  let ctx;
  try { ctx = new AudioContext({ sampleRate: 48000 }); } catch (e) { ctx = new AudioContext(); }
  await ctx.resume();
  const fonte = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const partes = [];
  let no;
  try {
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([PROC], { type: 'application/javascript' })));
    no = new AudioWorkletNode(ctx, 'cap');
    no.port.onmessage = e => { const f = e.data, i16 = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } partes.push(i16); };
  } catch (e) {
    no = ctx.createScriptProcessor(4096, 1, 1);
    no.onaudioprocess = ev => { const f = ev.inputBuffer.getChannelData(0), i16 = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } partes.push(i16); };
  }
  const mudo = ctx.createGain(); mudo.gain.value = 0;
  fonte.connect(no); no.connect(mudo); mudo.connect(ctx.destination);
  const an = ctx.createAnalyser(); an.fftSize = 2048; fonte.connect(an);
  const buf = new Float32Array(an.fftSize);
  let rec = null, pedacos = [], tv = '', desenhar = null;
  const L = iniciarLocalizacao();
  const relogioP = conferirRelogio();
  if (modo === 'video') {
    const pv = $('#gPrev'); pv.srcObject = stream; pv.muted = true; pv.hidden = false; await pv.play().catch(() => {});
    tv = tipoVideo();
    let fluxo = stream;
    if ($('#gCarimbo').checked && HTMLCanvasElement.prototype.captureStream) {
      const cv = $('#gTela'); const st = stream.getVideoTracks()[0].getSettings();
      cv.width = st.width || 1280; cv.height = st.height || 720; const c2 = cv.getContext('2d');
      cv.hidden = false; pv.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
      desenhar = () => {
        if (!G) return;
        c2.drawImage(pv, 0, 0, cv.width, cv.height);
        const linhas = textoCarimbo(L); const fs = Math.round(cv.height / 28);
        c2.font = `600 ${fs}px -apple-system, Roboto, Arial`; const alt = fs * 1.35 * linhas.length + fs * 0.6;
        c2.fillStyle = 'rgba(0,0,0,.55)'; c2.fillRect(0, cv.height - alt, cv.width, alt);
        c2.fillStyle = '#fff'; linhas.forEach((t, i) => c2.fillText(t, fs * 0.6, cv.height - alt + fs * 1.25 * (i + 1)));
        requestAnimationFrame(desenhar);
      };
      fluxo = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...stream.getAudioTracks()]);
    }
    rec = new MediaRecorder(fluxo, { mimeType: tv || undefined, videoBitsPerSecond: 6000000, audioBitsPerSecond: 256000 });
    rec.ondataavailable = e => { if (e.data && e.data.size) pedacos.push(e.data); };
    rec.start(1000);
  }
  let trava = null;
  try { trava = await navigator.wakeLock.request('screen'); } catch (e) {}
  const inicio = new Date();
  let pico = 0, estouros = 0;
  const tick = () => {
    if (!G) return;
    an.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v));
    pico = Math.max(pico, m); if (m > 0.98) estouros++;
    $('#gNivel').style.width = Math.min(100, m * 100) + '%';
    $('#gTempo').textContent = fmtTempo((Date.now() - inicio) / 1000);
    aviso.textContent = m > 0.98 ? 'Som estourando: abaixe o volume do outro aparelho ou afaste o celular.' : (m < 0.02 && Date.now() - inicio > 3000 ? 'Som muito baixo: aproxime o celular do alto-falante.' : 'Gravando…');
    requestAnimationFrame(tick);
  };
  G = { modo, stream, ctx, no, fonte, partes, rec, pedacos, tv, trava, inicio, L, relogioP, carimboNoVideo: !!desenhar,
        configuracao: stream.getAudioTracks()[0].getSettings(), estat: () => ({ pico, estouros }) };
  if (desenhar) desenhar();
  $('#gBotao').textContent = '■ Parar e salvar'; $('#gBotao').classList.add('gravando');
  document.querySelectorAll('input[name=gmodo]').forEach(r => r.disabled = true);
  tick();
}

async function parar() {
  const g = G; G = null;
  $('#gBotao').disabled = true; $('#gBotao').textContent = 'Salvando…';
  const fim = new Date();
  if (g.rec && g.rec.state !== 'inactive') await new Promise(ok => { g.rec.onstop = ok; g.rec.stop(); });
  try { g.no.disconnect(); g.fonte.disconnect(); } catch (e) {}
  g.stream.getTracks().forEach(t => t.stop());
  const taxa = g.ctx.sampleRate; await g.ctx.close();
  try { g.trava && g.trava.release(); } catch (e) {}
  $('#gPrev').hidden = true; $('#gPrev').srcObject = null; $('#gPrev').style.cssText = ''; $('#gTela').hidden = true;
  const local = resumoLocal(g.L);
  const relogio = await Promise.race([g.relogioP, new Promise(ok => setTimeout(() => ok({ conferido: false, motivo: 'servidor de hora não respondeu a tempo' }), 4000))]);
  const nota = $('#gNota').value.trim();
  const off = -g.inicio.getTimezoneOffset();
  const id = fim.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15) + '_' + Math.random().toString(36).slice(2, 6);
  const locTxt = local.obtida ? `${local.inicio.lat}, ${local.inicio.lon} (±${local.inicio.precisao_m} m)` : 'localização não obtida';
  const arquivos = [{ nome: 'audio.wav', papel: 'audio', blob: wav(g.partes, taxa, {
    INAM: nota || 'Gravação VisuWhats', ICRD: g.inicio.toISOString(), ISFT: 'VisuWhats Coleta 1.2',
    ICMT: `Início ${g.inicio.toISOString()} UTC; fuso ${Intl.DateTimeFormat().resolvedOptions().timeZone}; local ${locTxt}` }) }];
  if (g.pedacos.length) {
    const ext = g.tv.includes('mp4') ? 'mp4' : 'webm';
    arquivos.push({ nome: 'video.' + ext, papel: 'video', blob: new Blob(g.pedacos, { type: g.tv || 'video/' + ext }) });
  }
  const lista = [];
  for (const a of arquivos) lista.push({ nome: a.nome, papel: a.papel, bytes: a.blob.size, tipo: a.blob.type, sha256: await hashArquivo(a.blob) });
  const est = g.estat();
  const comp = {
    tipo: 'gravacao VisuWhats', versao: 'Coleta 1.2', id, modo: g.modo, nota,
    inicio_local: g.inicio.toString(), utc_offset_min: off, localizacao: local, relogio_do_aparelho: relogio,
    metadados_nos_arquivos: { audio_wav: 'bloco LIST/INFO com data de criação (ICRD), programa (ISFT), descrição (INAM) e data/fuso/local (ICMT)',
                               video: g.modo === 'video' ? (g.carimboNoVideo ? 'data, hora e local gravados sobre a imagem, atualizados a cada quadro' : 'sem carimbo na imagem') : null },
    inicio_utc: g.inicio.toISOString(), fim_utc: fim.toISOString(), duracao_s: Math.round((fim - g.inicio) / 100) / 10,
    fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
    audio: { formato: 'WAV PCM 16 bits mono', taxa_amostragem_hz: taxa, filtros_solicitados: { cancelamento_de_eco: false, reducao_de_ruido: false, controle_automatico_de_volume: false },
             configuracao_obtida_do_aparelho: g.configuracao, pico: Math.round(est.pico * 1000) / 1000, quadros_estourados: est.estouros },
    video: g.pedacos.length ? { formato: g.tv } : null,
    aparelho: { navegador: navigator.userAgent, plataforma: navigator.platform || '', idioma: navigator.language },
    arquivos: lista
  };
  const bytes = new TextEncoder().encode(JSON.stringify(comp, null, 1));
  let ots = null;
  try { ots = new Blob([await carimbar(bytes)]); } catch (e) {}
  await bd('readwrite', st => st.put({ id, criado: fim.toISOString(), comp, comprovante: new Blob([bytes], { type: 'application/json' }), ots,
    arquivos: arquivos.map(a => ({ nome: a.nome, papel: a.papel, blob: a.blob })), exportado: false }));
  $('#gBotao').disabled = false; $('#gBotao').textContent = '● Começar a gravar'; $('#gBotao').classList.remove('gravando');
  document.querySelectorAll('input[name=gmodo]').forEach(r => r.disabled = false);
  $('#gNivel').style.width = '0'; $('#gNota').value = ''; $('#gLocal').textContent = '';
  $('#gAviso').innerHTML = `<span class="ok">Gravação salva na biblioteca (${fmtTempo(comp.duracao_s)}).</span> ${local.obtida ? '📍 ' + locTxt + '. ' : ''}${relogio.conferido ? 'Relógio do celular conferido (diferença ' + relogio.diferenca_s + ' s). ' : ''} SHA-256 do áudio: <span class="h">${lista[0].sha256}</span>${ots ? '<br>Carimbo do tempo registrado.' : '<br>Sem internet: carimbo do tempo não registrado; o escritório registra ao receber.'}`;
}
$('#gBotao').onclick = () => G ? parar() : comecar();

// ---------------- biblioteca
async function desenhaBiblioteca() {
  const l = $('#bLista'); l.textContent = '';
  const itens = (await bd('readonly', st => st.getAll())) || [];
  itens.sort((a, b) => b.criado.localeCompare(a.criado));
  if (!itens.length) { l.innerHTML = '<p>Nenhuma gravação ainda.</p>'; return; }
  itens.forEach(g => {
    const d = document.createElement('div'); d.className = 'grav';
    const c = g.comp;
    d.innerHTML = `<div class="lin"><input type="checkbox" data-id="${g.id}" ${g.exportado ? '' : 'checked'}><b>${c.nota ? c.nota.replace(/</g, '&lt;') : 'Gravação sem descrição'}</b></div>
      <div class="aviso">${new Date(c.inicio_utc).toLocaleString('pt-BR')} · ${fmtTempo(c.duracao_s)} · ${c.modo === 'video' ? 'vídeo + áudio' : 'áudio'}${g.exportado ? ' · <span class="ok">exportada</span>' : ''}${g.ots ? '' : ' · sem carimbo'}</div>`;
    g.arquivos.forEach(a => { const m = document.createElement(a.papel === 'video' ? 'video' : 'audio'); m.controls = true; m.preload = 'none'; m.playsInline = true; m.src = URL.createObjectURL(a.blob); d.append(m); });
    const ap = document.createElement('button'); ap.className = 'sec'; ap.textContent = 'Apagar do celular';
    ap.onclick = async () => { if (!confirm(g.exportado ? 'Apagar esta gravação do celular?' : 'Esta gravação ainda NÃO foi exportada. Apagar mesmo assim?')) return; await bd('readwrite', st => st.delete(g.id)); desenhaBiblioteca(); };
    d.append(ap); l.append(d);
  });
}

// ---------------- ZIP (sem compressão, para preservar os arquivos byte a byte)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
async function crc32(blob) {
  let c = 0xFFFFFFFF; const T = 4 * 1024 * 1024;
  for (let i = 0; i < blob.size; i += T) { const b = new Uint8Array(await blob.slice(i, i + T).arrayBuffer()); for (let j = 0; j < b.length; j++) c = CRC[(c ^ b[j]) & 0xFF] ^ (c >>> 8); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function zip(entradas) {
  const partes = [], central = []; let pos = 0;
  const agora = new Date(); const dtm = ((agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1)) & 0xFFFF;
  const ddt = (((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate()) & 0xFFFF;
  for (const e of entradas) {
    const nome = new TextEncoder().encode(e.nome); const crc = await crc32(e.blob); const tam = e.blob.size;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dtm, true); lh.setUint16(12, ddt, true); lh.setUint32(14, crc, true); lh.setUint32(18, tam, true); lh.setUint32(22, tam, true);
    lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true);
    partes.push(lh.buffer, nome, e.blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dtm, true); ch.setUint16(14, ddt, true); ch.setUint32(16, crc, true); ch.setUint32(20, tam, true); ch.setUint32(24, tam, true);
    ch.setUint16(28, nome.length, true); ch.setUint32(42, pos, true);
    central.push(ch.buffer, nome);
    pos += 30 + nome.length + tam;
    if (pos > 0xFFFFFFF0) throw new Error('pacote acima de 4 GB: exporte menos gravações por vez');
  }
  const tamCentral = central.reduce((a, b) => a + (b.byteLength || b.length), 0);
  const fimc = new DataView(new ArrayBuffer(22));
  fimc.setUint32(0, 0x06054b50, true); fimc.setUint16(8, entradas.length, true); fimc.setUint16(10, entradas.length, true);
  fimc.setUint32(12, tamCentral, true); fimc.setUint32(16, pos, true);
  return new Blob([...partes, ...central, fimc.buffer], { type: 'application/zip' });
}

$('#bExportar').onclick = async () => {
  const av = $('#bAviso'); av.className = 'aviso';
  const marcados = [...document.querySelectorAll('#bLista input[type=checkbox]:checked')].map(i => i.dataset.id);
  if (!marcados.length) { av.textContent = 'Marque as gravações que deseja exportar.'; return; }
  const itens = (await bd('readonly', st => st.getAll())).filter(g => marcados.includes(g.id));
  av.textContent = 'Montando o pacote…';
  const base = 'VisuWhats_gravacoes_' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const entradas = [];
  const indice = { tipo: 'biblioteca de gravacoes VisuWhats', exportado_em_utc: new Date().toISOString(), gravacoes: [] };
  for (const g of itens) {
    entradas.push({ nome: `${base}/${g.id}/comprovante.json`, blob: g.comprovante });
    if (g.ots) entradas.push({ nome: `${base}/${g.id}/comprovante.json.ots`, blob: g.ots });
    g.arquivos.forEach(a => entradas.push({ nome: `${base}/${g.id}/${a.nome}`, blob: a.blob }));
    indice.gravacoes.push({ id: g.id, nota: g.comp.nota, inicio_utc: g.comp.inicio_utc, duracao_s: g.comp.duracao_s, comprovante_sha256: await hashArquivo(g.comprovante) });
  }
  entradas.unshift({ nome: `${base}/biblioteca.json`, blob: new Blob([JSON.stringify(indice, null, 1)], { type: 'application/json' }) });
  let pacote;
  try { pacote = await zip(entradas); } catch (e) { av.textContent = 'Erro: ' + e.message; av.className = 'aviso erro'; return; }
  const arq = new File([pacote], base + '.zip', { type: 'application/zip' });
  const h = await hashArquivo(arq);
  try {
    if (navigator.canShare && navigator.canShare({ files: [arq] })) await navigator.share({ files: [arq], title: 'Gravações', text: 'Pacote de gravações SHA-256 ' + h });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(arq); a.download = arq.name; a.click(); }
  } catch (e) { if (e.name === 'AbortError') { av.textContent = 'Envio cancelado.'; return; } }
  await bd('readwrite', st => { itens.forEach(g => { g.exportado = true; st.put(g); }); return null; });
  av.innerHTML = `<span class="ok">Pacote gerado (${(arq.size / 1048576).toFixed(1)} MB).</span> SHA-256 <span class="h">${h}</span>`;
  desenhaBiblioteca();
};
