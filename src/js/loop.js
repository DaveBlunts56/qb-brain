import { updateView } from "./canvas.js";
import { recordDefHist } from "./coach.js";
import { MODES, clamp, dist, setGeometry, shuffle } from "./config.js";
import { checkBulletLane, isSacked, updateDefenders, updateRusher } from "./defense.js";
import { clearOverlays, finalizeCoverageOnly, finalizeYac, isDrive, yacStep } from "./drive.js";
import { finalizeSack, finalizeThrow } from "./evaluate.js";
import { filmStart } from "./film.js";
import { clearFx } from "./fx.js";
import { checkTapHold, clearTapHold, joy, joyVisible } from "./input.js";
import { keyPlanText } from "./keyread.js";
import { tutAdjustRep, tutEvent } from "./learn.js";
import { LIB } from "./myplays.js";
import { audibleShow, closeAudible, showCallSheet } from "./playbook.js";
import { buildRep, passerPos, playerById, stepPlayers } from "./rep.js";
import { updateHud } from "./setup.js";
import { SFX } from "./sound.js";
import { drawFrame, drawStatic } from "./sprites.js";
import { els, state } from "./state.js";
import { coveragePool } from "./train.js";

/* ============================================================
   REP LIFECYCLE
============================================================ */
let rafId=null, tSnap=0, done=false, lastFrameT=null;
// the first finalize* call for a rep wins; later ones (a late sack after a throw, etc.) are ignored
function claimFinish(){ if(done) return false; done=true; return true; }
/* Throw gesture (Retro Bowl style): pull back to aim — it starts as a LOB.
   While still pulling, tap anywhere with another finger to switch to a BULLET (tap again to switch back).
   Desktop: Space bar or right-click toggles. */
const aim = {active:false,start:null,cur:null,lob:true,pointerId:null,flash:0};
function aimType(){ return aim.lob ? "lob" : "bullet"; }
function toggleThrowType(){ if(!aim.active) return; aim.lob=!aim.lob; aim.flash=performance.now(); SFX.toggle(aim.lob); if(!aim.lob) tutEvent("toggle"); }

function startRep(opts){
  opts=opts||{};
  clearOverlays();
  lastFrameT=null;
  if(isDrive()){ const d=state.drive; setGeometry(d.width, -d.ballOn-10, d.len-d.ballOn+10); }
  else setGeometry(30, -14, 45);
  updateView();
  if(isDrive() && !opts.play){ updateHud(); showCallSheet(); return; }   // call your play first
  state.rep = buildRep(opts.play ? {play:opts.play} : undefined);
  if(state.tut) tutAdjustRep(state.rep);
  state.phase = "study";
  aim.active=false;
  updateHud();
  drawStatic();
  showPlayTag();
  if(state.rep.askCoverage) showCoverageQuestion(); else beginStudyCountdown();
  tutEvent("ready");
  if(MODES[state.mode].film && !state.tut) filmStart();
}
function label(p){ return p.id+"'s "+p.name; }
function progText(rep){
  return "Progression: "+rep.play.prog.slice(0,3).map(id=>label(playerById(rep,id))).join(" → ")+".";
}
function showPlayTag(){
  if(state.mode==="coverage_id"){ els.playTag.classList.add("hidden"); return; }
  const rep=state.rep, pl=rep.play;
  let html='<b>'+pl.name+'</b> · '+pl.form+(pl.kind==="run"?" · run":pl.kind==="trick"?" · trick":"");
  if(state.showProgression) html+='<br>'+pl.prog.slice(0,3).map((id,i)=>(i+1)+' '+label(playerById(rep,id))).join(' → ');
  if(rep.audibledFrom) html+='<br><span style="color:#ffc933">AUDIBLE</span> from '+rep.audibledFrom;
  if(rep.hot && Object.keys(rep.hot).length) html+='<br><span style="color:#ffc933">HOT</span> '+Object.keys(rep.hot).map(k=>k+" "+LIB[rep.hot[k]].name).join(", ");
  if(rep.plan && rep.plan.adaptiveNote && state.adaptive) html+='<br><span style="color:#5ab8ff">'+rep.plan.adaptiveNote+'</span>';
  if(state.showProgression && rep.keyRead && !MODES[state.mode].film) html+='<br><span style="color:#ff6b5a">'+keyPlanText(rep)+'</span>';
  els.playTag.innerHTML=html;
  els.playTag.classList.remove("hidden");
}
function showCoverageQuestion(){
  els.coverageSheet.classList.remove("hidden");
  els.controls.classList.add("hidden");
  const must = Array.from(new Set([state.rep.actualCoverage, state.rep.shownCoverage]));
  const others = shuffle(coveragePool(state.rep.squad).filter(c=>!must.includes(c)));
  const options = shuffle(must.concat(others).slice(0,4));
  els.mcqOptions.innerHTML="";
  const letters=["A","B","C","D"];
  options.forEach((opt,i)=>{
    const b=document.createElement("button");
    b.innerHTML='<span class="k">'+letters[i]+'</span><span>'+opt+"</span>";
    b.addEventListener("click",()=>{
      state.rep.coverageGuess = opt;
      els.coverageSheet.classList.add("hidden");
      els.controls.classList.remove("hidden");
      beginStudyCountdown();
      tutEvent("coverage");
    });
    els.mcqOptions.appendChild(b);
  });
}
let studyTimer=null;
function beginStudyCountdown(){
  state.phase="study";
  els.studyBanner.classList.remove("hidden");
  let remaining = state.rep.tStudy;
  els.studyCount.textContent = remaining.toFixed(1);
  els.primaryBtn.textContent="SNAP";
  els.primaryBtn.classList.remove("hidden");
  audibleShow(!!MODES[state.mode].throws);
  els.throwType.classList.add("hidden");
  clearInterval(studyTimer);
  studyTimer = setInterval(()=>{
    remaining -= 0.1;
    if(remaining<=0){ clearInterval(studyTimer); els.studyBanner.classList.add("hidden"); }
    else els.studyCount.textContent = remaining.toFixed(1);
  },100);
  drawStatic();
  els.primaryBtn.onclick = ()=>doSnap();
}
function doSnap(){
  closeAudible(); audibleShow(false);
  clearInterval(studyTimer);
  els.studyBanner.classList.add("hidden");
  els.playTag.classList.add("hidden");
  const throws=MODES[state.mode].throws;
  if(throws){
    els.aimHint.firstElementChild.textContent = state.throwMode==="pull" ? "Stick to scramble · pull back anywhere to throw" : "Stick to scramble · tap a receiver = bullet, hold = lob";
    els.aimHint.classList.remove("hidden");
    els.timerBarWrap.classList.remove("hidden");
  }
  els.primaryBtn.classList.add("hidden");
  els.controls.classList.add("hidden");   // the whole screen is the field during the play
  state.phase="decision";
  tSnap = performance.now();
  done=false;
  joy.keys={}; clearTapHold();
  joyVisible(!!throws);
  clearFx();
  SFX.snap();
  runLoop();
  tutEvent("snap");
}
function runLoop(){
  cancelAnimationFrame(rafId);
  let lastT = performance.now();
  const rep=state.rep;
  function frame(now){
    const dt = Math.min(0.05,(now-lastT)/1000);
    lastT = now;
    const t = (now - tSnap)/1000;

    if(state.phase==="yac"){
      stepPlayers(rep, t, dt);
      const end=yacStep(rep, t, dt);
      lastFrameT=t;
      drawFrame(t);
      if(end){ finalizeYac(t,end); return; }
      rafId = requestAnimationFrame(frame);
      return;
    }
    checkTapHold();
    stepPlayers(rep, t, dt);
    updateDefenders(rep, t, dt);
    updateRusher(rep, t, dt);
    recordDefHist(rep, t);
    lastFrameT=t;
    drawFrame(t);

    if(rep.clock){
      const frac=clamp(1-t/rep.clock,0,1);
      els.timerBar.style.transform="scaleX("+frac+")";
      els.timerBar.style.background = frac<0.3?"var(--bad)":frac<0.55?"var(--risky)":"var(--offense)";
    } else if(rep.rushStart && !rep.rusher.dropped){
      const frac=clamp(dist(rep.rusher,passerPos(rep,t))/rep.rushStart,0,1);
      els.timerBar.style.transform="scaleX("+frac+")";
      els.timerBar.style.background = frac<0.35?"var(--bad)":frac<0.6?"var(--risky)":"var(--offense)";
    } else { els.timerBar.style.transform="scaleX(1)"; els.timerBar.style.background="var(--offense)"; }

    if(!MODES[state.mode].throws){
      if(t>=2.8){ finalizeCoverageOnly(); return; }
    } else if(rep.ball){
      const lane=checkBulletLane(rep,t);
      if(lane){ finalizeThrow(t,lane); return; }
      if(t>=rep.ball.tLand){ finalizeThrow(t,null); if(state.phase==="yac") rafId=requestAnimationFrame(frame); return; }
    } else if(isSacked(rep,t) || t>9 || (rep.clock && t>rep.clock)){
      if(rep.clock && t>rep.clock) rep.clockOut=true;
      aim.active=false;
      finalizeSack(t);
      return;
    }
    if(state.phase==="decision") rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

export function init(){}

export { rafId, tSnap, done, lastFrameT, claimFinish, aim, aimType, toggleThrowType, startRep, label, progText, showPlayTag, showCoverageQuestion, studyTimer, beginStudyCountdown, doSnap, runLoop };
