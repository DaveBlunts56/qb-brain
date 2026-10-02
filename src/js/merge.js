/* ============================================================
   MERGE — combine this device's copy of a document with the cloud's copy.
   Nothing a player did on either device should be lost:
     profile  — every rep from both (matched by time + play + result), oldest first, last 600 kept
     plays    — each play keeps its newest edit; a play deleted on any device stays deleted
     tutorial — a lesson finished anywhere counts as finished
     progress — every session from both (the longer copy of one session wins), training days, the best of each record
     settings — whichever device changed them last
   Documents are {upd, data}; either side may be null.
============================================================ */
const PROFILE_CAP = 600;

function mergeDocs(kind, a, b){
  if(!a) return b ? clone(b) : null;
  if(!b) return clone(a);
  const upd = Math.max(a.upd || 0, b.upd || 0);
  const newer = (a.upd || 0) >= (b.upd || 0) ? a : b;
  switch(kind){
    case "profile":  return { upd, data: mergeProfile(a.data, b.data) };
    case "plays":    return { upd, data: mergePlays(a.data, b.data, newer === a) };
    case "progress": return { upd, data: mergeProgress(a.data, b.data) };
    case "tutorial": return { upd, data: Object.assign({}, b.data || {}, a.data || {}) };
    default:         return clone(newer);
  }
}
function mergeProfile(x, y){
  const seen = new Set(), recs = [];
  [].concat((x && x.recs) || [], (y && y.recs) || []).forEach(r => {
    const k = r.t + "|" + (r.con || "") + "|" + (r.res || "") + "|" + (r.cov || "");
    if(!seen.has(k)){ seen.add(k); recs.push(r); }
  });
  recs.sort((p, q) => p.t - q.t);
  return { v: 1, recs: recs.slice(-PROFILE_CAP) };
}
const LOWER_WINS = { spd: true };
function mergeProgress(x, y){
  x = x || {}; y = y || {};
  const byT = new Map();
  [].concat(x.sessions || [], y.sessions || []).forEach(s => { if(!s || s.t == null) return; const c = byT.get(s.t); if(!c || (s.n || 0) > (c.n || 0) || ((s.n || 0) === (c.n || 0) && (s.e || 0) > (c.e || 0))) byT.set(s.t, s); });
  const sessions = Array.from(byT.values()).sort((p, q) => p.t - q.t).slice(-400);
  const days = Object.assign({}, x.days || {});
  Object.keys(y.days || {}).forEach(k => { days[k] = Math.max(days[k] || 0, y.days[k]); });
  const best = Object.assign({}, x.best || {});
  Object.keys(y.best || {}).forEach(k => { const a = best[k], b = y.best[k]; if(!b) return;
    if(!a || (LOWER_WINS[k] ? b.v < a.v : b.v > a.v)) best[k] = b; });
  return clone({ v: 1, sessions, days, best });
}
function mergePlays(x, y, xIsNewer){
  x = x || {}; y = y || {};
  const gone = Object.assign({}, y.gone || {}, x.gone || {});
  Object.keys(y.gone || {}).forEach(u => { gone[u] = Math.max(gone[u] || 0, y.gone[u]); });
  const byId = new Map(), order = [];
  [].concat(x.plays || [], y.plays || []).forEach(p => {
    if(!p || !p.uid) return;
    const cur = byId.get(p.uid);
    if(!cur){ byId.set(p.uid, p); order.push(p.uid); }
    else if((p.upd || 0) > (cur.upd || 0)) byId.set(p.uid, p);
  });
  const plays = order.map(u => byId.get(u)).filter(p => !(gone[p.uid] && gone[p.uid] >= (p.upd || 0)));
  const audibles = Object.assign({}, xIsNewer ? (y.audibles || {}) : (x.audibles || {}), xIsNewer ? (x.audibles || {}) : (y.audibles || {}));
  return { plays: clone(plays), audibles, gone };
}
function sameDoc(a, b){ return JSON.stringify(a ? a.data : null) === JSON.stringify(b ? b.data : null); }
function clone(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }

export function init(){}
export { mergeDocs, mergeProfile, mergeProgress, mergePlays, sameDoc };
