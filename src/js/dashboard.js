import { conceptFor } from "./coach.js";
import { MODES, on } from "./config.js";
import { BOOKS } from "./plays.js";
import { has, requirePro } from "./pro.js";
import { PROFILE, covDrill, profileMetrics, startDrill } from "./profile.js";
import { QUALIFY, form, progressDoc, streakInfo, totals } from "./progress.js";
import { rankFor } from "./score.js";
import { SCREENS } from "./setup.js";
import { els } from "./state.js";

/* ============================================================
   QB DASHBOARD — rank, rating, recent form, score history, personal bests, what to work on, recent sessions.
   Everything here is read from progress.js (sessions) and profile.js (reps); nothing is estimated.
============================================================ */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let range = 10;    // sessions shown in the chart (0 = all)

/* ---- the rank badge: a pixel shield, one stripe per rank earned ---- */
const TIER = ["#8a8f98", "#c27c3a", "#cfd6e3", "#5ab8ff", "#ffc933", "#e8412c"];
function rankBadge(i, px){
  px = px || 4; const c = i == null ? "#3a4152" : TIER[i] || TIER[0];
  const rows = ["0111111110", "1111111111", "1111111111", "1111111111", "1111111111", "0111111110", "0011111100", "0001111000", "0000110000"];
  let r = "";
  rows.forEach((row, y) => [...row].forEach((v, x) => { if(v === "1") r += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>'; }));
  // marks: 1–3 bars for Backup → Captain, a star for Field General, star + bar for Franchise QB
  let marks = "";
  const bar = (y, x0, x1) => { marks += '<rect x="' + x0 + '" y="' + y + '" width="' + (x1 - x0) + '" height="1" fill="#0d1117"/>'; };
  const star = y0 => ["00100", "01110", "11111", "01110", "01010"].forEach((row, y) => [...row].forEach((v, x) => { if(v === "1") marks += '<rect x="' + (x + 2.5) + '" y="' + (y + y0) + '" width="1" height="1" fill="#0d1117"/>'; }));
  if(i != null){
    if(i >= 1 && i <= 3){ bar(2, 2, 8); if(i >= 2) bar(4, 2, 8); if(i >= 3) bar(6, 3, 7); }
    if(i === 4) star(1.5);
    if(i === 5){ star(1); bar(6.5, 3, 7); }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 12 11" width="' + (12 * px) + '" height="' + (11 * px) + '" shape-rendering="crispEdges"><g fill="#000" transform="translate(0.5 0.6)">' + r + '</g><g fill="' + c + '">' + r + "</g>" + marks + "</svg>";
}

function dayLabel(t){
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if(diff === 0) return "Today"; if(diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
const modeLabel = m => (MODES[m] && MODES[m].label) || m;
const diffLabel = d => ({ rookie: "Rookie", varsity: "Varsity", elite: "Elite" }[d] || d);

/* ---- tiles: recent form (last 10 sessions) vs the 10 before ---- */
function delta(cur, prev, lowerWins, unit){
  if(cur == null || prev == null) return "";
  const d = cur - prev; if(Math.abs(d) < (unit === "s" ? 0.05 : 1)) return "steady vs previous 10";
  const better = lowerWins ? d < 0 : d > 0;
  return (better ? "▲ " : "▼ ") + (unit === "s" ? Math.abs(d).toFixed(2) + "s " + (lowerWins ? (d < 0 ? "quicker" : "slower") : "") : Math.round(Math.abs(d)) + " pts") + " vs previous 10";
}
function tile(v, l, sub, cls){ const d = document.createElement("div"); d.className = "pf-tile" + (cls ? " " + cls : ""); d.innerHTML = '<div class="n"></div><div class="l"></div><div class="s"></div>';
  d.children[0].textContent = v; d.children[1].textContent = l; d.children[2].textContent = sub || ""; return d; }
function renderTiles(){
  const F = form(10), c = F.cur, p = F.prev || {}, T = totals(), box = els.dashTiles; box.innerHTML = "";
  const f = (v, suf) => v == null ? "—" : Math.round(v) + (suf || "");
  box.append(
    tile(f(c.cov, "%"), "Coverage recognition", delta(c.cov, p.cov) || (c.cov == null ? "Call coverages in QB Brain or Coverage ID" : "")),
    tile(f(c.read, "%"), "Read accuracy", delta(c.read, p.read) || (c.read == null ? "Make throws in any mode" : "")),
    tile(f(c.press, "%"), "Under pressure", delta(c.press, p.press) || (c.press == null ? "Right reads with the rusher on you" : "right reads with the rusher on you")),
    tile(c.spd == null ? "—" : c.spd.toFixed(2) + "s", "Avg decision time", delta(c.spd, p.spd, true, "s") || (c.spd == null ? "" : "snap to release")),
    tile(String(T.sessions), "Sessions completed", T.reps + " reps in total"),
    tile(String(streakInfo().best), "Best training streak", "days in a row")
  );
  els.dashTiles.dataset.window = c.n ? "Last " + c.n + " sessions" : "";
}

/* ---- score history chart (single series → no legend; tap a point for its session) ---- */
function renderChart(){
  const historyLimit = has("history") ? 0 : 10;   // Free: last 10 scored sessions · Pro: everything
  const all = progressDoc().sessions.filter(s => s.sc != null);
  const cap = historyLimit ? Math.min(historyLimit, all.length) : all.length;
  const n = range && range < cap ? range : cap;
  const pts = all.slice(-n);
  const box = els.dashChart;
  els.dashRange.classList.toggle("hidden", !historyLimit ? all.length <= 10 : true);
  if(!historyLimit){
    els.dashRange.innerHTML = "";
    [[10, "LAST 10"], [30, "LAST 30"], [0, "ALL"]].forEach(([k, l]) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip" + (range === k ? " on" : ""); b.textContent = l;
      b.addEventListener("click", () => { range = k; renderChart(); }); els.dashRange.appendChild(b); });
  }
  if(pts.length < 2){
    box.innerHTML = '<div class="dash-empty">' + (pts.length ? "One scored session so far. Play another and your trend line starts here." : "Finish a session with 5+ reps and your QB Brain Score shows up here.") + "</div>";
    els.dashChartNote.textContent = ""; return;
  }
  const W = 340, H = 150, L = 26, R = 8, Tp = 10, B = 18;
  const x = i => L + (pts.length === 1 ? 0 : i * (W - L - R) / (pts.length - 1));
  const y = v => Tp + (100 - v) * (H - Tp - B) / 100;
  let g = "";
  [0, 50, 100].forEach(v => { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="gl"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="yl">' + v + "</text>"; });
  const rk = rankFor(progressDoc().sessions);
  if(rk.next){ g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(rk.next.min) + '" y2="' + y(rk.next.min) + '" class="goal"/><text x="' + (W - R) + '" y="' + (y(rk.next.min) - 4) + '" class="gt">' + esc(rk.next.name) + "</text>"; }
  const line = pts.map((s, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(s.sc).toFixed(1)).join(" ");
  let dots = "";
  pts.forEach((s, i) => { dots += '<rect class="pt" x="' + (x(i) - 4) + '" y="' + (y(s.sc) - 4) + '" width="8" height="8"/><rect class="hit" data-i="' + i + '" x="' + (x(i) - 12) + '" y="0" width="24" height="' + H + '"/>'; });
  box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="QB Brain Score for your last ' + pts.length + ' scored sessions, from ' + pts[0].sc + " to " + pts[pts.length - 1].sc + '">' + g +
    '<path d="' + line + '" class="ln"/>' + dots + '</svg><div class="dash-tip hidden" id="dashTip"></div>';
  const tip = box.querySelector("#dashTip");
  const show = i => { const s = pts[i]; tip.classList.remove("hidden");
    tip.innerHTML = "<b>" + s.sc + "</b> " + esc(dayLabel(s.t)) + "<br>" + esc(modeLabel(s.m)) + " · " + s.sq + "v" + s.sq + " · " + diffLabel(s.d) + " · " + s.n + " reps";
    const px = x(i) / W * box.clientWidth; tip.style.left = Math.max(0, Math.min(box.clientWidth - 170, px - 85)) + "px"; };
  box.querySelectorAll(".hit").forEach(h => { const i = +h.getAttribute("data-i"); h.addEventListener("pointerenter", () => show(i)); h.addEventListener("click", () => show(i)); });
  box.querySelector("svg").addEventListener("pointerleave", () => tip.classList.add("hidden"));
  const first = pts.slice(0, Math.min(5, Math.floor(pts.length / 2))), lastN = pts.slice(-first.length);
  const a = first.reduce((s, p) => s + p.sc, 0) / first.length, b = lastN.reduce((s, p) => s + p.sc, 0) / lastN.length;
  els.dashChartNote.textContent = (historyLimit && all.length > historyLimit ? "Your last " + pts.length + " scored sessions (Pro shows them all). " : "") +
    (pts.length >= 4 ? "First " + first.length + " shown: avg " + Math.round(a) + " → last " + lastN.length + ": avg " + Math.round(b) + (b - a >= 1 ? " (up " + Math.round(b - a) + ")." : b - a <= -1 ? " (down " + Math.round(a - b) + ")." : ".") : "");
}

/* ---- personal bests ---- */
function renderBests(){
  const B = progressDoc().best || {}, box = els.dashBests; box.innerHTML = "";
  const item = (k, label, fmt) => { const b = B[k]; const d = document.createElement("div"); d.className = "best" + (b ? "" : " none");
    d.innerHTML = '<b></b><span></span><small></small>'; d.children[0].textContent = b ? fmt(b.v) : "—"; d.children[1].textContent = label;
    d.children[2].textContent = b && b.t ? dayLabel(b.t) + (b.d ? " · " + diffLabel(b.d) : "") : "not set yet"; box.appendChild(d); };
  item("score", "QB Brain Score", v => String(v));
  item("cov", "Coverage ID in a session", v => v + "%");
  item("spd", "Quickest avg release", v => v.toFixed(2) + "s");
  item("streak", "Training streak", v => v + (v === 1 ? " day" : " days"));
  item("reps", "Reps in one session", v => String(v));
  item("drive", "Longest drive", v => v + " yds");
}

/* ---- what to work on: lowest coverages and concepts from your reps, with a drill for each ---- */
function conceptDrill(con){
  const names = [];
  [5, 7].forEach(sq => (BOOKS.standard.plays[sq] || []).forEach(p => { const c = conceptFor(p); if(c && c.name === con && !names.includes(p.name)) names.push(p.name); }));
  return names.length ? { name: con + " Drill", mode: "quick_read", book: "standard", plan: { plays: names }, sub: "Reps of " + con + " against every coverage." } : null;
}
function renderWeak(){
  const box = els.dashWeak; box.innerHTML = "";
  if(PROFILE.recs.length < 10){ const p = document.createElement("div"); p.className = "help"; p.textContent = "After 10+ reps this lists your lowest coverages and concepts (3+ reps each), with a drill for each one."; box.appendChild(p); return; }
  const M = profileMetrics();
  const items = [];
  M.covRank.slice(-2).reverse().forEach(r => { if(r.pct < 70) items.push({ what: r.k, kind: "coverage", pct: r.pct, n: r.n, dr: covDrill(r.k) }); });
  M.conRank.slice(-2).reverse().forEach(r => { if(r.pct < 70) items.push({ what: r.k, kind: "concept", pct: r.pct, n: r.n, dr: conceptDrill(r.k) }); });
  if(!items.length){ const p = document.createElement("div"); p.className = "help"; p.textContent = "Nothing under 70% right now. Move up a difficulty level or turn on Adaptive to keep finding your limits."; box.appendChild(p); return; }
  items.sort((a, b) => a.pct - b.pct).forEach(it => {
    const d = document.createElement("div"); d.className = "coach-note weak";
    d.innerHTML = '<p><b></b> <span class="tag"></span></p><small class="pf-dsub"></small>';
    d.querySelector("b").textContent = it.what; d.querySelector(".tag").textContent = it.kind.toUpperCase();
    d.querySelector("small").textContent = it.pct + "% successful on " + it.n + " reps.";
    if(it.dr){ const b = document.createElement("button"); b.type = "button"; b.className = "btn sm"; b.dataset.pro = "drills"; b.textContent = "DRILL " + it.what.toUpperCase();
      b.addEventListener("click", () => requirePro("drills", () => startDrill(it.dr))); d.appendChild(b); }
    box.appendChild(d);
  });
}

/* ---- recent sessions ---- */
function renderRecent(){
  const box = els.dashRecent; box.innerHTML = "";
  const list = progressDoc().sessions.slice(-8).reverse();
  if(!list.length){ const p = document.createElement("div"); p.className = "help"; p.textContent = "No sessions yet. Run a drill or a drive and tap END when you're done."; box.appendChild(p); return; }
  list.forEach(s => {
    const row = document.createElement("div"); row.className = "rep-row sess-row";
    const what = (s.plan ? s.plan : modeLabel(s.m)) + " · " + s.sq + "v" + s.sq + " " + diffLabel(s.d);
    const detail = s.drive ? (s.drive.res || "Drive") + " · " + s.drive.yards + " yds" : s.n + " rep" + (s.n === 1 ? "" : "s") + (s.read != null ? " · " + s.read + "% reads" : s.cov != null ? " · " + s.cov + "% coverage" : "");
    row.innerHTML = '<span class="c"><b></b><small></small></span><span class="pts"></span>';
    row.querySelector("b").textContent = dayLabel(s.t) + " · " + what; row.querySelector("small").textContent = detail;
    row.querySelector(".pts").textContent = s.sc == null ? (s.n < QUALIFY ? "—" : "") : String(s.sc);
    if(s.sc == null) row.querySelector(".pts").title = "Sessions need " + QUALIFY + "+ reps for a score";
    box.appendChild(row);
  });
}

/* ---- hero + home tile ---- */
function renderHero(){
  const rk = rankFor(progressDoc().sessions), st = streakInfo();
  els.dashBadge.innerHTML = rankBadge(rk.rank ? rk.index : null, 5);
  els.dashRank.textContent = rk.rank ? rk.rank.name : "UNRANKED";
  els.dashRating.textContent = rk.rating == null ? "—" : String(rk.rating);
  els.dashBar.style.width = (rk.rank ? Math.round(rk.frac * 100) : Math.round(100 * rk.n / 3)) + "%";
  els.dashNext.textContent = !rk.rank ? (rk.toGo === 1 ? "1 more scored session to get your rank." : rk.toGo + " more scored sessions (5+ reps each) to get your rank.")
    : rk.blocker ? "Rating is high enough for " + rk.next.name + ". To earn it: " + rk.blocker + "."
    : rk.next ? rk.toNext + " rating points to " + rk.next.name + "." : "Top rank. Keep your last 10 sessions at this level to hold it.";
  els.dashStreak.innerHTML = "";
  const chip = (t, on) => { const c = document.createElement("span"); c.className = "streak-chip" + (on ? " on" : ""); c.textContent = t; els.dashStreak.appendChild(c); };
  chip(st.current ? st.current + "-DAY STREAK" : "NO STREAK YET", st.current > 0);
  chip(st.today ? "TRAINED TODAY ✓" : "5 REPS TODAY KEEPS IT GOING", st.today);
}
function renderTile(){
  if(!els.dashTileSub) return;
  const rk = rankFor(progressDoc().sessions), st = streakInfo();
  els.dashTileBadge.innerHTML = rankBadge(rk.rank ? rk.index : null, 3);
  els.dashTileSub.textContent = rk.rank ? rk.rank.name + " · " + rk.rating + (st.current > 1 ? " · " + st.current + "-day streak" : "") : (progressDoc().sessions.length ? "Unranked · " + rk.toGo + " to go" : "Score · rank · progress");
}
function renderDashboard(){ renderHero(); renderTiles(); renderChart(); renderBests(); renderWeak(); renderRecent(); }

export function init(){
  SCREENS.push("dashScreen");
  ["dashScreen","dashBadge","dashRank","dashRating","dashBar","dashNext","dashStreak","dashTiles","dashChart","dashChartNote","dashRange","dashBests","dashWeak","dashRecent","dashTileBadge","dashTileSub"].forEach(id => { els[id] = $(id); });
  on("screen", id => { if(id === "dashScreen") renderDashboard(); if(id === "homeScreen") renderTile(); });
  on("progress:changed", () => { renderTile(); if(!els.dashScreen.classList.contains("hidden")) renderDashboard(); });
  on("progress:session", renderTile);
  renderTile();
}
export { renderDashboard, renderTile, rankBadge, dayLabel, modeLabel, diffLabel };
