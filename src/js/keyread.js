import { defAt, opennessAt } from "./coach.js";
import { GEO, dist, lerp } from "./config.js";
import { posAt } from "./paths.js";
import { histPos, playerById } from "./rep.js";

/* ============================================================
   KEY DEFENDER READS
   For a concept that puts one defender in conflict (high-low, inside-outside, or a deep safety
   between two verticals) we pick that defender at the snap from his ALIGNMENT (what a QB sees),
   track what he does after the snap from the play's recorded history, and decide which
   receiver the QB should have thrown to — and when.
============================================================ */
const KEY_CONCEPTS=[
  {k:/mesh/i,         type:"none"},
  {k:/smash/i,        type:"hilo",  hi:/corner/i,          lo:/hitch/i},
  {k:/slant.?flat/i,  type:"inout", a:/slant/i,            b:/flat/i},
  {k:/curl.?flat/i,   type:"hilo",  hi:/curl|hitch/i,      lo:/flat/i},
  {k:/stick/i,        type:"inout", a:/stick/i,            b:/flat/i},
  {k:/snag/i,         type:"hilo",  hi:/snag/i,            lo:/flat/i},
  {k:/flood|sail/i,   type:"hilo",  hi:/out/i,             lo:/flat/i},
  {k:/level/i,        type:"hilo",  hi:"deepdig",          lo:"shallowdig"},
  {k:/drive/i,        type:"hilo",  hi:/dig/i,             lo:/shallow|drag/i},
  {k:/vert|seam/i,    type:"safety"},
  {k:/spacing/i,      type:"inout", a:"sitpair",           b:"sitpair"}
];
const MAN_FAMILY=c=>c==="Man"||c==="Cover 1"||c==="Robber"||c==="Bracket"||c==="2-Man";
function routeEnd(p){ const w=p.path.wps; return w[w.length-1]; }
function readPt(p){ return posAt(p,1.5); }
function keyShort(rep,d){
  if(!d) return "?";
  if(d.isRusher) return "R";
  if(d.robber) return "ROBBER";
  if(d.bracket) return d.role==="man"?"CB":"S";
  if(d.role==="man"){ const off=Math.abs(d.assign.x0-GEO.CX); return off>GEO.W*0.28 ? "CB" : (d.assign.id==="C"?"LB":"NB"); }
  if(d.type==="deep") return Math.abs(d.lx-GEO.CX)<GEO.W*0.2 ? "S" : (Math.abs(d.lx-GEO.CX)>GEO.W*0.3 && !(rep.actualCoverage==="Cover 2") ? "CB" : "S");
  if(d.type==="flat") return "CB";
  return "LB";
}
const KEY_LONG={CB:"the corner",S:"the safety",LB:"the hook defender (LB)",NB:"the nickel",R:"the rusher",ROBBER:"the robber"};
function sideOf(x){ return x<GEO.CX-2?"left":x>GEO.CX+2?"right":"middle"; }
function keyLabel(rep,d){ const s=keyShort(rep,d); return {short:s, long:KEY_LONG[s]||"the key defender", side:sideOf(d.pos0?d.pos0.x:d.pos.x)}; }

// pick the two receivers the concept puts in conflict
function findKeyPair(rep){
  if(rep.play.kind==="run") return null;
  const T=rep.targets.filter(p=>!p.dashed && !/run|sweep|fake|release|clear|block|stay/i.test(p.name)), con=KEY_CONCEPTS.find(c=>c.k.test(rep.play.name||""));
  if(con && con.type==="none") return null;
  const pick=(re,near)=>{ const c=T.filter(p=>re.test(p.name)); if(!c.length) return null; if(!near) return c[0];
    return c.slice().sort((a,b)=>Math.abs(a.x0-near.x0)-Math.abs(b.x0-near.x0))[0]; };
  if(con){
    if(con.type==="safety"){
      const v=T.filter(p=>/go|seam|vert|fade|post/i.test(p.name)).sort((a,b)=>Math.abs(a.x0-GEO.CX)-Math.abs(b.x0-GEO.CX));
      const L=v.filter(p=>p.x0<GEO.CX), R=v.filter(p=>p.x0>=GEO.CX);
      if(L.length && R.length) return {type:"safety", a:L[0], b:R[0]};
      if(v.length>=2) return {type:"safety", a:v[0], b:v[1]};
    } else if(con.hi==="deepdig"){
      const d=T.filter(p=>/dig|in\b/i.test(p.name)).sort((a,b)=>routeEnd(b).y-routeEnd(a).y);
      if(d.length>=2) return {type:"hilo", hi:d[0], lo:d[d.length-1]};
    } else if(con.a==="sitpair"){
      const s=T.filter(p=>/sit|hitch|curl/i.test(p.name)).sort((a,b)=>Math.abs(a.x0-GEO.CX)-Math.abs(b.x0-GEO.CX));
      if(s.length>=2){ const [a,b]=[s[0],s[1]].sort((p,q)=>p.x0-q.x0); return {type:"inout", a, b}; }
    } else if(con.type==="hilo"){
      const lo=pick(con.lo), hi=lo&&pick(con.hi,lo); if(lo&&hi&&lo!==hi) return {type:"hilo", hi, lo};
    } else if(con.type==="inout"){
      const b=pick(con.b), a=b&&pick(con.a,b); if(a&&b&&a!==b) return {type:"inout", a, b};
    }
  }
  // generic: a high-low or a horizontal pair on one side (works for custom and Big Dawz plays)
  if(rep.play.kind==="trick") return null;
  let best=null;
  for(let i=0;i<T.length;i++) for(let j=0;j<T.length;j++){ if(i===j) continue;
    const A=T[i], B=T[j], qa=readPt(A), qb=readPt(B), dx=Math.abs(qa.x-qb.x);
    if(dx>9) continue;
    const prio=(rep.play.prog||[]).indexOf(A.id), pr=prio<0?5:prio;
    if(qb.y<=5 && qa.y>=7 && qa.y<=17){ const sc=pr+dx*0.1; if(!best||sc<best.sc) best={sc,type:"hilo",hi:A,lo:B}; }
    else if(i<j && Math.abs(qa.y-qb.y)<=2.5 && qa.y>=2.5 && qa.y<=10 && dx>=5){ const sc=pr+1.5; if(!best||sc<best.sc){ const [a,b]=[A,B].sort((p,q)=>Math.abs(readPt(p).x-GEO.CX)-Math.abs(readPt(q).x-GEO.CX)); best={sc,type:"inout",a,b}; } }
  }
  return best;
}
// called once per rep after the defense is aligned
function setupKeyRead(rep){
  rep.keyRead=null;
  try{
    rep.defenders.forEach(d=>{ d.pos0={x:d.pos.x,y:d.pos.y}; });
    const pr=findKeyPair(rep); if(!pr) return;
    const one=pr.type==="hilo"?pr.hi:pr.a, two=pr.type==="hilo"?pr.lo:pr.b;
    const qa=readPt(one), qb=readPt(two);
    let key=null;
    if(pr.type==="safety"){
      key=rep.defenders.filter(d=>d.pos.y>=8.5).sort((a,b)=>Math.abs(a.pos.x-GEO.CX)-Math.abs(b.pos.x-GEO.CX))[0]||null;
    } else {
      const cp={x:lerp(qb.x,qa.x,0.45), y:lerp(qb.y,qa.y,0.45)};
      key=rep.defenders.slice().sort((a,b)=>dist(a.pos,cp)-dist(b.pos,cp))[0]||null;
    }
    if(!key) return;
    rep.keyRead={type:pr.type, A:one.id, B:two.id, key, lab:keyLabel(rep,key)};
  }catch(_){ rep.keyRead=null; }
}
function keyPlanText(rep){
  const k=rep.keyRead; if(!k) return "";
  const A=playerById(rep,k.A), B=playerById(rep,k.B), L=k.lab;
  if(k.type==="hilo") return "KEY: "+L.short+" ("+L.side+") — sinks → "+B.id+" "+B.name+", jumps it → "+A.id+" "+A.name;
  if(k.type==="inout") return "KEY: "+L.short+" ("+L.side+") — toward "+A.id+" → "+B.id+" "+B.name+", toward "+B.id+" → "+A.id+" "+A.name;
  return "KEY: "+L.short+" — throw the vertical away from him ("+A.id+" or "+B.id+")";
}
// after the play: what did the key do, what was right, what did the QB do
function analyzeKeyRead(rep,tThrow,mineId){
  const k=rep.keyRead; if(!k || !k.key || !k.key.h || !k.key.h.length) return null;
  const A=playerById(rep,k.A), B=playerById(rep,k.B); if(!A||!B) return null;
  const hEnd=k.key.h[k.key.h.length-1].t, tLim=Math.min(2.6, hEnd, tThrow!=null?Math.max(tThrow+0.3,1.2):hEnd);
  let streak=0, side=0, tCommit=null, commit=null;
  const leanAt=t=>{ const dp=defAt(k.key,t); return dist(dp,histPos(B,t))-dist(dp,histPos(A,t)); };   // >0 = closer to A
  const base=leanAt(0.3);
  for(let t=0.4;t<=tLim+1e-6;t+=0.05){
    const lean=leanAt(t)-base;
    const s = lean>1.6 ? 1 : lean<-1.6 ? -1 : 0;
    if(s!==0 && s===side){ streak++; if(streak>=3 && tCommit===null){ tCommit=+(t-0.1).toFixed(2); commit=s>0?"A":"B"; } }
    else { side=s; streak = s?1:0; }
    if(tCommit!==null) break;
  }
  const tEval = tThrow!=null ? tThrow : (tCommit!=null ? tCommit+0.4 : 1.6);
  const snap=opennessAt(rep,tEval), snap2=opennessAt(rep,Math.min(tEval+0.5,hEnd));
  const sepOf=id=>{ const o=snap.find(z=>z.p.id===id), o2=snap2.find(z=>z.p.id===id); return Math.max(o?o.sep:0, o2?o2.sep*0.9:0); };
  let correctId, why;
  const man = MAN_FAMILY(rep.actualCoverage) && k.key.role==="man";
  if(commit){ correctId = commit==="A" ? k.B : k.A; }
  else { correctId = sepOf(k.A)>=sepOf(k.B) ? k.A : k.B; }
  // the "right" side can still be covered by help — then the answer is to move on
  let covered=false;
  if(sepOf(correctId)<1.8){ covered=true; const best=snap.slice().sort((a,b)=>b.sep-a.sep)[0]; if(best && best.sep>=3.5 && best.p.id!==correctId) correctId=best.p.id; else correctId=null; }
  const L=k.lab, key=L.short, pl=id=>{ const p=playerById(rep,id); return p ? id+"'s "+p.name.replace(" (hot)","") : id; };
  let did;
  if(commit){
    const to = commit==="A" ? A : B;
    if(k.type==="hilo") did = commit==="A" ? key+" sank with "+pl(A.id) : key+" jumped "+pl(B.id);
    else if(k.type==="inout") did = key+(Math.abs(routeEnd(to).x-GEO.CX)>Math.abs(routeEnd(commit==="A"?B:A).x-GEO.CX)?" widened to ":" squeezed inside to ")+pl(to.id);
    else did = key+" leaned toward "+pl(to.id);
    did+=" at "+tCommit.toFixed(1)+"s";
  } else did = key+" stayed in between and never committed";
  if(man) did+=" (man coverage — he was locked on his receiver)";
  let correctTxt = correctId ? pl(correctId)+" was the correct read" : "both were covered — the answer was your next read or the checkdown";
  if(covered && correctId) correctTxt = "the throw away from him was covered by help, so "+pl(correctId)+" was the right answer";
  let choice=null, right=null, timing=null;
  if(tThrow!=null && mineId){
    right = correctId ? mineId===correctId || (sepOf(mineId)>=sepOf(correctId)-0.8 && sepOf(mineId)>=3.5) : sepOf(mineId)>=3.5;
    choice="You threw "+pl(mineId)+" at "+tThrow.toFixed(1)+"s.";
    if(tCommit!=null){ const d=tThrow-tCommit; timing = d< -0.15 ? "early" : d<=0.75 ? "ontime" : "late"; }
  } else if(tThrow==null){ choice="You never threw it."; right=false; }
  const timingTxt = timing==="early" ? "Early: you let it go before "+key+" showed you anything — that's a guess, even when it works."
    : timing==="ontime" ? "On time: the ball came out right as "+key+" declared."
    : timing==="late" ? "Late: "+key+" declared at "+tCommit.toFixed(1)+"s; get it out on his first step." : "";
  return {key:k.key, label:L, did, correctId, correctTxt, choice, right, timing, timingTxt, tCommit, commit, type:k.type, A:k.A, B:k.B, man};
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
}

export { KEY_CONCEPTS, MAN_FAMILY, routeEnd, readPt, keyShort, KEY_LONG, sideOf, keyLabel, findKeyPair, setupKeyRead, keyPlanText, analyzeKeyRead };
