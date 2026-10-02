import { emit, on } from "./config.js";
import { PROFILE } from "./profile.js";
import { rankFor, sessionStats } from "./score.js";
import { state } from "./state.js";
import { load, save } from "./store.js";

/* ============================================================
   PROGRESS — your training history: one short summary per session, the days you trained, personal bests.
   Stored like everything else (store.js, kind "progress"), so it works signed out and syncs when signed in.
   A session's numbers come from the QB Profile reps recorded during it (score.js does the maths).
   doc = { v:1, sessions:[{t, e, m, sq, d, n, plays, sc, read, cov, spd, press, pressN, tw, pts, plan, ch, drive}],
           days:{ "2026-10-02": sessions that day }, best:{ score, cov, spd, streak, reps, drive } }
============================================================ */

const SESSION_CAP = 400, DAY_CAP = 400;
const QUALIFY = 5;           // reps for a session to count toward streaks and the score
let DOC = blank();
function blank(){ return { v: 1, sessions: [], days: {}, best: {} }; }
function loadProgress(){ const o = load("progress", null); DOC = o && Array.isArray(o.sessions) ? Object.assign(blank(), o) : blank(); }
function saveProgress(){ save("progress", DOC); }

function dayKey(t){ const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function addDays(key, n){ const [y, m, d] = key.split("-").map(Number); return dayKey(new Date(y, m - 1, d + n).getTime()); }

/* ---- streaks: consecutive days with at least one 5-rep session. Today not played yet doesn't break it. ---- */
function streakInfo(days, now){
  days = days || DOC.days; const today = dayKey(now || Date.now());
  let cur = 0, k = days[today] ? today : addDays(today, -1);
  while(days[k]){ cur++; k = addDays(k, -1); }
  const keys = Object.keys(days).filter(k2 => days[k2]).sort();
  let best = 0, run = 0, prev = null;
  keys.forEach(k2 => { run = prev && addDays(prev, 1) === k2 ? run + 1 : 1; best = Math.max(best, run); prev = k2; });
  return { current: cur, best: Math.max(best, (DOC.best && DOC.best.streak && DOC.best.streak.v) || 0), today: !!days[today] };
}

/* ---- personal bests (kept separately so they survive the history cap) ---- */
function better(cur, v, lowerWins){ return cur == null || (lowerWins ? v < cur.v : v > cur.v); }
function updateBests(s){
  const B = DOC.best, at = { t: s.t, m: s.m, d: s.d };
  const bump = (k, v, lowerWins) => { if(v == null) return; if(better(B[k], v, lowerWins) || (B[k] && B[k].t === s.t)) B[k] = Object.assign({ v }, at); };
  bump("score", s.sc);
  if(s.covN >= 5) bump("cov", s.cov);
  if(s.spdN >= 5) bump("spd", s.spd, true);
  if(s.n >= QUALIFY) bump("reps", s.n);
  if(s.drive && s.drive.yards != null) bump("drive", s.drive.yards);
  const st = streakInfo().best; if(st > ((B.streak && B.streak.v) || 0)) B.streak = { v: st, t: s.t };
}

/* ---- recording a session ---- */
let last = null;   // what the results screen shows: {session, stats, rankBefore, rankAfter, records}
function sessionRecs(t0){ return PROFILE.recs.filter(r => r.t >= t0); }
function recordSession(final){
  const S = state.session; if(!S || !S.t0 || state.tut) return null;
  const recs = sessionRecs(S.t0);
  if(!recs.length) return null;
  const st = sessionStats(recs), d = state.drive;
  const s = { t: S.t0, e: Date.now(), m: state.mode, sq: st.squad, d: st.diff, n: recs.length, plays: st.plays,
    sc: st.score, read: st.read, cov: st.cov, covN: st.covN, spd: st.spd, spdN: st.spdN, press: st.press, pressN: st.pressN, tw: st.tw,
    pts: S.score, plan: state.plan && state.plan.name || null, ch: S.challenge ? S.challenge.key : null,
    drive: d ? { res: d.result || null, yards: d.yards, plays: d.plays.length } : null };
  // the first time this session is saved, remember the rank and which bests already existed (for "new record!")
  if(!S.before) S.before = { rank: rankFor(DOC.sessions), had: Object.keys(DOC.best).filter(k => DOC.best[k] != null), streak: streakInfo().current };
  const i = DOC.sessions.findIndex(x => x.t === s.t);
  if(i >= 0) DOC.sessions[i] = s; else DOC.sessions.push(s);
  if(DOC.sessions.length > SESSION_CAP) DOC.sessions.splice(0, DOC.sessions.length - SESSION_CAP);
  if(s.n >= QUALIFY && !S.counted){ const k = dayKey(s.t); DOC.days[k] = (DOC.days[k] || 0) + 1; S.counted = true; }
  const dk = Object.keys(DOC.days).sort(); if(dk.length > DAY_CAP) dk.slice(0, dk.length - DAY_CAP).forEach(k => delete DOC.days[k]);
  updateBests(s);
  if(final) S.final = true;
  saveProgress();
  const records = ["score", "cov", "spd", "drive"].filter(k => S.before.had.includes(k) && DOC.best[k] && DOC.best[k].t === s.t);
  last = { session: s, stats: st, rankBefore: S.before.rank, rankAfter: rankFor(DOC.sessions), records, streak: streakInfo(), streakBefore: S.before.streak };
  if(final) emit("progress:session", last);
  return last;
}

/* ---- first run after the update: rebuild sessions from the reps already in the QB Profile ----
   Reps less than 20 minutes apart in the same mode are one session. Marked bf:1 (backfilled). */
function backfill(recs){
  const groups = [];
  recs.forEach(r => { const g = groups[groups.length - 1];
    if(g && r.t - g[g.length - 1].t < 20 * 60 * 1000 && r.m === g[0].m) g.push(r); else groups.push([r]); });
  groups.forEach(g => {
    const st = sessionStats(g);
    const s = { t: g[0].t, e: g[g.length - 1].t, m: g[0].m, sq: st.squad, d: st.diff, n: g.length, plays: st.plays, sc: st.score, read: st.read, cov: st.cov, covN: st.covN,
      spd: st.spd, spdN: st.spdN, press: st.press, pressN: st.pressN, tw: st.tw, pts: null, plan: g[0].plan || null, ch: null, drive: null, bf: 1 };
    DOC.sessions.push(s);
    if(s.n >= QUALIFY){ const k = dayKey(s.t); DOC.days[k] = (DOC.days[k] || 0) + 1; }
  });
  DOC.sessions = DOC.sessions.slice(-SESSION_CAP);
  DOC.sessions.forEach(updateBests);
}

/* ---- summaries for the dashboard ---- */
function avg(arr, k){ const v = arr.filter(s => s[k] != null); return v.length ? v.reduce((a, s) => a + s[k], 0) / v.length : null; }
function form(n){
  const all = DOC.sessions.filter(s => s.n >= QUALIFY), cur = all.slice(-n), prev = all.slice(-2 * n, -n);
  const f = arr => ({ n: arr.length, sc: avg(arr, "sc"), read: avg(arr, "read"), cov: avg(arr, "cov"), spd: avg(arr, "spd"), press: avg(arr, "press") });
  return { cur: f(cur), prev: prev.length >= 3 ? f(prev) : null };
}
function totals(){ const s = DOC.sessions; return { sessions: s.filter(x => x.n >= QUALIFY).length, reps: s.reduce((a, x) => a + x.n, 0), all: s.length }; }

export function init(){
  loadProgress();
  if(!load("progress", null) && PROFILE.recs.length){ backfill(PROFILE.recs); saveProgress(); }
  on("data:changed", k => { if(k === "progress"){ loadProgress(); emit("progress:changed"); } });
  // iPhone users often swipe the app away instead of tapping END: keep what they did
  if(typeof document !== "undefined" && document.addEventListener)
    document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden" && state.session && state.session.t0 && !state.session.final && !state.tut) recordSession(false); });
}
function progressDoc(){ return DOC; }
function lastResult(){ return last; }
export { loadProgress, saveProgress, recordSession, streakInfo, dayKey, addDays, form, totals, QUALIFY, progressDoc, lastResult };
