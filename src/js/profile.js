import { conceptFor } from "./coach.js";
import { on } from "./config.js";
import { familyOf } from "./film.js";
import { closeManual } from "./learn.js";
import { SCREENS, buildChoiceRow, refreshSetupUI, startSession } from "./setup.js";
import { els, saveSettings, state } from "./state.js";
import { load, save } from "./store.js";
import { actualShell, adaptivePlan } from "./train.js";

/* ============================================================
   QB PROFILE — your tendencies across sessions (stored on this device).
   Training metrics only: no ratings, no overall number.
============================================================ */

const PROFILE_MAX=600;
let PROFILE={v:1, recs:[]};

function profileSave(){ save("profile",PROFILE); }
function profileLoad(){ const o=load("profile",null); PROFILE = o && Array.isArray(o.recs) ? o : {v:1,recs:[]}; }
const OK_RESULTS=["GOOD READ","RISKY"];
// one record per rep (called from the coach after every result)
function profileRecord(rep,resultType,info){
  if(state.tut) return;
  const m=info.metrics||{}, con=conceptFor(rep.play);
  const r={t:Date.now(), m:state.mode, sq:rep.squad, d:state.difficulty, cov:rep.actualCoverage, sh:rep.shownCoverage, dg:rep.disguised?1:0, dk:rep.disguiseKind||null,
    shell:rep.shellShown||null, ashell:actualShell(rep), con:con?con.name:rep.play.name, res:resultType==="COVERAGE"?null:resultType,
    rel:m.release!=null?m.release:null, first:m.first?1:0, fOpen:m.firstOpen?1:0, fr:m.firstRight==null?null:(m.firstRight?1:0),
    miss:m.missed?1:0, tw:m.tw?1:0, pr:m.pressure?1:0, stare:m.stare?1:0,
    kr:m.keyRight==null?null:(m.keyRight?1:0), kt:m.keyTiming||null,
    cid: rep.askCoverage && rep.coverageGuess!==undefined ? (rep.coverageGuess===rep.actualCoverage?1:0) : null,
    mz: rep.askCoverage && rep.coverageGuess!==undefined ? (familyOf(rep.coverageGuess)===familyOf(rep.actualCoverage)?1:0) : null,
    ad: state.adaptive?1:0, plan: rep.plan && rep.plan.name || null};
  PROFILE.recs.push(r); if(PROFILE.recs.length>PROFILE_MAX) PROFILE.recs.splice(0,PROFILE.recs.length-PROFILE_MAX);
  profileSave();
}
function profileFilm(ans){
  const r=PROFILE.recs[PROFILE.recs.length-1]; if(!r) return;
  const b=a=>a?(a.ok?1:0):null;
  r.fmz=b(ans.mz); r.fcov=b(ans.cov); r.fkey=b(ans.key); r.fread=b(ans.read); r.fpost=b(ans.post);
  r.mz = r.fmz!=null ? r.fmz : r.mz;
  r.cid = r.fpost!=null ? r.fpost : r.cid;
  profileSave();
}
/* ---------- metrics ---------- */
const pct=(a,b)=>b?Math.round(100*a/b):null;
const rate=(arr,f)=>{ const v=arr.filter(r=>f(r)!=null); return {n:v.length, k:v.filter(r=>f(r)===1).length}; };
const success=r=> r.res==null ? r.cid : (OK_RESULTS.includes(r.res) && !r.tw ? 1 : 0);
function profileMetrics(recs){
  recs=recs||PROFILE.recs;
  const thr=recs.filter(r=>r.res && r.res!=="SACKED" && r.rel!=null);
  const plays=recs.filter(r=>r.res);
  const M={n:recs.length, plays:plays.length};
  M.release = thr.length ? thr.reduce((s,r)=>s+r.rel,0)/thr.length : null;
  const cid=rate(recs,r=>r.cid); M.covId={pct:pct(cid.k,cid.n), n:cid.n};
  const mz=rate(recs,r=>r.mz); M.mz={pct:pct(mz.k,mz.n), n:mz.n};
  const fr=rate(plays,r=>r.fr); M.first={pct:pct(fr.k,fr.n), n:fr.n};
  const kr=rate(plays,r=>r.kr); M.key={pct:pct(kr.k,kr.n), n:kr.n};
  const kl=plays.filter(r=>r.kt); M.keyLate={pct:pct(kl.filter(r=>r.kt==="late").length,kl.length), n:kl.length}; M.keyEarly={pct:pct(kl.filter(r=>r.kt==="early").length,kl.length), n:kl.length};
  M.missed={k:plays.filter(r=>r.miss).length, n:plays.length, pct:pct(plays.filter(r=>r.miss).length,plays.length)};
  M.tw={k:plays.filter(r=>r.tw).length, n:plays.length, pct:pct(plays.filter(r=>r.tw).length,plays.length)};
  const pr=plays.filter(r=>r.pr), cl=plays.filter(r=>!r.pr);
  M.pressure={n:pr.length, pct:pct(pr.filter(r=>success(r)===1).length,pr.length), clean:pct(cl.filter(r=>success(r)===1).length,cl.length), sacks:plays.filter(r=>r.res==="SACKED").length};
  const fst=plays.filter(r=>r.first && r.rel!=null); M.stare={k:plays.filter(r=>r.stare).length, n:fst.length, pct:pct(plays.filter(r=>r.stare).length,fst.length)};
  const group=(key,src)=>{ const g={}; src.forEach(r=>{ const k=key(r); if(!k) return; const s=success(r); if(s==null) return; (g[k]=g[k]||{n:0,k:0}); g[k].n++; g[k].k+=s; }); return g; };
  M.byCov=group(r=>r.cov,recs);
  M.byCon=group(r=>r.res?r.con:null,plays);
  M.byShell=group(r=>r.dg?(r.shell||"?")+"→rot":null,recs);
  const dg=recs.filter(r=>r.dg), nd=recs.filter(r=>!r.dg);
  M.disg={n:dg.length, pct:pct(dg.filter(r=>success(r)===1).length,dg.length), plain:pct(nd.filter(r=>success(r)===1).length,nd.length)};
  M.rotTwoHigh=(()=>{ const a=recs.filter(r=>r.dg && r.shell==="two-high" && r.ashell && r.ashell!==r.shell); return {n:a.length, pct:pct(a.filter(r=>success(r)===1).length,a.length)}; })();
  M.bluff=(()=>{ const a=recs.filter(r=>r.dg && r.dk && r.dk.indexOf("bluff")===0); return {n:a.length, pct:pct(a.filter(r=>success(r)===1).length,a.length)}; })();
  const last=recs.slice(-20), prev=recs.slice(-40,-20);
  M.trend={last:pct(last.filter(r=>success(r)===1).length,last.filter(r=>success(r)!=null).length), prev:prev.length>=8?pct(prev.filter(r=>success(r)===1).length,prev.filter(r=>success(r)!=null).length):null};
  const rank=(g,min)=>Object.keys(g).filter(k=>g[k].n>=min).map(k=>({k,n:g[k].n,pct:pct(g[k].k,g[k].n)})).sort((a,b)=>b.pct-a.pct);
  M.covRank=rank(M.byCov,3); M.conRank=rank(M.byCon,3);
  return M;
}
/* ---------- drills: each is a training plan ---------- */
const DRILLS={
  rotation:{name:"Post-Snap Rotation Drill", mode:"film", plan:{disguise:0.85, rotations:[["Cover 2","Cover 3"],["Cover 2","Cover 1"],["Cover 3","Cover 2"],["Cover 3","Cover 1"]]},
    sub:"Film Room reps where the shell rotates after the snap. Check the safeties again once the ball is snapped."},
  bluff:{name:"Man or Zone? Bluff Drill", mode:"film", plan:{disguise:0.8, rotations:[["Man","Cover 3"],["Man","Underneath Zone"],["Cover 1","Cover 3"],["Underneath Zone","Man"],["Cover 2","Cover 1"],["Cover 3","Cover 1"]]},
    sub:"Defenders show one thing and play another. Watch hips (man) vs eyes on you (zone)."},
  key:{name:"Key Read Drill", mode:"quick_read", book:"standard", plan:{plays:["Smash","Slant-Flat","Flood","Stick","Drive","Levels","Snag"], covWeights:{"Cover 2":2,"Cover 3":2,"Underneath Zone":1,"Cover 1":1}},
    sub:"High-low and inside-out concepts only. Watch the key defender and throw away from him."},
  pressure:{name:"Pressure Drill", mode:"quick_read", book:"standard", plan:{rushMul:1.12, rushPlans:{straight:0.4,edge:0.45,delay:0.15}, plays:["Slant-Flat","Stick","Spacing","Mesh","Snag"]},
    sub:"Faster, varied rush with quick-game concepts. Decide pre-snap, ball out on time."},
  eyes:{name:"Eyes Discipline Drill", mode:"quick_read", plan:{eyesMul:2.2, covWeights:{"Cover 3":2,"Cover 2":2,"Underneath Zone":2,"Cover 1":1}},
    sub:"Zone defenders and safeties chase your eyes hard. Look one way, throw the other."},
  open:{name:"Find the Open Man Drill", mode:"quick_read", plan:{covWeights:{"Cover 3":1,"Cover 2":1,"Underneath Zone":1,"Man":1}, rushMul:0.85},
    sub:"A little more time. Work 1-2-3 and take the receiver who's open — don't force #1."},
  security:{name:"Ball Security Drill", mode:"quick_read", plan:{covWeights:{"Underneath Zone":2,"Cover 2":1,"Cover 3":1}, eyesMul:1.5},
    sub:"Lots of underneath defenders. Throw to grass and away from leverage, or check it down."},
  manzone:{name:"Man vs Zone ID Drill", mode:"coverage_id", plan:{disguise:0.5}, sub:"Name the coverage every rep, with disguises mixed in."}
};
const COV_BEATERS={"Man":["Mesh","Slant-Flat","Snag","Drive"],"Cover 1":["Slant-Flat","Mesh","Flood","Four Verticals"],"Cover 2":["Smash","Four Verticals","Spacing","Stick"],"Cover 3":["Flood","Slant-Flat","Stick","Snag","Levels"],"Underneath Zone":["Four Verticals","Levels","Smash","Flood"]};
function covDrill(cov){ return {name:cov+" Drill", mode:"qb_brain", book:"standard", plan:{covWeights:{[cov]:1}, plays:COV_BEATERS[cov]||null}, sub:"Reps against "+cov+" with the concepts that beat it."}; }
function startDrill(dr){
  closeManual();
  state.plan=Object.assign({name:dr.name}, dr.plan);
  if(dr.book) state.book=dr.book;
  state.playPick="random";
  refreshSetupUI();
  startSession(dr.mode,{plan:state.plan});
}
/* ---------- diagnosis: weaknesses → drills ---------- */
function profileDiagnose(M){
  const out=[];
  const add=(sev,text,dr)=>out.push({sev,text,dr});
  if(M.rotTwoHigh.n>=3 && M.rotTwoHigh.pct<50) add(90-M.rotTwoHigh.pct*0.5,"You struggle when two-high shells rotate after the snap ("+M.rotTwoHigh.pct+"% on "+M.rotTwoHigh.n+" reps).",DRILLS.rotation);
  else if(M.disg.n>=4 && M.disg.pct!=null && M.disg.plain!=null && M.disg.pct < M.disg.plain-20) add(75,"Disguised coverages cost you: "+M.disg.pct+"% vs "+M.disg.plain+"% against honest looks.",DRILLS.rotation);
  if(M.bluff.n>=3 && M.bluff.pct<50) add(80-M.bluff.pct*0.4,"Bluffs fool you — man that turns into zone (or the reverse): "+M.bluff.pct+"% on "+M.bluff.n+" reps.",DRILLS.bluff);
  if(M.mz.n>=5 && M.mz.pct<70) add(78-M.mz.pct*0.3,"Man vs zone recognition is "+M.mz.pct+"%. That's the first read of every snap.",DRILLS.manzone);
  if(M.key.n>=4 && M.key.pct<60) add(85-M.key.pct*0.4,"You threw to the wrong side of the key defender "+(100-M.key.pct)+"% of the time.",DRILLS.key);
  else if(M.keyLate.n>=4 && M.keyLate.pct>=40) add(70,"You find the right read but late: "+M.keyLate.pct+"% of key reads came after the defender had already declared.",DRILLS.key);
  if(M.stare.n>=5 && M.stare.pct>=25) add(72,"You stare down your first read — "+M.stare.pct+"% of first-read throws went in while someone else was open.",DRILLS.eyes);
  if(M.pressure.n>=4 && M.pressure.pct!=null && M.pressure.clean!=null && M.pressure.pct < M.pressure.clean-20) add(74,"Under pressure your success drops from "+M.pressure.clean+"% to "+M.pressure.pct+"%.",DRILLS.pressure);
  else if(M.release!=null && M.release>2.5 && M.plays>=6) add(65,"Average release is "+M.release.toFixed(1)+"s — slow against a 7-yard rusher.",DRILLS.pressure);
  if(M.missed.n>=6 && M.missed.pct>=30) add(68,"You missed an open receiver on "+M.missed.pct+"% of plays.",DRILLS.open);
  if(M.tw.n>=6 && M.tw.pct>=15) add(76,M.tw.pct+"% of your throws were turnover-worthy (picks or balls thrown into tight coverage).",DRILLS.security);
  const worst=M.covRank.length?M.covRank[M.covRank.length-1]:null;
  if(worst && worst.pct<45) add(60+(45-worst.pct)*0.4,"Your toughest coverage is "+worst.k+" ("+worst.pct+"% on "+worst.n+" reps).",covDrill(worst.k));
  return out.sort((a,b)=>b.sev-a.sev).slice(0,4);
}
/* ---------- screen ---------- */
function tile(v,l,sub){ const d=document.createElement("div"); d.className="pf-tile"; d.innerHTML='<div class="n"></div><div class="l"></div><div class="s"></div>';
  d.children[0].textContent=v; d.children[1].textContent=l; d.children[2].textContent=sub||""; return d; }
function bars(box,rows){
  box.innerHTML="";
  if(!rows.length){ const p=document.createElement("div"); p.className="help"; p.textContent="Not enough reps yet (3+ per item)."; box.appendChild(p); return; }
  rows.forEach(r=>{ const row=document.createElement("div"); row.className="pf-bar";
    row.innerHTML='<span class="k"></span><span class="track"><i></i></span><span class="v"></span>';
    row.children[0].textContent=r.k; row.children[1].firstChild.style.width=Math.max(3,r.pct)+"%"; row.children[2].textContent=r.pct+"% · "+r.n;
    box.appendChild(row); });
}
function renderProfile(){
  const M=profileMetrics();
  els.pfSub.textContent = M.n ? "Based on your last "+M.n+" rep"+(M.n===1?"":"s")+" on this device." : "Play some reps (drills, Film Room or drives) and your profile builds itself.";
  const T=els.pfTiles; T.innerHTML="";
  const f=(v,suf)=>v==null?"—":v+(suf||"");
  T.append(
    tile(M.release==null?"—":M.release.toFixed(2)+"s","Avg release time", M.release==null?"":(M.release<1.8?"quick":M.release<2.5?"on time":"slow vs a rush")),
    tile(f(M.covId.pct,"%"),"Coverage recognition", M.covId.n?M.covId.n+" IDs":""),
    tile(f(M.mz.pct,"%"),"Man vs zone ID", M.mz.n?M.mz.n+" IDs":""),
    tile(f(M.first.pct,"%"),"Correct 1st-read decision", M.first.n?"throw it when open, move on when not":""),
    tile(f(M.key.pct,"%"),"Key defender reads", M.key.n?(M.keyLate.pct?M.keyLate.pct+"% late":"")+(M.keyEarly.pct?" · "+M.keyEarly.pct+"% early":""):""),
    tile(M.plays?M.missed.k+"":"—","Open receivers missed", M.plays?M.missed.pct+"% of plays":""),
    tile(f(M.tw.pct,"%"),"Turnover-worthy throws", M.plays?M.tw.k+" of "+M.tw.n:""),
    tile(f(M.pressure.pct,"%"),"Success under pressure", M.pressure.clean!=null?"vs "+M.pressure.clean+"% clean · "+M.pressure.sacks+" sacks":""),
    tile(f(M.stare.pct,"%"),"Stare-down rate", M.stare.n?"of first-read throws":"")
  );
  // diagnosis
  const D=profileDiagnose(M); els.pfDiag.innerHTML="";
  if(!D.length){ const p=document.createElement("div"); p.className="coach-note"; p.innerHTML="<p></p>";
    p.firstChild.textContent = M.n<10 ? "Get 10+ reps in and I'll start spotting patterns." : "No big leaks right now. Keep stacking reps on Varsity/Elite, or try Film Room with Adaptive on."; els.pfDiag.appendChild(p); }
  D.forEach(x=>{ const d=document.createElement("div"); d.className="coach-note"; const p=document.createElement("p"); p.textContent=x.text; d.appendChild(p);
    const s=document.createElement("small"); s.className="pf-dsub"; s.textContent="Recommended: "+x.dr.name+" — "+x.dr.sub; d.appendChild(s);
    const b=document.createElement("button"); b.type="button"; b.className="btn sm"; b.textContent="START "+x.dr.name.toUpperCase(); b.addEventListener("click",()=>startDrill(x.dr)); d.appendChild(b);
    els.pfDiag.appendChild(d); });
  bars(els.pfCov, M.covRank.concat(Object.keys(M.byShell).filter(k=>M.byShell[k].n>=3).map(k=>({k:k.replace("→rot"," rotated"),n:M.byShell[k].n,pct:pct(M.byShell[k].k,M.byShell[k].n)}))));
  const cr=M.conRank; bars(els.pfCon, cr.length>6 ? cr.slice(0,3).concat(cr.slice(-3)) : cr);
  els.pfTrend.textContent = M.trend.last==null ? "" : "Last 20 reps: "+M.trend.last+"% successful"+(M.trend.prev!=null?" (previous 20: "+M.trend.prev+"%)":"")+".";
  if(els.profileSummary) els.profileSummary.textContent = M.n ? M.n+" reps tracked" : "Your tendencies";
  renderAdaptiveStatus();
}

/* ---------- settings: 7v7 pass rush + adaptive ---------- */

function renderTrainingSettings(){
  if(els.rush7Row) buildChoiceRow(els.rush7Row,[
    {key:"clock",title:"4-sec clock",sub:"No rush, 7th defender in coverage (real 7v7)"},
    {key:"rusher",title:"One rusher",sub:"Rusher from 7 yds, 6 in coverage"}
  ], state.rush7||"clock", k=>{ state.rush7=k; });
  if(els.formatHelp) els.formatHelp.textContent = state.squad===7
    ? "7v7: layered zones, two-high shells, robbers, brackets and more rotations. Bigger picture, more to process."
    : "5v5: quick reads and spacing vs simple shells, a fast rush, and your center as the hot read.";
  if(els.adaptiveSwitch) els.adaptiveSwitch.classList.toggle("on",!!state.adaptive);
  if(els.rush7Row){ const show=state.squad===7; els.rush7Row.style.display=show?"":"none"; if(els.rush7Row.previousElementSibling) els.rush7Row.previousElementSibling.style.display=show?"":"none"; }
}
function flipAdaptive(){ state.adaptive=!state.adaptive; els.adaptiveSwitch.classList.toggle("on",state.adaptive); saveSettings(); refreshSetupUI(); }

function renderAdaptiveStatus(){
  const box=els.pfAdaptive; if(!box) return;
  box.classList.remove("hidden");
  box.firstChild.textContent = state.adaptive ? (adaptivePlan().note||"ADAPTIVE: on") + " (" + state.squad+"v"+state.squad+")" : "Adaptive training is off. Turn it on in Settings and every rep is built from this profile.";
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  SCREENS.push("profileScreen");
  ["profileScreen","pfSub","pfTiles","pfDiag","pfCov","pfCon","pfTrend","pfReset","profileSummary"].forEach(id=>{ els[id]=document.getElementById(id); });
  profileLoad();
  on("data:changed",k=>{ if(k!=="profile") return; profileLoad(); if(!els.profileScreen.classList.contains("hidden")) renderProfile(); else if(els.profileSummary){ const n=PROFILE.recs.length; els.profileSummary.textContent = n ? n+" reps tracked" : "Your tendencies"; } });
  els.pfReset.addEventListener("click",()=>{
    if(els.pfReset.dataset.arm!=="1"){ els.pfReset.dataset.arm="1"; els.pfReset.textContent="TAP AGAIN TO ERASE YOUR PROFILE"; return; }
    PROFILE={v:1,recs:[]}; profileSave(); els.pfReset.dataset.arm=""; els.pfReset.textContent="RESET PROFILE"; renderProfile();
  });
  on("screen",id=>{ if(id==="profileScreen"){ els.pfReset.dataset.arm=""; els.pfReset.textContent="RESET PROFILE"; renderProfile(); } });
  if(els.profileSummary){ const n=PROFILE.recs.length; els.profileSummary.textContent = n ? n+" reps tracked" : "Your tendencies"; }
  ["rush7Row","adaptiveSwitch","formatHelp","pfAdaptive"].forEach(id=>{ els[id]=document.getElementById(id); });
  els.adaptiveSwitch.addEventListener("click",flipAdaptive);
  els.adaptiveSwitch.addEventListener("keydown",(e)=>{ if(e.key===" "||e.key==="Enter"){ e.preventDefault(); flipAdaptive(); } });
  on("setup",renderTrainingSettings);
  renderTrainingSettings();
  ;
}

export { PROFILE_MAX, PROFILE, profileSave, OK_RESULTS, profileRecord, profileFilm, pct, rate, success, profileMetrics, DRILLS, COV_BEATERS, covDrill, startDrill, profileDiagnose, tile, bars, renderProfile, renderTrainingSettings, flipAdaptive, renderAdaptiveStatus, profileLoad };
