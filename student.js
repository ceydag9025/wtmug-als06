/* student.js — DTMF/Goertzel çözücü + QR üretici */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);

  /* ---------- DTMF tablosu ---------- */
  const ROWS = [697, 770, 852, 941];
  const COLS = [1209, 1336, 1477];
  const KEYS = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['*', '0', '#']
  ];

  /* ---------- Eşikler (ince ayar buradan) ---------- */
  const RMS_GATE = 0.0030;   // bu seviyenin altı "sessizlik"
  const BIN_MIN = 0.0020;   // bir DTMF frekansının min genliği
  const RATIO = 1.8;        // baskın frekans / ikinci en güçlü
  const STABLE = 3;         // aynı rakamın kaç ölçümde üst üste gelmesi
  const POLL_MS = 40;
  const SEQ_GAP = 1300;     // rakamlar arası bu süreden uzun boşluk → yeni dizi

  /* ---------- DOM ---------- */
  const noInput = $('#noInput');
  const listenBtn = $('#listenBtn');
  const micStatus = $('#micStatus');
  const digitsEl = $('#digits');
  const codeOut = $('#codeOut');
  const qrCanvas = $('#qr');
  const qrInfo = $('#qrInfo');
  const manual = $('#manual');
  const manualBtn = $('#manualBtn');
  const logEl = $('#log');
  const dbgEl = $('#dbg');

  /* ---------- Durum ---------- */
  let actx = null, analyser = null, micStream = null, pollTimer = null;
  let fbuf = null, sampleRate = 48000, running = false;
  let currentCode = '';

  const S = { pending: null, count: 0, committed: false, digits: [], silence: 0, lastCommit: 0 };

  /* ---------- Yardımcılar ---------- */
  function logMsg(t) {
    const d = document.createElement('div');
    const ts = new Date().toLocaleTimeString('tr-TR');
    d.textContent = `[${ts}] ${t}`;
    logEl.prepend(d);
    while (logEl.children.length > 60) logEl.lastChild.remove();
  }

  function renderDigits() {
    const arr = S.digits.slice(0, 4);
    while (arr.length < 4) arr.push('_');
    digitsEl.textContent = arr.join(' ');
  }

  function idxMax(a) {
    let bi = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
    return bi;
  }

  /* Goertzel: tek frekansın genliği (normalize) */
  function goertzel(x, f, sr) {
    const N = x.length;
    const w = 2 * Math.PI * f / sr;
    const c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < N; i++) {
      const s0 = x[i] + c * s1 - s2;
      s2 = s1; s1 = s0;
    }
    const p = s1 * s1 + s2 * s2 - c * s1 * s2;
    return Math.sqrt(Math.max(p, 0)) / N;
  }

  /* ---------- Kare → rakam ---------- */
  function detectDigit() {
    analyser.getFloatTimeDomainData(fbuf);

    let sum = 0;
    for (let i = 0; i < fbuf.length; i++) sum += fbuf[i] * fbuf[i];
    const rms = Math.sqrt(sum / fbuf.length);

    if (rms < RMS_GATE) return { digit: null, rms, dbg: 'sessiz' };

    const rowM = ROWS.map((f) => goertzel(fbuf, f, sampleRate));
    const colM = COLS.map((f) => goertzel(fbuf, f, sampleRate));
    const ri = idxMax(rowM), ci = idxMax(colM);

    const r1 = rowM[ri], c1 = colM[ci];
    let r2 = 0, c2 = 0;
    for (let i = 0; i < 4; i++) {
      if (i !== ri && rowM[i] > r2) r2 = rowM[i];
      if (i !== ci && colM[i] > c2) c2 = colM[i];
    }

    const ok = Math.min(r1, c1) > BIN_MIN && r1 > RATIO * r2 && c1 > RATIO * c2;
    if (!ok) return { digit: null, rms, dbg: 'gürültü' };

    return { digit: KEYS[ri][ci], rms, dbg: `güçlü (${r1.toFixed(3)}/${c1.toFixed(3)})` };
  }

  /* ---------- Durum makinesi ---------- */
  function step(d) {
    const now = performance.now();

    if (d === null) {
      S.silence++;
      if (S.silence >= 3) { S.pending = null; S.count = 0; S.committed = false; }
      // yarım kalan kod → sıfırla
      if (S.digits.length > 0 && now - S.lastCommit > 1500) {
        logMsg('Yarım kalan kod sıfırlandı (' + S.digits.join('') + ')');
        S.digits = [];
        renderDigits();
      }
      return;
    }

    S.silence = 0;

    if (d === S.pending) S.count++;
    else { S.pending = d; S.count = 1; S.committed = false; }

    if (S.committed) return;
    if (S.count < STABLE) return;

    // uzun boşluktan sonra gelen rakam → yeni dizi başlat
    if (S.digits.length > 0 && now - S.lastCommit > SEQ_GAP) {
      S.digits = [];
    }

    S.committed = true;
    S.digits.push(d);
    S.lastCommit = now;
    renderDigits();

    if (S.digits.length === 4) {
      const code = S.digits.join('');
      S.digits = [];
      renderDigits();
      onCode(code);
    }
  }

  function onCode(code) {
    logMsg('🔊 Ses dalgasından çözüldü: ' + code);
    setCode(code, 'ses');
  }

  /* ---------- Kod & QR ---------- */
  function setCode(code, source) {
    if (!/^\d{4}$/.test(code)) { logMsg('Geçersiz kod: ' + code); return; }
    if (code === currentCode && source === 'ses') return;
    currentCode = code;
    codeOut.textContent = code;
    logMsg((source === 'ses' ? 'Ses' : 'Manuel') + ' kod uygulandı: ' + code);
    updateQR();
  }

  function updateQR() {
    const no = (noInput.value || '').trim();
    if (!no) { qrInfo.textContent = 'Öğrenci numarası giriniz.'; clearQR(); return; }
    if (!currentCode) { qrInfo.textContent = 'Kod bekleniyor…'; clearQR(); return; }
    if (typeof QRCode === 'undefined') { qrInfo.textContent = 'QR kütüphanesi yüklenemedi (internet?).'; return; }

    const payload = no + '|' + currentCode;
    QRCode.toCanvas(qrCanvas, payload, {
      width: 280, margin: 2, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    }, (err) => {
      if (err) { qrInfo.textContent = 'QR üretilemedi: ' + err.message; return; }
      qrInfo.textContent = 'QR güncel • ' + no + ' | ' + currentCode;
    });
  }

  function clearQR() {
    const g = qrCanvas.getContext('2d');
    g.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
  }

  /* ---------- Mikrofon ---------- */
  function poll() {
    if (!running || !analyser) return;
    const r = detectDigit();
    if (dbgEl) dbgEl.textContent = `rms: ${r.rms.toFixed(4)} • ${r.dbg} • algılanan: ${r.digit || '—'}`;
    step(r.digit);
  }

  async function startListening() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,   // ← ipucu: gürültü/kazanç kapatılır
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      });
    } catch (e) {
      micStatus.textContent = 'Mikrofon hatası';
      micStatus.className = 'pill err';
      logMsg('Mikrofon hatası: ' + e.message);
      return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    actx = actx || new AC();
    await actx.resume();

    const src = actx.createMediaStreamSource(micStream);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);

    // Grafiğin çekilmesi için sessiz çıkış
    const mute = actx.createGain();
    mute.gain.value = 0;
    analyser.connect(mute);
    mute.connect(actx.destination);

    fbuf = new Float32Array(analyser.fftSize);
    sampleRate = actx.sampleRate;

    S.pending = null; S.count = 0; S.committed = false;
    S.digits = []; S.silence = 0; S.lastCommit = 0;
    renderDigits();

    running = true;
    pollTimer = setInterval(poll, POLL_MS);

    listenBtn.textContent = '⏹ Dinlemeyi Durdur';
    listenBtn.classList.remove('primary');
    listenBtn.classList.add('danger');
    micStatus.textContent = 'Dinleniyor';
    micStatus.className = 'pill ok';
    logMsg('Mikrofon açıldı, dinleme başladı.');
  }

  function stopListening() {
    running = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    analyser = null;
    listenBtn.textContent = '🎤 Dinlemeyi Başlat';
    listenBtn.classList.add('primary');
    listenBtn.classList.remove('danger');
    micStatus.textContent = 'Mikrofon kapalı';
    micStatus.className = 'pill';
    logMsg('Dinleme durduruldu.');
  }

  /* ---------- Olaylar ---------- */
  listenBtn.addEventListener('click', () => {
    if (running) stopListening(); else startListening();
  });

  noInput.addEventListener('input', () => {
    noInput.value = noInput.value.replace(/\D/g, '').slice(0, 12);
    Store.set('als06_student_no', noInput.value);
    updateQR();
  });

  manualBtn.addEventListener('click', () => {
    const v = (manual.value || '').replace(/\D/g, '');
    if (v.length !== 4) { logMsg('Manuel kod 4 haneli olmalı.'); return; }
    setCode(v, 'manuel');
    manual.value = '';
  });

  manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') manualBtn.click(); });

  /* ---------- Başlat ---------- */
  noInput.value = Store.get('als06_student_no', '');
  renderDigits();
  logMsg('Uygulama hazır.');
  if (noInput.value) updateQR();
})();