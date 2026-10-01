import { GEO, dist } from "./config.js";
import { nearestDefender } from "./defense.js";
import { driveApply, isDrive, renderResult, startYac } from "./drive.js";
import { addFx } from "./fx.js";
import { clearTapHold, joyVisible } from "./input.js";
import { tutEvent } from "./learn.js";
import { claimFinish, label, progText, rafId } from "./loop.js";
import { posAt } from "./paths.js";
import { livePos, passerIdAt, passerPos, playerById } from "./rep.js";
import { updateHud } from "./setup.js";
import { SFX } from "./sound.js";
import { els, state } from "./state.js";

/* ============================================================
   EVALUATION
============================================================ */
const COVERAGE_TELLS = {
  "Man":"Each defender mirrors one receiver; nobody sits in a zone.",
  "Cover 1":"Man underneath with one deep middle defender helping over the top.",
  "Cover 2":"Two deep defenders split the field in halves; the rest sit in short zones.",
  "Cover 3":"Three deep defenders take thirds; underneath defenders guard the flats and hook.",
  "Underneath Zone":"Everyone sits in short-to-mid zones with no deep help, so deep shots are open if you beat the rush.",
  "Cover 4":"Four deep defenders split the field in quarters; only a few defenders cover the short area.",
  "Robber":"Man outside, one deep safety, and a robber sitting in the middle reading your eyes.",
  "Bracket":"Two defenders on your best receiver (one under, one over); man on everyone else.",
  "2-Man":"Two deep safeties with man coverage underneath."
};
function roleName(rep,d){
  if(!d) return "a defender";
  if(d.isRusher) return "the rusher (dropped into coverage)";
  if(d.role==="man") return "the man defender on "+d.assign.id;
  if(d.type==="deep") return "the deep defender";
  if(d.type==="flat") return "the flat defender";
  return "the middle (hook) defender";
}
function sideWord(x){ return x<GEO.CX ? "left" : "right"; }
function openness(rep,t){
  return rep.targets.map(p=>{ const q=livePos(p); return {p, pos:q, sep:nearestDefender(rep,q).dist}; });
}
function coverageBits(rep){
  let c=null;
  if(rep.askCoverage && rep.coverageGuess!==undefined) c=(rep.coverageGuess===rep.actualCoverage);
  return c;
}
function commonTail(rep,explain){
  if(rep.askCoverage) explain+=" Tell: "+COVERAGE_TELLS[rep.actualCoverage];
  return explain+" "+progText(rep);
}
function finishRep(rep,resultType,subtitle,explain,chips,points,coverageCorrect,time,outcome){
  state.phase="result";
  joyVisible(false); clearTapHold();
  cancelAnimationFrame(rafId);
  els.timerBarWrap.classList.add("hidden");
  els.rushCue.classList.add("hidden");
  els.aimHint.classList.add("hidden");
  els.controls.classList.add("hidden");
  let driveInfo=null;
  if(isDrive() && state.drive && outcome){
    driveInfo = driveApply(rep,outcome,resultType,chips,points);
    points = driveInfo.points;
  }
  state.session.reps++; state.session.score+=points;
  state.session.log.push({play:rep.play.name,coverage:rep.actualCoverage,disguised:rep.disguised,coverageAsked:rep.askCoverage,coverageCorrect,result:resultType,points,time});
  renderResult(resultType,subtitle,explain,chips,points,rep,driveInfo);
  updateHud();
  tutEvent("result",{result:resultType, type:rep.ball&&rep.ball.type});
}

function finalizeSack(t){
  if(!claimFinish()) return;
  const rep=state.rep, cc=coverageBits(rep);
  rep.sackT=t;
  let points=cc?100:0;
  const o=openness(rep,t).sort((a,b)=>b.sep-a.sep)[0];
  let explain = rep.clockOut ? "The 4-second clock ran out. In 7v7 nobody rushes, but the ball has to be out by 4.0s." : "The rusher got home before the ball came out.";
  if(o && o.sep>4) explain+=" "+label(o.p)+" was open by "+o.sep.toFixed(1)+" yds at that moment.";
  const passer=passerIdAt(rep,t);
  if(passer!=="Q") explain+=" Even after the pitch, "+passer+" has to get it out fast.";
  const py=passerPos(rep,t).y;
  const qp=passerPos(rep,t), qb=playerById(rep,passer);
  const puller = rep.rusher.dropped ? (nearestDefender(rep,qp).d||{}).pos : rep.rusher;
  if(qb && !rep.clockOut) qb.flagGone = (puller && puller.x<qp.x) ? "left" : "right";
  rep.ballGone=true;
  if(puller) addFx({kind:"flag",from:{x:qp.x,y:qp.y},to:{x:puller.x,y:puller.y},dur:850,text:"SACK!"});
  SFX.flag(); SFX.sackThud(); SFX.groan();
  finishRep(rep,"SACKED",isDrive()?"Sacked "+Math.abs(Math.round(py))+" yds behind the line.":"",commonTail(rep,explain),[["Coverage ID",cc===null?null:(cc?"+100":"+0")],["Read","+0"]],points,cc,t,{kind:"sack",y:py});
}

function finalizeThrow(t,lane){
  if(!claimFinish()) return;
  const rep=state.rep, b=rep.ball, L=b.to, cc=coverageBits(rep);
  let points=cc?100:0, resultType, explain, subtitle="";
  const chips=[["Coverage ID",cc===null?null:(cc?"+100":"+0")]];
  const o=openness(rep,t);
  const withD=o.map(x=>Object.assign(x,{dl:dist(x.pos,L)}));
  const near=withD.find(x=>x.p===b.chaser) || withD.slice().sort((a,c)=>a.dl-c.dl)[0];
  const best=withD.slice().sort((a,c)=>c.sep-a.sep)[0];
  const nd=nearestDefender(rep,L);
  const catchR = b.type==="lob" ? 1.4 : 1.2;   // receivers now track the ball, so this is hands reach
  const adjust = dist(posAt(near.p,t), L);    // how far off his route he had to go
  const typeWord = b.type==="lob" ? "lob" : "bullet";

  if(lane){
    resultType=lane.kind;
    subtitle="Bullet "+(lane.kind==="INTERCEPTED"?"picked off":"tipped")+" in the lane by "+roleName(rep,lane.def)+".";
    explain="A bullet stays low the whole way, so "+roleName(rep,lane.def)+" sitting in the throwing lane got a hand on it. Either lob it over that defender or pick a window that isn't behind him.";
    if(lane.kind==="INTERCEPTED"){ points-=50; chips.push(["Turnover","−50"]); } else chips.push(["Read","+0"]);
  } else if(near.dl>catchR){
    if(nd.dist<0.9){
      resultType="INTERCEPTED"; points-=50; chips.push(["Turnover","−50"]);
      explain="The ball landed on "+roleName(rep,nd.d)+", not a receiver.";
    } else {
      resultType="OFF TARGET"; chips.push(["Read","+0"]);
      subtitle=near.p.id+" broke off his route to chase it but came up "+near.dl.toFixed(1)+" yds short.";
      explain = label(near.p)+" read the throw and went for it, but it was "+adjust.toFixed(1)+" yds off his route — too far to get there in "+b.flight.toFixed(1)+"s. "
        + (b.type==="bullet" ? "A bullet gives him almost no time to adjust, so it has to be on the spot." : "The lob gave him time, but not that much.")
        + " Aim where the route will be when the ball arrives.";
    }
  } else if(nd.dist<0.8 && nd.dist<=near.dl){
    resultType="INTERCEPTED"; points-=50; chips.push(["Turnover","−50"]);
    explain=roleName(rep,nd.d)+" got to the catch point first and caught it.";
    if(b.type==="lob") explain+=" The lob was in the air "+b.flight.toFixed(1)+"s, which gave him time to close. A bullet gets there before help arrives.";
  } else if(nd.dist<1.3 && nd.dist<near.dl+0.5){
    resultType="BROKEN UP"; chips.push(["Read","+0"]);
    explain=roleName(rep,nd.d)+" arrived with the ball and knocked it away from "+near.p.id+".";
    if(b.type==="lob" && b.flight>1.3) explain+=" The lob hung up "+b.flight.toFixed(1)+"s — against tight coverage, drive it in on a line.";
  } else {
    const gap=best.sep-near.sep;
    subtitle="Complete to "+near.p.id+" ("+typeWord+", "+(adjust<=1.5?"on the money":"he adjusted "+adjust.toFixed(1)+" yds")+").";
    if(near.sep>=4 && (near.p===best.p || gap<1.5)){
      resultType="GOOD READ"; points+=150; chips.push(["Correct read","+150"]);
      explain=label(near.p)+" had "+near.sep.toFixed(1)+" yds of space against "+rep.actualCoverage+" when the ball arrived.";
    } else if(near.sep>=4){
      resultType="RISKY"; points+=75; chips.push(["Partial credit","+75"]);
      explain="Completed, but "+label(best.p)+" on the "+sideWord(best.pos.x)+" had "+best.sep.toFixed(1)+" yds of space vs "+near.sep.toFixed(1)+".";
    } else {
      resultType="RISKY"; points+=50; chips.push(["Partial credit","+50"]);
      explain="Completed into a tight window — "+roleName(rep,nearestDefender(rep,near.pos).d)+" was "+near.sep.toFixed(1)+" yds away.";
    }
    if(adjust<=1.5){ points+=50; chips.push(["Ball placement","+50"]); }
    else explain+=" "+near.p.id+" had to adjust "+adjust.toFixed(1)+" yds off his route to make the catch — a more accurate ball keeps him running.";
    if(b.tRel<2.0){ points+=75; chips.push(["Quick decision","+75"]); }
  }
  if(rep.disguised) explain+=" The defense showed "+rep.shownCoverage+" and rotated to "+rep.actualCoverage+" after the snap.";
  const completed = resultType==="GOOD READ" || resultType==="RISKY";
  // on-field moment for the result
  {
    const fl=b.from, ux=L.x-fl.x, uy=L.y-fl.y, ul=Math.hypot(ux,uy)||1, dir={x:ux/ul,y:uy/ul};
    if(completed){ addFx({kind:"burst",at:{x:near.pos.x,y:near.pos.y},dur:420,col:"#ffffff"}); SFX.catchIt(); }
    else if(resultType==="INTERCEPTED"){
      const dp = lane ? lane.def.pos : nd.d.pos; rep.ballGone=true;
      addFx({kind:"burst",at:{x:dp.x,y:dp.y},dur:700,col:"#e8412c",text:"PICKED!"}); SFX.swat(); SFX.groan();
    } else if(resultType==="BROKEN UP"){
      const dp = lane ? lane.def.pos : nd.d.pos; rep.ballGone=true;
      addFx({kind:"bounce",at:{x:dp.x,y:dp.y},dir:{x:-dir.x*0.6+(Math.random()-0.5)*0.8,y:-dir.y*0.4},roll:2.5,dur:800,text:"SWAT!",col:"#ffc933"}); SFX.swat(); SFX.bounce();
    } else {
      rep.ballGone=true;
      addFx({kind:"bounce",at:{x:L.x,y:L.y},dir,roll:b.type==="lob"?1.5:3.5,dur:800}); SFX.bounce();
    }
  }
  if(isDrive() && completed){
    const pend={resultType,subtitle,explain:commonTail(rep,explain),chips,points,cc,time:b.tRel,catchY:near.pos.y};
    if(near.pos.y >= rep.goalRel){ // caught in the end zone
      finishRep(rep,resultType,subtitle,pend.explain,chips,points,cc,b.tRel,{kind:"catch",y:near.pos.y,catchY:near.pos.y,how:"td"});
      return;
    }
    startYac(rep,near.p,t,pend);
    return;
  }
  const kind = resultType==="INTERCEPTED" ? "int" : "inc";
  finishRep(rep,resultType,subtitle,commonTail(rep,explain),chips,points,cc,b.tRel,{kind});
}

export function init(){}

export { COVERAGE_TELLS, roleName, sideWord, openness, coverageBits, commonTail, finishRep, finalizeSack, finalizeThrow };
