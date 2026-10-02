import { emit, on } from "./config.js";
import { dayKey, progressDoc, saveProgress } from "./progress.js";
import { startSession } from "./setup.js";
import { els } from "./state.js";

/* ============================================================
   DAILY CHALLENGE — one short, fixed-length session a day, the same for everyone on that date.
   Optional: it sits on the home screen as a card, never pops up, and missing a day costs nothing.
   Built only from Free modes, at your own difficulty, so every player can do it.
   To add one: push a template into CHALLENGES (mode, reps, optional plan, a goal on measured stats).
   Results live in the progress document (progress.ch = {"2026-10-02": {key, done, best}}) and sync with it.
============================================================ */

const CHALLENGES = [
  { id: "cov10",    name: "Coverage Check",     mode: "coverage_id", reps: 10, goal: { stat: "cov",  min: 70 }, text: "Name the coverage on 10 snaps. Goal: 70%." },
  { id: "manzone",  name: "Man or Zone?",       mode: "coverage_id", reps: 10, plan: { disguise: 0.5 }, goal: { stat: "cov", min: 60 }, text: "10 looks, half of them disguised. Goal: 60% correct." },
  { id: "cover2",   name: "Beat Cover 2",       mode: "qb_brain",    reps: 8,  diff: "varsity", plan: { covWeights: { "Cover 2": 1 }, plays: ["Smash", "Four Verticals", "Spacing", "Stick"] }, goal: { stat: "read", min: 70 }, text: "8 reps against Cover 2. Goal: 70% right reads." },
  { id: "cover3",   name: "Beat Cover 3",       mode: "qb_brain",    reps: 8,  diff: "varsity", plan: { covWeights: { "Cover 3": 1 }, plays: ["Flood", "Slant-Flat", "Stick", "Snag", "Levels"] }, goal: { stat: "read", min: 70 }, text: "8 reps against Cover 3. Goal: 70% right reads." },
  { id: "manbeat",  name: "Beat Man",           mode: "quick_read",  reps: 8,  diff: "varsity", plan: { covWeights: { "Man": 2, "Cover 1": 1 }, plays: ["Mesh", "Slant-Flat", "Snag", "Drive"] }, goal: { stat: "read", min: 65 }, text: "8 reps against man coverage. Goal: 65% right reads." },
  { id: "quick",    name: "Ball Out Fast",      mode: "quick_read",  reps: 8,  diff: "varsity", plan: { rushMul: 1.08 }, goal: { stat: "spd", max: 2.0, also: { stat: "read", min: 60 } }, text: "8 reps with a faster rush. Goal: release under 2.0s and 60% right reads." },
  { id: "progress", name: "Full Progression",   mode: "qb_brain",    reps: 8,  diff: "rookie",  plan: { rushMul: 0.85 }, goal: { stat: "read", min: 80 }, text: "8 reps with extra time. Work 1-2-3. Goal: 80% right reads." }
];

function hash(str){ let h = 2166136261; for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function todays(now){ const day = dayKey(now || Date.now()); const c = CHALLENGES[hash("qbb:" + day) % CHALLENGES.length]; return Object.assign({ day, key: day + ":" + c.id }, c); }
function record(day){ const d = progressDoc(); return d.ch && d.ch[day] || null; }

function met(c, s){
  const ok = g => { const v = s[g.stat]; if(v == null) return false; return g.min != null ? v >= g.min : v <= g.max; };
  return ok(c.goal) && (!c.goal.also || ok(c.goal.also));
}
function fmtGoal(g, s){ const v = s[g.stat]; return v == null ? "—" : g.stat === "spd" ? v.toFixed(2) + "s" : v + "%"; }

function start(){
  const c = todays();
  // the challenge uses your own format and difficulty; it doesn't change your saved settings
  startSession(c.mode, { plan: Object.assign({ name: "Daily: " + c.name }, c.plan || {}), challenge: { key: c.key, id: c.id, name: c.name, day: c.day }, target: c.reps });
}

// a challenge session just ended: did it hit the goal?
function judge(r){
  const s = r.session; if(!s || !s.ch) return;
  const c = CHALLENGES.find(x => s.ch.endsWith(":" + x.id)); const day = s.ch.split(":")[0];
  if(!c) return;
  const done = s.n >= c.reps && met(c, s);
  const d = progressDoc(); d.ch = d.ch || {};
  const prev = d.ch[day] || { key: s.ch, done: false, tries: 0 };
  d.ch[day] = { key: s.ch, done: prev.done || done, tries: (prev.tries || 0) + 1, best: Math.max(prev.best || 0, s.sc || 0) };
  const keys = Object.keys(d.ch).sort(); if(keys.length > 120) keys.slice(0, keys.length - 120).forEach(k => delete d.ch[k]);
  saveProgress();
  r.challenge = { name: c.name, done, already: prev.done, finished: s.n >= c.reps, got: fmtGoal(c.goal, s), goal: c.text };
  emit("challenge:judged", r.challenge);
}

function renderCard(){
  const box = els.dailyCard; if(!box) return;
  const c = todays(), rec = record(c.day);
  box.classList.toggle("done", !!(rec && rec.done));
  els.dailyName.textContent = c.name;
  els.dailyText.textContent = c.text;
  els.dailyState.textContent = rec && rec.done ? "DONE ✓" : rec ? "TRY AGAIN" : c.reps + " REPS";
}

export function init(){
  ["dailyCard", "dailyName", "dailyText", "dailyState"].forEach(id => { els[id] = document.getElementById(id); });
  if(els.dailyCard) els.dailyCard.addEventListener("click", start);
  on("progress:session", judge);
  on("screen", id => { if(id === "homeScreen") renderCard(); });
  on("progress:changed", renderCard);
  renderCard();
}
export { CHALLENGES, todays, met, start as startChallenge };
