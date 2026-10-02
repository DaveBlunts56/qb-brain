import { renderCoachNotes } from "./coach.js";
import { MODES } from "./config.js";
import { RESULT_COLORS, clearOverlays, isDrive, spotText } from "./drive.js";
import { tutExit } from "./learn.js";
import { rafId, studyTimer } from "./loop.js";
import { recordSession } from "./progress.js";
import { showScreen } from "./setup.js";
import { els, state } from "./state.js";

/* ============================================================
   SUMMARY
============================================================ */
function endSession(){
  if(state.tut){ tutExit(false); return; }
  cancelAnimationFrame(rafId);
  clearInterval(studyTimer);
  clearOverlays();
  recordSession(true);
  showScreen("summaryScreen");
  renderSummary();
}
function renderDriveSummary(){
  const d=state.drive;
  if(!d.over){ d.over=true; d.result="ENDED EARLY"; }
  els.summaryTitle.textContent="DRIVE SUMMARY"; els.logTitle.textContent="PLAY-BY-PLAY"; els.againBtn.textContent="RUN ANOTHER DRIVE";
  els.summarySub.textContent=d.result+" · "+d.plays.length+" play"+(d.plays.length===1?"":"s")+", "+d.yards+" yds · "+d.len+"×"+d.width+" field";
  els.statGrid.innerHTML="";
  [[d.score,"Drive score"],[d.yards+" yds","Total yards"],[d.comp+"/"+d.att,"Completions"],[d.firstDowns,"First downs"]].forEach(s=>{
    const c=document.createElement("div"); c.className="stat-card";
    c.innerHTML='<div class="n">'+s[0]+'</div><div class="l">'+s[1]+"</div>";
    els.statGrid.appendChild(c);
  });
  els.strengthRow.innerHTML="";
  const good=d.plays.filter(p=>p.result==="GOOD READ").length;
  const c1=document.createElement("div"); c1.className="strength-card "+(d.result==="TOUCHDOWN"?"good":"work");
  c1.innerHTML="<b>"+d.result+"</b><span>"+(d.result==="TOUCHDOWN"?"Drive finished in the end zone":"Drive ended at "+spotText(d,d.ballOn))+"</span>";
  const c2=document.createElement("div"); c2.className="strength-card good";
  c2.innerHTML="<b>"+good+" good read"+(good===1?"":"s")+"</b><span>of "+d.plays.length+" plays</span>";
  els.strengthRow.appendChild(c1); els.strengthRow.appendChild(c2);
  els.repLog.innerHTML="";
  d.plays.forEach((p,i)=>{
    const row=document.createElement("div"); row.className="rep-row";
    const col=RESULT_COLORS[p.result]||"var(--chalk-dim)";
    row.innerHTML='<span class="dot" style="background:'+col+'"></span><span class="c">'+(i+1)+". "+p.situation+" · "+p.play+" · "+p.headline+'</span><span class="pts">'+(p.points<0?"−"+Math.abs(p.points):"+"+p.points)+'</span>';
    els.repLog.appendChild(row);
  });
}
function renderSummary(){
  renderCoachNotes();
  if(isDrive() && state.drive){ renderDriveSummary(); return; }
  els.summaryTitle.textContent=MODES[state.mode].label.toUpperCase(); els.logTitle.textContent="REP LOG"; els.againBtn.textContent="GO AGAIN";
  const log=state.session.log, reps=log.length;
  els.summarySub.textContent = reps+" REP"+(reps===1?"":"S");
  const asked=log.filter(l=>l.coverageAsked && l.coverageCorrect!==null);
  const covPct = asked.length ? Math.round(100*asked.filter(l=>l.coverageCorrect).length/asked.length) : null;
  const dec=log.filter(l=>l.result);
  const goodPct = dec.length ? Math.round(100*dec.filter(l=>l.result==="GOOD READ").length/dec.length) : 0;
  const thrown=dec.filter(l=>l.result!=="SACKED");
  const avgTime = thrown.length ? thrown.reduce((s,l)=>s+l.time,0)/thrown.length : 0;
  els.statGrid.innerHTML="";
  [[covPct===null?"—":covPct+"%","Coverage recognition"],[dec.length?goodPct+"%":"—","Good decisions"],[thrown.length?avgTime.toFixed(1)+"s":"—","Avg time to throw"],[state.session.score,"Total score"]].forEach(s=>{
    const c=document.createElement("div"); c.className="stat-card";
    c.innerHTML='<div class="n">'+s[0]+'</div><div class="l">'+s[1]+"</div>";
    els.statGrid.appendChild(c);
  });
  const by={};
  log.forEach(l=>{ (by[l.coverage]=by[l.coverage]||{good:0,total:0}).total++; if(l.result==="GOOD READ"||(l.result===null&&l.coverageCorrect)) by[l.coverage].good++; });
  let strongest=null, weakest=null;
  Object.keys(by).forEach(k=>{ const r=by[k].good/by[k].total; if(!strongest||r>strongest.rate) strongest={cov:k,rate:r}; if(!weakest||r<weakest.rate) weakest={cov:k,rate:r}; });
  els.strengthRow.innerHTML="";
  if(strongest){ const c=document.createElement("div"); c.className="strength-card good"; c.innerHTML="<b>Strongest</b><span>"+strongest.cov+"</span>"; els.strengthRow.appendChild(c); }
  if(weakest && (!strongest || weakest.cov!==strongest.cov || weakest.rate<0.5)){ if(strongest && weakest.cov===strongest.cov) els.strengthRow.innerHTML=""; const c=document.createElement("div"); c.className="strength-card work"; c.innerHTML="<b>Needs work</b><span>"+weakest.cov+"</span>"; els.strengthRow.appendChild(c); }
  els.repLog.innerHTML="";
  log.forEach((l,i)=>{
    const row=document.createElement("div"); row.className="rep-row";
    const col=RESULT_COLORS[l.result]||(l.coverageCorrect?"var(--good)":"var(--bad)");
    row.innerHTML='<span class="dot" style="background:'+col+'"></span><span class="c">'+(i+1)+". "+l.play+" · "+l.coverage+(l.disguised?" (disguised)":"")+" · "+(l.result||(l.coverageCorrect?"Correct ID":"Missed ID"))+'</span><span class="pts">'+(l.points<0?"−"+Math.abs(l.points):"+"+l.points)+'</span>';
    els.repLog.appendChild(row);
  });
}


/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
}

export { endSession, renderDriveSummary, renderSummary };
