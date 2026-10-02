import { VIEW, ch } from "./canvas.js";
import { renderCoach } from "./coach.js";
import { GEO, MODES, clamp, dist } from "./config.js";
import { nearestDefender } from "./defense.js";
import { COVERAGE_TELLS, finishRep, roleName } from "./evaluate.js";
import { filmResult } from "./film.js";
import { addFx, afterPlay, afterTimer, cancelAfterPlay, clearFx } from "./fx.js";
import { joyVisible } from "./input.js";
import { tutAfterResult, tutEvent } from "./learn.js";
import { claimFinish, rafId, startRep } from "./loop.js";
import { AUD } from "./playbook.js";
import { ACCEL } from "./rep.js";
import { updateHud } from "./setup.js";
import { SFX } from "./sound.js";
import { els, state } from "./state.js";
import { endSession } from "./summary.js";

/* ============================================================
   FULL DRIVE
   Flag defaults: drive starts at your own 5, 4 downs to cross midfield, then 4 to score.
   Field length/width and the first-down rule are set on the setup screen.
============================================================ */
function isDrive(){ return state.mode==="drive"; }
function toGainFrom(d,ballOn){
  if(d.fd==="ten") return Math.min(ballOn+10,d.len);
  return ballOn < d.len/2 ? d.len/2 : d.len;
}
function newDrive(){
  const c=state.driveCfg;
  const d={len:c.len, width:c.width, fd:c.fd, ballOn:5, down:1, plays:[], score:0, over:false, result:null, firstDowns:0, yards:0, comp:0, att:0};
  d.toGain=toGainFrom(d,d.ballOn);
  return d;
}
function spotText(d,y){
  const r=Math.round(y), half=d.len/2;
  if(Math.abs(r-half)<0.5) return "MIDFIELD";
  return r<half ? "OWN "+r : "OPP "+(d.len-r);
}
function downText(d){
  const n=["1st","2nd","3rd","4th"][d.down-1]||(d.down+"th");
  return d.toGain>=d.len ? n+" & Goal" : n+" & "+Math.max(1,Math.round(d.toGain-d.ballOn));
}
// Run after the catch: the carrier heads upfield and bends away from pursuit; everyone chases to pull the flag.
function startYac(rep,carrier,t,pend){
  rep.carrier=carrier; rep.yacT0=t; rep.pending=pend;
  joyVisible(false);
  rep.defenders.forEach(d=>{ d.v={x:0,y:0}; });
  state.phase="yac";
  els.timerBarWrap.classList.add("hidden");
  els.controls.classList.add("hidden");
  els.aimHint.classList.add("hidden");
}
function yacStep(rep,t,dt){
  const c=rep.carrier, s=c.s, W=GEO.W;
  // carrier steering
  let dx=0, dy=1;
  const chasers=rep.defenders.map(d=>d.pos).concat(rep.rusher.dropped?[]:[rep.rusher]);
  chasers.forEach(p=>{
    const rx=s.x-p.x, ry=s.y-p.y, dd=Math.hypot(rx,ry)||0.01;
    if(dd<7 && p.y>s.y-3){ const w=3/(dd*dd+1); dx+=rx/dd*w; dy+=ry/dd*w*0.35; }
  });
  if(s.x<2.5) dx+=(2.5-s.x)*0.9; if(s.x>W-2.5) dx-=(s.x-(W-2.5))*0.9;
  dy=Math.max(dy,0.25);
  const L=Math.hypot(dx,dy); dx/=L; dy/=L;
  const want=7.2;
  let ax=dx*want-s.vx, ay=dy*want-s.vy; const a=Math.hypot(ax,ay), amax=ACCEL*dt;
  if(a>amax){ ax*=amax/a; ay*=amax/a; }
  s.vx+=ax; s.vy+=ay; s.x+=s.vx*dt; s.y+=s.vy*dt;
  c.hist.push({t,x:s.x,y:s.y});
  // pursuit (after a short reaction), aiming at where the carrier is heading
  const react = t>=rep.yacT0+0.15;
  const pursue=(pos,spd)=>{
    const dd=dist(pos,s), lead=Math.min(0.8,dd/9);
    const tx=s.x+s.vx*lead, ty=s.y+s.vy*lead, ex=tx-pos.x, ey=ty-pos.y, e=Math.hypot(ex,ey)||1;
    const step=Math.min(e,spd*dt); pos.x+=ex/e*step; pos.y+=ey/e*step;
  };
  if(react){ rep.defenders.forEach(d=>pursue(d.pos,7.4)); }
  if(!rep.rusher.dropped) pursue(rep.rusher, clamp(rep.rushSpeed,6.2,7.4));
  // camera follows a long run
  const visible=ch/VIEW.ppy;
  VIEW.yHi=Math.max(VIEW.yHi, s.y+visible*0.35);
  // end conditions
  for(const p of chasers){ if(dist(p,s)<0.9){ const who=rep.defenders.find(d=>d.pos===p); return {how:"flag", by:who?roleName(rep,who):"the rusher", px:p.x, py:p.y}; } }
  if(s.y>=rep.goalRel) return {how:"td"};
  if(s.x<=0.15 || s.x>=W-0.15) return {how:"oob"};
  if(t-rep.yacT0>8){ const nd=nearestDefender(rep,s); return {how:"flag", by:"the defense", px:nd.d?nd.d.pos.x:s.x, py:nd.d?nd.d.pos.y:s.y}; }
  return null;
}
function finalizeYac(t,end){
  if(state.phase!=="yac") return;
  const rep=state.rep, pd=rep.pending, c=rep.carrier;
  const y = end.how==="td" ? rep.goalRel : c.s.y;
  const after = Math.round(y - pd.catchY);
  let ex=pd.explain;
  if(end.how==="flag"){
    c.flagGone = end.px<c.s.x ? "left" : "right";
    addFx({kind:"flag",from:{x:c.s.x,y:c.s.y},to:{x:end.px,y:end.py},dur:850}); SFX.flag();
  } else if(end.how==="oob"){ addFx({kind:"dust",at:{x:c.s.x,y:c.s.y},dur:500}); addFx({kind:"text",at:{x:c.s.x,y:c.s.y+1.5},text:"OUT",dur:700,col:"#ffffff"}); }
  else if(end.how==="td"){ addFx({kind:"burst",at:{x:c.s.x,y:c.s.y},dur:800,col:"#ffc933"}); }
  const tail = end.how==="td" ? c.id+" caught it at "+Math.round(pd.catchY)+" and took it the rest of the way!"
    : end.how==="oob" ? c.id+" caught it at "+Math.round(pd.catchY)+" and ran "+Math.max(0,after)+" more before stepping out."
    : c.id+" caught it at "+Math.round(pd.catchY)+" and ran "+Math.max(0,after)+" more before "+end.by+" pulled the flag.";
  finishRep(rep,pd.resultType,(pd.subtitle?pd.subtitle+" ":"")+tail,ex,pd.chips,pd.points,pd.cc,pd.time,{kind:"catch",y,catchY:pd.catchY,how:end.how});
}
function driveApply(rep,o,resultType,chips,points){
  const d=state.drive; let pts=points;
  const add=(lab,v)=>{ chips.push([lab,(v<0?"−"+Math.abs(v):"+"+v)]); pts+=v; };
  const before={down:d.down, ballOn:d.ballOn, text:downText(d)+" at "+spotText(d,d.ballOn)};
  let gain=0, headline="", status="";
  if(o.kind==="int"){
    // replace the drill's −50 turnover with the drive penalty
    const i=chips.findIndex(c=>c[0]==="Turnover"); if(i>=0){ chips.splice(i,1); pts+=50; }
    add("Interception",-200); d.over=true; d.result="INTERCEPTION"; headline="Intercepted.";
    d.att++;
  } else if(o.kind==="inc"){
    d.att++;
    if(resultType==="OFF TARGET"||resultType==="BROKEN UP") add("Bad throw",-50);
    headline="Incomplete.";
  } else if(o.kind==="sack"){
    gain=Math.round(o.y); add("Sack",-100); headline="Sack, loss of "+Math.abs(gain)+".";
  } else if(o.kind==="catch"){
    d.att++; d.comp++;
    gain = o.how==="td" ? d.len-d.ballOn : Math.round(o.y);
    headline = o.how==="td" ? "TOUCHDOWN!" : (gain>=0?"Gain of "+gain+".":"Loss of "+Math.abs(gain)+".");
  }
  if(!d.over){
    const spot=d.ballOn+gain;
    if(o.kind==="catch" && (o.how==="td" || spot>=d.len)){
      if(gain>0) add("Yards ("+gain+")",gain*2);
      add("Touchdown",500); d.ballOn=d.len; d.over=true; d.result="TOUCHDOWN";
    } else if(spot<=0){
      add("Safety",-200); d.ballOn=0; d.over=true; d.result="SAFETY"; headline+=" Tackled in the end zone — safety.";
    } else {
      if(gain>0) add("Yards ("+gain+")",gain*2);
      d.ballOn=spot;
      if(d.ballOn>=d.toGain){
        add("First down",50); d.firstDowns++; d.down=1; d.toGain=toGainFrom(d,d.ballOn);
        headline+=" First down!";
      } else {
        d.down++;
        if(d.down>4){ add("Turnover on downs",-100); d.over=true; d.result="TURNOVER ON DOWNS"; }
      }
    }
  }
  d.yards += (o.kind==="int"||o.kind==="inc") ? 0 : gain;
  d.score += pts;
  status = d.over ? (d.result==="TOUCHDOWN" ? "Drive complete." : "Drive over.") : "Next: "+downText(d)+" at "+spotText(d,d.ballOn);
  d.plays.push({situation:before.text, play:rep.play.name, coverage:rep.actualCoverage, result:resultType, kind:o.kind, gain, headline, points:pts});
  return {points:pts, headline, status, over:d.over};
}

function finalizeCoverageOnly(){
  if(!claimFinish()) return;
  const rep=state.rep;
  const correct = rep.coverageGuess===rep.actualCoverage;
  const points = correct?100:0;
  state.phase="result";
  cancelAnimationFrame(rafId);
  els.rushCue.classList.add("hidden");
  els.controls.classList.add("hidden");
  state.session.reps++; state.session.score+=points;
  state.session.log.push({play:rep.play.name,coverage:rep.actualCoverage,disguised:rep.disguised,coverageAsked:true,coverageCorrect:correct,result:null,points,time:0});
  els.resultText.textContent = (correct?"CORRECT":"INCORRECT")+" — "+rep.actualCoverage.toUpperCase();
  els.resultTag.querySelector(".dot").style.background = correct?"var(--good)":"var(--bad)";
  let sub = "You guessed "+rep.coverageGuess+". It was "+rep.actualCoverage+".";
  if(rep.disguised) sub += " It showed "+rep.shownCoverage+" and rotated after the snap.";
  els.resultSub.textContent = sub;
  els.resultExplain.textContent = COVERAGE_TELLS[rep.actualCoverage];
  els.playNote.classList.add("hidden");
  els.scoreRow.innerHTML="";
  [["Coverage ID","+"+points],["TOTAL","+"+points]].forEach(c=>{
    const d=document.createElement("div"); d.className="score-chip";
    d.innerHTML=c[0]+": <b>"+c[1]+"</b>"; els.scoreRow.appendChild(d);
  });
  els.nextRepBtn.textContent=nextRepLabel(); els.driveLine.classList.add("hidden");
  rep.endT=2.8; renderCoach(rep,"COVERAGE");
  showBanner(correct?"CORRECT!":"WRONG LOOK", correct?"good":"bad", ()=>els.resultSheet.classList.remove("hidden"));
  updateHud();
  tutEvent("result",{correct});
}

const RESULT_COLORS={"GOOD READ":"var(--good)","RISKY":"var(--risky)","COVERED":"var(--bad)","SACKED":"var(--bad)","OFF TARGET":"var(--risky)","BROKEN UP":"var(--bad)","INTERCEPTED":"var(--bad)"};
// Retro Bowl style banner across the field, then the breakdown slides up
function bannerFor(resultType, driveInfo){
  if(driveInfo){
    const h=driveInfo.headline;
    if(/TOUCHDOWN/.test(h)) return ["TOUCHDOWN!","gold"];
    if(/SAFETY/.test(driveInfo.status)) return ["SAFETY","bad"];
    if(/TURNOVER ON DOWNS/.test(driveInfo.status)) return ["TURNOVER ON DOWNS","bad"];
    if(/Intercepted/.test(h)) return ["INTERCEPTED","bad"];
    if(/First down/.test(h)) return ["FIRST DOWN","good"];
    if(/Sack/.test(h)) return [state.rep && state.rep.clockOut ? "TIME!" : "SACKED","bad"];
    if(/Incomplete/.test(h)) return ["INCOMPLETE",""];
    const m=h.match(/Gain of (\d+)/); if(m) return ["+"+m[1]+" YARDS","good"];
    const l=h.match(/Loss of (\d+)/); if(l) return ["LOSS OF "+l[1],"bad"];
  }
  if(resultType==="SACKED" && state.rep && state.rep.clockOut) return ["TIME!","bad"];
  const map={"GOOD READ":["GOOD READ","good"],"RISKY":["COMPLETE",""],"COVERED":["COVERED","bad"],"SACKED":["SACKED","bad"],"OFF TARGET":["INCOMPLETE",""],"BROKEN UP":["BROKEN UP","bad"],"INTERCEPTED":["INTERCEPTED","bad"]};
  return map[resultType]||[resultType,""];
}
let bannerTimer=null, bannerSkip=null;
function showBanner(text,cls,then){
  clearTimeout(bannerTimer);
  if(bannerSkip) els.fieldWrap.removeEventListener("pointerdown",bannerSkip);
  els.bigBannerText.textContent=text;
  els.bigBanner.className=cls||"";
  els.bigBannerText.style.animation="none"; void els.bigBannerText.offsetWidth; els.bigBannerText.style.animation="";
  const done=()=>{ clearTimeout(bannerTimer); if(bannerSkip){ els.fieldWrap.removeEventListener("pointerdown",bannerSkip); bannerSkip=null; } els.bigBanner.classList.add("hidden"); if(then) then(); };
  bannerSkip=()=>done();
  els.fieldWrap.addEventListener("pointerdown",bannerSkip);
  bannerTimer=setTimeout(done,1000);
}
function renderResult(resultType, subtitle, explain, chips, points, rep, driveInfo){
  els.resultText.textContent = resultType==="SACKED" && rep.clockOut ? "CLOCK RAN OUT" : resultType;
  if(driveInfo){
    els.driveLine.innerHTML="<b>"+driveInfo.headline+"</b> "+driveInfo.status;
    els.driveLine.classList.remove("hidden");
    els.nextRepBtn.textContent = driveInfo.over ? "DRIVE SUMMARY" : "NEXT PLAY";
  } else { els.driveLine.classList.add("hidden"); els.nextRepBtn.textContent=nextRepLabel(); }
  els.resultTag.querySelector(".dot").style.background = RESULT_COLORS[resultType];
  let sub = subtitle;
  if(rep.askCoverage && rep.coverageGuess!==undefined){
    sub += (sub?" · ":"")+"Coverage: you guessed "+rep.coverageGuess+", it was "+rep.actualCoverage+".";
  } else if(rep.disguised && sub.indexOf("rotated")<0){
    sub += (sub?" · ":"")+"Rotated from "+rep.shownCoverage+" into "+rep.actualCoverage+".";
  }
  els.resultSub.textContent = sub;
  els.resultExplain.textContent = explain;
  if(rep.play.note){ els.playNote.innerHTML="<b>"+rep.play.name+":</b> "+rep.play.note; els.playNote.classList.remove("hidden"); }
  else els.playNote.classList.add("hidden");
  els.scoreRow.innerHTML="";
  chips.filter(c=>c[1]!==null).concat([["TOTAL",(points<0?"−"+Math.abs(points):"+"+points)]]).forEach(c=>{
    const d=document.createElement("div"); d.className="score-chip";
    d.innerHTML=c[0]+": <b>"+c[1]+"</b>";
    els.scoreRow.appendChild(d);
  });
  renderCoach(rep,resultType);
  if(MODES[state.mode].film) filmResult(rep); else els.filmBox.classList.add("hidden");
  const bn=bannerFor(resultType,driveInfo);
  els.resultSheet.classList.add("hidden");
  SFX.whistle();
  afterPlay(()=>{
    if(bn[1]==="gold") SFX.cheer(true); else if(bn[1]==="good") SFX.cheer(false);
    showBanner(bn[0],bn[1],()=>els.resultSheet.classList.remove("hidden"));
  });
}

function clearOverlays(){
  ["aimHint","playTag","coverageSheet","resultSheet","timerBarWrap","rushCue","studyBanner","throwType","bigBanner","joy","callSheet","audibleSheet","audibleBtn","coachCard","coachBubble","filmSheet","filmBox"].forEach(k=>els[k].classList.add("hidden"));
  clearTimeout(bannerTimer); clearTimeout(afterTimer);
  if(typeof AUD!=="undefined"){ AUD.open=false; AUD.sel=null; }
  cancelAfterPlay();
  clearFx();
  els.controls.classList.remove("hidden");
  els.primaryBtn.classList.remove("hidden");
}

/* ---- sessions with a set number of reps (the daily challenge) end on their own ---- */
function sessionComplete(){ const S=state.session; return !!(S && S.target && S.reps>=S.target); }
function nextRepLabel(){ return sessionComplete() ? "FINISH" : "NEXT REP"; }

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  els.nextRepBtn.addEventListener("click",()=>{
    els.resultSheet.classList.add("hidden");
    if(state.tut){ tutAfterResult(); return; }
    if((isDrive() && state.drive && state.drive.over) || sessionComplete()) endSession(); else startRep();
  });
}

export { isDrive, toGainFrom, newDrive, spotText, downText, startYac, yacStep, finalizeYac, driveApply, finalizeCoverageOnly, RESULT_COLORS, bannerFor, bannerTimer, bannerSkip, showBanner, renderResult, clearOverlays };
