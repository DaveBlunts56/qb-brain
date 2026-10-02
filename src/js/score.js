/* ============================================================
   QB BRAIN SCORE — one 0–100 number for a session, built only from things the game measures on every rep
   (the QB Profile records: see profile.js → profileRecord).

     Decisions     45%  plays where you made the right read (good or risky-but-right, and not turnover-worthy)
     Coverage ID   25%  coverage called correctly when the game asked
     Speed         15%  release time on each play: 1.4s or quicker = full marks, 3.2s or slower (or a sack) = none
     Ball security 15%  fewer turnover-worthy throws (each 1% of plays costs 3 points)
   Parts a mode doesn't measure (no throws in Coverage ID, no ID question in Quick Read) drop out and the rest
   are re-weighted. Then a difficulty factor: Rookie ×0.88 · Varsity ×0.95 · Elite ×1.00 — the same reads
   are worth more against a faster rush and more disguise.
   A session needs 5+ reps to get a score.
============================================================ */

const WEIGHTS = { decisions: 45, coverage: 25, speed: 15, security: 15 };
const DIFF_FACTOR = { rookie: 0.88, varsity: 0.95, elite: 1 };
const MIN_REPS = 5;
const FAST = 1.4, SLOW = 3.2;
const OK = ["GOOD READ", "RISKY"];

const pct = (k, n) => n ? Math.round(100 * k / n) : null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const right = r => OK.includes(r.res) && !r.tw;
function speedPts(r){ if(r.res === "SACKED" || r.rel == null) return 0; return clamp((SLOW - r.rel) / (SLOW - FAST), 0, 1); }
function mostCommon(arr){ const c = {}; arr.forEach(x => { if(x != null) c[x] = (c[x] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null; }

// recs: the QB Profile records for one session (or any set of reps)
function sessionStats(recs){
  recs = recs || [];
  const plays = recs.filter(r => r.res);
  const thrown = plays.filter(r => r.res !== "SACKED" && r.rel != null);
  const asked = recs.filter(r => r.cid != null);
  const press = plays.filter(r => r.pr);
  const S = {
    reps: recs.length, plays: plays.length,
    read: pct(plays.filter(right).length, plays.length),
    good: pct(plays.filter(r => r.res === "GOOD READ").length, plays.length),
    cov: pct(asked.filter(r => r.cid === 1).length, asked.length), covN: asked.length,
    mz: pct(recs.filter(r => r.mz === 1).length, recs.filter(r => r.mz != null).length),
    spd: thrown.length ? +(thrown.reduce((s, r) => s + r.rel, 0) / thrown.length).toFixed(2) : null, spdN: thrown.length,
    press: pct(press.filter(right).length, press.length), pressN: press.length,
    tw: plays.filter(r => r.tw).length, sacks: plays.filter(r => r.res === "SACKED").length,
    diff: mostCommon(recs.map(r => r.d)) || "rookie", squad: +(mostCommon(recs.map(r => r.sq)) || 5)
  };
  S.parts = {
    decisions: plays.length ? S.read : null,
    coverage: asked.length ? S.cov : null,
    speed: plays.length ? Math.round(100 * plays.reduce((s, r) => s + speedPts(r), 0) / plays.length) : null,
    security: plays.length ? clamp(100 - 3 * Math.round(100 * S.tw / plays.length), 0, 100) : null
  };
  S.score = scoreOf(S.parts, S.diff, recs.length);
  return S;
}
function scoreOf(parts, diff, reps){
  if(reps < MIN_REPS) return null;
  let w = 0, sum = 0;
  Object.keys(WEIGHTS).forEach(k => { if(parts[k] != null){ w += WEIGHTS[k]; sum += WEIGHTS[k] * parts[k]; } });
  if(!w) return null;
  return Math.round(sum / w * (DIFF_FACTOR[diff] || 0.88));
}

/* ---- ranks: from your QB Brain Rating = average of your last 10 scored sessions ----
   The top ranks also need real reps against harder defenses, so they can't be earned on Rookie alone. */
const RANKS = [
  { key: "scout",    name: "SCOUT TEAM",    min: 0,  need: null },
  { key: "backup",   name: "BACKUP",        min: 50, need: null },
  { key: "starter",  name: "STARTER",       min: 62, need: null },
  { key: "captain",  name: "CAPTAIN",       min: 72, need: { diff: ["varsity", "elite"], n: 3, text: "3 of your last 10 scored sessions on Varsity or Elite" } },
  { key: "general",  name: "FIELD GENERAL", min: 80, need: { diff: ["varsity", "elite"], n: 5, text: "5 of your last 10 scored sessions on Varsity or Elite" } },
  { key: "franchise",name: "FRANCHISE QB",  min: 88, need: { diff: ["elite"], n: 3, text: "3 of your last 10 scored sessions on Elite" } }
];
const RATING_WINDOW = 10, RANK_MIN_SESSIONS = 3;
function ratingOf(sessions){
  const sc = (sessions || []).filter(s => s.sc != null).slice(-RATING_WINDOW);
  if(sc.length < RANK_MIN_SESSIONS) return { rating: null, n: sc.length, recent: sc };
  return { rating: Math.round(sc.reduce((a, s) => a + s.sc, 0) / sc.length), n: sc.length, recent: sc };
}
function meets(rank, recent){ return !rank.need || recent.filter(s => rank.need.diff.includes(s.d)).length >= rank.need.n; }
function rankFor(sessions){
  const R = ratingOf(sessions);
  if(R.rating == null) return { rank: null, rating: null, next: RANKS[0], toGo: RANK_MIN_SESSIONS - R.n, n: R.n };
  let i = 0;
  RANKS.forEach((rk, j) => { if(R.rating >= rk.min && meets(rk, R.recent)) i = j; });
  const next = RANKS[i + 1] || null;
  let blocker = null;
  if(next && R.rating >= next.min && !meets(next, R.recent)) blocker = next.need.text;
  const lo = RANKS[i].min, hi = next ? next.min : 100;
  return { rank: RANKS[i], index: i, rating: R.rating, next, blocker, toNext: next ? Math.max(0, next.min - R.rating) : 0,
    frac: next ? clamp((R.rating - lo) / (hi - lo), 0, 1) : 1, n: R.n };
}

export function init(){}
export { WEIGHTS, DIFF_FACTOR, MIN_REPS, RANKS, RATING_WINDOW, RANK_MIN_SESSIONS, sessionStats, scoreOf, ratingOf, rankFor, speedPts };
