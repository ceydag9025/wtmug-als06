/* lecturer.js — DTMF yayını + QR okuyucu + doğrulama */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);

  const DTMF = {
    '0': [941, 1336], '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477]
  };

  const TONE = 0.65;      // saniye
  const SLOT = 1.00;      // ton + sessizlik (650 + 350 ms)
  const PASS_GAP = 1.5;   // iki tekrar arası sessizlik
  const CYCLE = 13000;    // yeni kod periyodu (ms)
  const SCAN_COOLDOWN = 2500;

  const courseSel = $('#courseSel');
  const weekSel = $('#weekSel');
  const codeOut = $('#codeOut');
  const bcastPill = $('#bcastPill');
  const bcastBtn = $('#bcastBtn');
  const autoCam = $('#autoCam');
  const camBtn = $('#camBtn');
  const video = $('#cam');
  const resultEl = $('#result');
  const logEl = $('#log');

  let courses = [], students = [];
  let currentCode = null;
  let broadcasting = false;
  let actx = null, master = null, bcastTimer = null;

  let camStream = null, camActive = false, rafId = null, scanCanvas = null, scanCtx = null;
  let lastScanText = '', lastScanTime = 0;

  /* ---------- Log ---------- */
  function logMsg(t) {
    const d = document.createElement('div');
    d.textContent = `[${new Date().toLocaleTimeString('tr-TR')}] ${t}`;
    logEl.prepend(d);
    while (logEl.children.length > 80) logEl.lastChild.remove();
  }

  /* ---------- Veri ---------- */
  async function loadData() {
    try {
      const r = await Promise.all([
        fetch('courses.json', { cache: 'no-store' }).then((x) => x.json()),
        fetch('students.json', { cache: 'no-store' }).then((x) => x.json())
      ]);
      courses = r[0]; students = r[1];
    } catch (e) {
      logMsg('⚠️ JSON yüklenemedi. Uygulamayı HTTPS/HTTP sunucu üzerinden açın.');
      courses = []; students = [];
    }
  }

  function fillSelects() {
    courseSel.innerHTML = courses.map((c) =>
      `<option value="${c.kod}">${c.kod} — ${c.ad}</option>`).join('');
    weekSel.innerHTML = Array.from({ length: 14 }, (_, i) =>
      `<option value="${i + 1}">${i + 1}. Hafta</option>`).join('');

    const sc = Store.get('als06_course', courses[0] && courses[0].kod);
    if (courses.some((c) => c.kod === sc)) courseSel.value = sc;
    const sw = Store.get('als06_week', 1);
    weekSel.value = String(sw);
    autoCam.checked = !!Store.get('als06_autocam', false);

    courseSel.addEventListener('change', () => Store.set('als06_course', courseSel.value));
    weekSel.addEventListener('change', () => Store.set('als06_week', Number(weekSel.value)));
    autoCam.addEventListener('change', () => Store.set('als06_autocam', autoCam.checked));
  }

  /* ---------- DTMF üretimi ---------- */
  function ensureAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.6;
    master.connect(actx.destination);
  }

  function scheduleSequence(code, startAt) {
    let t = startAt;
    for (const ch of code) {
      const [f1, f2] = DTMF[ch] || DTMF['0'];
      const o1 = actx.createOscillator();
      const o2 = actx.createOscillator();
      const g = actx.createGain();
      o1.type = 'sine'; o1.frequency.value = f1;
      o2.type = 'sine'; o2.frequency.value = f2;

      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.010);
      g.gain.setValueAtTime(0.5, t + TONE - 0.020);
      g.gain.linearRampToValueAtTime(0, t + TONE);

      o1.connect(g); o2.connect(g); g.connect(master);
      o1.start(t); o2.start(t);
      o1.stop(t + TONE + 0.03); o2.stop(t + TONE + 0.03);

      t += SLOT;
    }
    return t;
  }

  function newCode() {
    return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  }

  function tick() {
    if (!actx) return;
    currentCode = newCode();
    codeOut.textContent = currentCode;

    const t0 = actx.currentTime + 0.15;
    let t = scheduleSequence(currentCode, t0);
    t += PASS_GAP;
    scheduleSequence(currentCode, t);
    logMsg('Yeni kod yayınlandı: ' + currentCode);
  }

  function startBroadcast() {
    ensureAudio();
    actx.resume();
    if (broadcasting) return;
    broadcasting = true;
    tick();
    bcastTimer = setInterval(tick, CYCLE);

    bcastBtn.textContent = '⏹ Yayını Durdur';
    bcastBtn.classList.remove('primary');
    bcastBtn.classList.add('danger');
    bcastPill.textContent = 'Yayın aktif';
    bcastPill.className = 'pill ok';

    if (autoCam.checked && !camActive) startCamera();
  }

  function stopBroadcast() {
    broadcasting = false;
    if (bcastTimer) { clearInterval(bcastTimer); bcastTimer = null; }
    currentCode = null;
    codeOut.textContent = '----';
    bcastBtn.textContent = '▶ Yayını Başlat';
    bcastBtn.classList.add('primary');
    bcastBtn.classList.remove('danger');
    bcastPill.textContent = 'Yayın durduruldu';
    bcastPill.className = 'pill';
    logMsg('Yayın durduruldu.');
  }

  /* ---------- Kamera ---------- */
  async function startCamera() {
    if (camActive) return;
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (e) {
      logMsg('Kamera hatası: ' + e.message);
      return;
    }
    video.srcObject = camStream;
    video.classList.add('on');
    await video.play();

    if (!scanCanvas) {
      scanCanvas = document.createElement('canvas');
      scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
    }
    camActive = true;
    camBtn.textContent = '⏹ Kamerayı Kapat';
    camBtn.classList.remove('ok');
    camBtn.classList.add('danger');
    logMsg('Kamera açıldı.');
    scanLoop();
  }

  function stopCamera() {
    camActive = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
    video.srcObject = null;
    video.classList.remove('on');
    camBtn.textContent = '📷 Kamerayı Aç';
    camBtn.classList.remove('danger');
    camBtn.classList.add('ok');
    logMsg('Kamera kapatıldı.');
  }

  function scanLoop() {
    if (!camActive) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
      const vw = video.videoWidth, vh = video.videoHeight;
      const maxW = 640;
      const scale = Math.min(1, maxW / vw);
      const w = Math.round(vw * scale), h = Math.round(vh * scale);

      if (scanCanvas.width !== w || scanCanvas.height !== h) {
        scanCanvas.width = w; scanCanvas.height = h;
      }
      scanCtx.drawImage(video, 0, 0, w, h);
      const img = scanCtx.getImageData(0, 0, w, h);

      if (typeof jsQR === 'function') {
        const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (res && res.data) handleScan(res.data);
      }
    }
    rafId = requestAnimationFrame(scanLoop);
  }

  /* ---------- QR doğrulama ---------- */
  function handleScan(text) {
    const now = Date.now();
    if (text === lastScanText && now - lastScanTime < SCAN_COOLDOWN) return;
    lastScanText = text; lastScanTime = now;
    processScan(text);
  }

  function processScan(text) {
    const parts = String(text).split('|');
    if (parts.length !== 2) { showResult('err', 'Geçersiz QR kod', text); return; }

    const no = parts[0].trim();
    const code = parts[1].trim();

    const st = students.find((s) => s.no === no);
    if (!st) { showResult('err', 'Öğrenci bulunamadı', 'No: ' + no); return; }

    if (!currentCode) {
      showResult('err', 'Ses yayını aktif değil', 'Önce "Yayını Başlat"a basın.');
      return;
    }

    if (code !== currentCode) {
      showResult('err', '❌ Kod eşleşmiyor',
        `QR kodu: <b>${code}</b> • Güncel kod: <b>${currentCode}</b><br>
         <span class="muted small">Öğrenci eski bir QR göstermiş olabilir.</span>`, st);
      return;
    }

    const course = courses.find((c) => c.kod === courseSel.value);
    if (!course) { showResult('err', 'Ders seçilmedi'); return; }

    if (course.ogrenciler.indexOf(no) === -1) {
      showResult('err', '⚠️ Öğrenci bu derse kayıtlı değil',
        `${st.ad} ${st.soyad} — ${course.kod}`, st);
      return;
    }

    const week = Number(weekSel.value);
    if (DB.has(course.kod, no, week)) {
      showResult('warn', '⚠️ Öğrenci bu hafta zaten yoklamaya katıldı.',
        `${course.kod} • ${week}. Hafta`, st);
      return;
    }

    DB.add(course.kod, no, week);
    showResult('ok', '✅ Yoklama kaydedildi',
      `${course.kod} • ${week}. Hafta`, st);
    logMsg(`Kayıt: ${no} — ${course.kod} — H${week}`);

    if (autoCam.checked) stopCamera();
  }

  function showResult(kind, title, detail, st) {
    let html = `<div class="result ${kind}"><div class="title">${title}</div>`;
    if (detail) html += `<div class="small muted">${detail}</div>`;
    if (st) {
      const src = 'photos/' + st.no + '.jpg';
      html += `<div class="stu">
        <img src="${src}" alt="${st.ad} ${st.soyad}"
             onerror="this.outerHTML='&lt;div class=\\'ph\\'&gt;${(st.ad[0] || '')}${(st.soyad[0] || '')}&lt;/div&gt;'">
        <div class="meta">
          <div><b>${st.no}</b> — ${st.ad} ${st.soyad}</div>
          <div>Bölüm: ${st.bolum}</div>
          <div>Program: ${st.program}</div>
          <div>Sınıf: ${st.sinif}</div>
        </div></div>`;
    }
    html += '</div>';
    resultEl.innerHTML = html;
  }

  /* ---------- Olaylar ---------- */
  bcastBtn.addEventListener('click', () => {
    if (broadcasting) stopBroadcast(); else startBroadcast();
  });

  camBtn.addEventListener('click', () => {
    if (camActive) stopCamera(); else startCamera();
  });

  /* ---------- Başlat ---------- */
  (async function init() {
    await loadData();
    if (courses.length) fillSelects();
    else logMsg('courses.json bulunamadı.');
    logMsg('Hoca uygulaması hazır.');
  })();
})();