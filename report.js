/* report.js — 14 haftalık yoklama tablosu */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const courseSel = $('#courseSel');
  const tableWrap = $('#tableWrap');
  const csvBtn = $('#csvBtn');
  const resetBtn = $('#resetBtn');

  let courses = [], students = [];

  function render() {
    const course = courses.find((c) => c.kod === courseSel.value);
    if (!course) { tableWrap.innerHTML = '<p style="padding:14px" class="muted">Ders bulunamadı.</p>'; return; }

    const list = course.ogrenciler
      .map((no) => students.find((s) => s.no === no))
      .filter(Boolean);

    let html = '<table class="tbl"><thead><tr><th>#</th><th style="text-align:left;padding-left:8px">Öğrenci</th>';
    for (let w = 1; w <= 14; w++) html += `<th>H${w}</th>`;
    html += '<th>Toplam</th></tr></thead><tbody>';

    list.forEach((st, i) => {
      const weeks = DB.weeks(course.kod, st.no);
      let total = 0;
      html += `<tr><td>${i + 1}</td>
        <td class="name">${st.no} — ${st.ad} ${st.soyad}</td>`;
      for (let w = 1; w <= 14; w++) {
        const has = weeks.indexOf(w) !== -1;
        if (has) total++;
        html += `<td class="${has ? 'yes' : 'no'}">${has ? '✓' : '✗'}</td>`;
      }
      html += `<td class="tot">${total}</td></tr>`;
    });

    html += '</tbody></table>';
    tableWrap.innerHTML = html;
  }

  function toCSV() {
    const course = courses.find((c) => c.kod === courseSel.value);
    const list = course.ogrenciler.map((no) => students.find((s) => s.no === no)).filter(Boolean);
    const head = ['No', 'Ad', 'Soyad', ...Array.from({ length: 14 }, (_, i) => 'H' + (i + 1)), 'Toplam'];
    const rows = [head.join(';')];

    list.forEach((st) => {
      const weeks = DB.weeks(course.kod, st.no);
      const cells = [st.no, st.ad, st.soyad];
      let total = 0;
      for (let w = 1; w <= 14; w++) {
        const has = weeks.indexOf(w) !== -1;
        if (has) total++;
        cells.push(has ? '1' : '0');
      }
      cells.push(String(total));
      rows.push(cells.join(';'));
    });

    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yoklama_${course.kod}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  (async function init() {
    try {
      const r = await Promise.all([
        fetch('courses.json', { cache: 'no-store' }).then((x) => x.json()),
        fetch('students.json', { cache: 'no-store' }).then((x) => x.json())
      ]);
      courses = r[0]; students = r[1];
    } catch (e) {
      tableWrap.innerHTML = '<p style="padding:14px" class="muted">JSON dosyaları yüklenemedi.</p>';
      return;
    }

    courseSel.innerHTML = courses.map((c) =>
      `<option value="${c.kod}">${c.kod} — ${c.ad}</option>`).join('');

    const sc = Store.get('als06_course', courses[0].kod);
    if (courses.some((c) => c.kod === sc)) courseSel.value = sc;

    courseSel.addEventListener('change', () => {
      Store.set('als06_course', courseSel.value);
      render();
    });

    csvBtn.addEventListener('click', toCSV);

    resetBtn.addEventListener('click', () => {
      if (!confirm(courseSel.value + ' dersinin tüm yoklaması silinsin mi?')) return;
      DB.resetCourse(courseSel.value);
      render();
    });

    render();
  })();
})();