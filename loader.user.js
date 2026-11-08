// ==UserScript==
// @name         JSim War Station Plus (auto-updating)
// @namespace    torn-war-status-plus
// @version      1.1
// @description  Loads the latest JSim War Station Plus from your faction's script address, so updates arrive by themselves
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

/*
 * This small script fetches JSim War Station Plus from the address below and keeps a copy on your device,
 * so it starts instantly and still works if the address can't be reached.
 * It checks for a newer copy every few minutes; a new version is used from the next page you open.
 * Your API key stays on your device: PDA puts it into this loader and the loader hands it straight to JSim War Station Plus.
 */
(function () {
  'use strict';
  if (window.__wspLoader) return;
  window.__wspLoader = true;
  var SRC = 'https://raw.githubusercontent.com/JonSim28/war-status-plus/main/war-status-plus.js';
  var PRESET = {};
  var KEY = '###PDA-APIKEY###';
  var ran = false, cached = null, errs = [];
  var NAME = 'JSim War Station Plus';
  function note(m) { errs.push(m); try { console.warn(NAME + ' loader:', m); } catch (e) { /* ignore */ } }
  try { cached = localStorage.getItem('wsp_code'); } catch (e) { /* storage blocked */ }

  function started() { return !!window.WarStatusPlus; }
  function viaGlobals() { window.__wspPdaKey = KEY; window.__wspPreset = PRESET; window.__wspFrom = SRC; }
  function clearGlobals() { window.__wspPdaKey = undefined; }
  function run(code) {
    if (ran || !code) return;
    ran = true;
    // 1) plain eval
    try {
      new Function('__wspPdaKey', '__wspPreset', '__wspFrom', code)(KEY, PRESET, SRC);
      return;
    } catch (e) {
      var why = String(e && (e.name + ': ' + e.message));
      if (!/unsafe-eval|Content Security|EvalError|call to Function|Refused/i.test(why)) { note('script error: ' + why); return; }
      note('eval blocked');
    }
    // 2) a script tag
    viaGlobals();
    try {
      var s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) { note('script tag failed: ' + e.message); }
    if (started()) { clearGlobals(); return; }
    // 3) TornPDA's own evaluator (not limited by the page's security rules)
    if (typeof PDA_evaluateJavascript === 'function') {
      note('script tag blocked, using PDA');
      try {
        Promise.resolve(PDA_evaluateJavascript(code)).then(function () { setTimeout(clearGlobals, 3000); }, function (e) { note('PDA evaluate failed: ' + e); });
      } catch (e) { note('PDA evaluate failed: ' + e.message); }
    } else note('script tag blocked and PDA evaluator missing');
  }

  // If nothing has started after 12 seconds, say why on screen instead of failing silently
  setTimeout(function () {
    if (started()) return;
    if (!errs.length) note(cached ? 'cached copy did not start' : 'still waiting for the download');
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:8px;right:8px;bottom:80px;z-index:2147483647;background:#7a1010;color:#fff;font:13px/1.4 -apple-system,Arial,sans-serif;padding:10px 12px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.5)';
    d.textContent = NAME + ' could not start: ' + errs.join(' | ') + '. Tap to close, and send Claude a screenshot.';
    d.addEventListener('click', function () { d.remove(); });
    (document.body || document.documentElement).appendChild(d);
  }, 12000);

  function got(t) {
    t = String(t || '');
    if (t.indexOf('WarStatusPlus') < 0 || t.length < 20000) { note('download was not the script (' + t.length + ' chars: ' + t.slice(0, 40).replace(/\s+/g, ' ') + ')'); return; }
    if (t !== cached) { try { localStorage.setItem('wsp_code', t); } catch (e) { /* full */ } }
    run(t); // only does anything on the very first install; otherwise the new copy starts on the next page
  }

  run(cached);

  var last = 0;
  try { last = +localStorage.getItem('wsp_code_chk') || 0; } catch (e) { /* ignore */ }
  if (!cached || Date.now() - last > 5 * 60e3) {
    try { localStorage.setItem('wsp_code_chk', String(Date.now())); } catch (e) { /* ignore */ }
    var url = SRC + (SRC.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
    var viaPda = function (e) {
      note('download failed (' + (e && e.message || e) + ')');
      if (typeof PDA_httpGet !== 'function') return;
      PDA_httpGet(url).then(function (r) { got(r && typeof r === 'object' ? (r.responseText || r.body || r.data || '') : r); }, function (e2) { note('PDA download failed (' + e2 + ')'); });
    };
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(got, viaPda);
  }
})();
