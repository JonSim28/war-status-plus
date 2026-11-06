// ==UserScript==
// @name         JSim War Station Plus (auto-updating)
// @namespace    torn-war-status-plus
// @version      1.0
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
  var SRC = '__SRC__';
  var PRESET = __PRESET__;
  var KEY = '###PDA-APIKEY###';
  var ran = false, cached = null;
  try { cached = localStorage.getItem('wsp_code'); } catch (e) { /* storage blocked */ }

  function run(code) {
    if (ran || !code) return;
    ran = true;
    try {
      new Function('__wspPdaKey', '__wspPreset', '__wspFrom', code)(KEY, PRESET, SRC);
    } catch (e) {
      var why = String(e && (e.name + ' ' + e.message));
      if (!/unsafe-eval|Content Security|EvalError|call to Function/i.test(why)) { console.error('JSim War Station Plus:', e); return; }
      // The page doesn't allow eval: run it as a script tag instead
      window.__wspPdaKey = KEY; window.__wspPreset = PRESET; window.__wspFrom = SRC;
      var s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      window.__wspPdaKey = undefined;
    }
  }

  function got(t) {
    t = String(t || '');
    if (t.indexOf('WarStatusPlus') < 0 || t.length < 20000) return; // an error page, not the script
    if (t !== cached) { try { localStorage.setItem('wsp_code', t); } catch (e) { /* full */ } }
    run(t); // only does anything on the very first install; otherwise the new copy starts on the next page
  }

  run(cached);

  var last = 0;
  try { last = +localStorage.getItem('wsp_code_chk') || 0; } catch (e) { /* ignore */ }
  if (!cached || Date.now() - last > 5 * 60e3) {
    try { localStorage.setItem('wsp_code_chk', String(Date.now())); } catch (e) { /* ignore */ }
    var url = SRC + (SRC.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
    var viaPda = function () {
      if (typeof PDA_httpGet !== 'function') return;
      PDA_httpGet(url).then(function (r) { got(r && (r.responseText || r)); }).catch(function () { /* offline */ });
    };
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(got)
      .catch(viaPda);
  }
})();
