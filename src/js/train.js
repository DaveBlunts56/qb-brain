import { MODES, choice } from "./config.js";
import { PROFILE, profileMetrics } from "./profile.js";
import { state } from "./state.js";

/* ============================================================
   TRAINING PLAN — one place that decides "what defense does the QB see this rep".
   Drills (from the QB Profile), Film Room and Adaptive all feed this; buildRep consumes it.
   plan = {name, covWeights:{cov:w}, disguise:0..1, rotations:[[shown,actual],...], eyesMul, rushMul, rushPlans:{plan:w}, plays:[names]}
============================================================ */
// Post-snap rotations. kind: rotation (shell changes) | bluff man → zone | bluff zone → man
const ROTATIONS={
  "Cover 2":        [["Cover 3","rotation"],["Cover 1","bluff zone → man"]],
  "Cover 3":        [["Cover 2","rotation"],["Cover 1","bluff zone → man"]],
  "Cover 1":        [["Cover 3","bluff man → zone"],["Cover 2","bluff man → zone"]],
  "Man":            [["Cover 3","bluff man → zone"],["Underneath Zone","bluff man → zone"],["Cover 1","rotation"]],
  "Underneath Zone":[["Man","bluff zone → man"],["Cover 3","rotation"]],
  // 7v7: more bodies, more layers
  "Cover 4":        [["Cover 3","rotation"],["2-Man","bluff zone → man"],["Cover 2","rotation"]],
  "Robber":         [["Cover 3","bluff man → zone"],["Cover 1","rotation"]],
  "Bracket":        [["Cover 1","rotation"],["2-Man","rotation"]],
  "2-Man":          [["Cover 2","bluff man → zone"],["Cover 4","bluff man → zone"]]
};
// 7v7-only twists on the base looks
const ROTATIONS_7={
  "Cover 1":[["Robber","rotation"],["Bracket","rotation"]],
  "Cover 2":[["2-Man","bluff zone → man"],["Cover 4","rotation"]],
  "Cover 3":[["Cover 4","rotation"],["Robber","bluff zone → man"]],
  "Man":    [["Bracket","rotation"],["Robber","rotation"]]
};
// 5v5 = quick game vs simple shells and fast pressure; 7v7 = layered zones, two safeties, robbers and brackets
const POOL_5=["Man","Cover 1","Cover 2","Cover 3","Underneath Zone"];
const POOL_7=["Man","Cover 1","Cover 2","Cover 3","Cover 4","Robber","Bracket","2-Man","Underneath Zone"];
function weighted(obj){ const ks=Object.keys(obj).filter(k=>obj[k]>0); let s=ks.reduce((a,k)=>a+obj[k],0), r=Math.random()*s; for(const k of ks){ r-=obj[k]; if(r<=0) return k; } return ks[ks.length-1]; }
function currentPlan(){
  const p=Object.assign({}, state.plan||{});
  if(state.adaptive && typeof adaptivePlan==="function" && !state.tut){ const a=adaptivePlan(); if(a) mergePlan(p,a); }
  return p;
}
function mergePlan(p,a){
  if(a.covWeights && !p.covWeights) p.covWeights=a.covWeights;
  if(a.disguise!=null) p.disguise=Math.max(p.disguise||0,a.disguise);
  if(a.rotations && !p.rotations) p.rotations=a.rotations;
  if(a.eyesMul) p.eyesMul=Math.max(p.eyesMul||1,a.eyesMul);
  if(a.rushMul && p.rushMul==null) p.rushMul=a.rushMul;
  if(a.rushPlans && !p.rushPlans) p.rushPlans=a.rushPlans;
  p.adaptiveNote=a.note;
  return p;
}
function coveragePool(squad){ return (squad||state.squad)===7 ? POOL_7 : POOL_5; }
function pickShownCoverage(plan,squad){
  if(plan.rotations && plan.rotations.length && plan.forceRotation){ return choice(plan.rotations)[0]; }
  if(plan.covWeights){ const pool=coveragePool(squad), w={}; Object.keys(plan.covWeights).forEach(k=>{ if(pool.includes(k)) w[k]=plan.covWeights[k]; }); if(Object.keys(w).length) return weighted(w); }
  return choice(coveragePool(squad));
}
function pickActualCoverage(shown,plan,squad){
  const pool=coveragePool(squad);
  let opts=(ROTATIONS[shown]||[]).concat(squad===7?(ROTATIONS_7[shown]||[]):[]).filter(o=>pool.includes(o[0]));
  if(plan.rotations && plan.rotations.length){ const f=opts.filter(o=>plan.rotations.some(r=>r[0]===shown && r[1]===o[0])); if(f.length) opts=f; }
  if(!opts.length) return {cov:shown, kind:null};
  const o=choice(opts); return {cov:o[0], kind:o[1]};
}
function disguiseChanceFor(plan,diff,squad){
  if(plan.disguise!=null) return plan.disguise;
  const bump = squad===7 && diff.disguiseChance>0 ? 0.1 : 0;   // 7v7 defenses rotate more
  if(MODES[state.mode] && MODES[state.mode].film) return Math.max(diff.disguiseChance+bump, state.difficulty==="rookie"?0.35:0.5);
  return diff.disguiseChance+bump;
}
// how many defenders sit deep (8+ yds) — "one-high", "two-high"...
// QB language: count the deep defenders. 3 deep = one-high (middle closed), 4 deep = two-high quarters
function shellName(n){ return n===0?"zero-high":n===1?"one-high":n===2?"two-high":n===3?"one-high, 3 deep":"two-high, quarters"; }
function shellOf(defs){ return shellName(defs.filter(d=>(d.pos0||d.pos).y>=8.5).length); }
function actualShell(rep){ return shellName(rep.defenders.filter(d=>d.role==="zone" && d.type==="deep").length); }

/* ============================================================
   ADAPTIVE TRAINING — builds a plan from your QB Profile every rep.
   Strong vs a coverage → you'll see it disguised more. Weak → you'll see it more.
   Stare-downs → defenders read your eyes harder. Pressure → the rush ramps up as you handle it.
   Struggle with rotations → more disguised reps.
============================================================ */
function adaptivePlan(){
  const all=PROFILE.recs.filter(r=>r.sq===state.squad);
  const recs=all.slice(-80);
  if(recs.length<8) return {note:"ADAPTIVE: learning your tendencies ("+recs.length+"/8 "+state.squad+"v"+state.squad+" reps)"};
  const M=profileMetrics(recs), pool=coveragePool(state.squad), plan={covWeights:{}}, notes=[];
  const rateOf=c=>{ const g=M.byCov[c]; return g&&g.n>=3 ? g.k/g.n : 0.5; };
  pool.forEach(c=>{ plan.covWeights[c]=+(0.6+(1-rateOf(c))*1.6).toFixed(2); });
  const weak=pool.filter(c=>M.byCov[c] && M.byCov[c].n>=3 && rateOf(c)<0.45);
  if(weak.length) notes.push("more "+weak.slice(0,2).join(" & ")+" reps");
  const strong=pool.filter(c=>M.byCov[c] && M.byCov[c].n>=4 && rateOf(c)>=0.7);
  if(strong.length){
    plan.disguise=0.3;
    plan.rotations=[]; strong.forEach(s0=>{ (ROTATIONS[s0]||[]).concat(state.squad===7?(ROTATIONS_7[s0]||[]):[]).forEach(o=>{ if(pool.includes(o[0])) plan.rotations.push([s0,o[0]]); }); });
    notes.push(strong[0]+" gets disguised more (you're reading it well)");
  }
  if((M.rotTwoHigh.n>=3 && M.rotTwoHigh.pct<50) || (M.disg.n>=4 && M.disg.pct!=null && M.disg.plain!=null && M.disg.pct<M.disg.plain-20)){
    plan.disguise=Math.max(plan.disguise||0,0.55); plan.rotations=null; notes.push("extra post-snap rotations");
  }
  if(M.stare.n>=4 && M.stare.pct>=20){ plan.eyesMul=+(1+Math.min(1.4,M.stare.pct/25)).toFixed(2); notes.push("safeties read your eyes harder"); }
  const P=M.pressure;
  if(P.n>=3){
    const sc=(P.pct||0)/100, L= sc<0.35?0 : sc<0.55?1 : sc<0.75?2 : 3;
    plan.rushMul=[0.92,1.0,1.06,1.12][L];
    plan.rushPlans = L>=2 ? {straight:0.4,edge:0.35,delay:0.25} : L===1 ? {straight:0.65,edge:0.35} : {straight:1};
    notes.push("pressure level "+(L+1)+"/4");
  }
  plan.note = notes.length ? "ADAPTIVE: "+notes.join(" · ") : "ADAPTIVE: balanced mix";
  return plan;
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
}

export { ROTATIONS, ROTATIONS_7, POOL_5, POOL_7, weighted, currentPlan, mergePlan, coveragePool, pickShownCoverage, pickActualCoverage, disguiseChanceFor, shellName, shellOf, actualShell, adaptivePlan };
