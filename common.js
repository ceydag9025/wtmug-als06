/* common.js — ortak depolama, yoklama veritabanı, SW kaydı */
(function () {
  'use strict';

  const Store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  const ATT = 'als06_yoklama_v1';

  const DB = {
    attendance() { return Store.get(ATT, {}); },
    save(a) { Store.set(ATT, a); },
    weeks(course, no) { const a = DB.attendance(); return (a[course] && a[course][no]) || []; },
    has(course, no, w) { return DB.weeks(course, no).indexOf(Number(w)) !== -1; },
    add(course, no, w) {
      const a = DB.attendance();
      a[course] = a[course] || {};
      a[course][no] = a[course][no] || [];
      if (a[course][no].indexOf(Number(w)) === -1) a[course][no].push(Number(w));
      DB.save(a);
    },
    resetCourse(course) { const a = DB.attendance(); delete a[course]; DB.save(a); }
  };

  window.Store = Store;
  window.DB = DB;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();