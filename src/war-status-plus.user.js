// ==UserScript==
// @name         JSim War Station Plus
// @namespace    torn-war-status-plus
// @version      5.48
// @description  ⚔️ war pop-out with Intel: statuses, hospital timers, travel ETAs, alerts, chain watcher, bars, FFScouter, hit log, target calling
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

/*
 * API key use (per Torn's API Terms of Service)
 * ─────────────────────────────────────────────
 * Key access level   Limited recommended (bars, cooldowns, your hits). Public works with those features off.
 * Key storage        Only on your own device (TornPDA's saved key, or this browser's storage). Never sent to the
 *                    faction tracker or calls server.
 * Key sharing        Sent to api.torn.com. Also sent to ffscouter.com for stat estimates, unless you enter a
 *                    separate FFScouter key in ⚙️ Settings or turn FFScouter off.
 * Data storage       Statuses, your bars and hits are cached on your device only.
 * Data sharing       If your faction uses target calling, your name and player ID are shared with your faction's
 *                    calls server when you call a target. The tracker only receives faction IDs.
 * Purpose            Showing war information. No actions are automated: you click every attack yourself.
 */

(function () {
  'use strict';
  if (window.__warStatusPlus) return;
  window.__warStatusPlus = true;


  /* ===== FACTION SETUP — fill these in once, then share this file with your faction =====
   * Members get these automatically. Anyone can still change them in ⚙️ Settings. */
  const FACTION = {
    trackerUrl: '',   // your tracker web app URL (ends in /exec)
    callsUrl: '',     // optional: target-calling server URL
    callsPw: '',      // optional: target-calling password
    trackerUrl2: ''   // optional: second tracker watching your own faction
  };

  const WSP_VERSION = '5.48';
  // TornPDA swaps this placeholder for your saved API key automatically. When the auto-updating loader runs this
  // code, PDA only swaps it in the loader, so the loader hands the key over as __wspPdaKey.
  /* global __wspPdaKey, __wspPreset, __wspFrom */
  const FROM_LOADER = typeof __wspFrom === 'string' ? __wspFrom : '';
  const PDA_KEY = typeof __wspPdaKey === 'string' && !__wspPdaKey.startsWith('###') ? __wspPdaKey : '###PDA-APIKEY###';
  const REFRESH_MS = 30000;     // main API refresh
  const CHAIN_FAST_MS = 10000;  // chain refresh when it's close to timing out
  const CALLS_MS = 10000;       // target-calls refresh while open
  const FF_TTL = 6 * 3600e3;    // FFScouter cache
  const G = 1000000;            // sort group size

  /* ================= Storage & settings ================= */
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full / blocked */ } };
  // Torn's drug icon is a cannabis leaf; there is no emoji for it, so draw one
  const LEAF = '<svg class="wsp-leaf" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="#3fbf6f" d="M12 2c1.3 2.6 1.9 5.5 1.6 8.3 1.6-2.2 3.9-3.9 6.4-4.8-.9 2.9-2.6 5.4-4.9 7.2 2-.4 4.1-.2 6 .6-2.1 1.3-4.6 1.9-7.1 1.6 1.2.9 2.1 2.1 2.6 3.5-1.6-.3-3.1-1.1-4.1-2.3l.3 5.9h-1.6l.3-5.9c-1 1.2-2.5 2-4.1 2.3.5-1.4 1.4-2.6 2.6-3.5-2.5.3-5-.3-7.1-1.6 1.9-.8 4-1 6-.6C6.6 10.9 4.9 8.4 4 5.5c2.5.9 4.8 2.6 6.4 4.8-.3-2.8.3-5.7 1.6-8.3z"/></svg>';
  // Torn's Xanax is a white scored bar, Vicodin a white oval tablet
  const MEDBOX = '<svg class="wsp-box" viewBox="0 0 24 22" aria-hidden="true"><rect x="8" y="1.5" width="8" height="4" rx="1" fill="none" stroke="#bbb" stroke-width="1.6"/><rect x="1.5" y="5" width="21" height="15" rx="2.5" fill="#f4f4f4"/><path d="M12 8.5v8M8 12.5h8" stroke="#e53935" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const PILL_X = '<svg class="wsp-pill" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="8" width="19" height="8" rx="4" fill="#f4f4f4" stroke="#9aa0a6" stroke-width="1"/><path d="M8.8 8.6v6.8M12 8.6v6.8M15.2 8.6v6.8" stroke="#b8bcc2" stroke-width=".9"/></svg>';
  const PILL_V = '<svg class="wsp-pill" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="5.6" fill="#f4f4f4" stroke="#9aa0a6" stroke-width="1"/><path d="M5.5 12h13" stroke="#b8bcc2" stroke-width=".9"/></svg>';

  const DEFAULTS = {
    sound: true, vibrate: true, hospAlert: true, landAlert: true,
    chainAlert: true, chainMin: 10, bg: true, popups: true, retalAlert: true, bonusAlert: true, drugAlert: true, medCap: 'auto', energyAlert: false, energyWarn: 10, energyCd: 60,
    flight: 'std', theme: 'war', med: '', blood: '', ff: true, ffKey: '', callsUrl: '', callsPw: '', trackerUrl: '', trackerPw: '', trackerUrl2: ''
  };
  const savedCfg = load('wsp_cfg', {});
  if (savedCfg.flight === 'air' && !localStorage.getItem('wsp_flight_v2')) delete savedCfg.flight; // old default was Airstrip
  try { localStorage.setItem('wsp_flight_v2', '1'); } catch (e) { /* ignore */ }
  if (savedCfg.theme === 'auto' && !localStorage.getItem('wsp_theme_v2')) { savedCfg.theme = 'war'; }
  try { localStorage.setItem('wsp_theme_v2', '1'); } catch (e) { /* ignore */ }
  if (!localStorage.getItem('wsp_en_v2')) { delete savedCfg.energyAlert; try { localStorage.setItem('wsp_en_v2', '1'); } catch (e) { /* ignore */ } }
  const cfg = Object.assign({}, DEFAULTS, savedCfg);
  if (typeof __wspPreset === 'object' && __wspPreset) for (const k in FACTION) if (__wspPreset[k] && !FACTION[k]) FACTION[k] = String(__wspPreset[k]);
  for (const k in FACTION) if (FACTION[k] && !savedCfg[k]) cfg[k] = FACTION[k]; // faction presets fill any blanks

  /* ================= Network ================= */
  function getKey() {
    if (!PDA_KEY.startsWith('###')) return PDA_KEY;
    let k = localStorage.getItem('wsp_key');
    if (!k) {
      k = prompt('JSim War Station Plus: enter your Torn API key (Limited access recommended for bars, cooldowns and hits)');
      if (k) localStorage.setItem('wsp_key', k.trim());
    }
    return k ? k.trim() : null;
  }

  // fetch, falling back to TornPDA's native HTTP (no CORS limits) if fetch is blocked
  async function getJSON(url, opts) {
    try {
      const r = await fetch(url, opts);
      return await r.json();
    } catch (e) {
      const post = opts && opts.method === 'POST';
      if (!post && typeof PDA_httpGet === 'function') return JSON.parse((await PDA_httpGet(url)).responseText);
      if (post && typeof PDA_httpPost === 'function') return JSON.parse((await PDA_httpPost(url, opts.headers || {}, opts.body)).responseText);
      throw e;
    }
  }

  // Medical cooldown limit: 6h, raised by faction perks (Fortitude, up to 9h). Read from your perks every 6 hours.
  const MED_BASE = 6 * 3600;
  async function loadPerks() {
    const c = load('wsp_perks', null);
    if (c && Date.now() - c.at < 6 * 3600e3) return;
    save('wsp_perks', { at: Date.now(), extra: c ? c.extra : 0, src: c ? c.src : '' }); // don't retry every refresh
    try {
      const j = await api('user/', 'perks');
      let extra = 0; const src = [];
      Object.values(j).forEach(list => (Array.isArray(list) ? list : []).forEach(t => {
        t = String(t);
        if (!/medical cooldown/i.test(t) || /reduc|decreas|less|lower/i.test(t)) return;
        const h = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i), m = t.match(/(\d+)\s*(?:minutes?|mins?|m)\b/i);
        const add = h ? +h[1] * 3600 : m ? +m[1] * 60 : 0;
        if (add > 0 && add <= 6 * 3600) { extra += add; src.push(t); }
      }));
      save('wsp_perks', { at: Date.now(), extra, src: src.join('; ') });
    } catch (e) { /* key may not allow perks: base limit is used */ }
  }
  function medCap() {
    if (cfg.medCap && cfg.medCap !== 'auto') return (+cfg.medCap || 6) * 3600;
    const c = load('wsp_perks', null);
    return MED_BASE + Math.min(c && c.extra || 0, 6 * 3600);
  }

  // Torn can hand back a cached reply up to ~30s old. Asking for 'timestamp' too tells us how old it is.
  async function apiTs(path, selections) {
    if (S.noTs) return api(path, selections);
    try { return await api(path, selections + ',timestamp'); } catch (e) {
      if (e.code !== 4 && e.code !== 3) throw e;
      S.noTs = true;
      return api(path, selections);
    }
  }
  function setChain(u) {
    if (!u.chain) return;
    const recv = Date.now() / 1000;
    let age = 0;
    if (u.timestamp) {
      const d = recv - u.timestamp;            // clock difference + reply age
      const o = load('wsp_tsoff', null);
      const prev = o ? o.d + (recv - o.at) / 600 : Infinity; // let the baseline drift 1s per 10 min
      if (d <= prev) save('wsp_tsoff', { d, at: recv });
      age = Math.max(0, Math.min(60, d - Math.min(d, prev)));
    }
    S.chain = u.chain;
    S.chainAt = Date.now() - age * 1000;
  }
  // Torn's own chain bar on the page (sidebar / header), if there is one: it is exact
  function pageChainLeft() {
    try {
      for (const el of document.querySelectorAll('[class*="bar-timeleft"], [class*="timeleft"], [class*="chain-time"], [class*="timeLeft"]')) {
        if (ours(el) || !el.closest('[class*="chain" i], [id*="chain" i]')) continue;
        const m = (el.textContent || '').trim().match(/^(\d{1,2}):(\d{2})$/);
        if (m) return +m[1] * 60 + +m[2];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function api(path, selections) {
    const key = getKey();
    if (!key) throw new Error('No API key');
    const j = await getJSON(`https://api.torn.com/${path}?selections=${selections}&key=${key}&comment=WarStatusPlus`);
    if (j.error) {
      if (j.error.code === 2) localStorage.removeItem('wsp_key');
      const err = new Error(j.error.error);
      err.code = j.error.code;
      throw err;
    }
    return j;
  }

  /* ================= Countries & formatting ================= */
  const FLAGS = {
    'Mexico': '🇲🇽', 'Cayman Islands': '🇰🇾', 'Canada': '🇨🇦', 'Hawaii': '🇺🇸',
    'United Kingdom': '🇬🇧', 'Argentina': '🇦🇷', 'Switzerland': '🇨🇭', 'Japan': '🇯🇵',
    'China': '🇨🇳', 'UAE': '🇦🇪', 'South Africa': '🇿🇦', 'Torn': '🏙️'
  };
  const SHORT = {
    'Mexico': 'Mex', 'Cayman Islands': 'Cay', 'Canada': 'Can', 'Hawaii': 'Haw',
    'United Kingdom': 'UK', 'Argentina': 'Arg', 'Switzerland': 'Swi', 'Japan': 'Jap',
    'China': 'Chi', 'UAE': 'UAE', 'South Africa': 'SA', 'Torn': 'Torn'
  };
  const ADJ = {
    'Mexican': 'Mexico', 'Caymanian': 'Cayman Islands', 'Canadian': 'Canada', 'Hawaiian': 'Hawaii',
    'British': 'United Kingdom', 'Argentinian': 'Argentina', 'Swiss': 'Switzerland', 'Japanese': 'Japan',
    'Chinese': 'China', 'Emirati': 'UAE', 'South African': 'South Africa'
  };
  // One-way standard flight times in minutes, and multipliers per travel type
  const FT = {
    'Mexico': 26, 'Cayman Islands': 35, 'Canada': 41, 'Hawaii': 134, 'United Kingdom': 159,
    'Argentina': 167, 'Switzerland': 175, 'Japan': 225, 'China': 242, 'UAE': 271, 'South Africa': 297
  };
  const FACT = { std: 1, air: 0.7, wlt: 0.5, bct: 0.3 };
  const FLIGHT_NAMES = { std: 'Standard', air: 'Airstrip', wlt: 'WLT private jet', bct: 'Business class' };
  const FLIGHT_SHORT = { std: 'Standard', air: 'Airstrip', wlt: 'WLT', bct: 'Business' };
  // Each player's travel method, best evidence first:
  //   1. seen: the tracker timed one of their real flights
  //   2. job: they work for a company whose star rating gives a business class perk (e.g. 10-star Lingerie Store)
  //   3. airstrip: their Private Island has an airstrip
  //   4. guess: they live on a Private Island but the upgrades couldn't be read
  //   5. your Default flight type (Standard unless you change it)
  const methods = load('wsp_methods', {}); // id -> { m, ts }
  const props = load('wsp_props2', {});    // id -> { t, pi, propId, air (true/false/undefined), compId, compType }
  const comps = load('wsp_comps', {});     // company id -> { type, rating, name, t }
  let compTypes = load('wsp_comptypes', null); // { t, names: { type: name }, bct: { type: stars needed } }
  const KNOWN_BCT = { lingerie: 10 }; // company name -> stars needed, in case the perk wording isn't matched
  function bctNeed(type) {
    if (!compTypes) return null;
    if (compTypes.bct[type] != null) return compTypes.bct[type];
    const name = (compTypes.names[type] || '').toLowerCase();
    for (const k in KNOWN_BCT) if (name.includes(k)) return KNOWN_BCT[k];
    return null;
  }
  function jobPerk(id) {
    const p = props[id];
    if (!p || !p.compId || !compTypes) return null;
    const c = comps[p.compId];
    if (!c) return null;
    const type = p.compType || c.type;
    const need = bctNeed(type);
    if (need == null || c.rating < need) return null;
    return { stars: c.rating, type: compTypes.names[type] || c.name || 'company' };
  }
  function methodFor(id) {
    if (methods[id]) return { m: methods[id].m, how: 'seen' };
    const perk = jobPerk(id);
    if (perk) return { m: 'bct', how: 'job', perk };
    const p = props[id];
    if (p && p.air === true) return { m: 'air', how: 'airstrip' };
    if (p && p.pi && p.air !== false) return { m: 'air', how: 'guess' };
    return { m: cfg.flight, how: 'default' };
  }

  const flag = c => FLAGS[c] || '🌍';
  const short = c => SHORT[c] || c;
  const normC = c => { c = c.replace(/[.\s]+$/, '').trim(); return c === 'United Arab Emirates' ? 'UAE' : c; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function fmt(sec) { // 1:02:03 / 4:05
    if (sec <= 0) return '0:00';
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function ago(ts) { // 5m / 3h / 2d since a unix time
    const m = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
    return m < 60 ? m + 'm' : m < 48 * 60 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd';
  }
  function fmtM(sec) { // 4m / 2h05
    const m = Math.round(sec / 60);
    if (m < 1) return '<1m';
    return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
  }

  /* ================= State ================= */
  const S = {
    open: false, tab: 'enemy', view: 'list', hittable: false, near: false,
    me: null, meId: '', meName: '', bars: null, chain: null, chainAt: 0, cd: null, uAt: 0, attacks: {},
    mine: null, enemy: null, war: null,
    at: 0, loading: false, chainLoading: false, err: '', note: '',
    calls: {}, callsAt: 0, callsLoading: false, callsErr: '',
    outAt: {}, dirty: true,
    influence: {}, // enemy id -> { t: 'x' | 'v' | 'o' } from the Intel tab
    influenceMine: {}, // same for your own members (second tracker)
    collapsed: load('wsp_collapsed', {}), // 'enemy:1' -> true
    retals: {}, retalErr: '', retalOff: 0
  };
  const CACHE_KEYS = ['me', 'meId', 'meName', 'bars', 'chain', 'chainAt', 'cd', 'uAt', 'attacks', 'mine', 'enemy', 'war', 'at'];
  const cached = load('wsp_cache', null);
  if (cached && Date.now() - cached.at < 10 * 60e3) CACHE_KEYS.forEach(k => { if (k in cached) S[k] = cached[k]; });
  function persist() { const o = {}; CACHE_KEYS.forEach(k => { o[k] = S[k]; }); save('wsp_cache', o); }

  /* ================= Location & sorting ================= */
  function where(st) { // { loc } or { travel:true, from, to }
    const d = (st.description || '').trim();
    let m;
    if ((m = d.match(/from\s+torn\s+to\s+(.+)/i)) || (m = d.match(/travel+ing\s+to\s+(?!torn\b)(.+)/i)))
      return { travel: true, from: 'Torn', to: normC(m[1]) };
    if ((m = d.match(/returning\s+(?:to\s+torn\s+)?from\s+(.+)/i)) || (m = d.match(/from\s+(.+?)\s+to\s+torn/i)))
      return { travel: true, from: normC(m[1]), to: 'Torn' };
    if (st.state === 'Abroad' && (m = d.match(/^In (.+)/i))) return { loc: normC(m[1]) };
    if (st.state === 'Hospital') {
      m = d.match(/In an? ([A-Z][a-z]+(?: [A-Z][a-z]+)?) hospital/);
      return { loc: m && ADJ[m[1]] ? ADJ[m[1]] : 'Torn' };
    }
    return { loc: 'Torn' };
  }

  function myLocation() {
    if (!S.me) return null;
    const w = where(S.me);
    return w.travel ? w.to : w.loc;
  }

  const hospLeft = st => (st.state === 'Hospital' && st.until ? st.until - Date.now() / 1000 : 0);

  // Enemy: 0 okay here · 1 hospital here · 2 flying here · 3 flying away · 4 elsewhere
  const ENEMY_GROUPS = ['Okay at your location', 'Hospital at your location', 'Flying to you', 'Flying away from you', 'Elsewhere'];
  function rankEnemy(st, myLoc) {
    if (!myLoc) return 4 * G;
    const w = where(st);
    if (!w.travel && w.loc === myLoc) {
      if (st.state === 'Okay' || st.state === 'Abroad') return 0; // "Abroad" = okay, when you're abroad too
      if (st.state === 'Hospital') { const l = hospLeft(st); return l <= 0 ? 0 : G + Math.floor(l); }
    }
    if (w.travel && w.to === myLoc) return 2 * G;
    if (w.travel && w.from === myLoc) return 3 * G;
    return 4 * G;
  }

  // Ours: 0 hospital (shortest first) · 1 okay · 2 flying · 3 abroad · 4 other
  const OURS_GROUPS = ['In hospital', 'Okay', 'Flying', 'Abroad', 'Jail / other'];
  function rankOurs(st) {
    const l = hospLeft(st);
    if (st.state === 'Hospital' && l > 0) return Math.floor(l);
    if (st.state === 'Okay' || st.state === 'Hospital') return G;
    if (where(st).travel) return 2 * G;
    if (st.state === 'Abroad') return 3 * G;
    return 4 * G;
  }
  const ONLINE_ORDER = { Online: 0, Idle: 1, Offline: 2 };

  /* ================= Travel ETAs ================= */
  const trips = load('wsp_trips', {});     // id -> { d: description, seen: ms first seen flying, after: ms last seen not flying }
  const lastNot = load('wsp_lastnot', {}); // id -> ms last seen not flying

  function track(members) {
    const now = Date.now();
    for (const [id, m] of Object.entries(members)) {
      const st = m.status || {};
      if (where(st).travel) {
        const t = trips[id];
        if (!t || t.d !== st.description) trips[id] = { d: st.description, seen: now, after: lastNot[id] || null };
      } else {
        lastNot[id] = now;
        delete trips[id];
      }
    }
    for (const id in lastNot) if (now - lastNot[id] > 86400e3) delete lastNot[id];
    save('wsp_trips', trips);
    save('wsp_lastnot', lastNot);
  }

  // Take-off times recorded by the cloud tracker (runs every minute, even with PDA closed)
  async function loadTracker() {
    S.trackAt = Date.now();
    const ids = [S.mine && S.mine.ID, S.enemy && S.enemy.ID].filter(Boolean).join(',');
    if (!ids) return;
    try {
      const u = cfg.trackerUrl;
      const j = await getJSON(u + (u.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(cfg.trackerPw) + '&f=' + ids + '&t=' + Date.now());
      if (!j || j.error) { S.trackErr = 'Tracker: ' + ((j && j.error) || 'no reply'); return; }
      S.trackErr = '';
      S.trackDataAt = j.at || 0;
      mergeTracker(j.trips || {});
      if (j.methods) {
        for (const id in j.methods) methods[id] = { m: j.methods[id][0], ts: j.methods[id][2] };
        save('wsp_methods', methods);
      }
    } catch (e) {
      S.trackErr = 'Tracker unreachable';
    }
  }

  function mergeTracker(remote) {
    // Only use the tracker's record if it's for the flight the player is on right now
    const current = {};
    [S.mine, S.enemy].forEach(f => {
      if (f) for (const [id, m] of Object.entries(f.members || {})) current[id] = (m.status && m.status.description) || '';
    });
    const gap = t => (t && t.after && t.seen - t.after < 10 * 60e3 ? t.seen - t.after : Infinity);
    for (const [id, t] of Object.entries(remote)) {
      if (current[id] !== t.d) continue;
      const r = { d: t.d, seen: t.seen * 1000, after: t.after ? t.after * 1000 : null };
      const l = trips[id];
      const better = !l || l.d !== r.d || gap(r) < gap(l) || (gap(r) === Infinity && gap(l) === Infinity && r.seen < l.seen);
      if (better) trips[id] = r;
    }
    save('wsp_trips', trips);
    S.dirty = true;
  }

  function eta(id, w) {
    const t = trips[id];
    const mins = FT[w.to === 'Torn' ? w.from : w.to];
    if (!t || !mins) return '';
    const dur = mins * 60e3 * (FACT[methodFor(id).m] || 1);
    const now = Date.now();
    if (t.after && t.seen - t.after < 10 * 60e3) { // we saw them take off (within a 10 min window)
      const left = (t.after + t.seen) / 2 + dur - now;
      return left > 0 ? '~' + fmtM(left / 1000) : 'landing';
    }
    const maxLeft = t.seen + dur - now; // already flying when first seen: upper bound only
    return maxLeft > 0 ? '≤' + fmtM(maxLeft / 1000) : 'landing';
  }

  /* ================= Status cell ================= */
  const C = { red: 'var(--hosp)', green: 'var(--ok)', blue: 'var(--travel)', teal: 'var(--abroad)', grey: 'var(--other)' };
  const arrow = a => `<b class="wsp-arrow">${a}</b>`;

  function statusCell(st, id) {
    const now = Date.now() / 1000;
    const w = where(st);
    if (w.travel) {
      const e = eta(id, w);
      const tail = e ? ` <small class="wsp-eta">${e}</small>` : '';
      return w.to === 'Torn'
        ? { h: `${arrow('←')} ${flag(w.from)} ${short(w.from)}${tail}`, c: C.blue }
        : { h: `${arrow('→')} ${flag(w.to)} ${short(w.to)}${tail}`, c: C.blue };
    }
    if (st.state === 'Hospital' || st.state === 'Jail' || st.state === 'Federal') {
      if (!st.until) return { h: esc(st.state), c: C.red };
      const left = st.until - now;
      if (left <= 0) return { h: 'Out', c: C.green };
      if (st.state === 'Hospital') return { h: `🏥${w.loc !== 'Torn' ? flag(w.loc) : ''} ${fmt(left)}`, c: C.red };
      return { h: `⛓️ ${fmt(left)}`, c: C.red };
    }
    if (st.state === 'Abroad') return { h: `${flag(w.loc)} ${short(w.loc)}`, c: C.teal };
    if (st.state === 'Okay') return { h: 'Okay', c: C.green };
    return { h: esc(st.state || '?'), c: C.grey };
  }

  /* ================= FFScouter ================= */
  const ffCache = load('wsp_ff', {});
  const purgeEmptyFF = () => { for (const id in ffCache) if (ffCache[id].ff == null) delete ffCache[id]; save('wsp_ff', ffCache); };
  if (!localStorage.getItem('wsp_ff_v2')) { purgeEmptyFF(); localStorage.setItem('wsp_ff_v2', '1'); } // clear blanks cached by older versions
  let ffLoading = false;
  async function loadFF(ids) {
    if (!cfg.ff || ffLoading) return;
    const now = Date.now();
    const need = ids.filter(id => !ffCache[id] || now - ffCache[id].t > FF_TTL);
    if (!need.length) return;
    ffLoading = true;
    const key = cfg.ffKey || getKey();
    try {
      for (let i = 0; i < need.length; i += 100) {
        const chunk = need.slice(i, i + 100);
        const j = await getJSON(`https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(key)}&targets=${chunk.join(',')}`);
        if (!Array.isArray(j)) { // error: don't cache anything, so it retries next refresh
          S.ffErr = 'FFScouter: ' + ((j && (j.error || j.message)) || 'unexpected reply');
          break;
        }
        S.ffErr = '';
        chunk.forEach(id => { ffCache[id] = { t: now, ff: null, bs: null }; });
        j.forEach(x => { ffCache[x.player_id] = { t: now, ff: x.fair_fight, bs: x.bs_estimate_human, n: x.bs_estimate }; });
      }
      save('wsp_ff', ffCache);
    } catch (e) {
      S.ffErr = 'FFScouter unreachable';
    }
    ffLoading = false;
    S.dirty = true;
  }
  // Drug effects on battle stats (Torn wiki): Vicodin +25%, Xanax -35%
  const DRUG_FX = { v: { f: 1.25, name: 'Vicodin', cls: 'up' }, x: { f: 0.65, name: 'Xanax', cls: 'down' } };
  const ffColors = ff => (ff < 1.5 ? ['#1e5bd8', '#fff'] : ff < 2 ? ['#18c3d8', '#000'] : ff < 2.5 ? ['#1fd17a', '#000'] : ff < 3.5 ? ['#f0641e', '#fff'] : ['#e3202c', '#fff']);
  function parseHuman(t) { // "253k" / "10.2m" / "1.4b" -> number
    const m = String(t || '').trim().match(/^([\d.]+)\s*([kmbt]?)$/i);
    if (!m) return null;
    return Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2].toLowerCase()]);
  }
  function human(n) { // 12_800_000 -> "12.8m"
    const u = [[1e12, 't'], [1e9, 'b'], [1e6, 'm'], [1e3, 'k']].find(([v]) => n >= v);
    if (!u) return String(Math.round(n));
    const v = n / u[0];
    return (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100) + u[1];
  }
  // Live = the FFScouter estimate adjusted for a drug they're on right now
  function liveFF(id, side) {
    const f = ffCache[id];
    if (!f || f.ff == null) return null;
    const d = DRUG_FX[((side === 'mine' ? S.influenceMine : S.influence)[id] || {}).t];
    if (!d) return { ff: f.ff, bs: f.bs, d: null };
    const n = (f.n != null ? f.n : parseHuman(f.bs));
    // Fair fight is 1 + 8/3 x (their stats / yours), capped at 3, so it scales the same way
    const ff = Math.min(3, 1 + (f.ff - 1) * d.f);
    return { ff, bs: n != null ? human(n * d.f) : f.bs, d };
  }
  const ffVal = id => (ffCache[id] && ffCache[id].ff != null ? ffCache[id].ff : 99);
  function ffCell(id) {
    const f = ffCache[id];
    if (!cfg.ff || !f || f.ff == null) return '<span class="wsp-ff none">&ndash;</span>';
    const [bg, fg] = ffColors(f.ff);
    return `<span class="wsp-ff" style="background:${bg};color:${fg}" title="FFScouter estimate, fair fight ${f.ff.toFixed(2)}">${esc(f.bs || '?')}</span>`;
  }
  function liveCell(id) {
    const l = cfg.ff ? liveFF(id) : null;
    if (!l) return '<span class="wsp-ff none">&ndash;</span>';
    if (!l.d) return `<span class="wsp-ff same" title="No drug effect seen right now, so the same as FF">${esc(l.bs || '?')}</span>`;
    const [bg, fg] = ffColors(l.ff);
    return `<span class="wsp-ff live ${l.d.cls}" style="background:${bg};color:${fg}" title="On ${l.d.name}: battle stats x${l.d.f}, fair fight about ${l.ff.toFixed(2)}">${esc(l.bs)}</span>`;
  }

  /* ================= Target calling (shared server) ================= */
  function callsUrl(extra) {
    const u = cfg.callsUrl;
    return u + (u.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(cfg.callsPw || '') + (extra || '');
  }
  async function loadCalls() {
    if (!cfg.callsUrl || S.callsLoading) return;
    S.callsLoading = true;
    try {
      const j = await getJSON(callsUrl('&t=' + Date.now()));
      if (j && j.error) S.callsErr = 'Calls: ' + j.error;
      else { S.calls = j || {}; S.callsErr = ''; }
    } catch (e) {
      S.callsErr = 'Calls server unreachable';
    }
    S.callsAt = Date.now();
    S.callsLoading = false;
    S.dirty = true;
  }
  async function toggleCall(id, name) {
    if (!cfg.callsUrl || !S.meId) return;
    const mineCall = S.calls[id] && String(S.calls[id].byId) === S.meId;
    if (S.calls[id] && !mineCall) { toast(`📣 ${S.calls[id].by} already called ${name}`); return; }
    // optimistic update
    if (mineCall) delete S.calls[id];
    else S.calls[id] = { by: S.meName, byId: S.meId, at: Date.now() / 1000 };
    S.dirty = true;
    try {
      const j = await getJSON(cfg.callsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ k: cfg.callsPw, action: mineCall ? 'clear' : 'call', target: id, targetName: name, by: S.meName, byId: S.meId })
      });
      if (j && j.error) S.callsErr = 'Calls: ' + j.error;
      else if (j) S.calls = j;
    } catch (e) {
      S.callsErr = 'Calls server unreachable';
    }
    S.dirty = true;
  }

  /* ================= Data refresh ================= */
  async function refresh() {
    if (S.loading) return;
    S.loading = true;
    S.err = '';
    try {
      let u;
      try {
        u = await apiTs('user/', 'basic,bars,cooldowns,attacks');
        if (/bars|hits/.test(S.note)) S.note = '';
      } catch (e) {
        if (e.code !== 16 && e.code !== 7) throw e;
        u = await api('user/', 'basic');
        S.note = 'Key access too low for bars/hits';
      }
      S.me = u.status;
      S.meId = String(u.player_id);
      S.meName = u.name;
      if (u.energy) { S.bars = { energy: u.energy, life: u.life }; S.barsAt = Date.now(); }
      setChain(u);
      if (u.cooldowns) S.cd = u.cooldowns;
      loadPerks();
      if (u.attacks) S.attacks = u.attacks;
      S.uAt = Date.now();

      const mine = await api('faction/', 'basic');
      S.mine = mine;
      track(mine.members || {});

      let eid = null;
      S.war = null;
      for (const w of Object.values(mine.ranked_wars || {})) {
        const ended = w.war && w.war.end && w.war.end * 1000 < Date.now();
        if (!ended && w.factions) {
          eid = Object.keys(w.factions).find(id => String(id) !== String(mine.ID));
          if (eid) { S.war = w; break; }
        }
      }
      if (!eid) eid = localStorage.getItem('wsp_enemy');
      if (eid) {
        const prev = S.enemy && String(S.enemy.ID) === String(eid) ? S.enemy.members : null;
        const enemy = await api(`faction/${eid}`, 'basic');
        track(enemy.members || {});
        transitions(prev, enemy.members || {});
        S.enemy = enemy;
        loadFF(Object.keys(enemy.members || {}).concat(Object.keys((S.mine && S.mine.members) || {})));
        await loadRetals();
        loadRevives(eid).catch(() => { /* optional */ });
      } else {
        S.enemy = null;
      }
      if (cfg.trackerUrl && Date.now() - (S.trackAt || 0) > 55000) await loadTracker();
      persist();
    } catch (e) {
      S.err = e.message;
    }
    S.at = Date.now();
    S.loading = false;
    S.dirty = true;
  }

  async function refreshChain() {
    S.chainLoading = true;
    try {
      const u = await apiTs('user/', 'bars');
      setChain(u);
      if (u.energy) { S.bars = { energy: u.energy, life: u.life }; S.barsAt = Date.now(); }
    } catch (e) {
      S.chainAt = Date.now(); // back off
    }
    S.chainLoading = false;
  }
  function chainLeft() {
    if (!S.chain) return 0;
    const api = S.chain.timeout - (Date.now() - S.chainAt) / 1000;
    if (S.chain.current > 0 && !(S.chain.cooldown > 0)) {
      const pg = pageChainLeft();
      if (pg != null && pg > 0) return pg;
    }
    return api;
  }

  /* ================= Retaliation targets ================= */
  // Anyone who successfully hit a member of your faction in the last 5 minutes, and hasn't been hit back yet.
  const RETAL_SECS = 300;
  const HIT_OK = /attacked|mugged|hospitali[sz]ed|arrested|looted|special/i;
  // Revive settings (API v2 faction members): enemies anyone can revive, and our members who still have revives on.
  // One call per faction every 3 minutes.
  S.rev = load('wsp_rev', {});
  async function loadRevives(eid) {
    if (Date.now() - (S.revAt || 0) < 180000) return;
    S.revAt = Date.now();
    const key = getKey();
    if (!key) return;
    const ids = [eid, S.mine && S.mine.ID].filter(Boolean);
    for (const fid of ids) {
      try {
        const j = await getJSON(`https://api.torn.com/v2/faction/${fid}/members?striptags=true&key=${key}&comment=WarStatusPlus`);
        if (j.error) { S.revErr = j.error.error; continue; }
        (j.members || []).forEach(m => {
          if (!m || m.id == null) return;
          S.rev[m.id] = { rv: m.is_revivable === true, set: m.revive_setting || '', at: Date.now() };
        });
        S.revErr = '';
      } catch (e) { S.revErr = e.message; }
    }
    save('wsp_rev', S.rev);
    S.dirty = true;
  }
  // our members: hide Revive when their revives are set to "No one" (unknown setting: keep the button)
  function canRevive(id) {
    const r = S.rev && S.rev[id];
    if (!r || Date.now() - r.at > 30 * 60e3 || !r.set) return true;
    return !/no ?one/i.test(r.set);
  }
  // 🎯 on enemies: how often they've hit our members this war. ⚔ on ours: their war hits so far.
  function warTag(id, kind) {
    if (!(S.war && S.war.war && S.war.war.start && S.war.war.start * 1000 <= Date.now())) return '';
    if (kind === 'enemy') {
      const n = hitsOnUs(id);
      const r = respOnUs(id);
      return n ? `<small class="wsp-wt en" title="Hit our members ${n} times this war for ${r.toFixed(2)} respect">\u{1F3AF}${n}</small>` : '';
    }
    const n = warHits(id), r = respByUs(id);
    return n == null ? '' : `<small class="wsp-wt us${n ? '' : ' zero'}" title="${n} war hits, ${r.toFixed(2)} respect">\u2694\ufe0f${n}</small>`;
  }
  function revTag(id, kind) {
    const r = S.rev && S.rev[id];
    if (!r || Date.now() - r.at > 30 * 60e3) return '';
    // only when anyone can revive them (setting "Everyone"), for both sides
    const on = r.set ? /every/i.test(r.set) : (kind === 'enemy' && r.rv);
    if (!on) return '';
    // enemies: anyone (or their faction) can bring them back early; ours: they should switch revives off
    const who = r.set ? r.set : 'Revivable';
    return kind === 'enemy'
      ? `<small class="wsp-rev en" title="Revives: ${esc(who)}">REV</small>`
      : `<small class="wsp-rev us" title="Revives: ${esc(who)} \u2014 turn them off during war">REV ON</small>`;
  }

  async function loadRetals() {
    if (!S.mine || Date.now() < S.retalOff) return;
    try {
      const j = await api('faction/', 'attacks');
      const atks = Object.values(j.attacks || {});
      const us = String(S.mine.ID);
      const now = Date.now() / 1000;
      const retals = {};
      for (const a of atks) {
        if (String(a.defender_faction) !== us || String(a.attacker_faction) === us) continue;
        if (!a.attacker_id || !HIT_OK.test(a.result || '')) continue; // stealthed or failed hits can't be retaliated
        const t = a.timestamp_ended || a.timestamp_started;
        const until = t + RETAL_SECS;
        if (until <= now) continue;
        const avenged = atks.some(b => String(b.attacker_faction) === us && String(b.defender_id) === String(a.attacker_id) &&
          b.timestamp_started >= t && HIT_OK.test(b.result || ''));
        if (avenged) continue;
        const id = String(a.attacker_id);
        if (!retals[id] || retals[id].until < until) retals[id] = { until, victim: a.defender_name || '?', attacker: a.attacker_name || id };
      }
      S.retals = retals;
      S.retalErr = '';
      updateWins(atks).catch(() => { /* keep going without it */ });
      for (const [id, r] of Object.entries(retals)) {
        if (cfg.retalAlert) fire(`retal-${id}-${r.until}`, `🔁 Retal ${r.attacker} (hit ${r.victim}) · ${fmt(r.until - now)} left`, true);
      }
    } catch (e) {
      S.retalErr = 'Retals need faction API access';
      S.retalOff = Date.now() + 10 * 60e3; // try again in 10 min
    }
  }
  /* ---------- Who has beaten whom this war (for the Call tab) ---------- */
  // Kept per war on this device: our attacker id -> { enemy id: 1 }
  let winsState = null;
  function winsLoad() {
    if (!(S.war && S.war.war && S.war.war.start && S.mine && S.enemy)) return null;
    const key = 'wsp_wins7_' + S.war.war.start + '_' + S.enemy.ID;
    if (!winsState || winsState.key !== key) {
      winsState = load(key, null) || { key, upTo: 0, backTo: null, w: {} };
      winsState.n = winsState.n || {};   // our member id -> successful war hits
      winsState.by = winsState.by || {}; // enemy id -> successful hits on our members
      winsState.seen = winsState.seen || {};
    }
    return winsState;
  }
  function addWins(list) {
    const ws = winsLoad();
    if (!ws) return;
    const us = String(S.mine.ID), them = String(S.enemy.ID), start = S.war.war.start;
    for (const a of list) {
      ws.read = (ws.read || 0) + 1;
      if (a.result) { ws.res = ws.res || {}; if (Object.keys(ws.res).length < 20 || ws.res[a.result]) ws.res[a.result] = (ws.res[a.result] || 0) + 1; }
      // a war hit = a win, or anything that earned respect (whatever Torn calls the result)
      const rs = +a.respect_gain || +a.respect || 0;
      if (!(HIT_OK.test(a.result || '') || rs > 0) || (a.timestamp_started || 0) < start) continue;
      if (!a.attacker_id || a.attacker_id === '0') {
        // stealthed: Torn hides who (and which faction) did it, so count it against nobody
        if (String(a.defender_faction) !== us) continue;
        // only ranked war hits: other people (muggers, bounty hunters) also stealth-attack our members
        if (a.ranked_war !== undefined && a.ranked_war !== null && !(+a.ranked_war)) continue;
        const ks = a.code || `${a.timestamp_started}-s-${a.defender_id}`;
        if (ws.seen[ks]) continue;
        ws.seen[ks] = 1;
        ws.stealth = (ws.stealth || 0) + 1;
        ws.stealthR = (ws.stealthR || 0) + rs;
        continue;
      }
      const af = String(a.attacker_faction), df = String(a.defender_faction);
      const ours = af === us && df === them, theirs = af === them && df === us;
      if (!ours && !theirs) continue;
      const k = a.code || `${a.timestamp_started}-${a.attacker_id}-${a.defender_id}`;
      if (ws.seen[k]) continue; // pages overlap; count each attack once
      ws.seen[k] = 1;
      ws.cnt = ws.cnt || { o: 0, i: 0 };
      if (ours) ws.cnt.o++; else ws.cnt.i++;
      if (ours) {
        (ws.w[a.attacker_id] = ws.w[a.attacker_id] || {})[a.defender_id] = 1;
        ws.n[a.attacker_id] = (ws.n[a.attacker_id] || 0) + 1;
        ws.nr = ws.nr || {}; ws.nr[a.attacker_id] = (ws.nr[a.attacker_id] || 0) + rs;
      } else {
        ws.by[a.attacker_id] = (ws.by[a.attacker_id] || 0) + 1;
        ws.byr = ws.byr || {}; ws.byr[a.attacker_id] = (ws.byr[a.attacker_id] || 0) + rs;
      }
    }
  }
  // API v2 attack log, newest first within [from, to], shaped like v1 attacks
  async function attacksV2(from, to, dir) {
    const key = getKey();
    const j = await getJSON(`https://api.torn.com/v2/faction/attacks?from=${from}&to=${to}&limit=100&sort=DESC${dir ? '&filters=' + dir : ''}&striptags=true&key=${key}&comment=WarStatusPlus`);
    if (j.error) { const e = new Error(j.error.error); e.code = j.error.code; throw e; }
    if (!Array.isArray(j.attacks)) throw new Error('unexpected v2 reply');
    return j.attacks.map(a => ({
      code: a.code || a.id,
      attacker_id: a.attacker && a.attacker.id,
      attacker_faction: a.attacker && a.attacker.faction ? a.attacker.faction.id : 0,
      defender_id: a.defender && a.defender.id,
      defender_faction: a.defender && a.defender.faction ? a.defender.faction.id : 0,
      result: a.result || '',
      respect_gain: +(a.respect_gain != null ? a.respect_gain : a.modifiers && a.modifiers.respect) || 0,
      chain: a.chain || 0,
      ranked_war: a.is_ranked_war === true ? 1 : a.is_ranked_war === false ? 0 : undefined,
      stealthed: a.is_stealthed ? 1 : 0,
      timestamp_started: a.started || a.timestamp_started || 0
    }));
  }
  // The v2 log can be split into our attacks (outgoing) and attacks on us (incoming); read both
  const atkDirs = () => (S.noAtkV2 ? [''] : S.noDirFilter ? [''] : ['outgoing', 'incoming']);
  async function pageBack(to, floor, maxPages, dir) { // read older attacks; returns where to carry on (0 = finished)
    for (let i = 0; i < maxPages; i++) {
      if (S.noDirFilter) dir = '';
      let list;
      if (!S.noAtkV2) {
        try { list = await attacksV2(floor, to, dir); } catch (e) {
          if (dir && !S.noDirFilter) { S.noDirFilter = true; try { list = await attacksV2(floor, to, ''); } catch (e2) { S.noAtkV2 = true; } }
          else S.noAtkV2 = true;
        }
      }
      if (!list) list = Object.values((await api('faction/', `attacks&from=${floor}&to=${to}`)).attacks || {});
      addWins(list);
      const ts = list.map(a => a.timestamp_started).filter(Boolean);
      if (list.length < 100 || !ts.length || Math.max(...ts) > to) return 0; // done, or the range was ignored
      to = Math.min(...ts) - 1;
      if (to <= floor) return 0;
    }
    return to;
  }
  async function updateWins(latest) {
    const ws = winsLoad();
    if (!ws) return;
    addWins(latest);
    const ts = latest.map(a => a.timestamp_started).filter(Boolean);
    if (ts.length) {
      const newest = Math.max(...ts), oldest = Math.min(...ts), start = S.war.war.start;
      ws.back = ws.back || {};
      for (const d0 of atkDirs()) {
        const dir = S.noDirFilter ? '' : d0;
        if (latest.length >= 100 && ws.upTo && oldest > ws.upTo) await pageBack(oldest - 1, ws.upTo, 10, dir); // fill a gap
        if (ws.back[dir] == null) ws.back[dir] = latest.length >= 100 ? oldest - 1 : 0;                      // first run
        if (ws.back[dir] > start) ws.back[dir] = await pageBack(ws.back[dir], start, 10, dir);              // back to the war start
      }
      ws.backTo = Math.max(0, ...atkDirs().map(d => ws.back[d] || 0));
      ws.upTo = Math.max(ws.upTo || 0, newest);
    }
    save(ws.key, ws);
    S.dirty = true;
  }
  const warHits = id => { const ws = winsLoad(); return ws ? ws.n[id] || 0 : null; };
  const hitsOnUs = id => { const ws = winsLoad(); return ws ? ws.by[id] || 0 : 0; };
  const respOnUs = id => { const ws = winsLoad(); return ws && ws.byr ? ws.byr[id] || 0 : 0; };
  const respByUs = id => { const ws = winsLoad(); return ws && ws.nr ? ws.nr[id] || 0 : 0; };
  const fmtR = r => (r >= 1000 ? (r / 1000).toFixed(1) + 'k' : r >= 100 ? Math.round(r) : r.toFixed(r >= 10 ? 0 : 1)) + 'r';
  const hasBeaten = (ours, theirs) => { const ws = winsLoad(); return !!(ws && ws.w[ours] && ws.w[ours][theirs]); };

  const retalLeft = id => (S.retals[id] ? S.retals[id].until - Date.now() / 1000 : 0);

  /* ================= Chain bonus hits ================= */
  const BONUS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  function chainBonus() {
    const c = S.chain;
    if (!c || !(c.current > 0) || c.cooldown > 0 || chainLeft() <= 0) return null;
    const next = BONUS.find(b => b > c.current);
    if (!next) return null;
    return { next, hits: next - c.current };
  }

  /* ================= Alerts ================= */
  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) { /* no audio */ }
  }
  ['touchend', 'click'].forEach(t => document.addEventListener(t, unlockAudio, { capture: true, passive: true }));

  function beep(urgent) {
    if (!cfg.sound || !actx) return;
    try {
      const n = urgent ? 3 : 2, f = urgent ? 1200 : 880, t0 = actx.currentTime + 0.02;
      for (let i = 0; i < n; i++) {
        const o = actx.createOscillator(), g = actx.createGain(), t = t0 + i * 0.22;
        o.type = 'square';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g);
        g.connect(actx.destination);
        o.start(t);
        o.stop(t + 0.18);
      }
    } catch (e) { /* ignore */ }
  }
  function buzz(urgent) {
    if (cfg.vibrate && navigator.vibrate) navigator.vibrate(urgent ? [250, 100, 250, 100, 250] : [200, 100, 200]);
  }

  const toasts = document.createElement('div');
  toasts.id = 'wsp-toasts';
  function toast(msg, urgent) {
    const t = document.createElement('div');
    t.className = 'wsp-toast' + (urgent ? ' urgent' : '');
    t.textContent = msg;
    toasts.appendChild(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => t.remove(), 7000);
  }

  // Each alert fires once (shared across tabs/pages via localStorage); hidden tabs leave it to the visible one
  function fire(key, msg, urgent) {
    if (document.hidden) return;
    const f = load('wsp_fired', {});
    if (f[key]) return;
    const now = Date.now();
    for (const k in f) if (now - f[k] > 15 * 60e3) delete f[k];
    f[key] = now;
    save('wsp_fired', f);
    beep(urgent);
    buzz(urgent);
    if (cfg.popups) toast(msg, urgent); // off: sound / vibrate only (if those are on)
    if (!S.open) btn.classList.add('alert');
  }

  function transitions(prev, next) {
    const myLoc = myLocation();
    if (!prev || !myLoc) return;
    for (const [id, m] of Object.entries(next)) {
      const p = prev[id];
      if (!p) continue;
      const a = p.status || {}, b = m.status || {};
      const wa = where(a), wb = where(b);
      if (a.state === 'Hospital' && (b.state === 'Okay' || b.state === 'Abroad') && wb.loc === myLoc) {
        S.outAt[id] = Date.now();
        if (cfg.hospAlert) fire(`out-${id}-${a.until}`, `✅ ${m.name} is out of hospital`, true);
      }
      if (wa.travel && !wb.travel && wb.loc === myLoc && cfg.landAlert) {
        fire(`land-${id}-${a.description}`, `🛬 ${m.name} landed in ${short(myLoc)}`);
      }
    }
  }

  function checkAlerts() {
    const now = Date.now();
    const myLoc = myLocation();
    if (S.enemy && myLoc) {
      for (const [id, m] of Object.entries(S.enemy.members || {})) {
        const st = m.status || {};
        if (st.state !== 'Hospital' || !st.until) continue;
        const w = where(st);
        if (w.loc !== myLoc) continue;
        const left = st.until - now / 1000;
        if (cfg.hospAlert && left > 0 && left <= 30) fire(`h30-${id}-${st.until}`, `🏥 ${m.name} out in ${Math.ceil(left)}s`);
        if (left <= 0 && left > -60) {
          S.outAt[id] = S.outAt[id] || now;
          if (cfg.hospAlert) fire(`out-${id}-${st.until}`, `✅ ${m.name} is out of hospital`, true);
        }
      }
    }
    // Your own cooldowns running out (only if it ended in the last 2 minutes, so a fresh page doesn't nag)
    if (S.cd && S.uAt) {
      // remember when each cooldown ends, even after the API starts reporting 0
      S.cdEnd = S.cdEnd || load('wsp_cdend', {});
      ['drug', 'medical'].forEach(k => {
        if (S.cd[k] > 0) {
          const e = S.uAt + S.cd[k] * 1000;
          if (Math.abs((S.cdEnd[k] || 0) - e) > 5000) { S.cdEnd[k] = e; save('wsp_cdend', S.cdEnd); }
        }
      });
      const ready = (k, on, msg) => {
        const end = S.cdEnd[k] || 0;
        if (on && end && now >= end && now - end < 120000) fire(`${k}ready-${Math.round(end / 60000)}`, msg, true);
      };
      ready('drug', cfg.drugAlert, '\u{1F33F} Drug cooldown over \u2014 ready for your next Xanax');
    }
    // Energy about to cap (regen is wasted once it's full). Uses Torn's own "full in" time; stacked energy above max is left alone.
    const en = S.bars && S.bars.energy;
    if (cfg.energyAlert && en && en.fulltime > 0 && S.barsAt) {
      const fullAt = S.barsAt + en.fulltime * 1000;
      const left = (fullAt - now) / 1000;
      if (left <= 0 && left > -120) fire(`en-full-${Math.round(fullAt / 60000)}`, `\u26a1 Energy is full \u2014 regen is being wasted`, true);
    }
    const bonus = chainBonus();
    if (cfg.bonusAlert && bonus && bonus.hits === 1 && bonus.next >= 50) fire(`bonus-${bonus.next}`, `🎁 Next hit is chain bonus #${bonus.next} — make it count`);
    const c = S.chain;
    if (cfg.chainAlert && c && c.current >= cfg.chainMin && !(c.cooldown > 0)) {
      const rem = chainLeft();
      if (rem > 30 && rem <= 60) fire(`c60-${c.current}`, `🔗 Chain ${c.current}: ${Math.ceil(rem)}s left!`, true);
      if (rem > 0 && rem <= 30) fire(`c30-${c.current}`, `🔗 CHAIN ${c.current}: ${Math.ceil(rem)}s LEFT!`, true);
    }
  }

  function isFlash(id, st) {
    const myLoc = myLocation();
    if (!myLoc || where(st).loc !== myLoc) return false;
    const l = hospLeft(st);
    if (st.state === 'Hospital' && l > 0 && l <= 30) return true;
    return !!(S.outAt[id] && Date.now() - S.outAt[id] < 60e3);
  }

  /* ================= Hits ================= */
  function myHits() {
    const since = S.war && S.war.war && S.war.war.start ? S.war.war.start : Date.now() / 1000 - 86400;
    return Object.values(S.attacks || {})
      .filter(a => String(a.attacker_id) === S.meId && a.timestamp_started >= since)
      .sort((a, b) => b.timestamp_started - a.timestamp_started);
  }
  const respectOf = a => Number(a.respect_gain != null ? a.respect_gain : a.respect || 0);
  function recentHitMap() { // defender id -> seconds since my last hit (last 15 min)
    const map = {}, now = Date.now() / 1000;
    for (const a of myHits()) {
      const ago = now - (a.timestamp_ended || a.timestamp_started);
      if (ago < 900 && !(a.defender_id in map)) map[a.defender_id] = ago;
    }
    return map;
  }

  /* ================= UI ================= */
  const style = document.createElement('style');
  style.textContent = `
  /* ---------- Theme (light default, dark follows Torn's dark mode) ---------- */
  .wsp-theme{
    --bg:#ffffff; --surface:#f4f6f9; --line:#e3e7ed; --line2:#eef1f5;
    --text:#18212c; --muted:#7a8696; --faint:#b4bdc8;
    --head:#1d2733; --head2:#26344a; --headText:#ffffff;
    --accent:#4c6ef5; --accentSoft:#edf1ff;
    --ok:#1f9d55; --hosp:#e03131; --travel:#2f74d0; --abroad:#0c8f8f; --other:#7a8696;
    --attack:#e5484d; --attackText:#fff; --revive:#1f9d55;
    --arrow:#000; --flash:#ffe9a3; --called:#fff5e0; --mine:#e7f7ec; --hit:#1f9d55; --caller:#c26a00;
    --pill:#e8ecf2; --hot:#e03131; --shadow:rgba(16,24,40,.28);
  }
  .wsp-theme.dark{ /* War room */
    --bg:#0c100e; --surface:#131915; --line:#26302a; --line2:#1a221d;
    --text:#dfe8dc; --muted:#7e8d80; --faint:#3c4a40;
    --head:#090c0a; --head2:#1b231d; --headText:#f2f5ee;
    --accent:#ffb000; --accentSoft:rgba(255,176,0,.10);
    --ok:#4be37f; --hosp:#ff4d4d; --travel:#4cc3ff; --abroad:#d9b45f; --other:#7e8d80;
    --attack:#c62828; --attackText:#fff; --revive:#1f8f4e;
    --arrow:#f2f5ee; --flash:rgba(255,176,0,.22); --called:rgba(255,176,0,.09); --mine:rgba(75,227,127,.10);
    --hit:#4be37f; --caller:#ffb000; --pill:#1d2620; --hot:#ff3b3b; --shadow:rgba(0,0,0,.7);
  }

  #wsp-btn{position:fixed;left:0;top:75%;transform:translateY(-50%);width:40px;height:52px;display:flex;align-items:center;
    justify-content:center;cursor:pointer;border:none;padding:0 0 0 2px;border-radius:0 12px 12px 0;
    background:linear-gradient(135deg,var(--head2),var(--head));font-size:22px;
    z-index:2147483000;box-shadow:2px 2px 10px var(--shadow);-webkit-tap-highlight-color:transparent;user-select:none;}
  #wsp-btn.hide{display:none;}
  #wsp-btn.alert{background:var(--hot);animation:wspPulse 1s infinite;}
  @keyframes wspPulse{50%{transform:translateY(-50%) scale(1.12);}}
  #wsp-toasts{position:fixed;left:8px;bottom:calc(25% + 34px);display:flex;flex-direction:column;gap:6px;z-index:2147483002;max-width:80vw;}
  #wsp-toasts.top{bottom:auto;top:12px;left:50%;transform:translateX(-50%);}
  .wsp-toast{background:var(--head);color:var(--headText);padding:9px 12px;border-radius:10px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    box-shadow:0 4px 14px var(--shadow);cursor:pointer;border-left:4px solid var(--accent);}
  .wsp-toast.urgent{border-left-color:var(--hot);}

  #wsp-panel{position:fixed;left:0;width:min(460px,97vw);bottom:9vh;max-height:78vh;display:none;flex-direction:column;background:var(--bg);color:var(--text);
    border-radius:0 12px 12px 0;box-shadow:4px 6px 28px var(--shadow);z-index:2147483001;
    font:12px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;overflow:hidden;}
  #wsp-panel.open{display:flex;}
  #wsp-head{display:flex;flex-direction:column;gap:3px;padding:7px 8px 5px 10px;background:linear-gradient(135deg,var(--head2),var(--head));color:var(--headText);}
  .wsp-hbar{display:flex;align-items:center;gap:2px;}
  .wsp-hbar #wsp-sub{flex:1;min-width:0;margin-top:0;}
  #wsp-title{font-weight:600;font-size:13px;}
  .wsp-frow{display:flex;align-items:baseline;gap:8px;white-space:nowrap;line-height:1.3;}
  .wsp-frow .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}
  .wsp-frow .n{display:flex;align-items:baseline;}
  .wsp-frow .n .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;}
  .wsp-frow .n .st{flex:0 0 auto;margin-left:8px;font-size:11px;font-weight:700;color:#c9b6ff;letter-spacing:0;text-transform:none;}
  .wsp-frow .o{display:inline-flex;align-items:center;justify-content:flex-end;min-width:62px;gap:3px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;opacity:.9;align-self:center;}
  .wsp-frow .o i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:4px;}
  .wsp-frow .o i:first-child{margin-left:0;}
  .wsp-frow .o i.g{background:#3fbf6f;} .wsp-frow .o i.y{background:#ffb000;}
  .wsp-frow .s{font-weight:700;min-width:42px;text-align:right;font-variant-numeric:tabular-nums;}
  .wsp-frow .c{min-width:74px;text-align:right;font-size:11px;font-weight:600;opacity:.85;font-variant-numeric:tabular-nums;}
  .wsp-frow .c.hot{color:#fff;background:var(--hot);border-radius:4px;padding:0 4px;opacity:1;animation:wspBlink 1s infinite;}
  .wsp-frow.lead .s{color:#5ee38f;} .wsp-frow.trail .s{color:#ff8a8a;}
  #wsp-bonus:empty{display:none;}
  #wsp-bonus div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 10px;font-weight:700;font-size:11.5px;background:var(--accentSoft);color:var(--text);border-bottom:1px solid var(--line);}
  #wsp-bonus div.next{background:#ffb000;color:#1a1300;animation:wspBlink 1.2s infinite;}
  .wsp-trv{padding:0 12px 8px;font-size:11px;}
  .wsp-trv div{display:flex;gap:6px;align-items:baseline;padding:2px 0;border-bottom:1px solid var(--line2);}
  .wsp-trv b{flex:0 0 auto;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .wsp-trv span{flex:1;min-width:0;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .wsp-trv i{font-style:normal;font-weight:700;color:var(--travel);flex:0 0 auto;}
  .wsp-meta.wsp-fly{color:var(--travel);font-weight:600;}
  .wsp-fly.guess{opacity:.75;}
  .wsp-wt{display:inline-block;margin-left:5px;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;vertical-align:1px;}
  .wsp-wt.en{color:#ff8a8a;} .wsp-wt.us{color:#9fd8ae;} .wsp-wt.us.zero{color:var(--muted);opacity:.8;}
  .wsp-rev{display:inline-block;margin-left:5px;padding:0 4px;border-radius:3px;font-size:9px;font-weight:800;letter-spacing:.4px;line-height:14px;vertical-align:1px;}
  .wsp-rev.en{background:rgba(255,176,0,.18);color:#ffb000;border:1px solid rgba(255,176,0,.5);}
  .wsp-rev.us{background:rgba(255,77,77,.18);color:#ff6b6b;border:1px solid rgba(255,77,77,.55);}
  .wsp-meta{display:block;font-size:9.5px;line-height:1.15;color:var(--muted);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}
  .wsp-name .wsp-retal{color:#fff;background:var(--hot);border-radius:3px;padding:0 3px;opacity:1;font-weight:700;}
  .wsp-next{display:flex;gap:5px;align-items:center;padding:5px 8px;overflow-x:auto;border-bottom:1px solid var(--line);background:var(--surface);-webkit-overflow-scrolling:touch;}
  .wsp-next .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);flex:0 0 auto;}
  .wsp-chip{flex:0 0 auto;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:12px;padding:2px 8px;font:600 11px inherit;font-family:inherit;}
  .wsp-chip b{color:var(--hosp);font-variant-numeric:tabular-nums;}
  .wsp-cbar{position:sticky;top:0;z-index:2;background:var(--surface);border-bottom:1px solid var(--line);padding:7px 10px;display:flex;flex-direction:column;gap:6px;}
  .wsp-cbar .pair{font-size:12.5px;line-height:1.35;}
  .wsp-cbar .pair.hint{color:var(--muted);}
  .wsp-cbar .ratio{display:inline-block;margin-left:2px;padding:0 5px;border-radius:3px;font-size:11px;font-weight:700;}
  .wsp-cbar .btns{display:flex;gap:6px;}
  .wsp-cbar button{flex:1;padding:7px 0;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);font-weight:700;font-size:12.5px;}
  .wsp-cbar button.go{flex:2;background:var(--accent);border-color:var(--accent);color:#111;}
  .wsp-ccols{display:grid;grid-template-columns:1fr 1fr;gap:0;}
  .wsp-ccols .col{min-width:0;border-right:1px solid var(--line);}
  .wsp-ccols .col:last-child{border-right:none;}
  .wsp-ccols .h{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);padding:5px 6px;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .wsp-crow{display:grid;grid-template-columns:6px minmax(0,1fr) 36px 60px;gap:3px;align-items:center;padding:6px 5px;border-bottom:1px solid var(--line2);cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .wsp-crow .wsp-dot{width:6px;height:6px;}
  .wsp-crow .n{font-weight:600;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .wsp-crow .v{font-size:10.5px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;border-radius:3px;padding:1px 2px;}
  .wsp-crow .v.up::after{content:"\\25B2";font-size:6px;vertical-align:2px;}
  .wsp-crow .v.down::after{content:"\\25BC";font-size:6px;vertical-align:2px;}
  .wsp-crow .v.easy,.wsp-cbar .ratio.easy{background:rgba(31,157,85,.35);}
  .wsp-crow .v.even,.wsp-cbar .ratio.even{background:rgba(255,176,0,.35);}
  .wsp-crow .v.hard,.wsp-cbar .ratio.hard{background:rgba(229,72,77,.45);}
  .wsp-crow .s{font-size:10.5px;font-weight:700;text-align:right;white-space:nowrap;overflow:hidden;letter-spacing:-.2px;}
  .wsp-crow.beaten{background:rgba(31,157,85,.18) !important;box-shadow:inset 3px 0 0 #1f9d55;}
  .wsp-crow .ck{color:#3fbf6f;margin-right:3px;}
  .wsp-crow.sel{background:var(--accentSoft) !important;box-shadow:inset 3px 0 0 var(--accent);}
  .wsp-lead{font-weight:700;} .wsp-lead.ahead{color:#5ee38f;} .wsp-lead.behind{color:#ff8a8a;} .wsp-lead.soon{color:#ffd23f;}
  .wsp-frow.them .n{opacity:.8;}
  #wsp-sub{font-size:10.5px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}
  #wsp-head button{background:none;border:none;color:var(--headText);font-size:14px;padding:2px 5px;cursor:pointer;}
  #wsp-dock{font-size:11.5px !important;font-weight:600;background:rgba(255,255,255,.1) !important;border-radius:6px;white-space:nowrap;margin-left:2px;}
  #wsp-bars{display:flex;align-items:center;gap:9px;padding:4px 10px;background:var(--surface);border-bottom:1px solid var(--line);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;}
  #wsp-barsv{display:flex;gap:9px;align-items:center;min-width:0;overflow:hidden;}
  .wsp-bi{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;font-variant-numeric:tabular-nums;}
  .wsp-bi i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:1.15em;line-height:1;}
  .wsp-bi i svg{width:1.05em;height:1.05em;vertical-align:0;}
  .wsp-bi b{font-weight:600;}
  @media (max-width:400px){ .wsp-bi .mx{display:none;} #wsp-barsv{gap:6px !important;} #wsp-bars{gap:6px !important;} .wsp-quick button{padding:2px 4px !important;} }
  .wsp-bi.ok b{color:#3fbf6f;}
  .wsp-bi.full b{color:#ff4d4d;}
  .wsp-bi.enear b{color:#ffb000;} .wsp-bi.efull b{color:#ff4d4d;}
  .wsp-bv{display:flex;flex-direction:column;line-height:1;}
  .wsp-bv small{font-size:9px;font-weight:700;letter-spacing:.3px;margin-top:2px;color:#9fb3a3;}
  .wsp-bi.enear .wsp-bv small{color:#ffb000;} .wsp-bi.efull .wsp-bv small{color:#ff4d4d;}
  .wsp-pill{width:1.6em;height:1.2em;display:block;margin:-2px 0 -1px;}
  .wsp-box{width:1.45em;height:1.35em;display:block;}
  .wsp-pb{display:flex;flex-direction:column;align-items:center;line-height:1;}
  .wsp-pb small{font-size:8px;font-weight:700;letter-spacing:.4px;margin-top:1px;}
  .wsp-quick{margin-left:auto;display:flex;gap:4px;flex:0 0 auto;}
  .wsp-leaf{vertical-align:-.18em;width:1.15em;height:1.15em;}
  .wsp-quick{gap:3px !important;align-items:stretch;}
  .wsp-quick button{padding:2px 5px !important;letter-spacing:0 !important;height:auto !important;min-height:28px;max-height:none !important;line-height:1 !important;
    display:inline-flex !important;align-items:center;justify-content:center;overflow:visible !important;box-sizing:border-box;margin:0 !important;}
  .wsp-pb small{display:block;line-height:1 !important;}
  .wsp-quick button{border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:5px;padding:2px 6px;font:600 11px inherit;font-family:inherit;cursor:pointer;}
  .wsp-med-pref{outline:3px solid #ffb000 !important;outline-offset:-3px;background:rgba(255,176,0,.16) !important;box-shadow:0 0 12px rgba(255,176,0,.45) !important;}
  .wsp-med-ok{outline:2px dashed #3fbf6f !important;outline-offset:-2px;background:rgba(63,191,111,.10) !important;}
  #wsp-medbar,#wsp-travbar{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483000;display:none;max-width:92vw;
    background:var(--head);color:var(--headText);border:1px solid var(--accent);border-radius:6px;padding:6px 10px;
    font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 4px 14px var(--shadow);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  #wsp-medbar.on,#wsp-travbar.on{display:flex;align-items:center;gap:8px;}
  #wsp-medlbl,#wsp-travlbl{overflow:hidden;text-overflow:ellipsis;min-width:0;}
  #wsp-medgo,#wsp-travgo{flex:0 0 auto;border:1px solid #ffb000;background:#ffb000;color:#111;border-radius:5px;padding:4px 10px;font:700 12px inherit;font-family:inherit;cursor:pointer;}
  #wsp-medbar .k,#wsp-travbar .k{color:#ffb000;} #wsp-medbar .o{color:#3fbf6f;}
  #wsp-travbar .st{opacity:.75;font-weight:500;}
  .wsp-trip{padding:10px 12px;}
  .wsp-trip h4{margin:8px 0 6px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;opacity:.7;}
  .wsp-trip .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;}
  .wsp-trip button{border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:6px;padding:7px 6px;font:600 12px inherit;font-family:inherit;cursor:pointer;text-align:left;}
  .wsp-trip button small{display:block;font-weight:500;opacity:.7;font-size:10.5px;}
  .wsp-trip button.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset;background:rgba(255,176,0,.12);}
  .wsp-trip .go{display:flex;gap:8px;margin-top:12px;}
  .wsp-trip .go button{flex:1;text-align:center;padding:10px;}
  .wsp-trip .go .main{background:var(--accent);color:#111;border-color:var(--accent);}
  #wsp-panel.dark .wsp-quick button{font-family:var(--cond);font-size:12px;letter-spacing:.6px;text-transform:uppercase;border-color:rgba(255,176,0,.45);color:var(--accent);background:transparent;border-radius:3px;}
  #wsp-bars .wsp-chain{margin-left:auto;padding:1px 8px;border-radius:9px;background:var(--pill);}
  #wsp-bars .wsp-chain.hot{background:var(--hot);color:#fff;animation:wspBlink 1s infinite;}
  @keyframes wspBlink{50%{opacity:.55;}}
  #wsp-tabs{display:flex;border-bottom:1px solid var(--line);background:var(--bg);}
  #wsp-tabs div{flex:1;text-align:center;padding:6px 2px 5px;cursor:pointer;font-weight:600;color:var(--muted);white-space:nowrap;border-bottom:2px solid transparent;}
  #wsp-tabs div.on{color:var(--accent);border-bottom-color:var(--accent);}
  #wsp-tabs .wsp-flt{flex:0 0 32px;font-size:14px;opacity:.4;}
  #wsp-tabs .wsp-flt.on{opacity:1;background:var(--accentSoft);border-bottom-color:var(--accent);}
  #wsp-tabs .wsp-flt.off{display:none;}
  #wsp-list{overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1 1 auto;min-height:0;}
  #wsp-panel > *:not(#wsp-list){flex-shrink:0;} /* only the list scrolls; header rows never get squashed */
  .wsp-grp{color:var(--muted);font-size:10px;font-weight:700;padding:7px 10px 3px;text-transform:uppercase;letter-spacing:.5px;background:var(--bg);border-bottom:1px solid var(--line2);}
  .wsp-grp span{font-weight:600;opacity:.7;}
  .wsp-grp{cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;}
  .wsp-grp::before{content:"▾";display:inline-block;width:12px;opacity:.8;transition:transform .15s;}
  .wsp-grp.collapsed::before{transform:rotate(-90deg);}
  .wsp-grp.collapsed{opacity:.75;}
  .wsp-row{padding-top:3px !important;padding-bottom:3px !important;display:grid;grid-template-columns:7px minmax(0,1fr) 100px 46px;align-items:center;gap:6px;padding:4px 8px 4px 10px;border-bottom:1px solid var(--line2);}
  .wsp-row.called{background:var(--called);} .wsp-row.mine-call{background:var(--mine);}
  .wsp-flash{animation:wspFlash .9s infinite;}
  @keyframes wspFlash{50%{background:var(--flash);}}
  .wsp-dot{width:7px;height:7px;border-radius:50%;background:var(--faint);}
  .wsp-dot.Online{background:#3fb950;} .wsp-dot.Idle{background:#f0a500;}
  .wsp-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .wsp-name a{color:var(--text);text-decoration:none;font-weight:600;}
  .wsp-name small{color:var(--muted);opacity:.8;margin-left:3px;font-size:10px;}
  .wsp-name .wsp-hitmark{color:var(--hit);font-weight:600;opacity:1;}
  .wsp-name .wsp-caller{color:var(--caller);font-weight:600;opacity:1;}
  .wsp-call{border:none;background:none;padding:0 3px 0 0;font-size:12px;cursor:pointer;}
  .wsp-ff{font-size:10px;font-weight:700;text-align:center;border-radius:3px;padding:2px 0;}
  .wsp-ff.none{color:var(--faint);}
  .wsp-row.en{grid-template-columns:7px minmax(0,1fr) 40px 40px 92px 46px;gap:5px;}
  .wsp-ff.same{background:var(--pill);color:var(--muted);}
  .wsp-ff.live{box-shadow:inset 0 0 0 2px rgba(255,255,255,.85);}
  .wsp-ff.live.up::after{content:"\\25B2";font-size:7px;margin-left:1px;vertical-align:1px;}
  .wsp-ff.live.down::after{content:"\\25BC";font-size:7px;margin-left:1px;vertical-align:1px;}
  .wsp-colhead{position:sticky;top:0;z-index:2;background:var(--bg) !important;padding-top:4px !important;padding-bottom:3px !important;border-bottom:1px solid var(--line);}
  .wsp-colhead span{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);text-align:center;}
  .wsp-colhead span:nth-child(2){text-align:left;}
  .wsp-st{white-space:nowrap;overflow:hidden;font-weight:600;font-size:11.5px;}
  .wsp-st small{font-weight:600;color:var(--muted);font-size:10px;}
  .wsp-arrow{color:var(--arrow);font-weight:900;font-size:1.15em;}
  .wsp-atk{background:var(--attack);color:var(--attackText);border:none;border-radius:5px;padding:4px 0;font-weight:600;font-size:11px;cursor:pointer;}
  .wsp-atk.rev{background:var(--revive);}
  .wsp-hsum{padding:6px 10px;font-weight:600;background:var(--surface);border-bottom:1px solid var(--line);}
  .wsp-hrow{display:grid;grid-template-columns:36px minmax(0,1fr) 88px 48px;gap:6px;padding:4px 10px;border-bottom:1px solid var(--line2);align-items:center;}
  .wsp-hrow > span:first-child{color:var(--muted);}
  .wsp-hrow a{color:var(--text);font-weight:600;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .wsp-hrow .r{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;}
  .wsp-hrow .p{text-align:right;font-weight:600;color:var(--ok);}
  .wsp-msg{padding:14px;color:var(--muted);text-align:center;}
  .wsp-msg input,.wsp-set input,.wsp-set select{background:var(--bg);color:var(--text);}
  .wsp-msg input{width:110px;padding:5px;margin:6px;border:1px solid var(--line);border-radius:5px;}
  .wsp-msg button,.wsp-actions button,.wsp-mini{padding:6px 12px;border:none;border-radius:6px;background:var(--pill);color:var(--text);font-weight:600;}
  .wsp-msg button,.wsp-actions button.pri{background:var(--accent);color:#fff;}
  .wsp-set{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line2);}
  .wsp-set input[type=checkbox]{accent-color:var(--accent);}
  .wsp-set.wide{flex-direction:column;align-items:stretch;gap:4px;}
  .wsp-set input[type=text],.wsp-set input[type=password],.wsp-set input:not([type]),.wsp-set select,.wsp-set input[type=number]{padding:5px;border:1px solid var(--line);border-radius:5px;font-size:13px;}
  .wsp-actions{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;}
  .wsp-help{font-size:11px;color:var(--muted);padding:0 12px 8px;}
  /* ---------- War room styling ---------- */
  .wsp-theme.dark{--cond:"DIN Condensed","DIN Alternate","Bahnschrift","Roboto Condensed","Arial Narrow","DejaVu Sans Condensed",sans-serif;
    --num:"DIN Alternate","Bahnschrift","Roboto Condensed","DejaVu Sans Condensed",-apple-system,sans-serif;}
  #wsp-panel.dark{border:1px solid rgba(255,176,0,.28);border-left:none;border-radius:0 6px 6px 0;
    background-color:var(--bg);
    background-image:linear-gradient(rgba(255,176,0,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,176,0,.03) 1px,transparent 1px);
    background-size:18px 18px;}
  #wsp-panel.dark #wsp-head{border-bottom:1px solid rgba(255,176,0,.45);
    background:repeating-linear-gradient(0deg,rgba(255,255,255,.018) 0 1px,transparent 1px 3px),linear-gradient(135deg,var(--head2),var(--head));}
  #wsp-panel.dark #wsp-title{font-family:var(--cond);font-size:14px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;}
  #wsp-panel.dark .wsp-frow .s{font-family:var(--num);font-size:14px;letter-spacing:.3px;}
  #wsp-panel.dark .wsp-frow .c{font-family:var(--num);font-size:12px;letter-spacing:.3px;}
  #wsp-panel.dark .wsp-frow.us .n{color:var(--accent);}
  #wsp-panel.dark .wsp-frow .c.hot{box-shadow:0 0 10px rgba(255,59,59,.7);}
  #wsp-panel.dark #wsp-sub{font-family:var(--num);letter-spacing:.4px;color:var(--accent);opacity:.85;text-transform:uppercase;font-size:10.5px;}
  #wsp-panel.dark #wsp-dock{font-family:var(--cond);font-size:13px !important;letter-spacing:.8px;text-transform:uppercase;
    background:transparent !important;border:1px solid rgba(255,176,0,.55) !important;color:var(--accent);border-radius:3px;}
  #wsp-panel.dark #wsp-bars{font-family:var(--num);font-size:12px;letter-spacing:.3px;background:rgba(19,25,21,.92);}
  #wsp-panel.dark #wsp-bars .wsp-chain{font-family:var(--cond);font-size:13px;letter-spacing:.6px;border:1px solid var(--line);border-radius:3px;}
  #wsp-panel.dark #wsp-bars .wsp-chain.hot{box-shadow:0 0 10px rgba(255,59,59,.7);border-color:var(--hot);}
  #wsp-panel.dark #wsp-tabs{background:rgba(12,16,14,.92);}
  #wsp-panel.dark #wsp-tabs div{font-family:var(--cond);font-size:12.5px;letter-spacing:1px;text-transform:uppercase;padding:7px 4px 4px;}
  #wsp-panel.dark #wsp-tabs div.on{text-shadow:0 0 8px rgba(255,176,0,.5);}
  #wsp-panel.dark .wsp-grp{font-family:var(--cond);font-size:11px;letter-spacing:1.1px;color:var(--accent);
    background:linear-gradient(90deg,rgba(255,176,0,.09),transparent 70%);border-left:2px solid var(--accent);padding:6px 10px 3px 8px;}
  #wsp-panel.dark .wsp-grp::before{content:"▾";opacity:.9;}
  #wsp-panel.dark .wsp-grp span{color:var(--muted);}
  #wsp-panel.dark .wsp-ccols .h{font-family:var(--cond);font-size:12px;letter-spacing:1px;color:var(--accent);}
  #wsp-panel.dark .wsp-crow{background:rgba(12,16,14,.72);}
  #wsp-panel.dark .wsp-crow .v,#wsp-panel.dark .wsp-crow .s{font-family:var(--num);}
  #wsp-panel.dark .wsp-cbar button{font-family:var(--cond);font-size:14px;letter-spacing:.8px;text-transform:uppercase;border-radius:3px;}
  #wsp-panel.dark #wsp-bonus div{font-family:var(--cond);font-size:13px;letter-spacing:.8px;text-transform:uppercase;}
  #wsp-panel.dark .wsp-next .lbl{font-family:var(--cond);font-size:12px;letter-spacing:1px;color:var(--accent);}
  #wsp-panel.dark .wsp-chip{font-family:var(--num);border-color:rgba(255,176,0,.35);background:transparent;border-radius:3px;}
  #wsp-panel.dark .wsp-grp[data-key="enemy:-1"]{color:#ff5252;border-left-color:#ff5252;background:linear-gradient(90deg,rgba(255,59,59,.16),transparent 70%);}
  #wsp-panel.dark .wsp-row{background:rgba(12,16,14,.72);grid-template-columns:7px minmax(0,1fr) 98px 56px;}
  #wsp-panel.dark .wsp-row.en{grid-template-columns:7px minmax(0,1fr) 40px 40px 90px 54px;}
  #wsp-panel.dark .wsp-colhead span{font-family:var(--cond);font-size:11px;letter-spacing:1px;color:var(--accent);}
  #wsp-panel.dark .wsp-row.called{background:var(--called);} #wsp-panel.dark .wsp-row.mine-call{background:var(--mine);}
  #wsp-panel.dark .wsp-name a{letter-spacing:.2px;}
  #wsp-panel.dark .wsp-dot.Online{background:#3dff7a;box-shadow:0 0 6px #3dff7a;}
  #wsp-panel.dark .wsp-dot.Idle{background:#ffb000;box-shadow:0 0 5px rgba(255,176,0,.8);}
  #wsp-panel.dark .wsp-st{font-family:var(--num);font-size:12px;letter-spacing:.2px;}
  #wsp-panel.dark .wsp-st small{font-family:var(--num);}
  #wsp-panel.dark .wsp-ff{font-family:var(--num);font-size:11px;border-radius:2px;}
  #wsp-panel.dark .wsp-atk{font-family:var(--cond);font-size:12px;letter-spacing:.5px;overflow:hidden;white-space:nowrap;text-transform:uppercase;padding:4px 0 3px;border-radius:3px;
    background:linear-gradient(180deg,#d63131,#8f1515);border:1px solid rgba(255,90,90,.55);box-shadow:0 0 6px rgba(198,40,40,.35);}
  #wsp-panel.dark .wsp-atk.rev{background:linear-gradient(180deg,#24a55a,#136b38);border-color:rgba(75,227,127,.5);box-shadow:none;}
  #wsp-panel.dark .wsp-hsum{font-family:var(--cond);font-size:14px;letter-spacing:.8px;text-transform:uppercase;color:var(--accent);}
  #wsp-panel.dark .wsp-hrow{background:rgba(12,16,14,.72);font-family:var(--num);}
  #wsp-panel.dark .wsp-actions button.pri,#wsp-panel.dark .wsp-msg button{color:#111;}
  #wsp-btn.dark{border:1px solid rgba(255,176,0,.55);border-left:none;border-radius:0 6px 6px 0;box-shadow:0 0 12px rgba(255,176,0,.25),2px 2px 10px var(--shadow);}
  .wsp-toast.dark,#wsp-toasts.dark .wsp-toast{font-family:var(--cond);font-size:15px;letter-spacing:.8px;text-transform:uppercase;border-radius:3px;
    border:1px solid rgba(255,176,0,.4);border-left:4px solid var(--accent);}
  #wsp-toasts.dark .wsp-toast.urgent{border-color:rgba(255,59,59,.6);border-left-color:var(--hot);box-shadow:0 0 14px rgba(255,59,59,.45);}
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'wsp-panel';
  panel.innerHTML = `
    <div id="wsp-head">
      <div id="wsp-title">⚔️ JSim War Station Plus</div>
      <div class="wsp-hbar">
        <div id="wsp-sub"></div>
        <button id="wsp-ref" title="Refresh">⟳</button>
        <button data-act="ffkey" title="FFScouter key">🔑</button>
        <button data-act="settings" title="Settings">⚙️</button>
        <button id="wsp-dock" title="Dock">◀ Dock</button>
      </div>
    </div>
    <div id="wsp-bonus"></div>
    <div id="wsp-bars"><span id="wsp-barsv"></span>
      <span class="wsp-quick"><button data-act="armoury" title="Faction armoury – medical">${MEDBOX}</button><button data-act="drug" data-d="xanax" title="Take a Xanax from the armoury"><span class="wsp-pb">${PILL_X}<small>XAN</small></span></button><button data-act="drug" data-d="vicodin" title="Take a Vicodin from the armoury"><span class="wsp-pb">${PILL_V}<small>VIC</small></span></button><button data-act="travel" title="Travel agency">✈️</button></span></div>
    <div id="wsp-tabs">
      <div data-act="tab" data-tab="enemy">Enemy</div>
      <div data-act="tab" data-tab="mine">Ours</div>
      <div data-act="tab" data-tab="hits" id="wsp-tab-hits">Hits</div>
    </div>
    <div id="wsp-list"></div>`;
  const $ = id => panel.querySelector('#' + id);

  const btn = document.createElement('button');
  btn.id = 'wsp-btn';
  btn.type = 'button';
  btn.textContent = '⚔️';

  /* ---------- Faction armoury: highlight your preferred medication ---------- */
  const MED_NAMES = { '': 'None', blood: 'Blood bag', morphine: 'Morphine', fak: 'First Aid Kit', sfak: 'Small First Aid Kit', ipecac: 'Ipecac Syrup', neumune: 'Neumune Tablet' };
  const BLOOD_OK = { // your type -> bags you can safely use
    'O-': ['O-'], 'O+': ['O+', 'O-'], 'A-': ['A-', 'O-'], 'A+': ['A+', 'A-', 'O+', 'O-'],
    'B-': ['B-', 'O-'], 'B+': ['B+', 'B-', 'O+', 'O-'], 'AB-': ['AB-', 'A-', 'B-', 'O-'],
    'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-']
  };
  function medKind(text) {
    const t = text.toLowerCase();
    if (/irradiated|empty blood/.test(t)) return null;
    const m = t.match(/blood bag\s*:?\s*(ab|a|b|o)\s*([+-])/);
    if (m) return { kind: 'blood', type: m[1].toUpperCase() + m[2] };
    if (t.includes('small first aid kit')) return { kind: 'sfak' };
    if (t.includes('first aid kit')) return { kind: 'fak' };
    if (t.includes('morphine')) return { kind: 'morphine' };
    if (t.includes('ipecac')) return { kind: 'ipecac' };
    if (t.includes('neumune')) return { kind: 'neumune' };
    if (/\bxanax\b/.test(t)) return { kind: 'xanax' };
    if (/\bvicodin\b/.test(t)) return { kind: 'vicodin' };
    return null;
  }
  // The armoury / travel helper bars only appear when you got there through the panel's buttons.
  // The flag survives the page load (2 minutes to arrive) and is dropped once you leave that page.
  const via = { med: false, trip: false };
  ['med', 'trip'].forEach(k => {
    if (Date.now() - load('wsp_via_' + k, 0) < 120000) via[k] = true;
    try { localStorage.removeItem('wsp_via_' + k); } catch (e) { /* ignore */ }
  });
  const viaAt = { med: via.med ? Date.now() : 0, trip: via.trip ? Date.now() : 0 };
  let ourNav = via.med || via.trip ? Date.now() + 4000 : 0; // grace while Torn settles the page we sent you to
  function arm(k) { via[k] = true; viaAt[k] = Date.now(); ourNav = Date.now(); save('wsp_via_' + k, Date.now()); if (k === 'med') save('wsp_want', want); }
  // What the armoury bar is after: your medical item (Settings), or a Xanax / Vicodin from the drug buttons
  const DRUG_NAMES = { xanax: 'Xanax', vicodin: 'Vicodin' };
  let want = via.med ? load('wsp_want', '') : '';
  const curWant = () => want || cfg.med;
  const isDrug = w => !!DRUG_NAMES[w];
  const wantSub = () => (isDrug(curWant()) ? 'drugs' : 'medical');
  const wantName = w => DRUG_NAMES[w] || MED_NAMES[w];
  const disarm = () => { via.med = false; via.trip = false; };
  // Anything other than our own buttons drops the bars: Torn links (hash or history changes), back/forward,
  // a page restored from cache, switching away for a while, or 3 minutes without using the bar.
  const isArm = u => /factions\.php/.test(u) && /#.*armou?ry/i.test(u);
  window.addEventListener('hashchange', e => {
    if (Date.now() - ourNav < 2000) return;
    // left the armoury, or arrived at it from another faction tab by yourself
    if (!isArm(e.newURL || location.href) || !isArm(e.oldURL || '')) via.med = false;
  });
  window.addEventListener('popstate', () => { if (Date.now() - ourNav > 2000) disarm(); });
  window.addEventListener('pageshow', e => { if (e.persisted) disarm(); });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 30000) disarm();
  });
  setInterval(() => { ['med', 'trip'].forEach(k => { if (via[k] && Date.now() - viaAt[k] > 180000) via[k] = false; }); }, 5000);
  const medbar = document.createElement('div');
  medbar.id = 'wsp-medbar';
  medbar.innerHTML = '<span id="wsp-medlbl"></span><button id="wsp-medgo" type="button">⚙️ Cog</button>';
  const medLbl = medbar.firstChild, medGo = medbar.lastChild;
  let medScrolled = false, medTarget = null;
  const onArmouryPage = () => /factions\.php/.test(location.href) && /armou?ry/i.test(location.hash);

  // ---- Stepped Meds button: every tap does ONE thing (cog -> Use -> Yes) on the item you picked ----
  const ours = el => panel.contains(el) || medbar.contains(el) || toasts.contains(el);
  const vis = el => !!el && !ours(el) && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
    getComputedStyle(el).visibility !== 'hidden';
  const txt = el => ((el.value || el.textContent || el.getAttribute('aria-label') || '') + '').trim();
  const CLICKY = 'button, a, input[type=button], input[type=submit], [role=button], span, div, i';
  function findText(root, re, ok) {
    if (!root) return null;
    const list = root.querySelectorAll(CLICKY);
    for (const el of list) {
      if (!vis(el) || !re.test(txt(el)) || (ok && !ok(el))) continue;
      let best = el, kid; // drill down to the innermost element with that text (that's where Torn's handler sits)
      while ((kid = [...best.children].find(c => vis(c) && re.test(txt(c))))) best = kid;
      return best.closest('button, a, [role=button]') || best;
    }
    return null;
  }
  // Score every likely control in the row: real cog/gear words win, icon-only buttons next, big containers lose
  const COG_STRONG = /cog|gear|setting/i, COG_WEAK = /option|manage|more|dots|menu|action|toggle|dropdown|expand/i;
  function findCog(row) {
    if (!row) return null;
    const name = ((row.querySelector('[class*="name"]') || {}).textContent || '').trim();
    let best = null, bestScore = 0;
    row.querySelectorAll('button, a, i, span, div, svg, img, [role=button]').forEach(el => {
      if (!vis(el)) return;
      const hint = [el.getAttribute('class'), el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-title'),
        el.getAttribute('src'), el.getAttribute('href'), el.id].join(' ');
      const text = (el.textContent || '').trim();
      let sc = 0;
      if (COG_STRONG.test(hint)) sc += 6; else if (COG_WEAK.test(hint)) sc += 2;
      if (/^(button|a)$/i.test(el.tagName) || el.getAttribute('role') === 'button') sc += 2;
      if (!text) sc += 2;                          // icons have no text
      if (/icon|btn|button/i.test(hint)) sc += 1;
      if (el.onclick || getComputedStyle(el).cursor === 'pointer') sc += 2;
      if (text && /^[\u2699\u22ee\u2026.\s]+$/.test(text)) sc += 4; // a cog / dots character
      if (name && text.includes(name)) sc -= 8;    // whole-row containers
      if (el.querySelectorAll('*').length > 6) sc -= 4;
      if (sc > bestScore || (sc === bestScore && sc > 0)) { best = el; bestScore = sc; } // ties: the later one (cogs sit at the end of a row)
    });
    if (!best || bestScore < 4) return null;
    if (/^(svg|path|use|img)$/i.test(best.tagName) || !/^(button|a)$/i.test(best.tagName)) {
      const up = best.closest('button, a, [role=button]');
      if (up && row.contains(up)) best = up;
    }
    return best;
  }
  let cogTry = null;
  function medNext() {
    if (!onArmouryPage() || !new RegExp('sub=' + wantSub(), 'i').test(location.hash)) return { kind: 'go' };
    const row = medTarget && medTarget.isConnected ? medTarget : null;
    if (!row) return { kind: 'none' };
    const area = (row && row.closest('ul')) ? row.closest('ul').parentElement : document.body;
    const yes = findText(row, /^(yes|confirm)$/i) || findText(area, /^(yes|confirm)$/i) || findText(document.body, /^(yes|confirm)$/i);
    if (yes) return { kind: 'yes', el: yes };
    let use = findText(row, /^use$/i);
    if (!use && row && row.nextElementSibling && !medKind((row.nextElementSibling.textContent || '').slice(0, 300)) && !/x\s?\d/i.test(row.nextElementSibling.textContent || '')) use = findText(row.nextElementSibling, /^use$/i);
    // a Use button outside the row is only OK if it doesn't belong to a different item's row
    if (!use) use = findText(area, /^use$/i, el => { const li = el.closest('li'); return !li || li === row || li.contains(row) || !medKind((li.textContent || '').slice(0, 300)); });
    if (use) return { kind: 'use', el: use };
    const cog = findCog(row);
    return cog ? { kind: 'cog', el: cog } : { kind: 'nocog' };
  }
  const MED_STEP_LABEL = { go: '\u27a1\ufe0f Go', yes: '\u2705 Yes', use: '\u{1F489} Use', cog: '\u2699\ufe0f Cog', none: '\u2014', nocog: '\u2699\ufe0f ?' };
  function press(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(t => {
      try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) { /* ignore */ }
    });
    el.click();
  }
  function medStep(w) {
    w = w || '';
    if (w !== want) { want = w; medTarget = null; medScrolled = false; if (via.med && onArmouryPage() && new RegExp('sub=' + wantSub(), 'i').test(location.hash)) { arm('med'); highlightArmoury(); return; } }
    if (!curWant()) { toast('\u26d1\ufe0f Pick your medical item in \u2699\ufe0f Settings first'); return; }
    if (via.med) viaAt.med = Date.now();
    if (!via.med && onArmouryPage() && new RegExp('sub=' + wantSub(), 'i').test(location.hash)) { arm('med'); medScrolled = false; highlightArmoury(); return; }
    const n = medNext();
    if (n.kind === 'go') {
      arm('med');
      location.href = 'https://www.torn.com/factions.php?step=your#/tab=armoury&start=0&sub=' + wantSub();
      medScrolled = false;
      return;
    }
    if (n.el) {
      press(n.el);
      setTimeout(highlightArmoury, 250);
      if (n.kind === 'cog') {
        cogTry = { el: n.el, row: medTarget };
        setTimeout(() => {
          if (medNext().kind === 'cog' && cogTry) copyToast('\u26a0\ufe0f The cog did not open.');
        }, 1500);
      }
      return;
    }
    if (n.kind === 'none') { toast(`No ${wantName(curWant())} found here`); return; }
    cogTry = { el: null, row: medTarget };
    copyToast('\u26a0\ufe0f Could not find the cog.');
  }
  function copyToast(msg, what) {
    const t = document.createElement('div');
    t.className = 'wsp-toast';
    t.dataset.copy = '1';
    t.textContent = msg + ` Tap this message to copy the ${what || 'item\'s'} code, then paste it to Claude.`;
    toasts.appendChild(t);
    setTimeout(() => t.remove(), 15000);
  }

  // ---- Stepped Travel button: pick country + method in the panel, then each tap does ONE thing on the travel page ----
  const travbar = document.createElement('div');
  travbar.id = 'wsp-travbar';
  travbar.innerHTML = '<span id="wsp-travlbl"></span><button id="wsp-travgo" type="button">\u2708\ufe0f</button>';
  const travLbl = travbar.firstChild, travGo = travbar.lastChild;
  S.tstep = 0;
  const onTravelPage = () => /sid=travel/i.test(location.href);
  const CRE = {
    'Mexico': 'Mexico', 'Cayman Islands': 'Cayman', 'Canada': 'Canada', 'Hawaii': 'Hawaii', 'United Kingdom': 'United Kingdom|UK',
    'Argentina': 'Argentina', 'Switzerland': 'Switzerland', 'Japan': 'Japan', 'China': 'China', 'UAE': 'UAE|United Arab Emirates|Dubai',
    'South Africa': 'South Africa'
  };
  const MRE = { std: /^standard/i, air: /^airstrip/i, wlt: /^(private|wlt)/i, bct: /^business/i };
  const navLike = el => !!el.closest('#sidebarroot, #chatRoot, #sidebar, [class*="sidebar"], nav, #header-root, [class*="header-wrapper"], [class*="headerWrapper"]');
  function findIn(sel, re) {
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el) || navLike(el) || !re.test(txt(el))) continue;
      let best = el, kid;
      while ((kid = [...best.children].find(c => vis(c) && re.test(txt(c))))) best = kid;
      return best.closest('button, a, label, [role=button], [role=radio], [role=tab], li') || best;
    }
    return null;
  }
  const TEXTY = 'button, a, label, [role=button], [role=radio], [role=tab], li, span, div, p, strong';
  // Torn's travel agency (2025+ layout): map pins for countries, a drop-down for the flight type, then the Travel button.
  // Reads what is already selected, so steps that are already right get skipped.
  const MNAME = { std: 'Standard', air: 'Airstrip', wlt: 'Private', bct: 'Business' };
  const norm = x => (x || '').replace(/\s+/g, ' ').trim().toLowerCase();
  function tornTrip(tr) {
    const root = document.querySelector('[class*="flightSelector"]');
    if (!root || !(root.querySelector('[class*="destDropdownToggler"]') || document.querySelector('button[class*="pin___"]'))) return null;
    const want = norm(tr.to);
    const destVal = root.querySelector('[class*="destDropdownToggler"] [class*="fromToValue"]');
    if (!destVal || norm(destVal.textContent) !== want) {
      const pin = [...document.querySelectorAll('button[class*="pin___"]')].find(b => norm(b.getAttribute('aria-label')) === want && vis(b));
      if (pin) return { kind: 'country', el: pin };
      const dd = root.querySelector('[class*="destDropdownToggler"]');
      const opt = [...root.querySelectorAll('[class*="destDropdown"] li[role=option]')].find(li => norm(li.textContent).endsWith(want));
      if (dd && dd.getAttribute('aria-expanded') === 'true' && opt) return { kind: 'country', el: opt };
      if (dd) return { kind: 'open', el: dd };
      return { kind: 'nocountry' };
    }
    const wantM = norm(MNAME[tr.m || 'std']);
    const cur = root.querySelector('[class*="flightTypeToggle"] [class*="label___"]');
    if (cur && norm(cur.textContent) !== wantM) {
      const tg = root.querySelector('[class*="flightTypeToggle"]');
      const opt = [...root.querySelectorAll('[class*="flightType"] li[role=option]')]
        .find(li => norm((li.querySelector('[class*="label___"]') || li).textContent) === wantM);
      if (!opt || opt.getAttribute('aria-disabled') === 'true') return { kind: 'nomethod' };
      if (tg && tg.getAttribute('aria-expanded') === 'true') return { kind: 'method', el: opt };
      if (tg) return { kind: 'mopen', el: tg };
    }
    const btn = [...document.querySelectorAll('[class*="departPanel"] button, [class*="departPanel"] a')].find(b => /^travel$/i.test(norm(b.textContent)) && vis(b));
    if (btn) return { kind: 'travel', el: btn };
    return null;
  }
  function tripNext() {
    const tr = cfg.trip || {};
    if (!onTravelPage()) return { kind: 'go' };
    if (!tr.to) return { kind: 'pick' };
    if (/you are (currently )?travel|you are flying|in flight|landing in/i.test((document.body.innerText || '').slice(0, 4000))) return { kind: 'done' };
    if (S.tstep >= 2) {
      const yes = findIn('button, a, [role=button]', /^(yes|confirm|continue)$/i);
      if (yes) return { kind: 'yes', el: yes };
    }
    const tt = tornTrip(tr);
    if (tt) return tt;
    if (S.tstep >= 3) return { kind: 'done' };
    if (S.tstep <= 0) {
      const re = new RegExp('^\\W*(' + CRE[tr.to] + ')(\\s*$|\\W*\\d)', 'i');
      const area = document.querySelector('[class*="flightSelector"]') || document;
      // a native drop-down: choosing the option is the one action
      for (const sel of area.querySelectorAll('select')) {
        const o = [...sel.options].find(op => re.test(op.textContent.trim()));
        if (o && vis(sel)) return { kind: 'country', sel, opt: o };
      }
      const c = findIn(TEXTY, re);
      if (c) return { kind: 'country', el: c };
      // a custom drop-down that is still closed: open it first
      let dd = null;
      if (area !== document) for (const q of ['[aria-haspopup]', '[role=combobox]', 'button[aria-expanded="false"]', '[class*="dropdown" i] button', '[class*="select" i] button', '[class*="to___"] button', '[class*="to___"]']) {
        dd = [...area.querySelectorAll(q)].find(el => vis(el) && !navLike(el));
        if (dd) break;
      }
      return dd && area !== document ? { kind: 'open', el: dd } : { kind: 'nocountry' };
    }
    if (S.tstep === 1) {
      const m = findIn(TEXTY, MRE[tr.m || 'std']);
      if (m) return { kind: 'method', el: m };
    }
    const t = findIn('button, input[type=submit], input[type=button], [role=button]', /^(travel|fly|book|depart|take off)\b/i) ||
      findIn('a', /^(travel|fly)( now)?$/i);
    if (t) return { kind: 'travel', el: t };
    return { kind: S.tstep >= 3 ? 'done' : 'notravel' };
  }
  const TRIP_LABEL = { open: '\u{1F30D} List', mopen: '\u{1F6EB} Method', nomethod: '\u26a0\ufe0f Method', go: '\u2708\ufe0f Go', pick: '\u2708\ufe0f Pick', country: '\u{1F30D} Country', nocountry: '\u{1F30D} ?',
    method: '\u{1F6EB} Pick', travel: '\u2708\ufe0f Travel', notravel: '\u2708\ufe0f ?', yes: '\u2705 Yes', done: '\u2714\ufe0f' };
  function tripStep() {
    if (via.trip) viaAt.trip = Date.now();
    const n = tripNext();
    if (n.kind === 'go' || n.kind === 'pick') { S.view = 'trip'; toggle(true); S.dirty = true; render(); return; }
    if (n.sel) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(n.sel, n.opt.value);
      n.sel.dispatchEvent(new Event('input', { bubbles: true }));
      n.sel.dispatchEvent(new Event('change', { bubbles: true }));
      S.tstep = 1;
      setTimeout(highlightTravel, 300);
      return;
    }
    if (n.el) {
      press(n.el);
      S.tstep = n.kind === 'open' || n.kind === 'mopen' ? S.tstep : n.kind === 'country' ? 1 : n.kind === 'method' ? 2 : n.kind === 'travel' ? 3 : n.kind === 'yes' ? 4 : S.tstep;
      setTimeout(highlightTravel, 300);
      return;
    }
    if (n.kind === 'nomethod') {
      toast(`\u26a0\ufe0f ${MNAME[cfg.trip.m || 'std']} isn't available to you. Pick another way to fly.`);
      S.view = 'trip'; toggle(true); S.dirty = true; render();
      return;
    }
    if (n.kind === 'done') { toast('\u2708\ufe0f On your way (tap the bar label to start over)'); return; }
    cogTry = { el: null, row: travelRoot(), limit: 15000 };
    copyToast(n.kind === 'nocountry' ? `\u26a0\ufe0f Could not find ${cfg.trip.to}.` : '\u26a0\ufe0f Could not find the Travel button.', 'travel page');
  }
  // The smallest part of the page that lists most of the destinations (for the copy-the-code helper)
  function travelRoot() {
    const fs = document.querySelector('[class*="flightSelector"]');
    if (fs) return fs.parentElement || fs;
    const names = Object.values(CRE).map(r => new RegExp(r, 'i'));
    let best = null;
    document.querySelectorAll('div, ul, section, main').forEach(el => {
      if (ours(el) || navLike(el) || el.closest('#sidebarroot, #chatRoot')) return;
      const t = el.textContent || '';
      if (names.filter(r => r.test(t)).length >= 6 && (!best || best.contains(el))) best = el;
    });
    const area = best ? (best.parentElement && best.parentElement.parentElement) || best : null;
    return area || document.querySelector('.content-wrapper, #mainContainer, main') || document.body;
  }
  let travHref = '';
  function highlightTravel() {
    if (!onTravelPage()) via.trip = false;
    if (!onTravelPage() || !(cfg.trip && cfg.trip.to) || !via.trip) { travbar.classList.remove('on'); travHref = ''; return; }
    if (!travbar.isConnected) document.body.appendChild(travbar);
    if (travHref !== location.href) { travHref = location.href; S.tstep = 0; }
    const tr = cfg.trip;
    const lbl = `${FLAGS[tr.to] || ''} <span class="k">${SHORT[tr.to] || tr.to}</span> \u00b7 ${FLIGHT_SHORT[tr.m || 'std']} <span class="st">\u00b7 ${S.tstep > 0 ? 'step ' + (S.tstep + 1) : 'tap \u2192'}</span>`;
    if (travLbl.innerHTML !== lbl) travLbl.innerHTML = lbl;
    const st = TRIP_LABEL[tripNext().kind];
    if (travGo.textContent !== st) travGo.textContent = st;
    travbar.classList.add('on');
  }
  function tripHTML() {
    const tr = cfg.trip || {};
    const m = tr.m || cfg.flight || 'std';
    const dur = c => { const mins = Math.round(FT[c] * FACT[m]); return Math.floor(mins / 60) + 'h' + String(mins % 60).padStart(2, '0'); };
    return `<div class="wsp-trip">
      <h4>Where to?</h4><div class="g">${Object.keys(FT).map(c => `<button data-act="tcountry" data-c="${c}" class="${tr.to === c ? 'on' : ''}">${FLAGS[c]} ${SHORT[c]}<small>${dur(c)} one way</small></button>`).join('')}</div>
      <h4>How?</h4><div class="g">${Object.keys(FLIGHT_SHORT).map(k => `<button data-act="tmethod" data-m="${k}" class="${m === k ? 'on' : ''}">${FLIGHT_SHORT[k]}</button>`).join('')}</div>
      <div class="go"><button data-act="tback">Cancel</button><button data-act="tgo" class="main" ${tr.to ? '' : 'disabled style="opacity:.5"'}>\u2708\ufe0f ${tr.to ? 'Go to ' + tr.to : 'Pick a country'}</button></div>
      <div class="wsp-help" style="padding:10px 0 0">On the travel page, tap the button at the top once per step: country, method, Travel, then Yes if Torn asks. Each tap does one thing.</div>
    </div>`;
  }
  function highlightArmoury() {
    const onArmoury = onArmouryPage();
    const W = curWant();
    if (!onArmoury) via.med = false;
    if (!onArmoury || !W || !via.med) {
      medbar.classList.remove('on');
      document.querySelectorAll('.wsp-med-pref, .wsp-med-ok').forEach(li => li.classList.remove('wsp-med-pref', 'wsp-med-ok'));
      medScrolled = false;
      return;
    }
    if (!medbar.isConnected) document.body.appendChild(medbar);
    const okTypes = W === 'blood' ? (BLOOD_OK[cfg.blood] || null) : null;
    let label = `${isDrug(W) ? LEAF : MEDBOX.replace('class="wsp-box"', 'class="wsp-box" style="display:inline;vertical-align:-.25em;width:1.2em;height:1.1em"')} Looking for <span class="k">${wantName(W)}${W === 'blood' && cfg.blood ? ' ' + cfg.blood : ''}</span>`;
    if (isDrug(W) && S.cd) {
      const left = S.cd.drug - (Date.now() - S.uAt) / 1000;
      if (left > 0) label += ` \u00b7 <span style="color:#ff5a5a">drug cooldown ${fmt(left)}</span>`;
    }
    if (!isDrug(W) && S.cd) {
      const over = S.cd.medical - (Date.now() - S.uAt) / 1000 - medCap();
      if (over >= 0) label += ` \u00b7 <span style="color:#ff5a5a">medical cooldown full, wait ${fmt(over)}</span>`;
    }
    if (W === 'blood') {
      const extra = okTypes ? okTypes.filter(t => t !== cfg.blood) : null;
      label += okTypes ? (extra.length ? ` · also safe: <span class="o">${extra.join(', ')}</span>` : ' · only your own type is safe')
                       : ' · set your blood type in ⚙️ Settings';
    }

    let items = document.querySelectorAll('[id*="armoury"] li, [class*="armoury"] li, [id*="armory"] li, [class*="armory"] li');
    if (!items.length) items = document.querySelectorAll('li');
    let first = null, firstRank = 1e9, firstType = '', count = 0;
    items.forEach(li => {
      if (panel.contains(li) || li.querySelector('li')) return; // skip our panel and container rows
      const k = medKind((li.textContent || '').slice(0, 300));
      let cls = '';
      if (k && W === 'blood' && k.kind === 'blood') {
        if (k.type === cfg.blood) cls = 'pref';
        else if (!okTypes || okTypes.includes(k.type)) cls = 'ok'; // no blood type set: show every bag
      } else if (k && k.kind === W) cls = 'pref';
      li.classList.toggle('wsp-med-pref', cls === 'pref');
      li.classList.toggle('wsp-med-ok', cls === 'ok');
      if (cls) {
        count++;
        // your own type first; otherwise the closest safe type, keeping O- (everyone's backup) for last
        const rank = cls === 'pref' ? -1 : (okTypes ? okTypes.indexOf(k.type) : 50);
        if (rank < firstRank) { first = li; firstRank = rank; firstType = k.type || ''; }
      }
    });
    if (W === 'blood' && cfg.blood && first && firstRank >= 0) label += ` \u00b7 none of yours, using <span class="o">${firstType}</span>`;
    if (!count && W === 'blood' && cfg.blood && [...items].some(li => /blood bag/i.test(li.textContent || ''))) label += ' · <span style="color:#ff5a5a">no safe bag here</span>';
    else if (!count && items.length > 5) label += ' · <span style="opacity:.7">none found</span>';
    medTarget = first;
    if (medLbl.innerHTML !== label) medLbl.innerHTML = label;
    const step = MED_STEP_LABEL[medNext().kind];
    if (medGo.textContent !== step) medGo.textContent = step;
    medbar.classList.add('on');
    if (first && !medScrolled) { medScrolled = true; first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  [panel, btn, toasts, medbar, travbar].forEach(el => el.classList.add('wsp-theme'));
  function applyTheme() {
    const dark = cfg.theme === 'war' || cfg.theme === 'dark' || (cfg.theme === 'auto' &&
      (document.body.classList.contains('dark-mode') ||
       (!document.body.classList.contains('light-mode') && document.documentElement.classList.contains('dark-mode'))));
    [panel, btn, toasts, medbar, travbar].forEach(el => el.classList.toggle('dark', dark));
  }
  applyTheme();

  // Keep Torn's chat in front of the panel. Lifting the chat's root as one layer keeps its own windows in their usual order.
  let chatChecked = 0;
  function liftChat() {
    if (Date.now() - chatChecked < 3000) return;
    chatChecked = Date.now();
    const root = document.getElementById('chatRoot') || document.getElementById('chat-root');
    if (!root) return;
    if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
    if (root.style.zIndex !== '2147483640') root.style.setProperty('z-index', '2147483640', 'important');
  }

  function ensureAttached() {
    liftChat();
    if (!panel.isConnected) document.body.appendChild(panel);
    if (!toasts.isConnected) document.body.appendChild(toasts);
    if (!btn.isConnected) document.body.appendChild(btn);
  }
  ensureAttached();

  function toggle(force) {
    S.open = force === undefined ? !S.open : force;
    panel.classList.toggle('open', S.open);
    btn.classList.toggle('hide', S.open);
    btn.classList.remove('alert');
    toasts.classList.toggle('top', S.open); // keep alerts clear of the open panel
    if (S.open) {
      S.dirty = true;
      render();
      if (Date.now() - S.at > REFRESH_MS) refresh();
      if (cfg.callsUrl) loadCalls();
    }
  }

  // Tab / dock / refresh / toast taps are caught at document level so the page can't swallow them
  const ACTIONS = {
    '#wsp-btn': () => toggle(true),
    '#wsp-dock': () => toggle(false),
    '#wsp-ref': () => { refresh(); if (cfg.callsUrl) loadCalls(); },
    '.wsp-toast': el => {
      el.remove();
      if (el.dataset.reload) { location.reload(); return; }
      if (!el.dataset.copy) { toggle(true); return; }
      const row = cogTry && cogTry.row;
      if (!row) return;
      if (cogTry.el && cogTry.el.setAttribute) cogTry.el.setAttribute('data-wsp-tapped', '1');
      const c = row.cloneNode(true);
      c.querySelectorAll('script, style, noscript, svg, #wsp-panel, #wsp-toasts, #wsp-medbar, #wsp-travbar, #sidebarroot, #sidebar, #header-root, #chatRoot, [class*="chat-box"], #topRoot, footer, #websocketConnectionData, [class*="appHeaderWrapper"], [class*="inventoryPanel"], [class*="itemControls"], link').forEach(x => x.remove());
      c.querySelectorAll('*').forEach(x => { ['style', 'tabindex', 'data-is-tooltip-opened', 'srcset'].forEach(a => x.removeAttribute(a)); });
      const html = c.outerHTML.replace(/\s+/g, ' ').replace(/[^\x20-\x7e]/g, '?').slice(0, cogTry.limit || 5000);
      if (cogTry.el && cogTry.el.removeAttribute) cogTry.el.removeAttribute('data-wsp-tapped');
      copyText('War Status+ ' + location.hash + ' ' + html, ok => toast(ok ? '\u2705 Copied - paste it to Claude' : 'Copy blocked - send a screenshot instead'));
    },
    '#wsp-medgo': () => medStep(want),
    '#wsp-travgo': () => tripStep(),
    '#wsp-travlbl': () => { S.tstep = 0; highlightTravel(); toast('\u21bb Travel steps restarted'); }
  };
  let lastTap = 0;
  function onTap(e) {
    if (!e.target || !e.target.closest) return;
    for (const sel in ACTIONS) {
      const el = e.target.closest(sel);
      if (!el) continue;
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() - lastTap < 500) return;
      lastTap = Date.now();
      ACTIONS[sel](el);
      return;
    }
  }
  ['touchend', 'click'].forEach(t => document.addEventListener(t, onTap, { capture: true, passive: false }));

  // Everything else inside the panel
  panel.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'attack':
        e.preventDefault();
        window.open(`https://www.torn.com/loader.php?sid=attack&user2ID=${id}`, '_blank');
        break;
      case 'profile':
        e.preventDefault();
        window.open(`https://www.torn.com/profiles.php?XID=${id}`, '_blank');
        break;
      case 'call': toggleCall(id, el.dataset.name); break;
      case 'tab': S.tab = el.dataset.tab; S.view = 'list'; break;
      case 'grp': {
        const k = el.dataset.key;
        if (S.collapsed[k]) delete S.collapsed[k]; else S.collapsed[k] = true;
        save('wsp_collapsed', S.collapsed);
        break;
      }
      case 'settings': S.view = S.view === 'settings' ? 'list' : 'settings'; break;
      case 'save': saveSettings(); break;
      case 'armoury':
        e.preventDefault();
        medStep('');
        return;
      case 'drug':
        e.preventDefault();
        medStep(el.dataset.d);
        return;
      case 'travel': S.view = S.view === 'trip' ? 'list' : 'trip'; break;
      case 'tcountry': cfg.trip = Object.assign({ m: cfg.flight || 'std' }, cfg.trip, { to: el.dataset.c }); save('wsp_cfg', cfg); break;
      case 'tmethod': cfg.trip = Object.assign({}, cfg.trip, { m: el.dataset.m }); save('wsp_cfg', cfg); break;
      case 'tback': S.view = 'list'; break;
      case 'tgo':
        e.preventDefault();
        if (!(cfg.trip && cfg.trip.to)) return;
        S.tstep = 0;
        S.view = 'list';
        toggle(false); // get the panel out of the way of the travel page
        arm('trip');
        if (onTravelPage()) { highlightTravel(); return; }
        location.href = 'https://www.torn.com/page.php?sid=travel';
        return;
      case 'ffkey': {
        const v = prompt('FFScouter API key (the key you registered at ffscouter.com).\nLeave blank to use your Torn key.', cfg.ffKey);
        if (v === null) return;
        cfg.ffKey = v.trim();
        cfg.ff = true;
        save('wsp_cfg', cfg);
        S.ffErr = '';
        purgeEmptyFF();
        if (S.enemy) loadFF(Object.keys(S.enemy.members || {}));
        lastSig = '';
        toast('🔑 FFScouter key saved');
        break;
      }
      case 'ffshow': { const i = $('wsp-c-ffKey'); i.type = i.type === 'password' ? 'text' : 'password'; return; }
      case 'update':
        toast('\u21bb Checking for an update\u2026');
        checkUpdate(true);
        return;
      case 'testsound': unlockAudio(); setTimeout(() => { beep(true); buzz(true); }, 50); toast('🔔 Test alert', true); break;
      case 'load': {
        const v = ($('wsp-eid').value || '').trim();
        if (/^\d+$/.test(v)) { localStorage.setItem('wsp_enemy', v); refresh(); }
        break;
      }
      default: {
        const ad = ADDONS[S.tab];
        if (!ad || !ad.onAction) return;
        try { ad.onAction(el.dataset.act, el, e); } catch (err) { ad.error = err; }
      }
    }
    S.dirty = true;
    render();
  });

  /* ---------- rendering ---------- */
  function renderHeader() {
    // Two lines: us, then them — name · score · chain
    const wf = id => (S.war && S.war.factions && S.war.factions[id]) || null;
    const sc = id => (wf(id) && wf(id).score) || 0;
    const war = !!(S.war && S.mine && S.enemy);
    const ourScore = war ? sc(S.mine.ID) : null, theirScore = war ? sc(S.enemy.ID) : null;

    let ourChain = '', ourHot = false;
    if (S.chain && S.chain.current > 0) { // live, from your own bars
      const rem = chainLeft();
      const cd = S.chain.cooldown > 0;
      ourHot = !cd && rem > 0 && rem <= 60 && S.chain.current >= cfg.chainMin;
      ourChain = `🔗${S.chain.current}${cd ? ' cd' : rem > 0 ? ' · ' + fmt(rem) : ''}`;
    } else if (S.mine && wf(S.mine.ID) && wf(S.mine.ID).chain) {
      ourChain = `🔗${wf(S.mine.ID).chain}`;
    }
    const theirChain = S.enemy && wf(S.enemy.ID) && wf(S.enemy.ID).chain ? `🔗${wf(S.enemy.ID).chain}` : '';

    // online / idle tally from the member list we already have
    const tally = f => {
      let on = 0, idle = 0;
      Object.values((f && f.members) || {}).forEach(m => { const st = m.last_action && m.last_action.status; if (st === 'Online') on++; else if (st === 'Idle') idle++; });
      return f && f.members ? `<span class="o" title="Online / idle"><i class="g"></i>${on}<i class="y"></i>${idle}</span>` : '';
    };
    const stealthTag = () => {
      const ws = winsLoad();
      return ws && ws.stealth ? `<span class="st" title="${ws.stealth} stealthed ranked war hits on our members (${(ws.stealthR || 0).toFixed(1)} respect); Torn hides who made them">\u{1F575}\ufe0f${ws.stealth}</span>` : '';
    };
    const row = (cls, name, score, chain, hot, f) => `<div class="wsp-frow ${cls}">
      <span class="n"><span class="nm">${esc(name)}</span>${cls.startsWith('them') ? stealthTag() : ''}</span>
      ${tally(f)}
      <span class="s">${score == null ? '' : Number(score).toLocaleString()}</span>
      <span class="c${hot ? ' hot' : ''}">${chain}</span></div>`;
    let title;
    if (S.mine || S.enemy) {
      const lead = war && ourScore !== theirScore ? (ourScore > theirScore ? 'us' : 'them') : '';
      title = row('us' + (lead === 'us' ? ' lead' : lead ? ' trail' : ''), S.mine ? S.mine.name : 'Your faction', ourScore, ourChain, ourHot, S.mine)
        + (S.enemy ? row('them' + (lead === 'them' ? ' lead' : lead ? ' trail' : ''), S.enemy.name, theirScore, theirChain, false, S.enemy) : '');
    } else {
      title = '<div class="wsp-frow"><span class="n">⚔️ JSim War Station Plus</span></div>';
    }
    if ($('wsp-title').innerHTML !== title) $('wsp-title').innerHTML = title;

    // Chain bonus banner
    const bn = chainBonus();
    let bonusHTML = '';
    if (bn && bn.hits === 1) bonusHTML = `<div class="next">🎁 Next hit = bonus #${bn.next.toLocaleString()} · make it count</div>`;
    else if (bn && bn.hits <= 5) bonusHTML = `<div>🎁 Bonus #${bn.next.toLocaleString()} in ${bn.hits} hits</div>`;
    if ($('wsp-bonus').innerHTML !== bonusHTML) $('wsp-bonus').innerHTML = bonusHTML;

    const loc = myLocation();
    const parts = [];
    if (loc) parts.push(esc(`You: ${flag(loc)} ${short(loc)}`));
    const wStart = S.war && S.war.war && S.war.war.start;
    if (wStart && wStart * 1000 > Date.now()) {
      const left = wStart - Date.now() / 1000;
      const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60);
      parts.unshift(`<span class="wsp-lead soon">\u23f3 War in ${d ? d + 'd ' : ''}${d || h ? h + 'h ' : ''}${m}m</span>`); // first, so it never gets cut off
    } else if (war && S.war.war && S.war.war.target) {
      const diff = ourScore - theirScore;
      const cls = diff > 0 ? 'ahead' : diff < 0 ? 'behind' : '';
      const mark = diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : '';
      parts.push(`<span class="wsp-lead ${cls}">${mark}Lead ${Math.abs(diff).toLocaleString()}/${S.war.war.target.toLocaleString()}</span>`);
    }
    { // war hit counts still reading back through the attack log
      const ws = winsLoad(), st = S.war && S.war.war && S.war.war.start;
      if (ws && st && st * 1000 < Date.now() && (ws.backTo == null || ws.backTo > st)) {
        const pct = ws.backTo ? Math.max(0, Math.min(99, Math.round(100 * (Date.now() / 1000 - ws.backTo) / (Date.now() / 1000 - st)))) : 0;
        parts.push(`counting hits ${pct}%`);
      }
    }
    parts.push(S.loading ? 'updating…' : S.at ? Math.round((Date.now() - S.at) / 1000) + 's ago' : '');
    if (S.err) parts.push(esc('⚠️ ' + S.err));
    else if (S.callsErr) parts.push(esc('⚠️ ' + S.callsErr));
    else if (cfg.ff && S.ffErr) parts.push(esc('⚠️ ' + S.ffErr));
    else if (S.retalErr) parts.push(esc('ℹ️ ' + S.retalErr));
    else if (S.note) parts.push(esc('ℹ️ ' + S.note));
    const subHTML = parts.filter(Boolean).join(' · ');
    if ($('wsp-sub').innerHTML !== subHTML) $('wsp-sub').innerHTML = subHTML;

    const b = [];
    const el = (Date.now() - S.uAt) / 1000;
    const bi = (icon, val, cls, sub) => `<span class="wsp-bi${cls ? ' ' + cls : ''}"><i>${icon}</i>${sub ? `<span class="wsp-bv"><b>${val}</b><small>${sub}</small></span>` : `<b>${val}</b>`}</span>`;
    if (S.bars && S.bars.energy) {
      const en = S.bars.energy, eLeft = en.fulltime > 0 && S.barsAt ? en.fulltime - (Date.now() - S.barsAt) / 1000 : 0;
      const eCls = en.current === en.maximum || (en.fulltime > 0 && eLeft <= 0 && en.current <= en.maximum) ? 'efull' : eLeft > 0 && eLeft <= (+cfg.energyWarn || 0) * 60 ? 'enear' : '';
      // countdown under the number from an hour out (Settings), counting to full
      const cdFrom = Math.max(0, +cfg.energyCd || 0) * 60;
      const eSub = eLeft > 0 && eLeft <= cdFrom && en.current < en.maximum ? 'full ' + (eLeft >= 3600 ? '1h' + String(Math.floor(eLeft % 3600 / 60)).padStart(2, '0') : eLeft >= 120 ? Math.ceil(eLeft / 60) + 'm' : fmt(eLeft))
        : eCls === 'efull' ? 'FULL' : '';
      b.push(bi('⚡', `${en.current}<span class="mx">/${en.maximum}</span>`, eCls, eSub));
    }
    if (S.bars && S.bars.life && S.bars.life.maximum) b.push(bi('❤️', `${Math.round(100 * S.bars.life.current / S.bars.life.maximum)}%`));
    if (S.cd) {
      const d = S.cd.drug - el, m = S.cd.medical - el;
      // compact: 1h56m / 42m / 1:05 (seconds only in the last two minutes)
      const cdf = x => x >= 3600 ? Math.floor(x / 3600) + 'h' + String(Math.floor(x % 3600 / 60)).padStart(2, '0') + 'm' : x >= 120 ? Math.ceil(x / 60) + 'm' : fmt(x);
      b.push(bi(LEAF, d > 0 ? cdf(d) : '✓', d > 0 ? 'cd' : 'ok'));
      // medical cooldown stacks: green while you're under your limit (you can still use meds), red once it's full
      const cap = medCap();
      b.push(bi('💉', m > 0 ? cdf(m) : '✓', m < cap ? 'ok' : 'full'));
    }
    const barsHTML = b.join(' ') || '<span style="color:var(--muted)">Loading your bars…</span>';
    if ($('wsp-barsv').innerHTML !== barsHTML) $('wsp-barsv').innerHTML = barsHTML;
  }

  function renderTabs() {
    panel.querySelectorAll('#wsp-tabs [data-tab]').forEach(d => d.classList.toggle('on', S.view === 'list' && d.dataset.tab === S.tab));
    const n = myHits().length;
    const label = n ? `Hits (${n})` : 'Hits';
    if ($('wsp-tab-hits').textContent !== label) $('wsp-tab-hits').textContent = label;
  }

  function memberRows() {
    const enemyTab = S.tab === 'enemy';
    const f = enemyTab ? S.enemy : S.mine;
    if (!f) return null;
    const myLoc = myLocation();
    let rows = Object.entries(f.members || {}).map(([id, m]) => {
      const st = m.status || {};
      const rl = enemyTab ? retalLeft(id) : 0;
      const r = rl > 0 ? -G + Math.floor(rl) : enemyTab ? rankEnemy(st, myLoc) : rankOurs(st); // retals go on top
      return { id, m, st, r, on: ONLINE_ORDER[(m.last_action && m.last_action.status) || 'Offline'] };
    });
    if (enemyTab) {
      rows.sort((a, b) => a.r - b.r || ffVal(a.id) - ffVal(b.id) || (b.m.level || 0) - (a.m.level || 0));
    } else {
      rows.sort((a, b) => a.r - b.r || a.on - b.on || (b.m.level || 0) - (a.m.level || 0));
    }
    return rows;
  }

  function travelReport() {
    if (!S.enemy) return '<div class="wsp-help">No enemy faction loaded.</div>';
    const ids = Object.keys(S.enemy.members || {});
    const done = ids.filter(i => props[i] && props[i].t).length;
    const perks = compTypes && compTypes.n ? Object.keys(compTypes.names).filter(t => bctNeed(t) != null).map(t => `${esc(compTypes.names[t])} ${bctNeed(t)}&#9733;`).join(', ') || 'none found' : 'not loaded yet';
    let html = `<div class="wsp-help">Company list: ${compTypes && compTypes.n ? compTypes.n + ' types' : 'not loaded yet'} &middot; business class perks: ${perks}<br>` +
      `Enemies checked: ${done}/${ids.length}${S.lookupErr ? '<br>Last error: ' + esc(S.lookupErr) : ''}<br>Checks run while the panel is open, one every 3 seconds.</div>`;
    html += '<div class="wsp-trv">' + ids.map(i => {
      const p = props[i] || {}, c = p.compId ? comps[p.compId] : null, f = methodFor(i);
      const type = p.compType || (c && c.type);
      const co = methods[i] ? 'timed from a real flight' : !p.t ? 'not checked yet' : p.compId
        ? `${esc((compTypes && compTypes.names[type]) || p.compName || 'company')}${c ? ' ' + c.rating + '&#9733;' : ' (rating not checked)'}`
        : (p.job ? esc(p.job) : 'no company');
      const home = p.pi ? (p.air === true ? 'PI with airstrip' : p.air === false ? 'PI, no airstrip' : 'PI') : (p.prop ? esc(p.prop) : '');
      return `<div><b>${esc(S.enemy.members[i].name)}</b> <span>${co}${home ? ' &middot; ' + home : ''}</span> <i>${FLIGHT_SHORT[f.m]}${f.how === 'default' ? ' (default)' : ''}</i></div>`;
    }).join('') + '</div>';
    return html;
  }

  function flyTag(id, kind) {
    if (kind !== 'enemy') return '';
    const f = methodFor(id);
    const line = (cls, title, text) => `<span class="wsp-meta wsp-fly${cls}" title="${title}">&#9992; ${text}</span>`;
    if (f.how === 'seen') return line('', 'Timed from one of their real flights', 'Flies ' + FLIGHT_NAMES[f.m]);
    if (f.how === 'job') return line('', `Their ${f.perk.stars}-star ${esc(f.perk.type)} gives free business class travel`, `Business class (${f.perk.stars}&#9733; ${esc(f.perk.type)})`);
    if (f.how === 'airstrip') return line('', 'Their Private Island has an airstrip', 'Airstrip (on their PI)');
    if (f.how === 'guess') return line(' guess', 'Lives on a Private Island; the airstrip could not be confirmed', 'Airstrip? (lives on a PI)');
    return '';
  }

  // Look up enemies' jobs and property once a week: one API call every 3 seconds while the panel is open
  let propBusy = false, propLast = 0;
  const WEEK = 7 * 86400e3;
  function nextLookup() {
    if (!compTypes || Date.now() - compTypes.t > WEEK) return { kind: 'types' };
    const ids = Object.keys(S.enemy.members || {}).filter(i => !methods[i]);
    let id = ids.find(i => !props[i] || Date.now() - props[i].t > WEEK);
    if (id) return { kind: 'profile', id };
    id = ids.find(i => props[i].compId && (!props[i].compType || bctNeed(props[i].compType) != null) &&
      (!comps[props[i].compId] || Date.now() - comps[props[i].compId].t > WEEK));
    if (id) return { kind: 'company', cid: props[id].compId };
    id = ids.find(i => props[i].pi && props[i].propId && props[i].air === undefined && !jobPerk(i));
    if (id) return { kind: 'property', id };
    return null;
  }
  async function propTick() {
    if (propBusy || !S.open || !S.enemy || Date.now() - propLast < 3000) return;
    const job = nextLookup();
    if (!job) return;
    propBusy = true; propLast = Date.now();
    try {
      if (job.kind === 'types') {
        // Which company types give business class travel, and at what star rating
        const j = await api('torn/', 'companies');
        const names = {}, bct = {};
        for (const [type, c] of Object.entries(j.companies || {})) {
          names[type] = c.name;
          for (const sp of Object.values(c.specials || {})) {
            const txt = (sp.effect || '') + ' ' + (sp.name || '');
            if (/business\s*class|business travel|free travel/i.test(txt) && (bct[type] == null || sp.rating_required < bct[type])) bct[type] = sp.rating_required;
          }
        }
        compTypes = { t: Date.now(), names, bct, n: Object.keys(names).length };
        save('wsp_comptypes', compTypes);
      } else if (job.kind === 'profile') {
        const j = await api('user/' + job.id, 'profile');
        const jb = j.job || {};
        props[job.id] = { t: Date.now(), pi: /private island/i.test(j.property || ''), propId: j.property_id || 0,
          compId: jb.company_id || jb.id || 0, compType: jb.company_type || jb.type_id || 0,
          compName: jb.company_name || jb.name || '', job: jb.position || jb.job || '', prop: j.property || '' };
        save('wsp_props2', props);
      } else if (job.kind === 'company') {
        const j = await api('company/' + job.cid, 'profile');
        const c = j.company || {};
        comps[job.cid] = { t: Date.now(), type: c.company_type, rating: Number(c.rating) || 0, name: c.name || '' };
        save('wsp_comps', comps);
      } else if (job.kind === 'property') {
        const j = await api('property/' + props[job.id].propId, 'property');
        const ups = j.property && j.property.upgrades;
        const list = Array.isArray(ups) ? ups : ups && typeof ups === 'object' ? Object.values(ups).concat(Object.keys(ups)) : null;
        props[job.id].air = list ? list.some(u => /airstrip/i.test(typeof u === 'string' ? u : JSON.stringify(u))) : null;
        save('wsp_props2', props);
      }
      S.dirty = true;
    } catch (e) {
      // Skip what can't be read, and try again tomorrow
      S.lookupErr = (job.kind + ': ' + (e && e.message || e)).slice(0, 120);
      if (job.kind === 'types') compTypes = { t: Date.now() - WEEK + 10 * 60e3, names: {}, bct: {} }; // retry in 10 min
      else if (job.kind === 'profile') props[job.id] = { t: Date.now() - WEEK + 86400e3 };
      else if (job.kind === 'company') comps[job.cid] = { t: Date.now() - WEEK + 86400e3, rating: 0 };
      else if (job.kind === 'property') props[job.id].air = null;
    }
    propBusy = false;
  }

  function rowHTML(x, kind, hitMap) {
    const { id, m, st } = x;
    const s = statusCell(st, id);
    const online = (m.last_action && m.last_action.status) || 'Offline';
    const call = kind === 'enemy' ? S.calls[id] : null;
    let cls = 'wsp-row ' + (kind === 'enemy' ? 'en' : 'us');
    if (call) cls += String(call.byId) === S.meId ? ' mine-call' : ' called';
    if (kind === 'enemy' && isFlash(id, st)) cls += ' wsp-flash';
    const callBtn = kind === 'enemy' && cfg.callsUrl ? `<button class="wsp-call" data-act="call" data-id="${id}" data-name="${esc(m.name)}">📣</button>` : '';
    const caller = call ? `<small class="wsp-caller">📣${esc(call.by)}</small>` : '';
    const hit = hitMap[id] != null ? `<small class="wsp-hitmark">✓${fmtM(hitMap[id])}</small>` : '';
    const la = m.last_action || {};
    const seen = la.status && la.status !== 'Online' && la.timestamp ? ` · Last active ${ago(la.timestamp)} ago` : la.status === 'Online' ? ' · Online now' : '';
    const rt = kind === 'enemy' && retalLeft(id) > 0
      ? `<small class="wsp-retal" data-until="${S.retals[id].until}" title="Hit ${esc(S.retals[id].victim)}">🔁${fmt(retalLeft(id))}</small>` : '';
    const action = kind === 'enemy'
      ? `<button class="wsp-atk" data-act="attack" data-id="${id}">Attack</button>`
      : st.state === 'Hospital' && hospLeft(st) > 0 && canRevive(id)
        ? `<button class="wsp-atk rev" data-act="profile" data-id="${id}">Revive</button>`
        : '<span></span>';
    return `<div class="${cls}" data-row="${id}" title="${esc(st.description || '')}">
      <span class="wsp-dot ${esc(online)}"></span>
      <span class="wsp-name">${callBtn}<a href="/profiles.php?XID=${id}">${esc(m.name)}</a>${revTag(id, kind)}${warTag(id, kind)}${rt}${caller}${hit}<span class="wsp-meta">Lvl ${m.level || '?'}${seen}</span>${flyTag(id, kind)}</span>
      ${kind === 'enemy' ? ffCell(id) + liveCell(id) : ''}
      <span class="wsp-st" data-id="${id}" style="color:${s.c}">${s.h}</span>
      ${action}
    </div>`;
  }

  function settingsHTML() {
    const ck = (k, label) => `<label class="wsp-set"><input type="checkbox" id="wsp-c-${k}" ${cfg[k] ? 'checked' : ''}> ${label}</label>`;
    const opts = Object.entries(FLIGHT_NAMES).map(([k, v]) => `<option value="${k}" ${cfg.flight === k ? 'selected' : ''}>${v}</option>`).join('');
    return `
      <div class="wsp-grp">Alerts</div>
      ${ck('popups', 'Pop-up messages (off = sound / vibrate only)')}
      ${ck('sound', 'Sound')}
      ${ck('vibrate', 'Vibrate (Android only)')}
      ${ck('hospAlert', 'Enemy leaving hospital at your location')}
      ${ck('landAlert', 'Enemy landing at your location')}
      ${ck('retalAlert', 'Retaliation chances')}
      ${ck('bonusAlert', 'Next hit is a chain bonus')}
      ${ck('drugAlert', 'Your drug cooldown is over')}
      <label class="wsp-set">Energy countdown under ⚡ from (minutes before full)
        <input type="number" id="wsp-c-energyCd" inputmode="numeric" value="${cfg.energyCd}" style="width:64px"></label>
      <label class="wsp-set">…turns amber in the last (minutes)
        <input type="number" id="wsp-c-energyWarn" inputmode="numeric" value="${cfg.energyWarn}" style="width:64px"></label>
      ${ck('energyAlert', 'Also pop up and beep when energy is full')}
      <label class="wsp-set"><input type="checkbox" id="wsp-c-chainAlert" ${cfg.chainAlert ? 'checked' : ''}> Chain warnings at 60s &amp; 30s from chain
        <input type="number" id="wsp-c-chainMin" inputmode="numeric" value="${cfg.chainMin}" style="width:64px"></label>
      ${ck('bg', 'Keep checking while docked (uses ~6 API calls/min)')}
      ${(() => {
        const ws = winsLoad();
        if (!ws) return '';
        const src = S.noAtkV2 ? 'v1 log' : S.noDirFilter ? 'v2 log' : 'v2 log, both directions';
        const back = ws.backTo ? new Date(ws.backTo * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'war start';
        const res = Object.entries(ws.res || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n]) => esc(r) + ' ' + n).join(', ');
        const onUs = Object.values(ws.byr || {}).reduce((x, y) => x + y, 0) + (ws.stealthR || 0);
        const theirScore = S.war && S.enemy && S.war.factions && S.war.factions[S.enemy.ID] ? S.war.factions[S.enemy.ID].score : null;
        return `<div class="wsp-help">Respect counted on us: ${Math.round(onUs).toLocaleString()} (named ${Math.round(onUs - (ws.stealthR || 0)).toLocaleString()} + stealthed ${Math.round(ws.stealthR || 0).toLocaleString()} from ${ws.stealth || 0} hits)${theirScore != null ? ` vs their war score ${Number(theirScore).toLocaleString()}` : ''}.</div>
        <div class="wsp-help">War hit counts: read ${ws.read || 0} attacks (${ws.cnt ? ws.cnt.o : 0} our wins, ${ws.cnt ? ws.cnt.i : 0} wins on us) from ${src}, back to ${back}${S.retalErr ? ' \u00b7 ' + esc(S.retalErr) : ''}.<br>Results seen: ${res || 'none yet'}</div>`;
      })()}
      <div class="wsp-grp">Display</div>
      <label class="wsp-set">Default flight type <select id="wsp-c-flight">${opts}</select></label>
      <div class="wsp-help">Only used when nothing better is known. Each enemy's own method comes first: timed from a real flight, a business class job perk, or an airstrip on their Private Island.</div>
      <div class="wsp-grp">Medical</div>
      <label class="wsp-set">Preferred medication <select id="wsp-c-med">
        ${Object.entries(MED_NAMES).map(([k, v]) => `<option value="${k}" ${cfg.med === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="wsp-set">Your blood type <select id="wsp-c-blood">
        <option value="">Not set</option>
        ${Object.keys(BLOOD_OK).map(t => `<option value="${t}" ${cfg.blood === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="wsp-help">Highlighted on the faction armoury's medical page. For blood bags, every bag safe for your blood type is highlighted too.</div>
      <label class="wsp-set">Medical cooldown limit <select id="wsp-c-medCap">
        ${[['auto', 'Auto (' + (medCap() / 3600).toFixed(medCap() % 3600 ? 1 : 0) + 'h from your perks)'], ['6', '6 hours'], ['7', '7 hours'], ['8', '8 hours'], ['9', '9 hours']].map(([k, v]) => `<option value="${k}" ${String(cfg.medCap || 'auto') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="wsp-help">The 💉 timer is green while you can still use meds and red once your cooldown is at the limit. Faction perks can raise the 6-hour limit.</div>
      <div class="wsp-grp">Appearance</div>
      <label class="wsp-set">Theme <select id="wsp-c-theme">
        <option value="war" ${cfg.theme !== 'light' && cfg.theme !== 'auto' ? 'selected' : ''}>War room</option>
        <option value="auto" ${cfg.theme === 'auto' ? 'selected' : ''}>Match Torn (war room / light)</option>
        <option value="light" ${cfg.theme === 'light' ? 'selected' : ''}>Light</option></select></label>
      ${ck('ff', 'FFScouter stat estimates')}
      <label class="wsp-set wide">FFScouter API key
        <span style="display:flex;gap:6px"><input id="wsp-c-ffKey" type="password" autocomplete="off" value="${esc(cfg.ffKey)}" placeholder="Paste the key you registered at ffscouter.com" style="flex:1">
        <button data-act="ffshow" type="button" class="wsp-mini" style="padding:0 10px">👁</button></span></label>
      <div class="wsp-help">${S.ffErr ? '⚠️ ' + esc(S.ffErr) + '<br>' : ''}Leave blank to use your Torn key. Tap Save to apply.</div>
      <div class="wsp-grp">Enemy travel lookups</div>
      ${travelReport()}
      <div class="wsp-grp">Target calling</div>
      <label class="wsp-set wide">Calls server URL<input id="wsp-c-callsUrl" value="${esc(cfg.callsUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="wsp-set wide">Faction password<input id="wsp-c-callsPw" value="${esc(cfg.callsPw)}"></label>
      <div class="wsp-help">Everyone in your faction pastes the same URL and password. Leave blank to turn calling off.</div>
      <div class="wsp-grp">Tracker (take-off times while PDA is closed)</div>
      <label class="wsp-set wide">Tracker web app URL<input id="wsp-c-trackerUrl" value="${esc(cfg.trackerUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="wsp-set wide">Own faction tracker URL<input id="wsp-c-trackerUrl2" value="${esc(cfg.trackerUrl2)}" placeholder="Second tracker with WATCH = own (optional)"></label>
      <label class="wsp-set wide">Tracker password<input id="wsp-c-trackerPw" value="${esc(cfg.trackerPw)}"></label>
      <div class="wsp-help">${S.trackErr ? '⚠️ ' + esc(S.trackErr) + '<br>' : S.trackDataAt ? `✓ Connected — tracker last checked ${fmtM(Date.now() / 1000 - S.trackDataAt)} ago.<br>` : ''}Optional. Gives accurate ETAs for flights that started while PDA was closed.</div>
      <div class="wsp-actions"><button data-act="testsound">Test alert</button><button data-act="save" class="pri">Save</button></div>
      <div class="wsp-help" style="text-align:center;padding:10px;opacity:.6">JSim War Station Plus v${WSP_VERSION}${FROM_LOADER ? ' \u00b7 auto-updates on' : ''}</div>
      ${FROM_LOADER ? '<div class="wsp-actions"><button data-act="update">Check for update now</button></div>' : ''}`;
  }

  function saveSettings() {
    ['popups', 'sound', 'vibrate', 'hospAlert', 'landAlert', 'retalAlert', 'bonusAlert', 'drugAlert', 'energyAlert', 'chainAlert', 'bg', 'ff'].forEach(k => { cfg[k] = $('wsp-c-' + k).checked; });
    cfg.chainMin = Math.max(1, parseInt($('wsp-c-chainMin').value, 10) || 10);
    cfg.energyWarn = Math.max(0, Math.min(120, parseInt($('wsp-c-energyWarn').value, 10) || 0));
    cfg.energyCd = Math.max(0, Math.min(600, parseInt($('wsp-c-energyCd').value, 10) || 0));
    cfg.flight = $('wsp-c-flight').value;
    cfg.theme = $('wsp-c-theme').value;
    cfg.med = $('wsp-c-med').value;
    cfg.blood = $('wsp-c-blood').value;
    cfg.medCap = $('wsp-c-medCap').value;
    applyTheme();
    cfg.callsUrl = $('wsp-c-callsUrl').value.trim();
    cfg.callsPw = $('wsp-c-callsPw').value.trim();
    cfg.trackerUrl = $('wsp-c-trackerUrl').value.trim();
    cfg.trackerUrl2 = $('wsp-c-trackerUrl2').value.trim();
    cfg.trackerPw = $('wsp-c-trackerPw').value.trim();
    S.trackAt = 0; S.trackErr = '';
    if (cfg.trackerUrl) loadTracker().then(() => { S.dirty = true; });
    const newFF = $('wsp-c-ffKey').value.trim();
    if (newFF !== cfg.ffKey) { cfg.ffKey = newFF; S.ffErr = ''; purgeEmptyFF(); }
    save('wsp_cfg', cfg);
    S.view = 'list';
    if (cfg.callsUrl) loadCalls(); else S.calls = {};
    if (cfg.ff && S.enemy) loadFF(Object.keys(S.enemy.members || {}));
    toast('Settings saved');
  }

  function hitsHTML() {
    const hits = myHits();
    if (!S.attacks || !Object.keys(S.attacks).length) return '<div class="wsp-msg">No attack data yet (needs a Limited access key).</div>';
    const total = hits.reduce((s, a) => s + respectOf(a), 0);
    const label = S.war ? 'This war' : 'Last 24h';
    const now = Date.now() / 1000;
    let html = `<div class="wsp-hsum">${label}: ${hits.length} hits · ${total.toFixed(2)} respect</div>`;
    for (const a of hits) {
      const r = respectOf(a);
      html += `<div class="wsp-hrow">
        <span>${fmtM(now - a.timestamp_started)}</span>
        <a href="/profiles.php?XID=${a.defender_id}">${esc(a.defender_name || a.defender_id)}</a>
        <span class="r">${esc(a.result || '')}</span>
        <span class="p">${r ? '+' + r.toFixed(2) : ''}</span>
      </div>`;
    }
    return html + (hits.length ? '' : '<div class="wsp-msg">No hits yet.</div>');
  }

  let lastSig = '';
  function render() {
    renderHeader();
    renderTabs();
    const list = $('wsp-list');

    if (S.view === 'settings') {
      if (lastSig !== 'settings') { list.innerHTML = settingsHTML(); lastSig = 'settings'; list.scrollTop = 0; }
      return;
    }
    if (S.view === 'trip') {
      const sig = 'trip' + JSON.stringify(cfg.trip || {});
      if (lastSig !== sig) { list.innerHTML = tripHTML(); lastSig = sig; }
      return;
    }

    if (ADDONS[S.tab]) { // a tab added by another script
      const ad = ADDONS[S.tab];
      if (S.dirty || lastSig !== 'addon:' + ad.id) {
        let html;
        try { html = ad.error ? addonError(ad) : ad.render(); } catch (err) { ad.error = err; html = addonError(ad); }
        const sc = list.scrollTop; list.innerHTML = html; list.scrollTop = sc;
        lastSig = 'addon:' + ad.id; S.dirty = false;
      }
      return;
    }

    if (S.tab === 'hits') {
      if (S.dirty || lastSig !== 'hits') { list.innerHTML = hitsHTML(); lastSig = 'hits'; S.dirty = false; }
      return;
    }

    const kind = S.tab;
    const rows = memberRows();
    if (!rows) {
      const sig = 'empty-' + kind + S.loading + S.at;
      if (sig !== lastSig) {
        lastSig = sig;
        list.innerHTML = S.loading || !S.at ? '<div class="wsp-msg">Loading…</div>'
          : kind === 'enemy'
            ? `<div class="wsp-msg">No ranked war found.<br>Enter a faction ID to watch:<br>
                 <input id="wsp-eid" inputmode="numeric" value="${esc(localStorage.getItem('wsp_enemy') || '')}">
                 <button data-act="load">Load</button></div>`
            : '<div class="wsp-msg">Could not load your faction.</div>';
      }
      return;
    }

    const myLoc = myLocation();
    const groupsOn = kind === 'mine' || !!myLoc;
    // Upcoming releases: enemies at your location leaving hospital within 10 minutes
    const nextOut = kind === 'enemy' && myLoc ? rows.filter(x => x.r >= G && x.r < G + 600).slice(0, 8) : [];
    const sig = kind + '|' + rows.map(x => x.id + ':' + Math.floor(x.r / G)).join(',') + '|n:' + nextOut.map(x => x.id).join(',');
    if (S.dirty || sig !== lastSig) {
      const names = (kind === 'enemy' ? ENEMY_GROUPS : OURS_GROUPS).slice();
      const hitMap = kind === 'enemy' ? recentHitMap() : {};
      const counts = {};
      rows.forEach(x => { const g = Math.floor(x.r / G); counts[g] = (counts[g] || 0) + 1; });
      let html = '', last = null;
      if (kind === 'enemy' && rows.length) {
        html += '<div class="wsp-row en wsp-colhead"><span></span><span>Member</span><span title="FFScouter battle stat estimate">FF</span>' +
          '<span title="FF adjusted for drugs they are on now: Vicodin +25%, Xanax -35%">Live</span><span>Status</span><span></span></div>';
      }
      if (nextOut.length) {
        html += '<div class="wsp-next"><span class="lbl">Next out</span>' + nextOut.map(x =>
          `<button class="wsp-chip" data-act="attack" data-id="${x.id}">${esc(x.m.name)} <b class="wsp-cd" data-until="${x.st.until}">${fmt(x.st.until - Date.now() / 1000)}</b></button>`).join('') + '</div>';
      }
      for (const x of rows) {
        const g = Math.floor(x.r / G);
        const key = kind + ':' + g;
        const shut = groupsOn && !!S.collapsed[key];
        if (groupsOn && g !== last) {
          html += `<div class="wsp-grp${shut ? ' collapsed' : ''}" data-act="grp" data-key="${key}">${g < 0 ? '🔁 Retaliate now' : names[g]} <span>· ${counts[g]}</span></div>`;
          last = g;
        }
        if (!shut) html += rowHTML(x, kind, hitMap);
      }
      if (!rows.length) html = `<div class="wsp-msg">No members.</div>`;
      const scroll = list.scrollTop;
      list.innerHTML = html;
      list.scrollTop = scroll;
      lastSig = sig;
      S.dirty = false;
      return;
    }

    // Same layout: just tick the live parts (timers, flashing) without rebuilding,
    // so taps on buttons are never lost mid-render
    const f = kind === 'enemy' ? S.enemy : S.mine;
    list.querySelectorAll('.wsp-st[data-id]').forEach(cell => {
      const m = f.members[cell.dataset.id];
      if (!m) return;
      const st = m.status || {};
      const s = statusCell(st, cell.dataset.id);
      if (cell.innerHTML !== s.h) cell.innerHTML = s.h;
      if (cell.style.color !== s.c) cell.style.color = s.c;
      if (kind === 'enemy') cell.parentElement.classList.toggle('wsp-flash', isFlash(cell.dataset.id, st));
    });
    const nowS = Date.now() / 1000;
    list.querySelectorAll('[data-until]').forEach(el => {
      const left = Number(el.dataset.until) - nowS;
      const txt = el.classList.contains('wsp-retal') ? (left > 0 ? '🔁' + fmt(left) : '🔁 over') : (left > 0 ? fmt(left) : 'OUT');
      if (el.textContent !== txt) el.textContent = txt;
    });
  }

  /* ================= Add-on tabs (e.g. War Status+ Intel) ================= */
  // Other userscripts can add a tab to this panel. Keeps optional features separate,
  // so a problem in an add-on can't stop the main panel from working.
  const ADDONS = {};
  function addonError(ad) {
    return `<div class="wsp-msg">⚠️ ${esc(ad.label)} add-on error:<br><b>${esc((ad.error && ad.error.message) || ad.error)}</b><br>Send a screenshot of this.</div>`;
  }
  window.WarStatusPlus = {
    version: +WSP_VERSION,
    addTab(def) {
      if (!def || !def.id || ADDONS[def.id]) return;
      ADDONS[def.id] = def;
      const t = document.createElement('div');
      t.dataset.act = 'tab';
      t.dataset.tab = def.id;
      t.textContent = def.label;
      $('wsp-tabs').appendChild(t);
      S.dirty = true;
    },
    // what add-ons can use
    get state() { return S; },
    get cfg() { return cfg; },
    setInfluence(map, side) { // { id: { t: 'x' | 'v' | 'o' } } from the Intel tab
      const key = side === 'mine' ? 'influenceMine' : 'influence';
      const next = map || {};
      if (JSON.stringify(next) === JSON.stringify(S[key])) return;
      S[key] = next;
      S.dirty = true;
    },
    redraw() { S.dirty = true; },
    esc, fmt, fmtM, load, save, getJSON, getKey,
    flag, short
  };
  /* ================= Call tab: pair one of ours with one of theirs ================= */
  const callSel = { mine: null, enemy: null };
  function callStatus(st) {
    const now = Date.now() / 1000, w = where(st);
    if (w.travel) return { h: (w.to === 'Torn' ? '&larr;' : '&rarr;') + flag(w.to === 'Torn' ? w.from : w.to), c: C.blue, r: 4 };
    if (st.state === 'Hospital' && st.until > now) return { h: (w.loc && w.loc !== 'Torn' ? flag(w.loc) : '') + '\u{1F3E5}' + fmtM(st.until - now), c: C.red, r: 3, left: st.until - now };
    if (st.state === 'Jail' || st.state === 'Federal') return { h: 'Jail', c: C.red, r: 5 };
    if (st.state === 'Abroad') return { h: flag(w.loc) + ' ' + short(w.loc), c: C.teal, r: 4 };
    return { h: 'OK', c: C.green, r: 0 };
  }
  function liveStats(id, side) {
    const f = ffCache[id];
    if (!f) return null;
    const n = f.n != null ? f.n : parseHuman(f.bs);
    if (n == null) return null;
    const d = DRUG_FX[((side === 'mine' ? S.influenceMine : S.influence)[id] || {}).t];
    return { n: n * (d ? d.f : 1), d };
  }
  function callRows(side) {
    const f = side === 'mine' ? S.mine : S.enemy;
    if (!f) return [];
    return Object.entries(f.members || {}).map(([id, m]) => {
      const st = callStatus(m.status || {});
      const on = ONLINE_ORDER[(m.last_action && m.last_action.status) || 'Offline'];
      // Ours: online first, then idle, then offline (each by status). Theirs: by status, online first among the available.
      const k = side === 'mine' ? on * 100 + st.r * 10 + (st.left ? st.left / 1e6 : 0)
        : st.r * 10 + (st.r === 0 ? on : 0) + (st.left ? st.left / 1e6 : 0);
      return { id, m, st, on, ls: liveStats(id, side), k };
    }).sort((a, b) => a.k - b.k || (b.ls ? b.ls.n : 0) - (a.ls ? a.ls.n : 0));
  }
  function ratioClass(r) { return r < 0.75 ? 'easy' : r <= 1.1 ? 'even' : 'hard'; }
  function callColumn(side) {
    const ours = callSel.mine ? liveStats(callSel.mine, 'mine') : null;
    return callRows(side).map(x => {
      const sel = callSel[side] === x.id;
      let vcls = x.ls && x.ls.d ? (x.ls.d.cls === 'up' ? ' up' : ' down') : '';
      if (side === 'enemy' && ours && x.ls) vcls += ' ' + ratioClass(x.ls.n / ours.n);
      const online = (x.m.last_action && x.m.last_action.status) || 'Offline';
      const beat = side === 'enemy' && callSel.mine && hasBeaten(callSel.mine, x.id);
      return `<div class="wsp-crow${sel ? ' sel' : ''}${beat ? ' beaten' : ''}" data-act="cpick" data-side="${side}" data-id="${x.id}"${beat ? ' title="Already beaten this war by your pick"' : ''}>
        <span class="wsp-dot ${esc(online)}"></span><span class="n">${beat ? '<b class="ck">&#10003;</b>' : ''}${esc(x.m.name)}</span>
        <span class="v${vcls}" title="${x.ls ? 'Live stat estimate' + (x.ls.d ? ', on ' + x.ls.d.name : '') : 'No estimate'}">${x.ls ? human(x.ls.n) : '&ndash;'}</span>
        <span class="s" style="color:${x.st.c}">${x.st.h}</span></div>`;
    }).join('') || '<div class="wsp-msg">Loading...</div>';
  }
  function callHTML() {
    if (!S.mine || !S.enemy) return '<div class="wsp-msg">Needs both factions loaded (a ranked war, or an enemy faction ID).</div>';
    const a = callSel.mine && S.mine.members[callSel.mine], b = callSel.enemy && S.enemy.members[callSel.enemy];
    let bar;
    if (a && b) {
      const sa = liveStats(callSel.mine, 'mine'), sb = liveStats(callSel.enemy, 'enemy');
      const r = sa && sb ? sb.n / sa.n : null;
      bar = `<div class="pair"><b>${esc(a.name)}</b> &rarr; <b>${esc(b.name)}</b>` +
        (r != null ? ` <span class="ratio ${ratioClass(r)}">${esc(b.name)} is about ${Math.round(r * 100)}% of ${esc(a.name)}'s stats</span>` : '') +
        (hasBeaten(callSel.mine, callSel.enemy) ? ` <span class="ratio easy">&#10003; already beaten this war</span>` : '') + '</div>' +
        '<div class="btns"><button data-act="ccopy" class="go">&#128227; Copy call</button><button data-act="cclear">Clear</button></div>';
    } else {
      bar = `<div class="pair hint">${a ? '<b>' + esc(a.name) + '</b> &rarr; now tap a target on the right' : b ? 'Now tap one of ours on the left for <b>' + esc(b.name) + '</b>' : 'Tap one of ours, then one of theirs'}</div>`;
    }
    return `<div class="wsp-cbar">${bar}</div>
      <div class="wsp-ccols">
        <div class="col"><div class="h">${esc(S.mine.name)}</div>${callColumn('mine')}</div>
        <div class="col"><div class="h">${esc(S.enemy.name)}</div>${callColumn('enemy')}</div>
      </div>
      <div class="wsp-help" style="padding-top:8px">Numbers are live battle stat estimates (FFScouter, adjusted for Xanax and Vicodin when the trackers have seen them). Once one of ours is picked, targets turn green (easier), amber (even) or red (harder) for them, and anyone they have already beaten this war gets a green row with a tick (needs faction API access). Copy call puts the call on your clipboard; paste it in faction chat and send.</div>`;
  }
  function copyText(t, done) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      done(ok);
    };
    try { navigator.clipboard.writeText(t).then(() => done(true), fallback); } catch (e) { fallback(); }
  }
  function callAction(act, el) {
    if (act === 'cpick') {
      const side = el.dataset.side;
      callSel[side] = callSel[side] === el.dataset.id ? null : el.dataset.id;
    } else if (act === 'cclear') {
      callSel.mine = callSel.enemy = null;
    } else if (act === 'ccopy') {
      const a = S.mine.members[callSel.mine], b = S.enemy.members[callSel.enemy];
      if (!a || !b) return;
      const text = `${a.name} -> ${b.name} https://www.torn.com/loader.php?sid=attack&user2ID=${callSel.enemy}`;
      copyText(text, ok => toast(ok ? 'Call copied. Paste it in faction chat: ' + a.name + ' -> ' + b.name : 'Could not copy automatically: ' + text, !ok));
      callSel.mine = callSel.enemy = null;
    }
    S.dirty = true;
  }
  setTimeout(() => window.WarStatusPlus.addTab({ id: 'call', label: 'Call', render: callHTML, onAction: callAction }), 0);

  try { window.dispatchEvent(new Event('warstatusplus:ready')); } catch (e) { /* old browser */ }

  // Auto-updates: while running, look at a tiny version.txt next to the script every 2 minutes.
  // When it's newer, download the script into the loader's cache and offer a one-tap reload.
  let updReady = '';
  async function checkUpdate(manual) {
    if (!FROM_LOADER) return;
    const base = FROM_LOADER.replace(/[^/]*$/, '');
    const bust = 't=' + Date.now();
    try {
      let v = '';
      try {
        const r = await fetch(base + 'version.txt?' + bust, { cache: 'no-store' });
        v = (await r.text()).trim();
      } catch (e) {
        if (typeof PDA_httpGet === 'function') v = String((await PDA_httpGet(base + 'version.txt?' + bust)).responseText || '').trim();
      }
      if (!/^\d+(\.\d+)*$/.test(v)) throw new Error('no version file');
      const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
      const newer = cmp(v, WSP_VERSION) > 0;
      if (!newer) { if (manual) toast(`\u2705 You're on the latest version (v${WSP_VERSION})`); return; }
      if (updReady === v) { if (manual) location.reload(); return; }
      let code = '';
      try {
        const r = await fetch(FROM_LOADER + (FROM_LOADER.includes('?') ? '&' : '?') + bust, { cache: 'no-store' });
        code = await r.text();
      } catch (e) {
        if (typeof PDA_httpGet === 'function') code = String((await PDA_httpGet(FROM_LOADER + '?' + bust)).responseText || '');
      }
      // GitHub's cache can lag behind version.txt (especially after quick back-to-back updates):
      // take whatever copy is newer than the one running, even if it isn't the very latest yet
      const cv = ((code.match(/@version\s+([\d.]+)/) || [])[1]) || '';
      if (code.length < 20000 || !code.includes('WarStatusPlus') || !cv || cmp(cv, WSP_VERSION) <= 0) {
        if (manual) toast('\u23f3 New version is on its way, try again in a minute');
        return;
      }
      v = cv;
      try { localStorage.setItem('wsp_code', code); localStorage.setItem('wsp_code_chk', String(Date.now())); } catch (e) { return; }
      updReady = v;
      if (manual) { location.reload(); return; }
      const t = document.createElement('div');
      t.className = 'wsp-toast';
      t.dataset.reload = '1';
      t.textContent = `\u2b06\ufe0f v${v} is ready \u2014 tap here to load it (or it loads on your next page)`;
      toasts.appendChild(t);
      setTimeout(() => t.remove(), 60000);
    } catch (e) {
      if (manual) toast('Could not check for updates right now');
    }
  }
  if (FROM_LOADER) { setTimeout(checkUpdate, 15000); setInterval(() => { if (!document.hidden) checkUpdate(); }, 120000); }

  // Tell people when an auto-update has landed
  {
    const lastV = load('wsp_lastver', null);
    if (lastV && lastV !== WSP_VERSION) setTimeout(() => toast(`\u2705 JSim War Station Plus updated to v${WSP_VERSION}`), 2000);
    save('wsp_lastver', WSP_VERSION);
  }

  /* ================= Main loop ================= */
  setInterval(() => {
    ensureAttached();
    applyTheme();
    highlightArmoury();
    highlightTravel();
    propTick();
    const now = Date.now();
    const active = S.open || cfg.bg;
    if (active && !document.hidden) {
      if (!S.loading && now - S.at > REFRESH_MS) refresh();
      if (S.chain && S.chain.current >= cfg.chainMin && !(S.chain.cooldown > 0)) {
        const rem = chainLeft();
        if (rem < 90 && rem > -30 && !S.chainLoading && now - S.chainAt > CHAIN_FAST_MS) refreshChain();
      }
      checkAlerts();
    }
    if (S.open && cfg.callsUrl && now - S.callsAt > CALLS_MS) loadCalls();
    const ad = S.open && S.view === 'list' && ADDONS[S.tab];
    if (ad && ad.tick && !ad.error) { try { ad.tick(); } catch (err) { ad.error = err; S.dirty = true; } }
    if (S.open) render();
  }, 1000);
})();

/* ===================== Intel tab (built in) ===================== */
(function () {
  'use strict';
  let registered = false;

  function start() {
    const W = window.WarStatusPlus;
    if (!W || registered || !W.addTab) return;
    registered = true;
    let impl = null, initError = null;
    try { impl = makeIntel(W); } catch (e) { initError = e; }
    W.addTab({
      id: 'intel',
      label: 'Intel',
      error: initError,
      render: () => impl.render(),
      tick: () => impl.tick(),
      onAction: (act, el) => impl.action(act, el)
    });
  }
  if (window.WarStatusPlus) start();
  window.addEventListener('warstatusplus:ready', start);
  let tries = 0; // in case the two scripts load in an unusual order
  const wait = setInterval(() => { if (registered || ++tries > 30) clearInterval(wait); else start(); }, 500);

  function makeIntel(W) {
    const style = document.createElement('style');
    style.textContent = `
  .wsp-ichips{display:flex;align-items:center;gap:6px;padding:8px 10px 4px;}
  .wsp-ichips button{flex:1;padding:5px 0;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:6px;font-weight:700;font-size:12px;}
  .wsp-ichips button.on{background:var(--accent);border-color:var(--accent);color:#111;}
  .wsp-iwar{margin:4px 10px 8px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);display:flex;flex-direction:column;gap:2px;}
  .wsp-iwar .t{font-weight:700;font-size:13px;}
  .wsp-iwar .s{font-size:12px;font-variant-numeric:tabular-nums;}
  .wsp-iwar .n{font-size:10.5px;color:var(--muted);}
  .wsp-isum{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:0 10px 6px;}
  .wsp-isum div{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:5px 4px;text-align:center;}
  .wsp-isum b{display:block;font-size:15px;}
  .wsp-isum span{display:block;font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;}
  .wsp-irow{display:grid;grid-template-columns:minmax(0,1fr) 34px 40px 30px 76px;gap:4px;align-items:center;padding:4px 10px;border-bottom:1px solid var(--line2);}
  .wsp-irow a{color:var(--text);font-weight:600;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .wsp-irow span{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;border-radius:3px;padding:1px 3px;}
  .wsp-irow span.hot{color:#fff;background:#c62828;}
  .wsp-irow span.warm{background:rgba(255,120,60,.3);}
  .wsp-irow span.na,.wsp-irow span.zero{color:var(--faint);font-weight:500;}
  .wsp-irow span.inf{text-align:center;font-size:11px;white-space:nowrap;}
  .wsp-irow span.inf.x{background:rgba(255,176,0,.22);color:var(--text);}
  .wsp-irow span.inf.v{background:rgba(160,90,255,.28);color:var(--text);}
  .wsp-irow span.inf.o{background:#c62828;color:#fff;}
  .wsp-irow span.inf b{font-weight:800;margin-right:3px;}
  .wsp-legend{display:flex;flex-wrap:wrap;gap:4px 10px;padding:4px 10px 0;font-size:10.5px;color:var(--muted);}
  .wsp-legend i{font-style:normal;font-weight:700;padding:0 4px;border-radius:3px;margin-right:3px;}
  .wsp-legend .x{background:rgba(255,176,0,.22);color:var(--text);} .wsp-legend .v{background:rgba(160,90,255,.28);color:var(--text);} .wsp-legend .o{background:#c62828;color:#fff;}
  .wsp-irow .exm{display:inline-block;margin-left:5px;padding:0 3px;border-radius:3px;border:1px dashed var(--muted);color:var(--muted);font-size:9.5px;font-weight:700;vertical-align:1px;}
  .wsp-irow .od{display:inline-block;margin-left:5px;padding:0 4px;border-radius:3px;background:#c62828;color:#fff;font-size:10px;font-weight:700;vertical-align:1px;}
  .wsp-irow.head{position:sticky;top:0;z-index:1;background:var(--bg);border-bottom:1px solid var(--line);}
  .wsp-irow.head span{background:none;font-size:10px;text-transform:uppercase;color:var(--muted);cursor:pointer;}
  .wsp-irow.head span:first-child{text-align:left;}
  .wsp-irow.head span.on{color:var(--accent);}
  #wsp-panel.dark .wsp-iwar .t{font-family:var(--cond);font-size:16px;letter-spacing:.6px;text-transform:uppercase;}
  #wsp-panel.dark .wsp-iwar .s,#wsp-panel.dark .wsp-irow span,#wsp-panel.dark .wsp-isum b{font-family:var(--num);}
  #wsp-panel.dark .wsp-isum b{color:var(--accent);}
  #wsp-panel.dark .wsp-ichips button,#wsp-panel.dark .wsp-irow.head span{font-family:var(--cond);letter-spacing:.8px;text-transform:uppercase;}
  #wsp-panel.dark .wsp-ichips button{font-size:14px;border-radius:3px;}
  #wsp-panel.dark .wsp-irow:not(.head){background:rgba(12,16,14,.72);}
    `;
    document.head.appendChild(style);

    const intel = { view: null, sort: W.load('wsp_intel2_sort', 'x'), side: W.load('wsp_intel_side', 'enemy') };
    const src = { enemy: { data: null, err: '', at: 0, busy: false }, own: { data: null, err: '', at: 0, busy: false } };

    function trackerUrl(which) {
      const key = which === 'own' ? 'trackerUrl2' : 'trackerUrl';
      if (W.cfg && W.cfg[key]) return W.cfg[key];
      const c = W.load('wsp_cfg', {});
      return (c && c[key]) || '';
    }

    async function loadIntel(which) {
      const st = src[which];
      const u = trackerUrl(which);
      if (!u) { st.err = 'notracker'; return; }
      if (st.busy) return;
      st.busy = true;
      st.at = Date.now();
      try {
        const j = await W.getJSON(u + (u.includes('?') ? '&' : '?') + 'intel=1&t=' + Date.now());
        if (!j || j.error) st.err = 'Tracker: ' + ((j && j.error) || 'no reply');
        else if (!('war' in j)) st.err = 'oldtracker';
        else { st.data = j; st.err = ''; pushInfluence(which); }
      } catch (e) {
        st.err = 'Tracker unreachable';
      }
      st.busy = false;
      W.redraw();
    }
    function loadAll(force) {
      ['enemy', 'own'].forEach(w => { if (force || Date.now() - src[w].at > 60000) loadIntel(w); });
    }

    let lastDraw = 0;
    function tick() {
      if (Date.now() - src.enemy.at > 60000 || Date.now() - src.own.at > 60000) loadAll();
      else if (Date.now() - lastDraw > 30000) { lastDraw = Date.now(); W.redraw(); }
    }

    const clock = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const day = ts => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const span = sec => {
      const m = Math.max(0, Math.round(sec / 60));
      if (m < 60) return m + 'm';
      const h = Math.floor(m / 60);
      return h < 24 ? h + 'h ' + (m % 60) + 'm' : Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    };

    const short = sec => { // compact age for the table: 43m / 9h / 2d
      const m = Math.max(0, Math.round(sec / 60));
      return m < 60 ? m + 'm' : m < 48 * 60 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
    };

    // Average cooldowns from Torn's wiki: Xanax 6-8h, Vicodin 4-6h, overdose adds ~24-25h
    const COOL = { x: 7 * 3600, v: 5 * 3600, o: 24.5 * 3600 };
    const NAME = { x: 'Xan', v: 'Vic', o: 'OD' };
    const LONG = { x: 'Xanax', v: 'Vicodin', o: 'an overdose' };
    function influence(r, now) {
      const c = [];
      if (r.lx) c.push({ t: 'x', from: r.lx[0], to: r.lx[1] });
      if (r.lv) c.push({ t: 'v', from: r.lv[0], to: r.lv[1] });
      if (r.lo) c.push({ t: 'o', from: r.lo[0], to: r.lo[1] });
      if (r.odNow && r.odSeen) c.push({ t: 'o', from: r.odSeen - 60, to: r.odSeen });
      c.forEach(e => { e.end = (e.from + e.to) / 2 + COOL[e.t]; });
      const active = c.filter(e => e.end > now);
      if (!active.length) return null;
      // An active overdose matters most; otherwise show whichever effect lasts longest
      const pool = active.some(e => e.t === 'o') ? active.filter(e => e.t === 'o') : active;
      const best = pool.reduce((a, b) => (b.end > a.end ? b : a));
      best.left = best.end - now;
      best.text = `Took ${LONG[best.t]} between ${clock(best.from)} and ${clock(best.to)} TCT. ` +
        `Estimated clear around ${clock(best.end)} TCT` + (best.t === 'o' ? '.' : ' (cooldowns vary by about an hour either way).');
      return best;
    }
    const hm = sec => { const m = Math.max(0, Math.round(sec / 60)); return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };

    // Share who is on what with the main panel, for its Live FF column
    function pushInfluence(which) {
      const d = src[which].data;
      if (!W.setInfluence || !d || !d.members) return;
      const now = Date.now() / 1000, map = {};
      for (const id in d.members) {
        const inf = influence(d.members[id], now);
        if (inf) map[id] = { t: inf.t };
      }
      W.setInfluence(map, which === 'own' ? 'mine' : 'enemy');
    }
    // Keep it fresh while the panel is open, even when another tab is showing
    setInterval(() => {
      if (!W.state.open) return;
      loadAll();
      pushInfluence('enemy'); pushInfluence('own');
    }, 30000);
    setTimeout(() => loadAll(true), 1500);

    function render() {
      const side = intel.side === 'own' ? 'own' : 'enemy';
      const st = src[side];
      const enemy = side === 'own' ? W.state.mine : W.state.enemy;
      const sideChips = `<div class="wsp-ichips"><button data-act="iside" data-v="enemy" class="${side === 'enemy' ? 'on' : ''}">Enemy</button>` +
        `<button data-act="iside" data-v="own" class="${side === 'own' ? 'on' : ''}">Ours</button></div>`;
      return sideChips + renderSide(side, st, enemy);
    }

    function renderSide(side, intelSrc, enemy) {
      const intel2 = intelSrc;
      if (intel2.err === 'notracker') return side === 'own'
        ? '<div class="wsp-msg">To see your own faction, set up a second tracker with <b>WATCH = \'own\'</b> on another free Google account, then add its URL in Settings &rarr; Own faction tracker.</div>'
        : '<div class="wsp-msg">Intel needs the JSim War Station Plus tracker.<br>Add its web app URL in Settings &rarr; Tracker, then tap Save.</div>';
      if (intel2.err === 'oldtracker') return '<div class="wsp-msg">Your tracker is the older version.<br>Paste the new tracker code into Google Apps Script, run <b>setup</b>, then redeploy it as a new version.</div>';
      if (intel2.err && !intel2.data) return `<div class="wsp-msg">${W.esc(intel2.err)}</div>`;
      if (!intel2.data) { tick(); return '<div class="wsp-msg">Loading intel from your tracker...</div>'; }
      const d = intel2.data, war = d.war;
      if (!war) return '<div class="wsp-msg">No ranked war scheduled.<br>Intel starts as soon as your next war is announced.</div>';
      if (enemy && String(enemy.ID) !== String(war.factionId || war.enemyId)) return '<div class="wsp-msg">This tracker is watching a different faction. Check that WATCH is set right in its Google script.</div>';

      const now = Date.now() / 1000;
      const view = intel.view || (war.phase === 'pre' ? 'pre' : 'war');
      let html = `<div class="wsp-ichips">
        <button data-act="iview" data-v="pre" class="${view === 'pre' ? 'on' : ''}">Pre-war</button>
        <button data-act="iview" data-v="war" class="${view === 'war' ? 'on' : ''}">War</button></div>`;

      // Status card
      const name = W.state.enemy ? W.esc(W.state.enemy.name) : 'enemy';
      const head = war.phase === 'pre' ? `War vs ${name} starts in ${span(war.start - now)}`
        : war.phase === 'war' ? `War vs ${name} on &middot; ${span(now - war.start)} in`
        : `War vs ${name} ended ${span(now - war.end)} ago`;
      const since = `${day(war.seenAt)} ${clock(war.seenAt)} TCT`;
      const watch = war.late ? `Counting since ${since}, after the war started, so earlier drug use isn't included.`
        : `Counting since ${since}.`;
      const cov = d.coverage && d.coverage.oldest ? ` Everyone is re-checked about every 15-20 min; oldest check ${span(now - d.coverage.oldest)} ago.` : '';
      html += `<div class="wsp-iwar"><div class="t">${head}</div>
        <div class="s">Starts ${day(war.start)} ${clock(war.start)} TCT${war.end ? ' &middot; ended ' + day(war.end) + ' ' + clock(war.end) : ''}</div>
        <div class="n">${watch}${cov}</div></div>`;

      if (view === 'war' && war.phase === 'pre') {
        return html + '<div class="wsp-msg">The war has not started yet. War numbers begin at the start time.</div>';
      }

      // Rows
      const members = (enemy && enemy.members) || {};
      const vicFrom = Object.values(d.members).map(m => m.pre && m.pre.v6from).find(Boolean);
      const rows = Object.keys(members).map(id => {
        const r = d.members[id] || {};
        const src = view === 'pre' ? r.pre : r.war;
        return {
          id, name: members[id].name, odNow: r.odNow, ex: r.ex || 0,
          x: src ? src.x : null,
          v: src ? (view === 'pre' ? src.v6 : src.v) : null,
          o: src ? src.o : null,
          inf: influence(r, now)
        };
      });

      // Summary
      const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
      const vicLabel = view === 'pre' ? `vicodin last ${war.vicHours}h` : 'vicodin';
      const vicVal = view === 'pre' && !vicFrom ? '&ndash;' : sum('v');
      html += `<div class="wsp-isum">
        <div><b>${sum('x')}</b><span>xanax</span></div>
        <div><b>${vicVal}</b><span>${vicLabel}</span></div>
        <div><b>${sum('o')}</b><span>overdoses</span></div>
        <div><b>${rows.filter(r => r.x > 0).length}</b><span>took xanax</span></div></div>`;
      if (view === 'pre' && !vicFrom) html += `<div class="wsp-help" style="padding-top:0">Vicodin counting starts ${war.vicHours} hours before the war (${clock(war.start - war.vicHours * 3600)} TCT).</div>`;

      html += '<div class="wsp-legend"><span><i class="x">Xan</i>-35% battle stats, +250 energy</span><span><i class="v">Vic</i>+25% battle stats</span><span><i class="o">OD</i>energy drained, long cooldown</span></div>';

      // Table
      const cols = [['x', 'Xan'], ['v', view === 'pre' ? 'Vic ' + war.vicHours + 'h' : 'Vic'], ['o', 'OD'], ['inf', 'Under influence']];
      const key = intel.sort;
      rows.sort((a, b) => {
        if (key === 'name') return a.name.localeCompare(b.name);
        if (key === 'inf') return (b.inf ? b.inf.left : -1) - (a.inf ? a.inf.left : -1);
        return (b[key] == null ? -1 : b[key]) - (a[key] == null ? -1 : a[key]);
      });
      html += `<div class="wsp-irow head"><span data-act="isort" data-k="name" class="${key === 'name' ? 'on' : ''}">Member</span>${cols.map(([k, l]) =>
        `<span data-act="isort" data-k="${k}" class="${key === k ? 'on' : ''}">${l}${key === k ? ' &#9662;' : ''}</span>`).join('')}</div>`;
      for (const r of rows) {
        const cell = (v, hot, warm) => v == null ? '<span class="na">&ndash;</span>'
          : `<span class="${v === 0 ? 'zero' : v >= hot ? 'hot' : v >= warm ? 'warm' : ''}">${v}</span>`;
        const inf = r.inf ? `<span class="inf ${r.inf.t}" title="${r.inf.text}"><b>${NAME[r.inf.t]}</b>${hm(r.inf.left)}</span>`
          : '<span class="na" title="No active drug effect seen since the tracker started watching">&ndash;</span>';
        html += `<div class="wsp-irow"><a href="/profiles.php?XID=${r.id}"${r.inf ? ` title="${r.inf.text}"` : ''}>${W.esc(r.name)}${r.odNow ? '<span class="od">OD</span>' : ''}${r.ex ? `<span class="exm" title="${r.ex} more showed up in Torn's stats than the drug cooldowns allow in that time. Torn's figures were catching up, so those were not counted.">+${r.ex}?</span>` : ''}</a>` +
          cell(r.x, 3, 1) + cell(r.v, 2, 1) + cell(r.o, 1, 1) + inf + '</div>';
      }
      html += '<div class="wsp-help" style="padding-top:8px">' + (view === 'pre'
        ? 'Pre-war: Xanax and overdoses since the war was announced, Vicodin in the last hours before it starts.'
        : 'War: everything since the war started.') +
        ' Counts are checked against drug cooldowns: anything Torn reports that could not have happened in the time is left out and shown as +N? next to the name.' +
        ' Under influence counts down to when their drug cooldown should end, using Torn\'s average cooldowns (Xanax 7h, Vicodin 5h, overdose about 24h) and the 15-20 min check window. Tap and hold for the details.</div>';
      return html;
    }

    return {
      render,
      tick,
      action(act, el) {
        if (act === 'iview') intel.view = el.dataset.v;
        if (act === 'iside') { intel.side = el.dataset.v; W.save('wsp_intel_side', intel.side); }
        if (act === 'isort') { intel.sort = el.dataset.k; W.save('wsp_intel2_sort', intel.sort); }
        W.redraw();
      }
    };
  }
})();
