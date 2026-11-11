/**
 * War Status+ Tracker v2.6 - runs on Google's servers every minute, even when TornPDA is closed.
 *
 * 1. Records when players take off and land, so War Status+ can show accurate flight ETAs
 *    and work out each player's travel method (standard, airstrip, WLT jet or business class).
 * 2. War intel: while a ranked war is coming up or running, it checks every enemy's
 *    lifetime Xanax, Vicodin and overdose counts, so the Intel tab can show:
 *      - pre-war: Xanax since the war was announced, Vicodin in the last 6 hours, overdoses
 *      - during the war: Xanax, Vicodin and overdoses since it started
 *      - when each enemy last took a Xanax
 *
 * Two trackers: run one with WATCH = 'enemy' (also records flight times) and, on a second free
 * Google account, one with WATCH = 'own' to watch your own faction's drug use.
 *
 * Setup: paste this over everything in Code.gs, fill in SETTINGS, save, run "setup".
 * If you had already deployed it as a web app: Deploy > Manage deployments > edit (pencil) >
 * Version: New version > Deploy. The URL stays the same.
 *
 * To pause: run "stop". To start again: run "setup".
 */

/* ------------------------- SETTINGS ------------------------- */
const TORN_KEY = 'PASTE_YOUR_TORN_API_KEY';   // Public access is enough
const WATCH = 'enemy';                        // 'enemy' = watch the enemy faction, 'own' = watch your own faction
const ENEMY_FACTION_ID = '';                  // optional: faction to track when there's no ranked war (enemy mode)
const CHECKS_PER_MINUTE = 6;                  // normal rolling checks of enemy members
const BURST_PER_MINUTE = 30;                  // right after 6h-before, war start and war end
const VICODIN_WINDOW_HOURS = 6;
/* ------------------------------------------------------------ */

function setup() {
  stop();
  ScriptApp.newTrigger('track').timeBased().everyMinutes(1).create();
  run();
  console.log('Tracker is on and checking every minute.');
}

function stop() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Tracker stopped.');
}

function track() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try { run(); } catch (err) { console.error(err); } finally { lock.releaseLock(); }
}

function run() {
  const now = Math.floor(Date.now() / 1000);
  const mine = api('faction/', 'basic');
  const own = WATCH === 'own';
  if (!own) record(mine, now);

  // Current or upcoming ranked war
  let eid = '', war = null;
  for (const id in (mine.ranked_wars || {})) {
    const w = mine.ranked_wars[id];
    const ended = w.war && w.war.end && w.war.end < now - 3 * 3600; // keep watching 3h after the end
    if (!ended && w.factions) {
      eid = Object.keys(w.factions).find(f => String(f) !== String(mine.ID)) || '';
      if (eid) { war = { id: String(id), start: w.war.start, end: w.war.end || 0 }; break; }
    }
  }
  if (own) {
    if (war) watchWar(war, mine, now);
  } else {
    if (!eid) eid = ENEMY_FACTION_ID;
    if (eid) {
      const enemy = api(`faction/${eid}`, 'basic');
      record(enemy, now);
      if (war) watchWar(war, enemy, now);
    }
  }
  PropertiesService.getScriptProperties().setProperty('at', String(now));
}

/* ------------------------- flight times ------------------------- */
// trips:   id -> [description, first seen flying, last seen NOT flying, last seen flying]
// methods: id -> [method, flight time / standard time, when learned]
function record(f, now) {
  const P = PropertiesService.getScriptProperties();
  const fid = String(f.ID);
  const trips = JSON.parse(P.getProperty('trips_' + fid) || '{}');
  const last = JSON.parse(P.getProperty('last_' + fid) || '{}');
  const methods = JSON.parse(P.getProperty('methods_' + fid) || '{}');
  const nextTrips = {}, nextLast = {};
  for (const id in (f.members || {})) {
    const st = f.members[id].status || {};
    const d = st.description || '';
    if (isFlying(st)) {
      const t = trips[id];
      const trip = t && t[0] === d ? t : [d, now, last[id] || 0, now];
      trip[3] = now;
      nextTrips[id] = trip;
      if (last[id]) nextLast[id] = last[id];
    } else {
      if (trips[id]) learnMethod(methods, id, trips[id], now); // just landed
      nextLast[id] = now;
    }
  }
  P.setProperty('trips_' + fid, JSON.stringify(nextTrips));
  P.setProperty('last_' + fid, JSON.stringify(nextLast));
  P.setProperty('methods_' + fid, JSON.stringify(methods));
}

// Standard one-way flight times in minutes, and how much faster each method is
const FLIGHT_MIN = { 'Mexico': 26, 'Cayman Islands': 35, 'Canada': 41, 'Hawaii': 134, 'United Kingdom': 159,
  'Argentina': 167, 'Switzerland': 175, 'Japan': 225, 'China': 242, 'UAE': 271, 'South Africa': 297 };
const METHODS = [['std', 1], ['air', 0.7], ['wlt', 0.5], ['bct', 0.3]];

function learnMethod(methods, id, trip, now) {
  const d = trip[0], seen = trip[1], after = trip[2], lastFly = trip[3];
  // Only learn from a flight whose take-off and landing were both seen to within 3 minutes
  if (!after || seen - after > 180 || !lastFly || now - lastFly > 180) return;
  const std = FLIGHT_MIN[destOf(d)];
  if (!std) return;
  const ratio = (((now + lastFly) / 2 - (seen + after) / 2) / 60) / std;
  let best = null;
  for (const m of METHODS) { const diff = Math.abs(ratio - m[1]); if (!best || diff < best.diff) best = { k: m[0], diff }; }
  if (best.diff > 0.08) return; // doesn't match any method closely enough
  methods[id] = [best.k, Math.round(ratio * 100) / 100, now];
}

function destOf(d) {
  let m = d.match(/from\s+torn\s+to\s+(.+)/i) || d.match(/travel+ing\s+to\s+(?!torn\b)(.+)/i) ||
          d.match(/returning\s+(?:to\s+torn\s+)?from\s+(.+)/i) || d.match(/from\s+(.+?)\s+to\s+torn/i);
  if (!m) return '';
  const c = m[1].replace(/[.\s]+$/, '').trim();
  return c === 'United Arab Emirates' ? 'UAE' : c;
}

function isFlying(st) {
  if (st.state === 'Traveling') return true;
  return /from\s+torn\s+to|travel+ing\s+to|returning\s+to\s+torn/i.test(st.description || '');
}

/* ------------------------- war intel ------------------------- */
// Per member: b = first check (baseline), p6 = first check after 6h-before-start,
// s = first check after start, e = first check after end, l = latest check.
// Each check is [xanax, vicodin, overdoses, time]. lx / lv / lo = window when the last Xanax / Vicodin / overdose happened.
function watchWar(war, enemy, now) { // 'enemy' is whichever faction is being watched
  let W = getBig('intel');
  if (!W || W.id !== war.id) {
    W = { id: war.id, factionId: String(enemy.ID), start: war.start, end: war.end, seenAt: now,
          late: now >= war.start, m: {} };
  }
  W.start = war.start;
  W.end = war.end;
  if (!W.v || W.v < 25) { // before v2.5 nothing was read (Torn now needs the stat names), so start counting afresh
    for (const id in W.m) W.m[id] = { odNow: W.m[id].odNow || 0, odUntil: W.m[id].odUntil, odSeen: W.m[id].odSeen };
    W.cntSince = now; W.v = 26;
  }
  if (W.v === 25) { // v2.5 set aside doses closer together than 6h; Torn's figures are live, so count them all
    for (const id in W.m) {
      const rec = W.m[id];
      delete rec.cnt; delete rec.ex; delete rec.nd; delete rec.lx; delete rec.lv; delete rec.lo;
      (rec.h || []).forEach(h => { h.length = 5; credit(W, rec, h[0], h[1], h[2], h[3], h[4], true); });
    }
    W.v = 26;
  }
  if (!W.cntSince) W.cntSince = now; // plausibility-checked counting starts here

  const marks = [war.start - VICODIN_WINDOW_HOURS * 3600, war.start];
  if (war.end) marks.push(war.end);
  const ids = Object.keys(enemy.members || {});

  // Overdoses seen in hospital status (to the minute, free)
  for (const id of ids) {
    const st = enemy.members[id].status || {};
    const text = (st.description || '') + ' ' + (st.details || '');
    const rec = W.m[id] || (W.m[id] = {});
    if (st.state === 'Hospital' && /overdos/i.test(text)) {
      if (!rec.odNow) rec.odSeen = now; // a new overdose stay (a changed hospital time is the same stay)
      rec.odUntil = st.until;
      rec.odNow = 1;
    } else {
      rec.odNow = 0;
    }
  }

  // Who needs checking: anyone not checked since a key moment that has just passed, then the oldest checks
  const lastT = id => (W.m[id] && W.m[id].l ? W.m[id].l[3] : 0);
  const urgent = ids.filter(id => marks.some(t => t <= now && lastT(id) < t)).sort((a, b) => lastT(a) - lastT(b));
  let pick = urgent.slice(0, BURST_PER_MINUTE);
  if (!pick.length) pick = ids.slice().sort((a, b) => lastT(a) - lastT(b)).slice(0, CHECKS_PER_MINUTE);

  if (pick.length) {
    // Torn only returns another player's personal stats when you name the ones you want
    const reqs = pick.map(id => ({ url: `https://api.torn.com/user/${id}?selections=personalstats&stat=xantaken,victaken,overdosed&key=${TORN_KEY}&comment=WarTracker`, muteHttpExceptions: true }));
    const res = UrlFetchApp.fetchAll(reqs);
    res.forEach((r, i) => {
      let j;
      try { j = JSON.parse(r.getContentText()); } catch (e) { return; }
      const rec = W.m[pick[i]];
      if (!j || j.error || !j.personalstats) { rec.err = j && j.error ? String(j.error.error || j.error.code) : 'no reply'; return; }
      const ps = readStats(j.personalstats);
      if (ps.xantaken == null) { rec.err = 'no xanax figure in reply'; return; } // never record a missing figure as 0
      delete rec.err;
      const snap = [Number(ps.xantaken) || 0, Number(ps.victaken) || 0, Number(ps.overdosed) || 0, now];
      if (!rec.b) rec.b = snap;
      if (rec.l) {
        const dx = snap[0] - rec.l[0], dv = snap[1] - rec.l[1], dO = snap[2] - rec.l[2];
        if (dx > 0 || dv > 0 || dO > 0) credit(W, rec, rec.l[3], now, Math.max(0, dx), Math.max(0, dv), Math.max(0, dO));
      }
      if (now >= W.start - VICODIN_WINDOW_HOURS * 3600 && !rec.p6) rec.p6 = snap;
      if (now >= W.start && !rec.s) rec.s = snap;
      if (W.end && now >= W.end && !rec.e) rec.e = snap;
      rec.l = snap;
    });
  }
  putBig('intel', W);
}

// The reply is either { xantaken: n, ... } or a list of { name, value }
function readStats(ps) {
  if (!Array.isArray(ps)) return ps;
  const o = {};
  ps.forEach(x => { if (x && x.name != null) o[x.name] = x.value; });
  return o;
}

// War Status+ asks for data here
function doGet(e) {
  const P = PropertiesService.getScriptProperties();
  if (e.parameter.intel) return json(intelReport());
  if (e.parameter.raw) { // e.g. ...exec?raw=1234567 to see one player's readings
    const W = getBig('intel');
    const r = W && W.m[e.parameter.raw];
    if (!r) return json({ error: 'not found' });
    const t = x => x ? Utilities.formatDate(new Date(x * 1000), 'UTC', 'dd MMM HH:mm') : '';
    return json({ countingSince: t(W.cntSince), error: r.err || null, first: r.b, latest: r.l, counted: r.cnt || null, notCounted: r.ex || 0,
      increases: (r.h || []).map(h => ({ between: t(h[0]) + ' - ' + t(h[1]) + ' TCT', xanax: h[2], vicodin: h[3], od: h[4],
        counted: h.length > 5 ? { xanax: h[5], vicodin: h[6], od: h[7] } : 'before counting started' })) });
  }
  const out = { at: Number(P.getProperty('at') || 0), trips: {}, methods: {} };
  String(e.parameter.f || '').split(',').filter(Boolean).forEach(fid => {
    const trips = JSON.parse(P.getProperty('trips_' + fid) || '{}');
    for (const id in trips) out.trips[id] = { d: trips[id][0], seen: trips[id][1], after: trips[id][2] || 0 };
    const methods = JSON.parse(P.getProperty('methods_' + fid) || '{}');
    for (const id in methods) out.methods[id] = methods[id];
  });
  return json(out);
}

// Count a rise in someone's lifetime drug totals (Torn's figures are live, so every rise is real use)
function credit(W, rec, from, to, dx, dv, dO, replay) {
  if (!replay) rec.h = (rec.h || []).concat([[from, to, dx, dv, dO]]).slice(-40);
  if (from < W.cntSince) return; // started before checking began
  const c = rec.cnt || (rec.cnt = { px: 0, pv6: 0, po: 0, wx: 0, wv: 0, wo: 0 });
  const cx = dx, cv = dv, co = dO;
  const hh = rec.h.find(h => h[0] === from && h[1] === to) || rec.h[rec.h.length - 1];
  hh.push(cx, cv, co);
  if (cx) rec.lx = [from, to];
  if (cv) rec.lv = [from, to];
  if (co) rec.lo = [from, to];
  if (to < W.start) {
    c.px += cx; c.po += co;
    if (to >= W.start - VICODIN_WINDOW_HOURS * 3600) c.pv6 += cv;
  } else if (!W.end || from < W.end) {
    c.wx += cx; c.wv += cv; c.wo += co;
  }
}

function intelReport() {
  const W = getBig('intel');
  const at = Number(PropertiesService.getScriptProperties().getProperty('at') || 0);
  if (!W) return { at, war: null };
  const phase = at < W.start ? 'pre' : (W.end && at >= W.end ? 'over' : 'war');
  const members = {};
  let oldest = Infinity, newest = 0;
  for (const id in W.m) {
    const r = W.m[id];
    if (!r.b || !r.l) { members[id] = { odNow: r.odNow || 0 }; continue; }
    oldest = Math.min(oldest, r.l[3]); newest = Math.max(newest, r.l[3]);
    const c = r.cnt || { px: 0, pv6: 0, po: 0, wx: 0, wv: 0, wo: 0 };
    const v6from = W.start - VICODIN_WINDOW_HOURS * 3600;
    const out = {
      pre: { x: c.px, o: c.po, v6: at >= v6from ? c.pv6 : null, v6from: at >= v6from ? v6from : null },
      war: at >= W.start ? { x: c.wx, v: c.wv, o: c.wo } : null,
      ex: r.ex || 0,
      lx: r.lx || null, lv: r.lv || null, lo: r.lo || null, odNow: r.odNow || 0, odSeen: r.odSeen || 0, checked: r.l[3]
    };
    members[id] = out;
  }
  return {
    at, watch: WATCH, war: { id: W.id, factionId: W.factionId || W.enemyId, enemyId: WATCH === 'own' ? '' : (W.factionId || W.enemyId), start: W.start, end: W.end, seenAt: W.cntSince || W.seenAt, late: (W.cntSince || W.seenAt) > W.start, phase,
               vicHours: VICODIN_WINDOW_HOURS },
    coverage: { oldest: oldest === Infinity ? 0 : oldest, newest, checked: Object.values(members).filter(m => m.checked).length,
                failed: Object.keys(W.m).filter(id => W.m[id].err).length,
                why: (Object.values(W.m).find(r => r.err) || {}).err || '' },
    members
  };
}

/* ------------------------- helpers ------------------------- */
// Script properties hold up to 9 KB each, so big data is split across several
function putBig(name, obj) {
  const P = PropertiesService.getScriptProperties();
  const s = JSON.stringify(obj);
  const parts = Math.ceil(s.length / 8000) || 1;
  const old = Number(P.getProperty(name + '_n') || 0);
  const props = {};
  for (let i = 0; i < parts; i++) props[name + '_' + i] = s.slice(i * 8000, (i + 1) * 8000);
  props[name + '_n'] = String(parts);
  P.setProperties(props);
  for (let i = parts; i < old; i++) P.deleteProperty(name + '_' + i);
}

function getBig(name) {
  const P = PropertiesService.getScriptProperties();
  const n = Number(P.getProperty(name + '_n') || 0);
  if (!n) return null;
  let s = '';
  for (let i = 0; i < n; i++) s += P.getProperty(name + '_' + i) || '';
  try { return JSON.parse(s); } catch (e) { return null; }
}

function api(path, selections) {
  const r = UrlFetchApp.fetch(`https://api.torn.com/${path}?selections=${selections}&key=${TORN_KEY}&comment=WarTracker`, { muteHttpExceptions: true });
  const j = JSON.parse(r.getContentText());
  if (j.error) throw new Error('Torn API: ' + j.error.error);
  return j;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
